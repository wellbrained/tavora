import { mkdtempSync, readFileSync } from "node:fs";
import http, { createServer, type Server } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { publishReadMs, ZIP_LIMITS } from "@tavora/pack";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundWork } from "./background-work.ts";
import { CatalogStore } from "./catalog.ts";
import { backfillAtStart, guarded, HEADERS_TIMEOUT_MS, setServerTimeouts, shutDownOnSignals } from "./server-start.ts";

const source = () => readFileSync(new URL("./server.ts", import.meta.url), "utf8");

describe("starting the server", () => {
  it("goes on when the backfill can't write to the catalog, and says so", () => {
    const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-start-")));
    catalog.setState("signed_backfill_reading", "a".repeat(64));
    catalog.setState = () => {
      throw new Error("attempt to write a readonly database");
    };
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(() => backfillAtStart(catalog, log)).not.toThrow();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("readonly database"));
    catalog.close();
  });

  it("runs the backfill through that guard", () => {
    expect(source()).toContain("backfillAtStart(catalog)");
    expect(source()).not.toContain("catalog.backfillSignedHashes");
  });

  it("gives a request longer than the slowest upload the catalog allows, and headers only their minute", () => {
    const server = createServer();
    setServerTimeouts(server);
    expect(server.requestTimeout).toBeGreaterThan(publishReadMs(ZIP_LIMITS.maxArchiveBytes));
    expect(server.requestTimeout).toBeGreaterThanOrEqual(600_000);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.headersTimeout).toBeLessThan(server.requestTimeout);
  });

  it("sets those timeouts on the public server", () => {
    expect(source()).toMatch(/setServerTimeouts\(publicServer/);
  });
});

describe("a request that stops sending its body", () => {
  const servers: Server[] = [];
  const sockets: net.Socket[] = [];
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.destroy();
    for (const server of servers.splice(0)) server.close();
  });

  /** A server that answers right away, or never when `answer` is false. */
  async function serverWith(answer: boolean) {
    const server = createServer((_request, response) => {
      if (answer) response.end("answered");
    });
    setServerTimeouts(server, { bodyMs: 80, answeredMs: 40 });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as net.AddressInfo).port;
  }

  /** Sends headers and one byte of a longer body, then stalls. Resolves `closed` when the server cuts the line. */
  function stalled(port: number, target: string) {
    const socket = net.connect(port, "127.0.0.1");
    sockets.push(socket);
    let isClosed = false;
    const closed = new Promise<void>((resolve) => {
      const done = () => {
        isClosed = true;
        resolve();
      };
      socket.on("close", done);
      socket.on("error", done);
    });
    socket.on("data", () => {});
    socket.write(`POST ${target} HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\nx`);
    return { closed, isClosed: () => isClosed };
  }
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("is cut off on any other route, even before it is answered", async () => {
    const line = stalled(await serverWith(false), "/v1/account/profile");
    await line.closed;
    expect(line.isClosed()).toBe(true);
  });

  it("is cut off after it was answered, also on the publish route", async () => {
    const other = stalled(await serverWith(true), "/v1/account/profile");
    const publish = stalled(await serverWith(true), "/v1/catalog/publish");
    await Promise.all([other.closed, publish.closed]);
    expect(publish.isClosed()).toBe(true);
  });

  it("keeps a publish that is still being read, past the limit other routes get", async () => {
    const line = stalled(await serverWith(false), "/v1/catalog/publish?x=1");
    await wait(220);
    expect(line.isClosed()).toBe(false);
  });

  it("is cut off through the real HTTP adapter too, after a route answered without reading it", async () => {
    const app = new Hono().post("/v1/account/profile", (context) => context.json({ ok: true }, 400));
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as Server;
    servers.push(server);
    setServerTimeouts(server, { bodyMs: 80, answeredMs: 40 });
    await new Promise((resolve) => server.once("listening", resolve));
    const line = stalled((server.address() as net.AddressInfo).port, "/v1/account/profile");
    await line.closed;
    expect(line.isClosed()).toBe(true);
  });

  it("is cut off through the real HTTP adapter while a route is still reading it", async () => {
    const app = new Hono().post("/v1/account/profile", async (context) => context.text(await context.req.text()));
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as Server;
    servers.push(server);
    setServerTimeouts(server, { bodyMs: 80, answeredMs: 40 });
    await new Promise((resolve) => server.once("listening", resolve));
    const line = stalled((server.address() as net.AddressInfo).port, "/v1/account/profile");
    await line.closed;
    expect(line.isClosed()).toBe(true);
  });

  it("leaves a finished request's connection open for the next one", async () => {
    const port = await serverWith(true);
    const socket = net.connect(port, "127.0.0.1");
    sockets.push(socket);
    let received = "";
    socket.on("data", (chunk) => (received += chunk.toString()));
    socket.write("POST /v1/account/profile HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\nok");
    await wait(160);
    expect(socket.destroyed).toBe(false);
    socket.write("GET /next HTTP/1.1\r\nHost: x\r\n\r\n");
    await wait(40);
    expect(received.match(/HTTP\/1\.1 200/g)).toHaveLength(2);
  });
});

describe("timers and shutdown (bug hunt)", () => {
  it("keeps a timer's error to a log line, so a broken sweep never takes the service down", () => {
    const log = { error: vi.fn() };
    const sweep = guarded("Sweeping the conversations", () => {
      throw new Error("database disk image is malformed");
    }, log);
    expect(() => sweep()).not.toThrow();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Sweeping the conversations failed: database disk image is malformed"));
  });

  it("runs every sweep and snapshot of server.ts through that guard", () => {
    expect(source()).toMatch(/guarded\("Sweeping the conversations"/);
    expect(source()).toMatch(/guarded\("Writing down the account numbers"/);
    expect(source()).toContain("shutDownOnSignals(");
  });

  it("on SIGTERM stops taking requests, lets the running one finish, closes the stores and exits 0", async () => {
    let finish!: () => void;
    const server = createServer((_request, response) => {
      finish = () => response.end("done");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    const handlers = new Map<string, () => void>();
    const closed: string[] = [];
    let exitCode: number | null = null;
    const exited = new Promise<void>((resolve) => {
      shutDownOnSignals({
        servers: [server],
        close: [() => closed.push("accounts"), () => closed.push("catalog")],
        graceMs: 5000,
        on: (signal, run) => void handlers.set(signal, run),
        exit: (code) => {
          exitCode = code;
          resolve();
        },
        log: { log: () => {}, error: () => {} },
      });
    });
    expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
    const running = fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    await new Promise((resolve) => setTimeout(resolve, 50));
    handlers.get("SIGTERM")!();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Nothing new is taken, nothing is closed while the request runs.
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    expect(closed).toEqual([]);
    expect(exitCode).toBeNull();
    finish();
    expect(await running).toBe("done");
    await exited;
    expect(closed).toEqual(["accounts", "catalog"]);
    expect(exitCode).toBe(0);
  });

  it("doesn't wait out the keep-alive of a connection whose request finished during the stop (hunt 2026-11-25 E4)", async () => {
    let finish!: () => void;
    const server = createServer((_request, response) => {
      finish = () => response.end("done");
    });
    server.keepAliveTimeout = 4000;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    const handlers = new Map<string, () => void>();
    const exited = new Promise<number>((resolve) =>
      shutDownOnSignals({ servers: [server], close: [], graceMs: 10_000, on: (signal, run) => void handlers.set(signal, run), exit: resolve, log: { log: () => {}, error: () => {} } }),
    );
    // A client that keeps its connection open for the next request, as browsers and the app do.
    const agent = new http.Agent({ keepAlive: true });
    const running = new Promise<string>((resolve, reject) =>
      http.get({ host: "127.0.0.1", port, agent }, (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve(text));
      }).on("error", reject),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    handlers.get("SIGTERM")!();
    await new Promise((resolve) => setTimeout(resolve, 50));
    finish();
    expect(await running).toBe("done");
    const started = Date.now();
    expect(await exited).toBe(0);
    expect(Date.now() - started).toBeLessThan(2000);
    agent.destroy();
  });

  it("waits for mail still going out before it closes the stores, within the grace time (review of #976)", async () => {
    const server = createServer((_request, response) => response.end("done"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const handlers = new Map<string, () => void>();
    const closed: string[] = [];
    const background = new BackgroundWork();
    let sendMail!: () => void;
    background.add(new Promise<void>((resolve) => (sendMail = resolve)));
    let exited = false;
    const exit = new Promise<number>((resolve) =>
      shutDownOnSignals({ servers: [server], pending: () => background.settled(), close: [() => closed.push("accounts")], graceMs: 5000, on: (signal, run) => void handlers.set(signal, run), exit: (code) => ((exited = true), resolve(code)), log: { log: () => {}, error: () => {} } }),
    );
    handlers.get("SIGTERM")!();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The server is closed, the mail still goes: the stores stay open for it.
    expect(closed).toEqual([]);
    expect(exited).toBe(false);
    sendMail();
    expect(await exit).toBe(0);
    expect(closed).toEqual(["accounts"]);
  });

  it("gives up waiting after the grace period, still closing the stores", async () => {
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    const handlers = new Map<string, () => void>();
    const closed: string[] = [];
    const exited = new Promise<number>((resolve) =>
      shutDownOnSignals({ servers: [server], close: [() => closed.push("accounts")], graceMs: 100, on: (signal, run) => void handlers.set(signal, run), exit: resolve, log: { log: () => {}, error: () => {} } }),
    );
    void fetch(`http://127.0.0.1:${port}/`).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    handlers.get("SIGINT")!();
    expect(await exited).toBe(0);
    expect(closed).toEqual(["accounts"]);
  });
});
