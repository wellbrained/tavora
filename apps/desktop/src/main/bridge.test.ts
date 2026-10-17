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
    game: { id: "poe2", displayName: "Path of Exile 2" },
    data: registry.get("local", moduleId, "poe2"),
    appSettings: registry.appSettings("local", moduleId),
    aiUsage: { accounts: () => Promise.reject(new Error("no AI accounts in this test")), read: () => Promise.reject(new Error("no AI accounts in this test")) },
    discord: noDiscord,
    panelState: registry.panelState,
    capabilities: () => new Set(),
    getViewport: () => ({ width: 400, height: 300 }),
    getTheme: () => THEME,
    getLanguage: () => "de",
    isSuspended: () => false,
    openLink: () => {},
    showMenu: () => Promise.resolve(null),
    fetch: () => Promise.reject(new Error("no network in this test")),
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
  it("tells the module the language of Tavora's texts", async () => {
    expect(await call(port, "ui.getLanguage")).toMatchObject({ ok: true, result: "de" });
    expect(await call(port, "ui.getLanguage", { x: 1 })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

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
  it("shares a module's settings across games, apart from each game's own", async () => {
    expect(await call(port, "storage.app.set", { key: "style", value: "used" })).toMatchObject({ ok: true, result: null });
    expect(await call(port, "storage.get", { key: "style" })).toMatchObject({ ok: true, result: null });
    const otherGame = await connected({ ...makeContext(OTHER_INSTANCE), game: { id: "wow", displayName: "World of Warcraft" }, data: registry.get("local", "local.example.a", "wow") });
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
