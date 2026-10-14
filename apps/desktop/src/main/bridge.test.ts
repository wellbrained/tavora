import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LIMITS } from "@tavora/sdk/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeSession, type BridgeContext } from "./bridge";
import { THEME } from "./games";
import { DataRegistry } from "./storage";

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

const INSTANCE = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_INSTANCE = "123e4567-e89b-42d3-a456-426614174001";

let registry: DataRegistry;
let port: FakePort;
let context: BridgeContext;
let nextId: number;

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

function makeContext(instanceId = INSTANCE, moduleId = "local.example.a"): BridgeContext {
  return {
    hostVersion: "0.0.0-test",
    moduleId,
    moduleVersion: "1.2.3",
    instanceId,
    game: { id: "poe2", displayName: "Path of Exile 2" },
    data: registry.get(moduleId, "poe2"),
    panelState: registry.panelState,
    capabilities: new Set(),
    getViewport: () => ({ width: 400, height: 300 }),
    getTheme: () => THEME,
    isSuspended: () => false,
  };
}

/** Sends a request and returns its response. */
async function call(target: FakePort, method: string, params?: unknown, v = 1) {
  const id = nextId++;
  target.receive({ v, id, method, params });
  await flush();
  return target.sent.find((m) => (m as { id?: number }).id === id) as Record<string, any>;
}

async function connected(ctx = makeContext()) {
  const p = new FakePort();
  new BridgeSession(p, ctx);
  expect(await call(p, "bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" })).toMatchObject({ ok: true });
  return p;
}

beforeEach(async () => {
  registry = new DataRegistry(await mkdtemp(path.join(tmpdir(), "tavora-bridge-")));
  nextId = 1;
  context = makeContext();
  port = await connected(context);
});

describe("handshake", () => {
  it("reports host, module and granted capabilities", async () => {
    const p = new FakePort();
    new BridgeSession(p, context);
    expect(await call(p, "bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" })).toEqual({
      v: 1,
      id: expect.any(Number),
      ok: true,
      result: {
        protocol: 1,
        host: { name: "tavora-desktop", version: "0.0.0-test" },
        module: { id: "local.example.a", version: "1.2.3" },
        capabilities: [],
      },
    });
  });

  it("rejects an incompatible SDK with the supported versions", async () => {
    const p = new FakePort();
    new BridgeSession(p, context);
    expect(await call(p, "bridge.handshake", { protocol: 2, sdkVersion: "9.0.0" })).toMatchObject({
      ok: false,
      error: { code: "INCOMPATIBLE", supported: [1] },
    });
    expect(await call(p, "game.getCurrent")).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
  });

  it("refuses other calls and events before the handshake", async () => {
    const p = new FakePort();
    const session = new BridgeSession(p, context);
    session.emit("workspace.resize", { width: 1, height: 1 });
    expect(await call(p, "game.getCurrent")).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(p.sent.some((m) => "event" in (m as object))).toBe(false);
  });

  it("tells a panel that connects while hidden that it is suspended", async () => {
    const p = new FakePort();
    new BridgeSession(p, { ...context, isSuspended: () => true });
    await call(p, "bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" });
    expect(p.sent).toEqual([expect.objectContaining({ ok: true }), { v: 1, event: "lifecycle.suspend", data: null }]);
  });
});

describe("identity", () => {
  it("answers with the bound game, ignoring anything the module claims", async () => {
    expect(await call(port, "game.getCurrent")).toEqual({
      v: 1,
      id: expect.any(Number),
      ok: true,
      result: { id: "poe2", displayName: "Path of Exile 2" },
    });
    expect(await call(port, "game.getCurrent", { gameId: "satisfactory" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_PARAMS" },
    });
  });

  it("reads and writes only the bound settings", async () => {
    await context.data.settings.set("count", 5);
    expect(await call(port, "storage.get", { key: "count", moduleId: "local.example.b" })).toMatchObject({ result: 5 });
    expect(await call(port, "storage.set", { key: "n", value: [1, 2] })).toMatchObject({ ok: true, result: null });
    expect(await call(port, "storage.set", { key: "n" })).toMatchObject({ error: { code: "INVALID_PARAMS" } });
    expect(await call(port, "storage.keys")).toMatchObject({ result: ["count", "n"] });
    expect(await registry.get("local.example.b", "poe2").settings.get("n")).toBeNull();
  });

  it("keeps panel state per panel", async () => {
    const other = await connected(makeContext(OTHER_INSTANCE));
    expect(await call(port, "panel.setState", { value: { tab: "gear" } })).toMatchObject({ ok: true });
    expect(await call(port, "panel.getState")).toMatchObject({ result: { tab: "gear" } });
    expect(await call(other, "panel.getState")).toMatchObject({ result: null });
    expect(await call(port, "panel.setState", { value: null })).toMatchObject({ ok: true });
    expect(await call(port, "panel.getState")).toMatchObject({ result: null });
  });
});

describe("documents", () => {
  it("creates, revises and conflicts", async () => {
    const created = await call(port, "documents.put", { title: "Build A", data: { stage: 1 } });
    expect(created).toMatchObject({ ok: true, result: { title: "Build A", revision: 1 } });
    const id = created.result.id as string;

    expect(await call(port, "documents.put", { id, title: "Build A", data: { stage: 2 }, ifRevision: 1 })).toMatchObject({
      result: { revision: 2 },
    });
    expect(await call(port, "documents.put", { id, title: "Stale", data: {}, ifRevision: 1 })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", revision: 2 },
    });
    expect(await call(port, "documents.get", { id })).toMatchObject({ result: { data: { stage: 2 }, revision: 2 } });
    expect(await call(port, "documents.list")).toMatchObject({ result: [{ id, title: "Build A" }] });
  });

  it("notifies other panels of the same module, not the writer or other modules", async () => {
    const sibling = await connected(makeContext(OTHER_INSTANCE));
    const stranger = await connected(makeContext(OTHER_INSTANCE, "local.example.b"));
    await call(port, "documents.put", { id: "plan", title: "Plan", data: [] });
    await call(port, "documents.delete", { id: "plan" });

    const events = (p: FakePort) => p.sent.filter((m) => "event" in (m as object));
    expect(events(sibling)).toEqual([
      { v: 1, event: "documents.changed", data: { id: "plan", revision: 1, deleted: false } },
      { v: 1, event: "documents.changed", data: { id: "plan", revision: 1, deleted: true } },
    ]);
    expect(events(port)).toEqual([]);
    expect(events(stranger)).toEqual([]);
  });

  it("stops notifying a closed session", async () => {
    const sibling = new FakePort();
    const session = new BridgeSession(sibling, makeContext(OTHER_INSTANCE));
    await call(sibling, "bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" });
    session.close();
    await call(port, "documents.put", { id: "x", title: "x", data: 1 });
    expect(sibling.sent.filter((m) => "event" in (m as object))).toEqual([]);
    expect(context.data.documents.listenerCount("change")).toBe(1);
  });
});

describe("denied and malformed calls", () => {
  it.each([
    ["network.fetch", "network"],
    ["files.open", "files"],
    ["clipboard.readText", "clipboard"],
    ["sharedData.read", "sharedData"],
  ])("denies %s with the capability it needs", async (method, capability) => {
    expect(await call(port, method, { url: "https://example.com" })).toMatchObject({
      ok: false,
      error: { code: "PERMISSION_DENIED", capability },
    });
  });

  it.each([
    [{ method: "toString" }, "UNKNOWN_METHOD"],
    [{ method: "hasOwnProperty" }, "UNKNOWN_METHOD"],
    [{ method: "__proto__" }, "UNKNOWN_METHOD"],
    [{ method: 42 }, "UNKNOWN_METHOD"],
    [{ method: "storage.get", params: null }, "INVALID_PARAMS"],
    [{ method: "storage.get", params: [] }, "INVALID_PARAMS"],
    [{ method: "storage.get", params: { key: 7 } }, "INVALID_PARAMS"],
    [{ method: "documents.get", params: { id: "../x" } }, "INVALID_PARAMS"],
    [{ method: "storage.set", params: { key: "k", value: "x".repeat(LIMITS.maxMessageBytes) } }, "BAD_REQUEST"],
  ])("rejects %j with %s", async (message, code) => {
    const { method, params } = message as { method: string; params?: unknown };
    expect(await call(port, method, params)).toMatchObject({ ok: false, error: { code } });
  });

  it("rejects other protocol versions and lists the supported one", async () => {
    expect(await call(port, "game.getCurrent", undefined, 0)).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", supported: [1] },
    });
  });

  it("ignores messages it cannot answer", async () => {
    const before = port.sent.length;
    for (const data of [null, "hello", 42, { v: 1, method: "game.getCurrent" }, { v: 1, id: -1 }, { v: 1, id: 1.5 }]) {
      port.receive(data);
    }
    await flush();
    expect(port.sent.length).toBe(before);
  });

  it("closes ports a module tries to hand to the host", () => {
    const extra = { close: vi.fn() };
    port.receive({ v: 1, id: 99, method: "game.getCurrent" }, [extra]);
    expect(extra.close).toHaveBeenCalled();
  });

  it("limits concurrent requests", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    context.data.settings.get = vi.fn(async () => {
      await gate;
      return null;
    });
    const first = nextId;
    for (let i = 0; i <= LIMITS.maxInFlight; i++) {
      port.receive({ v: 1, id: nextId++, method: "storage.get", params: { key: "k" } });
    }
    await flush();
    const response = (id: number) => port.sent.find((m) => (m as { id?: number }).id === id);
    expect(response(first + LIMITS.maxInFlight)).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    release();
    await flush();
    expect(response(first)).toMatchObject({ ok: true });
  });

  it("hides internal errors from the module", async () => {
    context.data.settings.get = vi.fn(async () => {
      throw new Error("disk path /home/user/secret");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await call(port, "storage.get", { key: "k" })).toEqual({
      v: 1,
      id: expect.any(Number),
      ok: false,
      error: { code: "INTERNAL", message: "internal error" },
    });
  });
});
