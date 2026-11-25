import type { IncomingMessage, Server } from "node:http";
import { ZIP_LIMITS, publishReadMs } from "@tavora/pack";
import { REMOVED_ZIP, type CatalogStore } from "./catalog.ts";

/**
 * Node ends a request after 5 minutes by default, which cut off a slow honest upload the catalog was still willing to read
 * (publishReadMs: about 8 minutes for the biggest zip on a 1 Mbit/s line). The catalog's own reader is what limits an upload.
 */
export const REQUEST_TIMEOUT_MS = 600_000;
/** Headers still have to arrive within Node's default minute, so a slow request can't hold a connection before it is known. */
export const HEADERS_TIMEOUT_MS = 60_000;
/** How long any other request may take to send its body. The biggest is a cloud copy's 8 MB, and the app gives that 60 s. */
export const BODY_TIMEOUT_MS = 120_000;
/** How long a request may go on sending after it was answered: time for the client to read the answer before the line is cut. */
export const ANSWERED_BODY_MS = 15_000;

const isPublish = (request: IncomingMessage) => request.method === "POST" && (request.url ?? "").split("?")[0] === "/v1/catalog/publish";
const hasBody = (request: IncomingMessage) => request.headers["transfer-encoding"] !== undefined || Number(request.headers["content-length"] ?? 0) > 0;

/**
 * Sets the server's limits. Node's request limit is one number for every route, so it is the long one publish needs, and each
 * other request with a body is cut off here if it hasn't finished sending in time. Any request still sending after it was
 * answered, publish too, is cut off shortly after: a stalled client holds a connection for nothing.
 */
export function setServerTimeouts(server: Server, { bodyMs = BODY_TIMEOUT_MS, answeredMs = ANSWERED_BODY_MS }: { bodyMs?: number; answeredMs?: number } = {}): void {
  server.requestTimeout = Math.max(REQUEST_TIMEOUT_MS, publishReadMs(ZIP_LIMITS.maxArchiveBytes) + 60_000);
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.on("request", (request, response) => {
    if (!hasBody(request)) return;
    let timer: NodeJS.Timeout | undefined;
    const cutIn = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!request.complete) request.socket.destroy();
      }, ms);
      timer.unref();
    };
    const finished = () => clearTimeout(timer);
    request.once("end", finished);
    request.once("close", finished);
    if (!isPublish(request)) cutIn(bodyMs);
    response.once("finish", () => {
      if (!request.complete) cutIn(answeredMs);
    });
  });
}

/**
 * The signed hash and file hashes of each version from before they were kept. Only rows still without them are read, so after
 * the first start this is quick; a zip it can't use is named and the start goes on. Whatever goes wrong here (a database that
 * can't be written, say) is logged and never stops the service: it is tried again at the next start.
 */
export function backfillAtStart(catalog: CatalogStore, log: Pick<Console, "log" | "warn" | "error"> = console): void {
  try {
    const { filled, skipped } = catalog.backfillSignedHashes({ skipStalled: true });
    if (filled > 0) log.log(`[tavora-api] Filled the signed hash of ${filled} catalog versions.`);
    const removed = skipped.filter((version) => version.reason === REMOVED_ZIP).length;
    if (removed > 0) log.log(`[tavora-api] ${removed} catalog versions have no signed hash: their zip was removed to make room.`);
    for (const version of skipped.filter((version) => version.reason !== REMOVED_ZIP)) log.warn(`[tavora-api] Hashes not filled for ${version.id} ${version.version} (${version.sha256}): ${version.reason}.`);
  } catch (error) {
    log.error(`[tavora-api] Couldn't fill the catalog's hashes at this start: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A timer's work with its errors kept to a log line: a throw in a setInterval callback would end the whole service. */
export function guarded(what: string, run: () => void, log: Pick<Console, "error"> = console): () => void {
  return () => {
    try {
      run();
    } catch (error) {
      log.error(`[tavora-api] ${what} failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  };
}

/** How long a stop waits for the requests that are running (systemd waits 90 s before it kills). */
export const SHUTDOWN_GRACE_MS = 20_000;

/**
 * Stops cleanly on SIGTERM (systemctl stop or restart, a deploy) and SIGINT: the servers take no new request, the running
 * ones may finish for up to `graceMs`, then every store is closed (`close`, each on its own) and the process exits 0. A
 * second signal meanwhile changes nothing. `on`, `exit` and `log` are for tests.
 */
export function shutDownOnSignals({
  servers,
  close,
  graceMs = SHUTDOWN_GRACE_MS,
  on = (signal, run) => void process.on(signal, run),
  exit = (code) => process.exit(code),
  log = console,
}: {
  servers: Server[];
  close: (() => void)[];
  graceMs?: number;
  on?: (signal: "SIGTERM" | "SIGINT", run: () => void) => void;
  exit?: (code: number) => void;
  log?: Pick<Console, "log" | "error">;
}): void {
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.log(`[tavora-api] ${signal}: finishing the running requests, then stopping.`);
    const closed = servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          // Kept-alive connections that wait for their next request would hold close() up: now, and each one whose
          // request finishes during the stop, so none waits out its keep-alive (hunt 2026-11-25 E4).
          server.closeIdleConnections();
        }),
    );
    const idle = setInterval(() => {
      for (const server of servers) server.closeIdleConnections();
    }, 250);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        log.error(`[tavora-api] Requests still running after ${Math.round(graceMs / 1000)} s; stopping anyway.`);
        for (const server of servers) server.closeAllConnections();
        resolve();
      }, graceMs);
    });
    void Promise.race([Promise.all(closed), late]).then(() => {
      clearTimeout(timer);
      clearInterval(idle);
      for (const done of close) {
        try {
          done();
        } catch (error) {
          log.error(`[tavora-api] Closing a store failed: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
      exit(0);
    });
  };
  on("SIGTERM", () => stop("SIGTERM"));
  on("SIGINT", () => stop("SIGINT"));
}
