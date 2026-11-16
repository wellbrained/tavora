import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A panel closed right after typing: its page saves on lifecycle.dispose, and those saves must still land. ModuleView
// runs here with a real BridgeSession over a fake port, and a fake page that answers like the SDK's would.
const made = vi.hoisted(() => ({
  /** The host's end of the page's port, once the page connected. */
  ports: [] as unknown[],
  /** What the session answers for the module's own addresses (its files). */
  serve: undefined as ((request: Request) => Promise<Response>) | undefined,
  /** The page's event handlers, by event name. */
  handlers: {} as Record<string, (...args: unknown[]) => void>,
  page: {
    /** The page answers the host's ping this long after it (null: it is hung and never does). */
    pongAfter: 5 as number | null,
    pings: [] as unknown[],
    closed: 0,
    destroyed: false,
    visible: true,
    throttled: true,
    ipc: undefined as unknown as EventEmitter,
  },
}));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
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
  }
  const ses = {
    protocol: { handle: (_scheme: string, serve: (request: Request) => Promise<Response>) => void (made.serve = serve) },
    webRequest: { onBeforeRequest: () => undefined },
    setProxy: async () => undefined,
    setPermissionRequestHandler: () => undefined,
    setPermissionCheckHandler: () => undefined,
    setDevicePermissionHandler: () => undefined,
    setSpellCheckerEnabled: () => undefined,
    on: () => undefined,
  };
  class WebContentsView {
    webContents = {
      id: 7,
      session: ses,
      ipc: (made.page.ipc = new EventEmitter()),
      setWindowOpenHandler: () => undefined,
      setWebRTCIPHandlingPolicy: () => undefined,
      on: (event: string, handler: (...args: unknown[]) => void) => void (made.handlers[event] = handler),
      close: () => void made.page.closed++,
      loadURL: async () => undefined,
      isDestroyed: () => made.page.destroyed,
      isLoading: () => false,
      setBackgroundThrottling: (allowed: boolean) => void (made.page.throttled = allowed),
      insertCSS: async () => "key",
      removeInsertedCSS: async () => undefined,
      send: (channel: string, token?: unknown) => {
        if (channel !== "tavora:ping") return;
        made.page.pings.push(token);
        const after = made.page.pongAfter;
        if (after !== null) setTimeout(() => made.page.ipc.emit("tavora:pong", { senderFrame: { parent: null } }, token), after);
      },
      postMessage: () => undefined,
    };
    setBackgroundColor() {}
    setBorderRadius() {}
    setVisible(visible: boolean) {
      made.page.visible = visible;
    }
    setBounds() {}
    getBounds() {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
  }
  return {
    app: { isPackaged: false, getPath: () => "/nowhere", getVersion: () => "0.0.0" },
    BrowserWindow: { getAllWindows: () => [] },
    clipboard: {},
    ClipboardItem: class {},
    MessageChannelMain: class {
      port1 = new FakePort();
      port2 = {};
      constructor() {
        made.ports.push(this.port1);
      }
    },
    session: { fromPartition: () => ses },
    shell: {},
    WebContentsView,
  };
});

const { ModuleView, CLOSE_CAP_MS, CLOSE_QUIET_MS } = await import("./module-view");

interface Port extends EventEmitter {
  sent: Record<string, unknown>[];
  closed: boolean;
  postMessage(message: unknown): void;
}

/** What the module's settings hold, and how long a write takes to reach the disk. */
let saved: Map<string, unknown>;
let writeMs: number;
/** How long storing a picture takes. */
let pictureMs: number;
let calls: { status: string[]; released: number; menus: number };

function make() {
  const options = {
    instanceId: "11111111-1111-4111-8111-111111111111",
    module: { owner: "official", root: "/nowhere", provenance: "official", manifest: { id: "tavora.notes", version: "1.0.0", entry: "dist/index.html", permissions: {} } },
    panelType: null,
    workspace: { id: "elden", displayName: "Elden Ring", kind: "game" },
    hostVersion: "0.0.0",
    launch: () => ({ reason: "restore", content: null }),
    data: {
      blobs: {
        put: async () => {
          await new Promise((resolve) => setTimeout(resolve, pictureMs));
          return { id: "0".repeat(32), type: "image/png", bytes: 3 };
        },
      },
      documents: { on: () => undefined, off: () => undefined },
      settings: {
        set: async (key: string, value: unknown) => {
          await new Promise((resolve) => setTimeout(resolve, writeMs));
          saved.set(key, value);
        },
      },
    },
    networkHosts: () => new Set(),
    connectors: () => new Set(),
    getTheme: () => ({ tokens: { background: "#202020" } }),
    fontCss: (theme: { font?: { id: string } }) => `font:${theme.font?.id ?? ""}`,
    showMenu: async () => void calls.menus++,
    onStatus: (status: string) => void calls.status.push(status),
    discord: { release: () => void calls.released++ },
  };
  return new ModuleView(options as never);
}

let nextId = 1;
/** The page sends a request over its port. */
function send(port: Port, method: string, params?: unknown): number {
  const id = nextId++;
  port.emit("message", { data: { v: 1, id, method, params }, ports: [] });
  return id;
}
const answer = (port: Port, id: number) => port.sent.find((message) => message.id === id);

/** A page that has loaded and connected; `onDispose` runs when lifecycle.dispose reaches it. */
async function running(onDispose?: (port: Port) => void) {
  const view = make();
  made.handlers["did-finish-load"]!();
  view.connect();
  const port = made.ports.at(-1) as Port;
  const post = port.postMessage.bind(port);
  port.postMessage = (message: unknown) => {
    post(message);
    if ((message as { event?: string }).event === "lifecycle.dispose") onDispose?.(port);
  };
  const hello = send(port, "bridge.handshake", { protocol: 1, sdkVersion: "0.2.0" });
  await vi.advanceTimersByTimeAsync(1);
  expect(answer(port, hello)).toMatchObject({ ok: true });
  return { view, port };
}

beforeEach(() => {
  vi.useFakeTimers();
  saved = new Map();
  writeMs = 50;
  pictureMs = 400;
  calls = { status: [], released: 0, menus: 0 };
  made.ports = [];
  made.handlers = {};
  Object.assign(made.page, { pongAfter: 5, pings: [], closed: 0, destroyed: false, visible: true, throttled: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("closing a panel right after typing", () => {
  it("still applies a save the page sends after lifecycle.dispose, then closes its port", async () => {
    // The SDK's store saves on dispose; its write reaches the host a moment later.
    const { view, port } = await running((p) => void setTimeout(() => send(p, "storage.set", { key: "note", value: "last words" }), 20));
    let closed = false;
    void view.dispose().then(() => (closed = true));
    expect(made.page.visible).toBe(false);
    expect(made.page.throttled).toBe(false);

    // The write is still on its way to the disk: the port stays open.
    await vi.advanceTimersByTimeAsync(40);
    expect(port.closed).toBe(false);
    expect(made.page.closed).toBe(0);

    await vi.advanceTimersByTimeAsync(CLOSE_CAP_MS);
    expect(saved.get("note")).toBe("last words");
    expect(port.sent.some((message) => message.ok === true && message.id !== undefined && message.id !== 1)).toBe(true);
    expect(port.closed).toBe(true);
    expect(made.page.closed).toBe(1);
    expect(closed).toBe(true);
  });

  it("closes once the page has gone quiet, without waiting for the cap", async () => {
    const { view, port } = await running();
    void view.dispose();
    // Pong after 5 ms, then quiet for CLOSE_QUIET_MS.
    await vi.advanceTimersByTimeAsync(5 + CLOSE_QUIET_MS - 1);
    expect(port.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(port.closed).toBe(true);
    expect(made.page.closed).toBe(1);
  });

  it("waits for a save that comes after the ping was answered", async () => {
    // A busy page answers the ping first and saves a little later, within the quiet time.
    const { view } = await running((p) => void setTimeout(() => send(p, "storage.set", { key: "note", value: "late" }), 100));
    void view.dispose();
    await vi.advanceTimersByTimeAsync(CLOSE_CAP_MS);
    expect(saved.get("note")).toBe("late");
  });

  it("counts only the answer to its own ping, not a heartbeat's", async () => {
    const { view, port } = await running();
    made.page.pongAfter = null;
    void view.dispose();
    // An older ping's answer (no number, or another) doesn't make the page quiet.
    made.page.ipc.emit("tavora:pong", { senderFrame: { parent: null } }, undefined);
    made.page.ipc.emit("tavora:pong", { senderFrame: { parent: null } }, -1);
    await vi.advanceTimersByTimeAsync(CLOSE_QUIET_MS * 2);
    expect(port.closed).toBe(false);
  });

  it("waits for a picture the page is still writing", async () => {
    // Pictures go up through the module's own address, not the bridge (Whiteboard uploads one before it saves the board).
    let stored = false;
    const { view, port } = await running(() => void made.serve!(new Request("tavora-module://tavora.notes/_blobs/", { method: "POST", body: "png" })).then(() => (stored = true)));
    void view.dispose();
    await vi.advanceTimersByTimeAsync(5 + CLOSE_QUIET_MS + 50);
    expect(port.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(pictureMs);
    expect(stored).toBe(true);
    await vi.advanceTimersByTimeAsync(CLOSE_QUIET_MS);
    expect(port.closed).toBe(true);
  });

  it("closes a hung page after the cap", async () => {
    const { view, port } = await running();
    made.page.pongAfter = null;
    let closed = false;
    void view.dispose().then(() => (closed = true));
    await vi.advanceTimersByTimeAsync(CLOSE_CAP_MS - 1);
    expect(port.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(port.closed).toBe(true);
    expect(made.page.closed).toBe(1);
    expect(closed).toBe(true);
  });

  it("closes at the cap a page that keeps saving", async () => {
    writeMs = 5_000;
    const { view, port } = await running((p) => send(p, "storage.set", { key: "note", value: "slow" }));
    void view.dispose();
    await vi.advanceTimersByTimeAsync(CLOSE_CAP_MS);
    expect(port.closed).toBe(true);
    expect(made.page.closed).toBe(1);
  });

  it("answers only saves while it closes", async () => {
    const { view, port } = await running();
    void view.dispose();
    const menu = send(port, "ui.showMenu", { items: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(answer(port, menu)).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(calls.menus).toBe(0);
  });

  it("tells the host nothing more, and lets go of what it held at once", async () => {
    const { view } = await running();
    const released = calls.released;
    calls.status = [];
    void view.dispose();
    expect(calls.released).toBe(released + 1);
    // A panel opened in its place may have the same id: the old page's crash or hang must not reach it.
    made.handlers.unresponsive!();
    await vi.advanceTimersByTimeAsync(CLOSE_CAP_MS);
    expect(calls.status).toEqual([]);
    expect(calls.released).toBe(released + 1);
  });

  it("closes at once when its page crashes while it saves", async () => {
    const { view, port } = await running();
    made.page.pongAfter = null;
    void view.dispose();
    made.handlers["render-process-gone"]!({}, { reason: "crashed" });
    expect(port.closed).toBe(true);
    expect(made.page.closed).toBe(1);
    expect(calls.status).not.toContain("crashed");
  });

  it("is closed once, however often it is disposed", async () => {
    const { view, port } = await running();
    made.page.pongAfter = null;
    const first = view.dispose();
    expect(view.dispose()).toBe(first);
    // Its data is being deleted: no more waiting.
    await view.dispose(true);
    expect(port.closed).toBe(true);
    expect(made.page.closed).toBe(1);
    await vi.advanceTimersByTimeAsync(CLOSE_CAP_MS * 2);
    expect(made.page.closed).toBe(1);
    expect(made.page.pings).toHaveLength(1);
  });

  it("closes at once a page that never connected, and starts no timers when it loads later", async () => {
    const view = make();
    await view.dispose();
    expect(made.page.closed).toBe(1);
    expect(made.page.pings).toHaveLength(0);
    made.handlers["did-finish-load"]!();
    made.handlers["did-start-navigation"]!({ isMainFrame: true, isSameDocument: false });
    expect(vi.getTimerCount()).toBe(0);
    expect(calls.status).toEqual([]);
  });
});
