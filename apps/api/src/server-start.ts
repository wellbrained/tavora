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
