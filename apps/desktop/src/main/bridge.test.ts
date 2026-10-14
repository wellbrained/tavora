import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeSession, MAX_IN_FLIGHT, type BridgeContext } from "./bridge";
import { THEMES } from "./games";
import { ModuleStore } from "./storage";

class FakePort extends EventEmitter {
  sent: unknown[] = [];
  closed = false;
  postMessage(message: unknown) {
    this.sent.push(message);
  }
  start() {}
  close() {
    this.closed = true;
  }
  receive(data: unknown, ports: { close(): void }[] = []) {
    this.emit("message", { data, ports });
  }
}

let port: FakePort;
let context: BridgeContext;
let session: BridgeSession;

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
const response = (id: number) => port.sent.find((m) => (m as { id?: number }).id === id) as Record<string, unknown>;

beforeEach(async () => {
  port = new FakePort();
  context = {
    moduleId: "local.example.a",
    game: { id: "poe2", displayName: "Path of Exile 2" },
    store: new ModuleStore(path.join(await mkdtemp(path.join(tmpdir(), "tavora-bridge-")), "s.json")),
    getViewport: () => ({ width: 400, height: 300 }),
    getTheme: () => THEMES.dark,
  };
  session = new BridgeSession(port, context);
});

describe("BridgeSession", () => {
  it("answers with the bound game, ignoring anything the module claims", async () => {
    port.receive({ v: 0, id: 1, method: "game.getCurrent" });
    port.receive({ v: 0, id: 2, method: "game.getCurrent", params: { gameId: "satisfactory" } });
    await flush();
    expect(response(1)).toEqual({ v: 0, id: 1, ok: true, result: { id: "poe2", displayName: "Path of Exile 2" } });
    expect(response(2)).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("reads and writes only the bound store", async () => {
    await context.store.set("count", 5);
    port.receive({ v: 0, id: 1, method: "storage.get", params: { key: "count", moduleId: "local.example.b" } });
    port.receive({ v: 0, id: 2, method: "storage.set", params: { key: "n", value: [1, 2] } });
    port.receive({ v: 0, id: 3, method: "storage.set", params: { key: "n" } });
    await flush();
    expect(response(1)).toMatchObject({ ok: true, result: 5 });
    expect(response(2)).toMatchObject({ ok: true, result: null });
    expect(response(3)).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(await context.store.get("n")).toEqual([1, 2]);
  });

  it.each([
    [{ v: 0, id: 1, method: "toString" }, "UNKNOWN_METHOD"],
    [{ v: 0, id: 1, method: "hasOwnProperty" }, "UNKNOWN_METHOD"],
    [{ v: 0, id: 1, method: 42 }, "UNKNOWN_METHOD"],
    [{ v: 2, id: 1, method: "game.getCurrent" }, "BAD_REQUEST"],
    [{ id: 1, method: "game.getCurrent" }, "BAD_REQUEST"],
    [{ v: 0, id: 1, method: "storage.get", params: null }, "INVALID_PARAMS"],
    [{ v: 0, id: 1, method: "storage.get", params: { key: 7 } }, "INVALID_PARAMS"],
    [{ v: 0, id: 1, method: "storage.set", params: { key: "k", value: "x".repeat(2 * 1024 * 1024) } }, "BAD_REQUEST"],
  ])("rejects %j with %s", async (message, code) => {
    port.receive(message);
    await flush();
    expect(response(1)).toMatchObject({ ok: false, error: { code } });
  });

  it("ignores messages it cannot answer", async () => {
    for (const data of [null, "hello", 42, { v: 0, method: "game.getCurrent" }, { v: 0, id: -1 }, { v: 0, id: 1.5 }]) {
      port.receive(data);
    }
    await flush();
    expect(port.sent).toEqual([]);
  });

  it("closes ports a module tries to hand to the host", () => {
    const extra = { close: vi.fn() };
    port.receive({ v: 0, id: 1, method: "game.getCurrent" }, [extra]);
    expect(extra.close).toHaveBeenCalled();
  });

  it("limits concurrent requests", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    context.store.get = vi.fn(async () => {
      await gate;
      return null;
    });
    for (let id = 1; id <= MAX_IN_FLIGHT + 1; id++) {
      port.receive({ v: 0, id, method: "storage.get", params: { key: "k" } });
    }
    await flush();
    expect(response(MAX_IN_FLIGHT + 1)).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    release();
    await flush();
    expect(response(1)).toMatchObject({ ok: true });
  });

  it("hides internal errors from the module", async () => {
    context.store.get = vi.fn(async () => {
      throw new Error("disk path /home/user/secret");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    port.receive({ v: 0, id: 1, method: "storage.get", params: { key: "k" } });
    await flush();
    expect(response(1)).toEqual({ v: 0, id: 1, ok: false, error: { code: "INTERNAL", message: "internal error" } });
  });

  it("stops sending once closed", async () => {
    session.emit("workspace.resize", { width: 1, height: 2 });
    session.close();
    session.emit("workspace.resize", { width: 3, height: 4 });
    port.receive({ v: 0, id: 1, method: "game.getCurrent" });
    await flush();
    expect(port.closed).toBe(true);
    expect(port.sent).toEqual([{ v: 0, event: "workspace.resize", data: { width: 1, height: 2 } }]);
  });
});
