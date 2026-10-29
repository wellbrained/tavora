import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LIMITS } from "@tavora/sdk/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeSession, type BridgeContext } from "./bridge";
import { HostError } from "./errors";
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

const offline = () => Promise.reject(new Error("no Discord in this test"));
const noDiscord: BridgeContext["discord"] = { state: offline, connect: offline, allowControl: offline, command: offline, subscribe: offline, unsubscribe: offline, image: offline };

function makeContext(instanceId = INSTANCE, moduleId = "local.example.a"): BridgeContext {
  return {
    hostVersion: "0.0.0-test",
    moduleId,
    moduleVersion: "1.2.3",
    instanceId,
    panelType: null,
    launch: { reason: "add" },
    setContent: () => {},
    openPanel: () => Promise.resolve("opened"),
    navigated: () => {},
    isMaximized: () => false,
    setMaximized: () => Promise.resolve(),
    setDialog: () => Promise.resolve(),
    setLive: () => {},
    workspace: { id: "poe2", displayName: "Path of Exile 2", kind: "game" },
    data: registry.get("local", moduleId, "poe2"),
    appSettings: registry.appSettings("local", moduleId),
    aiUsage: { accounts: () => Promise.reject(new Error("no AI accounts in this test")), read: () => Promise.reject(new Error("no AI accounts in this test")) },
    systemInfo: {
      info: () => { throw new Error("no system info in this test"); },
      watch: () => { throw new Error("no system info in this test"); },
      connectionLog: () => { throw new Error("no system info in this test"); },
      clearConnectionLog: () => { throw new Error("no system info in this test"); },
      connectionSettings: () => { throw new Error("no system info in this test"); },
      setConnectionSettings: () => { throw new Error("no system info in this test"); },
      apps: () => Promise.reject(new Error("no system info in this test")),
      traffic: () => Promise.reject(new Error("no system info in this test")),
    },
    media: { watch: () => { throw new Error("no media in this test"); }, control: () => Promise.reject(new Error("no media in this test")) },
    discord: noDiscord,
    leaderboards: {
      status: () => Promise.resolve({ online: true, signedIn: true, available: true, shown: false, name: "Mara" }),
      show: () => Promise.resolve({ online: true, signedIn: true, available: true, shown: true, name: "Mara" }),
      hide: () => Promise.resolve({ online: true, signedIn: true, available: true, shown: false, name: "Mara" }),
      submit: (params) => Promise.resolve({ accepted: [(params as { results: { id: string }[] }).results[0]!.id], rejected: [] }),
      top: () => Promise.resolve({ rows: [{ rank: 1, name: "Mara", self: true, current: 2, best: 3 }] }),
    },
    panelState: registry.panelState,
    capabilities: () => new Set(),
    getViewport: () => ({ width: 400, height: 300 }),
    getTheme: () => THEME,
    getLanguage: () => "de",
    isSuspended: () => false,
    openLink: () => {},
    showMenu: () => Promise.resolve(null),
    tooltip:{show:async()=>false,move:()=>{},close:()=>{}},
    overlay: { publish: () => {}, remove: () => {}, copyLink: () => Promise.resolve("copied"), resetLink: () => {}, showOverGame: () => Promise.resolve("shown"), hideOverGame: () => {}, overGame: () => [], preview: () => Promise.resolve() },
    hotkeys: { list: () => [], set: () => Promise.resolve("cancelled"), remove: () => {} },
    fetch: () => Promise.reject(new Error("no network in this test")),
    readPage: () => Promise.reject(new Error("no pages in this test")),
  };
}

/** Sends a request and returns its response. */
async function call(target: FakePort, method: string, params?: unknown, v = 1) {
  const id = nextId++;
  target.receive({ v, id, method, params });
  const find = () => target.sent.find((m) => (m as { id?: number }).id === id) as Record<string, any>;
  // Handlers touch the disk, so how long a reply takes depends on the load: wait for it
  // rather than for a fixed time.
  for (let waited = 0; !find() && waited < 3000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
  await flush();
  return find();
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
        panel: { type: null },
      },
    });
  });

  it("tells the page which panel type it runs as", async () => {
    const p = new FakePort();
    new BridgeSession(p, { ...context, panelType: "planner" });
    expect(await call(p, "bridge.handshake", { protocol: 1, sdkVersion: "0.2.2" })).toMatchObject({ ok: true, result: { panel: { type: "planner" } } });
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
  it("tells the module the language of Tavora's texts", async () => {
    expect(await call(port, "ui.getLanguage")).toMatchObject({ ok: true, result: "de" });
    expect(await call(port, "ui.getLanguage", { x: 1 })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("answers with the bound workspace, ignoring anything the module claims", async () => {
    expect(await call(port, "workspace.getCurrent")).toEqual({
      v: 1,
      id: expect.any(Number),
      ok: true,
      result: { id: "poe2", displayName: "Path of Exile 2", kind: "game" },
    });
    expect(await call(port, "workspace.getCurrent", { workspaceId: "satisfactory" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_PARAMS" },
    });
  });

  it("still answers game.getCurrent in the words of Tavora before the workspace names", async () => {
    expect(await call(port, "game.getCurrent")).toMatchObject({ ok: true, result: { id: "poe2", displayName: "Path of Exile 2", kind: "game" } });
    expect(await call(port, "game.getCurrent", { gameId: "satisfactory" })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    const personal = await connected({ ...makeContext(OTHER_INSTANCE), workspace: { id: "local-notes", displayName: "Notes", kind: "personal" }, data: registry.get("local", "local.example.a", "local-notes") });
    expect(await call(personal, "game.getCurrent")).toMatchObject({ ok: true, result: { id: "local-notes", displayName: "Notes", kind: "workspace" } });
    expect(await call(personal, "workspace.getCurrent")).toMatchObject({ ok: true, result: { id: "local-notes", displayName: "Notes", kind: "personal" } });
  });

  it("reads and writes only the bound settings", async () => {
    await context.data.settings.set("count", 5);
    expect(await call(port, "storage.get", { key: "count", moduleId: "local.example.b" })).toMatchObject({ result: 5 });
    expect(await call(port, "storage.set", { key: "n", value: [1, 2] })).toMatchObject({ ok: true, result: null });
    expect(await call(port, "storage.set", { key: "n" })).toMatchObject({ error: { code: "INVALID_PARAMS" } });
    expect(await call(port, "storage.keys")).toMatchObject({ result: ["count", "n"] });
    expect(await registry.get("local", "local.example.b", "poe2").settings.get("n")).toBeNull();
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

describe("panel content", () => {
  it("says why the page is loading, the same on every call", async () => {
    const restored = await connected({ ...makeContext(), launch: { reason: "restore", content: { id: "b1", title: "Ice Shot" } } });
    expect(await call(port, "panel.getLaunch")).toMatchObject({ ok: true, result: { reason: "add" } });
    expect(await call(restored, "panel.getLaunch")).toMatchObject({ result: { reason: "restore", content: { id: "b1", title: "Ice Shot" } } });
    expect(await call(restored, "panel.getLaunch")).toMatchObject({ result: { reason: "restore", content: { id: "b1", title: "Ice Shot" } } });
    expect(await call(port, "panel.getLaunch", {})).toMatchObject({ error: { code: "INVALID_PARAMS" } });
  });

  it("passes on what the panel shows, on one line, and refuses anything else", async () => {
    const shown: unknown[] = [];
    const p = await connected({ ...makeContext(), setContent: (content) => shown.push(content) });
    expect(await call(p, "panel.setContent", { content: { id: "b1", title: "  0.5 Ice Shot\nDeadeye  " } })).toMatchObject({ ok: true, result: null });
    expect(await call(p, "panel.setContent", { content: null })).toMatchObject({ ok: true });
    for (const content of [undefined, "b1", { id: "", title: "x" }, { id: "b1", title: " \n " }, { id: "b1" }, { id: "x".repeat(201), title: "x" }, { id: "b1", title: "x".repeat(201) }]) {
      expect(await call(p, "panel.setContent", content === undefined ? {} : { content })).toMatchObject({ error: { code: "INVALID_PARAMS" } });
    }
    expect(shown).toEqual([{ id: "b1", title: "0.5 Ice Shot Deadeye" }, null]);
  });

  it("passes panels.open on with a checked type and content, and refuses anything else", async () => {
    const asked: unknown[] = [];
    const p = await connected({ ...makeContext(), openPanel: (type, content) => (asked.push([type, content]), Promise.resolve("switched")) });
    expect(await call(p, "panels.open", { type: "planner", content: { id: "b1", title: "Ice\tShot" } })).toMatchObject({ ok: true, result: "switched" });
    expect(await call(p, "panels.open", { type: "gear" })).toMatchObject({ ok: true });
    for (const params of [{}, { type: "../x" }, { type: "Planner" }, { type: "planner", content: null }, { type: "planner", content: { id: "b1" } }]) {
      expect(await call(p, "panels.open", params)).toMatchObject({ error: { code: "INVALID_PARAMS" } });
    }
    expect(asked).toEqual([
      ["planner", { id: "b1", title: "Ice Shot" }],
      ["gear", null],
    ]);
  });

  it("says whether the panel fills the workspace and passes on a checked request to change it", async () => {
    const asked: boolean[] = [];
    const p = await connected({ ...makeContext(), isMaximized: () => true, setMaximized: (maximized) => (asked.push(maximized), Promise.resolve()) });
    expect(await call(p, "panel.isMaximized")).toMatchObject({ ok: true, result: true });
    expect(await call(p, "panel.setMaximized", { maximized: true })).toMatchObject({ ok: true, result: null });
    expect(await call(p, "panel.setMaximized", { maximized: false })).toMatchObject({ ok: true, result: null });
    for (const params of [{}, { maximized: "yes" }, { maximized: null }]) {
      expect(await call(p, "panel.setMaximized", params)).toMatchObject({ error: { code: "INVALID_PARAMS" } });
    }
    expect(asked).toEqual([true, false]);
  });

  it("passes on a live view's state when it is small enough, and refuses a big or missing one", async () => {
    const states: unknown[] = [];
    const p = await connected({ ...makeContext(), setLive: (state) => states.push(state) });
    expect(await call(p, "panel.setLive", { state: { hp: 3 } })).toMatchObject({ ok: true, result: null });
    expect(await call(p, "panel.setLive", { state: null })).toMatchObject({ ok: true, result: null });
    expect(await call(p, "panel.setLive", { state: "x".repeat(LIMITS.maxOverlayStateBytes) })).toMatchObject({ error: { code: "QUOTA_EXCEEDED" } });
    // The limit counts bytes, not characters.
    expect(await call(p, "panel.setLive", { state: "é".repeat(LIMITS.maxOverlayStateBytes / 2) })).toMatchObject({ error: { code: "QUOTA_EXCEEDED" } });
    expect(await call(p, "panel.setLive", {})).toMatchObject({ error: { code: "INVALID_PARAMS" } });
    expect(states).toEqual([{ hp: 3 }, null]);
  });

  it("passes on the page's answer to panel.navigate", async () => {
    const answers: unknown[] = [];
    const p = await connected({ ...makeContext(), navigated: (...answer) => answers.push(answer) });
    expect(await call(p, "panel.navigated", { requestId: 3, handled: true, ok: false })).toMatchObject({ ok: true, result: null });
    expect(await call(p, "panel.navigated", { requestId: 3, handled: "yes", ok: true })).toMatchObject({ error: { code: "INVALID_PARAMS" } });
    expect(answers).toEqual([[3, true, false]]);
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

describe("overlay methods", () => {
  it("lets a module without the overlay capability publish, remove and show over the game", async () => {
    const seen: string[] = [];
    const p = await connected({
      ...makeContext(),
      overlay: {
        publish: (key, state) => void seen.push(`publish ${key} ${JSON.stringify(state)}`),
        remove: (key) => void seen.push(`remove ${key}`),
        copyLink: () => Promise.resolve("copied"),
        resetLink: () => {},
        showOverGame: async (key) => (seen.push(`show ${key}`), "full"),
        hideOverGame: (key) => void seen.push(`hide ${key}`),
        overGame: () => ["a", "b"],
        preview: async (key) => void seen.push(`preview ${key}`),
      },
    });
    expect(await call(p, "overlay.publish", { key: "item-1", state: { n: 1 } })).toMatchObject({ ok: true });
    expect(await call(p, "overlay.remove", { key: "item-1" })).toMatchObject({ ok: true });
    expect(await call(p, "overlay.showOverGame", { key: "item-1" })).toMatchObject({ ok: true, result: "full" });
    expect(await call(p, "overlay.preview", { key: "item-1" })).toMatchObject({ ok: true, result: null });
    expect(await call(p, "overlay.hideOverGame", { key: "item-1" })).toMatchObject({ ok: true, result: null });
    expect(await call(p, "overlay.overGame", undefined)).toMatchObject({ ok: true, result: ["a", "b"] });
    expect(await call(port, "overlay.hideOverGame", { key: "no spaces" })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(seen).toEqual(['publish item-1 {"n":1}', "remove item-1", "show item-1", "preview item-1", "hide item-1"]);
  });

  it("still needs the overlay capability to reset a link", async () => {
    expect(await call(port, "overlay.resetLink", { key: "item-1" })).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED", capability: "overlay" } });
  });

  it("refuses a bad key for showOverGame", async () => {
    expect(await call(port, "overlay.showOverGame", { key: "no spaces" })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(await call(port, "overlay.showOverGame", {})).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("refuses a bad key for preview, and passes on a refusal", async () => {
    expect(await call(port, "overlay.preview", { key: "no spaces" })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    const p = await connected({ ...makeContext(), overlay: { ...makeContext().overlay, preview: () => Promise.reject(new HostError("PERMISSION_DENIED", "no click")) } });
    expect(await call(p, "overlay.preview", { key: "item-1" })).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
  });

  it("passes on the refusal when the panel had no click", async () => {
    const p = await connected({ ...makeContext(), overlay: { ...makeContext().overlay, showOverGame: () => Promise.reject(new HostError("PERMISSION_DENIED", "no click")) } });
    expect(await call(p, "overlay.showOverGame", { key: "item-1" })).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
  });
});

describe("denied and malformed calls", () => {
  it.each([
    ["network.fetch", "network"],
    ["network.readPage", "network"],
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

describe("onBusy", () => {
  it("reports when requests start and finish, counting the handshake apart", async () => {
    const events: [boolean, number][] = [];
    const ctx = { ...makeContext(), onBusy: (busy: boolean, served: number) => void events.push([busy, served]) };
    const p = await connected(ctx);
    expect(events).toEqual([
      [true, 0],
      [false, 0],
    ]);
    events.length = 0;
    await call(p, "game.getCurrent");
    expect(events).toEqual([
      [true, 0],
      [false, 1],
    ]);
  });
});

describe("links.open", () => {
  it("hands a web address to the host and answers with null", async () => {
    const opened: string[] = [];
    const p = await connected({ ...makeContext(), openLink: (url) => void opened.push(url) });
    expect(await call(p, "links.open", { url: "https://poe2db.tw/us" })).toMatchObject({ ok: true, result: null });
    expect(opened).toEqual(["https://poe2db.tw/us"]);
  });

  it("refuses anything but a non-empty string of reasonable length", async () => {
    const opened: string[] = [];
    const p = await connected({ ...makeContext(), openLink: (url) => void opened.push(url) });
    for (const params of [undefined, {}, { url: 4 }, { url: "" }, { url: "x".repeat(2049) }]) {
      expect(await call(p, "links.open", params)).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    }
    expect(opened).toEqual([]);
  });

  it("passes on the host's refusal", async () => {
    const p = await connected({
      ...makeContext(),
      openLink: () => {
        throw new HostError("PERMISSION_DENIED", "no click");
      },
    });
    expect(await call(p, "links.open", { url: "https://example.com" })).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
  });
});

describe("network.fetch", () => {
  const ANSWER = { status: 200, url: "https://api.example.com/", headers: {}, body: "ok" };

  it("reports the network capability in the handshake once a host is granted", async () => {
    const p = new FakePort();
    new BridgeSession(p, { ...makeContext(), capabilities: () => new Set(["network"] as const) });
    expect(await call(p, "bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" })).toMatchObject({ ok: true, result: { capabilities: ["network"] } });
  });

  it("hands the request to the host and answers with what came back", async () => {
    const asked: unknown[] = [];
    const p = await connected({ ...makeContext(), capabilities: () => new Set(["network"] as const), fetch: async (params) => (asked.push(params), ANSWER) });
    expect(await call(p, "network.fetch", { url: "https://api.example.com/" })).toMatchObject({ ok: true, result: ANSWER });
    expect(asked).toEqual([{ url: "https://api.example.com/" }]);
  });

  it("asks for the grant on every call, so a revoke takes effect at once", async () => {
    let granted = true;
    const p = await connected({ ...makeContext(), capabilities: () => new Set(granted ? (["network"] as const) : []), fetch: async () => ANSWER });
    expect(await call(p, "network.fetch", { url: "https://api.example.com/" })).toMatchObject({ ok: true });
    granted = false;
    expect(await call(p, "network.fetch", { url: "https://api.example.com/" })).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED", capability: "network" } });
  });

  it("passes on the host's refusals and failures", async () => {
    const p = await connected({
      ...makeContext(),
      capabilities: () => new Set(["network"] as const),
      fetch: async () => {
        throw new HostError("NETWORK_ERROR", "could not reach api.example.com");
      },
    });
    expect(await call(p, "network.fetch", { url: "https://api.example.com/" })).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR", message: "could not reach api.example.com" } });
  });

  it("lets one panel run only a few requests at once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const p = await connected({ ...makeContext(), capabilities: () => new Set(["network"] as const), fetch: async () => (await gate, ANSWER) });
    const first = nextId;
    for (let i = 0; i <= LIMITS.maxNetworkInFlight; i++) p.receive({ v: 1, id: nextId++, method: "network.fetch", params: { url: "https://api.example.com/" } });
    await flush();
    const response = (id: number) => p.sent.find((m) => (m as { id?: number }).id === id);
    expect(response(first + LIMITS.maxNetworkInFlight)).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    release();
    await flush();
    expect(response(first)).toMatchObject({ ok: true });
    // The slots are free again.
    expect(await call(p, "network.fetch", { url: "https://api.example.com/" })).toMatchObject({ ok: true });
  });
});

describe("storage.app", () => {
  it("shares a module's settings across workspaces, apart from each workspace's own", async () => {
    expect(await call(port, "storage.app.set", { key: "style", value: "used" })).toMatchObject({ ok: true, result: null });
    expect(await call(port, "storage.get", { key: "style" })).toMatchObject({ ok: true, result: null });
    const otherGame = await connected({ ...makeContext(OTHER_INSTANCE), workspace: { id: "wow", displayName: "World of Warcraft", kind: "game" }, data: registry.get("local", "local.example.a", "wow") });
    expect(await call(otherGame, "storage.app.get", { key: "style" })).toMatchObject({ ok: true, result: "used" });
    expect(await call(otherGame, "storage.app.keys")).toMatchObject({ ok: true, result: ["style"] });
    expect(await call(otherGame, "storage.app.delete", { key: "style" })).toMatchObject({ ok: true, result: null });
    expect(await call(port, "storage.app.get", { key: "style" })).toMatchObject({ ok: true, result: null });
  });

  it("keeps another module's settings apart", async () => {
    await call(port, "storage.app.set", { key: "style", value: "used" });
    const other = await connected(makeContext(OTHER_INSTANCE, "local.example.b"));
    expect(await call(other, "storage.app.get", { key: "style" })).toMatchObject({ ok: true, result: null });
  });

  it("checks keys and values like storage.set", async () => {
    expect(await call(port, "storage.app.set", { key: 7, value: 1 })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(await call(port, "storage.app.set", { key: "k" })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });
});

describe("compareAndSet", () => {
  it("sets a workspace or shared setting only while it holds what was expected", async () => {
    expect(await call(port, "storage.compareAndSet", { key: "run", expected: null, value: 1 })).toMatchObject({ ok: true, result: true });
    expect(await call(port, "storage.compareAndSet", { key: "run", expected: null, value: 2 })).toMatchObject({ ok: true, result: false });
    expect(await call(port, "storage.get", { key: "run" })).toMatchObject({ ok: true, result: 1 });
    expect(await call(port, "storage.app.compareAndSet", { key: "run", expected: null, value: { n: 1 } })).toMatchObject({ ok: true, result: true });
    expect(await call(port, "storage.app.compareAndSet", { key: "run", expected: { n: 1 }, value: { n: 2 } })).toMatchObject({ ok: true, result: true });
    expect(await call(port, "storage.app.get", { key: "run" })).toMatchObject({ ok: true, result: { n: 2 } });
  });

  it("needs expected and value", async () => {
    expect(await call(port, "storage.compareAndSet", { key: "run", value: 1 })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(await call(port, "storage.app.compareAndSet", { key: "run", expected: null })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });
});

describe("leaderboards", () => {
  const granted = () => connected({ ...makeContext(), capabilities: () => new Set(["leaderboards"] as const) });

  it.each(["leaderboards.status", "leaderboards.show", "leaderboards.hide", "leaderboards.submit", "leaderboards.top"])("denies %s without the leaderboards connector", async (method) => {
    const params = method === "leaderboards.submit" || method === "leaderboards.top" ? { board: "daily", results: [] } : undefined;
    expect(await call(port, method, params)).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED", capability: "leaderboards" } });
  });

  it("passes a granted module's calls to the connector", async () => {
    const p = await granted();
    expect(await call(p, "leaderboards.status")).toMatchObject({ ok: true, result: { signedIn: true, shown: false, name: "Mara" } });
    expect(await call(p, "leaderboards.show")).toMatchObject({ ok: true, result: { shown: true } });
    expect(await call(p, "leaderboards.submit", { board: "daily", results: [{ id: "a" }] })).toMatchObject({ ok: true, result: { accepted: ["a"], rejected: [] } });
    expect(await call(p, "leaderboards.top", { board: "daily" })).toMatchObject({ ok: true, result: { rows: [{ rank: 1, self: true }] } });
    expect(await call(p, "leaderboards.status", { extra: 1 })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(await call(p, "leaderboards.top", "daily")).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });
});

describe("aiUsage", () => {
  const ACCOUNT = { id: "a1", provider: "claude" as const, label: "Work", plan: "Max 5×" };
  const READING = { status: "ok" as const, retryAfterMs: null, answer: { limits: [] }, email: "me@example.com", plan: "Max 5×", readAt: "2026-10-17T10:00:00.000Z" };
  const granted = (extra: Partial<BridgeContext> = {}) =>
    connected({ ...makeContext(), capabilities: () => new Set(["aiUsage"] as const), aiUsage: { accounts: async () => [ACCOUNT], read: async () => READING }, ...extra });

  it.each(["aiUsage.accounts", "aiUsage.read"])("denies %s without the ai-usage connector", async (method) => {
    expect(await call(port, method, method === "aiUsage.read" ? { accountId: "a1" } : undefined)).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED", capability: "aiUsage" } });
  });

  it("lists the accounts and reads one for a granted module", async () => {
    const asked: string[] = [];
    const p = await granted({ aiUsage: { accounts: async () => [ACCOUNT], read: async (id) => (asked.push(id), READING) } });
    expect(await call(p, "aiUsage.accounts")).toMatchObject({ ok: true, result: [ACCOUNT] });
    expect(await call(p, "aiUsage.read", { accountId: "a1" })).toMatchObject({ ok: true, result: READING });
    expect(asked).toEqual(["a1"]);
  });

  it.each([{}, { accountId: 7 }, { accountId: "" }, { accountId: "x".repeat(65) }])("refuses %j as an account id", async (params) => {
    const p = await granted();
    expect(await call(p, "aiUsage.read", params)).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("passes on that an account does not exist", async () => {
    const p = await granted({ aiUsage: { accounts: async () => [], read: async () => Promise.reject(new HostError("INVALID_PARAMS", "there is no AI account with that id")) } });
    expect(await call(p, "aiUsage.read", { accountId: "gone" })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });
});

describe("media", () => {
  const STATE = { state: "ready" as const, sessions: [] };
  const calls: unknown[] = [];
  const granted = () =>
    connected({
      ...makeContext(),
      capabilities: () => new Set(["media"] as const),
      media: {
        watch: (on) => (calls.push(["watch", on]), on ? STATE : null),
        control: async (session, action) => (calls.push(["control", session, action]), true),
      },
    });

  it.each([
    ["media.watch", { on: true }],
    ["media.control", { session: "Spotify.exe#0", action: "next" }],
  ])("denies %s without the media connector", async (method, params) => {
    expect(await call(port, method, params)).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED", capability: "media" } });
  });

  it("starts and ends a watch", async () => {
    calls.length = 0;
    const p = await granted();
    expect(await call(p, "media.watch", { on: true })).toMatchObject({ ok: true, result: STATE });
    expect(await call(p, "media.watch", { on: false })).toMatchObject({ ok: true, result: null });
    expect(calls).toEqual([["watch", true], ["watch", false]]);
  });

  it("passes a checked control on", async () => {
    calls.length = 0;
    const p = await granted();
    expect(await call(p, "media.control", { session: "Spotify.exe#0", action: "playPause" })).toMatchObject({ ok: true, result: true });
    expect(calls).toEqual([["control", "Spotify.exe#0", "playPause"]]);
  });

  it.each([
    ["media.watch", undefined],
    ["media.watch", {}],
    ["media.watch", { on: 1 }],
    ["media.watch", { on: true, extra: 1 }],
    ["media.control", undefined],
    ["media.control", { session: "", action: "next" }],
    ["media.control", { session: "a", action: "seek" }],
    ["media.control", { session: 1, action: "next" }],
    ["media.control", { session: "a", action: "next", extra: 1 }],
  ])("refuses %s with %j", async (method, params) => {
    calls.length = 0;
    const p = await granted();
    expect(await call(p, method, params)).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(calls).toEqual([]);
  });
});

describe("systemInfo", () => {
  const INFO = { cpu: { model: "Test CPU", threads: 8 }, ramBytes: 16e9, gpus: [], drives: [{ id: "C:", label: "", kind: "internal" as const, totalBytes: 1e12 }] };
  const APPS = { apps: [{ name: "Firefox", memoryBytes: 6.8e9, cpu: 1.2, windows: false }], usedBytes: 20e9 };
  const PERIOD = { start: 1, end: 2, downBytes: 3e9, upBytes: 1e8, countedFrom: 1 };
  const TRAFFIC = { week: PERIOD, months: [PERIOD, PERIOD, PERIOD, PERIOD] };
  const watching: unknown[] = [];
  const settings = { enabled: true, target: "1.1.1.1" };
  const cleared: number[] = [];
  const changed: unknown[] = [];
  const granted = (extra: Partial<BridgeContext> = {}) =>
    connected({
      ...makeContext(),
      capabilities: () => new Set(["systemInfo"] as const),
      systemInfo: {
        info: () => INFO,
        watch: (request) => void watching.push(request),
        connectionLog: () => ({ outages: [{ start: 1, end: 2, kind: "offline" as const, durationMs: 1 }] }),
        clearConnectionLog: () => void cleared.push(1),
        connectionSettings: () => settings,
        setConnectionSettings: (change) => (changed.push(change), { ...settings, ...change }),
        apps: async () => APPS,
        traffic: async () => TRAFFIC,
      },
      ...extra,
    });
  const request = { blocks: { cpu: true, drives: ["C:", "D:"] }, intervalMs: 1000 };

  it.each([
    ["systemInfo.info", undefined],
    ["systemInfo.watch", request],
    ["systemInfo.connectionLog", undefined],
    ["systemInfo.clearConnectionLog", undefined],
    ["systemInfo.connectionSettings", undefined],
    ["systemInfo.setConnectionSettings", { enabled: false }],
    ["systemInfo.apps", undefined],
    ["systemInfo.traffic", undefined],
  ])("denies %s without the system-info connector", async (method, params) => {
    expect(await call(port, method, params)).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED", capability: "systemInfo" } });
  });

  it("answers info and passes on a checked watch", async () => {
    watching.length = 0;
    const p = await granted();
    expect(await call(p, "systemInfo.info")).toMatchObject({ ok: true, result: INFO });
    expect(await call(p, "systemInfo.watch", request)).toMatchObject({ ok: true, result: null });
    expect(watching).toEqual([{ blocks: { cpu: true, gpu: false, ram: false, drives: ["C:", "D:"], tavora: false, connection: false }, intervalMs: 1000 }]);
  });

  it("takes no params for info", async () => {
    const p = await granted();
    expect(await call(p, "systemInfo.info", {})).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("answers the apps, without params", async () => {
    const p = await granted();
    expect(await call(p, "systemInfo.apps")).toMatchObject({ ok: true, result: APPS });
    expect(await call(p, "systemInfo.apps", {})).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("answers the traffic, without params", async () => {
    const p = await granted();
    expect(await call(p, "systemInfo.traffic")).toMatchObject({ ok: true, result: TRAFFIC });
    expect(await call(p, "systemInfo.traffic", {})).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it.each([
    [undefined],
    [{}],
    [{ blocks: {}, intervalMs: 3000 }],
    [{ blocks: { cpu: true } }],
    [{ blocks: { cpu: true }, intervalMs: "1000" }],
    [{ blocks: { cpu: 1 }, intervalMs: 1000 }],
    [{ blocks: { temperature: true }, intervalMs: 1000 }],
    [{ blocks: { drives: "C:" }, intervalMs: 1000 }],
    [{ blocks: { drives: ["c:"] }, intervalMs: 1000 }],
    [{ blocks: { drives: ["C:\\"] }, intervalMs: 1000 }],
    [{ blocks: { drives: Array.from({ length: 27 }, () => "C:") }, intervalMs: 1000 }],
    [{ blocks: { cpu: true }, intervalMs: 1000, extra: 1 }],
    [{ blocks: [], intervalMs: 1000 }],
  ])("refuses %j as a watch", async (params) => {
    watching.length = 0;
    const p = await granted();
    expect(await call(p, "systemInfo.watch", params)).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(watching).toEqual([]);
  });

  it("reads and clears the log of drops and reads the settings", async () => {
    cleared.length = 0;
    const p = await granted();
    expect(await call(p, "systemInfo.connectionLog")).toMatchObject({ ok: true, result: { outages: [{ kind: "offline" }] } });
    expect(await call(p, "systemInfo.clearConnectionLog")).toMatchObject({ ok: true, result: null });
    expect(cleared).toEqual([1]);
    expect(await call(p, "systemInfo.connectionSettings")).toMatchObject({ ok: true, result: settings });
    expect(await call(p, "systemInfo.connectionLog", {})).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("changes the settings after checking them", async () => {
    changed.length = 0;
    const p = await granted();
    expect(await call(p, "systemInfo.setConnectionSettings", { enabled: false, target: "Example.com" })).toMatchObject({ ok: true, result: { enabled: false, target: "example.com" } });
    expect(changed).toEqual([{ enabled: false, target: "example.com" }]);
    for (const bad of [undefined, { target: "http://example.com" }, { target: 5 }, { enabled: "no" }, { other: true }]) {
      expect(await call(p, "systemInfo.setConnectionSettings", bad)).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    }
    expect(changed).toHaveLength(1);
  });

  it("takes empty blocks as stopping", async () => {
    watching.length = 0;
    const p = await granted();
    expect(await call(p, "systemInfo.watch", { blocks: {}, intervalMs: 60000 })).toMatchObject({ ok: true });
    expect(watching).toEqual([{ blocks: { cpu: false, gpu: false, ram: false, drives: [], tavora: false, connection: false }, intervalMs: 60000 }]);
  });
});

describe("ui.showMenu", () => {
  const menu = { items: [{ type: "item", id: "rename", label: "Rename" }], at: { x: 1, y: 2 } };

  it("hands the checked menu to the host and answers with the chosen id", async () => {
    const shown: unknown[] = [];
    const p = await connected({ ...makeContext(), showMenu: async (checked) => (shown.push(checked.request), "rename") });
    expect(await call(p, "ui.showMenu", menu)).toMatchObject({ ok: true, result: "rename" });
    expect(shown).toEqual([menu]);
  });

  it("refuses a menu that is not well formed before the host sees it", async () => {
    const shown: unknown[] = [];
    const p = await connected({ ...makeContext(), showMenu: async (checked) => (shown.push(checked), null) });
    expect(await call(p, "ui.showMenu", { ...menu, items: [{ type: "item", id: "x", label: "<b>X</b>", html: true }] })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(shown).toEqual([]);
  });

  it("passes on that the panel did not just get a click", async () => {
    const p = await connected({ ...makeContext(), showMenu: () => Promise.reject(new HostError("PERMISSION_DENIED", "ui.showMenu must be called right after a click or key press")) });
    expect(await call(p, "ui.showMenu", menu)).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
  });
});

describe("discord", () => {
  const STATE = { status: "connected" as const, error: null, user: { id: "1", name: "Alex" }, canControl: true, canSaveSignIn: true };
  function granted() {
    const sent: unknown[][] = [];
    const discord: BridgeContext["discord"] = {
      state: async () => STATE,
      connect: async () => void sent.push(["connect"]),
      allowControl: async () => void sent.push(["allowControl"]),
      command: async (command, args) => (sent.push([command, args]), { ok: true, data: { id: "10" } }),
      subscribe: async (event, channelId) => void sent.push(["subscribe", event, channelId]),
      unsubscribe: async (event, channelId) => void sent.push(["unsubscribe", event, channelId]),
      image: async (url) => (sent.push(["image", url]), null),
    };
    return { sent, port: connected({ ...makeContext(), capabilities: () => new Set(["discord"] as const), discord }) };
  }

  it.each(["discord.state", "discord.connect", "discord.allowControl", "discord.command", "discord.subscribe", "discord.unsubscribe", "discord.image"])("denies %s without the discord connector", async (method) => {
    expect(await call(port, method, method === "discord.command" ? { command: "GET_GUILDS" } : undefined)).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED", capability: "discord" } });
  });

  it("passes checked commands, subscriptions and pictures on to the connector", async () => {
    const { sent, port: p } = granted();
    const target = await p;
    expect(await call(target, "discord.state")).toMatchObject({ ok: true, result: STATE });
    expect(await call(target, "discord.command", { command: "GET_CHANNEL", args: { channel_id: "10" } })).toMatchObject({ ok: true, result: { ok: true, data: { id: "10" } } });
    expect(await call(target, "discord.command", { command: "GET_GUILDS" })).toMatchObject({ ok: true });
    expect(await call(target, "discord.command", { command: "SET_USER_VOICE_SETTINGS", args: { user_id: "2", volume: 150 } })).toMatchObject({ ok: true });
    expect(await call(target, "discord.subscribe", { event: "SPEAKING_START", channelId: "10" })).toMatchObject({ ok: true, result: null });
    expect(await call(target, "discord.subscribe", { event: "VOICE_CHANNEL_SELECT" })).toMatchObject({ ok: true, result: null });
    expect(await call(target, "discord.image", { url: "https://cdn.discordapp.com/avatars/1/x.png" })).toMatchObject({ ok: true, result: null });
    expect(sent).toEqual([
      ["GET_CHANNEL", { channel_id: "10" }],
      ["GET_GUILDS", {}],
      ["SET_USER_VOICE_SETTINGS", { user_id: "2", volume: 150 }],
      ["subscribe", "SPEAKING_START", "10"],
      ["subscribe", "VOICE_CHANNEL_SELECT", null],
      ["image", "https://cdn.discordapp.com/avatars/1/x.png"],
    ]);
  });

  it.each([
    { command: "AUTHORIZE", args: {} },
    { command: "GET_CHANNEL", args: { channel_id: "general" } },
    { command: "GET_CHANNEL", args: { channel_id: "10", extra: true } },
    { command: "GET_GUILDS", args: { guild_id: "1" } },
    { command: "SELECT_VOICE_CHANNEL", args: {} },
    { command: "SET_VOICE_SETTINGS", args: {} },
    { command: "SET_VOICE_SETTINGS", args: { mute: "yes" } },
    { command: "SET_VOICE_SETTINGS", args: { input: { volume: 0 } } },
    { command: "SET_USER_VOICE_SETTINGS", args: { user_id: "2", volume: 201 } },
    { command: "SET_USER_VOICE_SETTINGS", args: { user_id: "2", volume: 50.5 } },
    { command: "SET_USER_VOICE_SETTINGS", args: { user_id: "2" } },
    { command: "GET_CHANNEL", args: [] },
  ])("refuses %j", async (params) => {
    const { sent, port: p } = granted();
    expect(await call(await p, "discord.command", params)).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(sent).toEqual([]);
  });

  it.each([{ event: "MESSAGE_CREATE", channelId: "10" }, { event: "SPEAKING_START" }, { event: "VOICE_CHANNEL_SELECT", channelId: "10" }, { event: "SPEAKING_START", channelId: "x" }])("refuses the subscription %j", async (params) => {
    const { sent, port: p } = granted();
    expect(await call(await p, "discord.subscribe", params)).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(sent).toEqual([]);
  });
});

describe("blobs", () => {
  it("lists nothing, reports the limits, and ignores a missing file", async () => {
    expect(await call(port, "blobs.list")).toMatchObject({ ok: true, result: [] });
    expect(await call(port, "blobs.usage")).toMatchObject({ ok: true, result: { bytes: 0, count: 0, maxBytes: LIMITS.maxBlobsBytes, maxFileBytes: LIMITS.maxBlobBytes } });
    expect(await call(port, "blobs.delete", { id: "0".repeat(32) })).toMatchObject({ ok: true, result: null });
  });

  it("refuses ids that are not ones the host made, and params where none belong", async () => {
    for (const params of [undefined, {}, { id: 4 }, { id: "../etc/passwd" }, { id: "A".repeat(32) }]) {
      expect(await call(port, "blobs.delete", params)).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    }
    expect(await call(port, "blobs.list", {})).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });
});

describe("shared tooltips",()=>{
 it("forwards checked show/move/hide/close with the bound context",async()=>{
  const calls:unknown[]=[];const p=await connected({...makeContext(),tooltip:{show:async r=>(calls.push(r),true),move:a=>{calls.push(a);},close:(id,hover)=>{calls.push({id,hover});}}});
  const request={id:"item:1",at:{x:12,y:34},content:{title:"Item"},pinned:true};
  expect(await call(p,"ui.tooltip.show",request)).toMatchObject({ok:true,result:true});
  expect(await call(p,"ui.tooltip.move",{id:"item:1",at:{x:20,y:40}})).toMatchObject({ok:true,result:null});
  await call(p,"ui.tooltip.hide",{id:"item:1"});await call(p,"ui.tooltip.close",{id:"item:1"});
  expect(calls).toEqual([request,{id:"item:1",at:{x:20,y:40}},{id:"item:1",hover:true},{id:"item:1",hover:false}]);
 });
 it("rejects HTML and lets gesture denial propagate",async()=>{
  const p=await connected({...makeContext(),tooltip:{show:async()=>{throw new HostError("PERMISSION_DENIED","real click required");},move:()=>{},close:()=>{}}});
  expect(await call(p,"ui.tooltip.show",{id:"x",at:{x:0,y:0},content:{title:"x",html:"x"}})).toMatchObject({ok:false,error:{code:"INVALID_PARAMS"}});
  expect(await call(p,"ui.tooltip.show",{id:"x",at:{x:0,y:0},content:{title:"x"},pinned:true})).toMatchObject({ok:false,error:{code:"PERMISSION_DENIED"}});
 });
});
