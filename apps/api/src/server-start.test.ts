import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { publishReadMs, ZIP_LIMITS } from "@tavora/pack";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogStore } from "./catalog.ts";
import { backfillAtStart, HEADERS_TIMEOUT_MS, setServerTimeouts } from "./server-start.ts";

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
