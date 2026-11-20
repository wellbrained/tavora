import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ModuleView needs only a little of Electron to be made: a view with a page, and a session to harden.
const made = vi.hoisted(() => ({
  views: [] as { background: string; visible: boolean; throttled: boolean; css: string[]; removed: string[] }[],
  sent: [] as unknown[][],
  /** What the session answers for the module's own addresses (the clipboard, pictures, files). */
  serve: undefined as ((request: Request) => Promise<Response>) | undefined,
  /** What the module's calls hand to the system's file manager. */
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn(async () => "") },
  /** The last page's event handlers, by event name. */
  handlers: {} as Record<string, (...args: unknown[]) => void>,
}));

vi.mock("electron", () => {
  const session = () => ({
    protocol: { handle: (_scheme: string, serve: (request: Request) => Promise<Response>) => void (made.serve = serve) },
    webRequest: { onBeforeRequest: () => undefined },
    setProxy: async () => undefined,
    setPermissionRequestHandler: () => undefined,
    setPermissionCheckHandler: () => undefined,
    setDevicePermissionHandler: () => undefined,
    setSpellCheckerEnabled: () => undefined,
    on: () => undefined,
  });
  const ses = session();
  class WebContentsView {
    state = { background: "", visible: true, throttled: true, css: [] as string[], removed: [] as string[] };
    webContents = {
      session: ses,
      setWindowOpenHandler: () => undefined,
      setWebRTCIPHandlingPolicy: () => undefined,
      on: (event: string, handler: (...args: unknown[]) => void) => void (made.handlers[event] = handler),
      close: () => undefined,
      loadURL: async () => undefined,
      isDestroyed: () => false,
      isLoading: () => false,
      setBackgroundThrottling: (allowed: boolean) => void (this.state.throttled = allowed),
      insertCSS: async (css: string) => {
        this.state.css.push(css);
        // The page takes a moment to take a style.
        await new Promise((resolve) => setTimeout(resolve, 15));
        return `key-${this.state.css.length}`;
      },
      removeInsertedCSS: async (key: string) => void this.state.removed.push(key),
      send: (channel: string, ...args: unknown[]) => void made.sent.push([channel, ...args]),
      postMessage: () => undefined,
    };
    constructor() {
      made.views.push(this.state);
    }
    setBackgroundColor(color: string) {
      this.state.background = color;
    }
    setBorderRadius() {}
    setVisible(visible: boolean) {
      this.state.visible = visible;
    }
    setBounds() {}
    getBounds() {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
  }
  return {
    app: { isPackaged: false, getPath: () => "/nowhere" },
    BrowserWindow: { getAllWindows: () => [] },
    clipboard: {},
    ClipboardItem: class {},
    MessageChannelMain: class {
      port1 = { on: () => undefined, postMessage: () => undefined, start: () => undefined, close: () => undefined };
      port2 = {};
    },
    session: { fromPartition: () => ses },
    shell: made.shell,
    WebContentsView,
  };
});

const { ModuleView, allowedHere, ADD_DIALOG_MS, CONNECT_GAP_MS, GESTURE_MS } = await import("./module-view");
const { CLIPBOARD_PATH, JSON_EXPORT_PATH } = await import("@tavora/sdk/protocol");

function make(extra: Record<string, unknown> = {}) {
  const options = {
    instanceId: "11111111-1111-4111-8111-111111111111",
    module: { owner: "official", root: "/nowhere", provenance: "official", manifest: { id: "tavora.todos", entry: "dist/index.html", permissions: {} } },
    panelType: null,
    workspace: { id: "elden", displayName: "Elden Ring", kind: "game" },
    data: { blobs: {} },
    getTheme: () => ({ tokens: { background: "#202020" } }),
    fontCss: (theme: { font?: { id: string } }) => `font:${theme.font?.id ?? ""}`,
    savePicture: async () => null,
    saveJson: async () => null,
    openJson: async () => null,
    saveFile: async () => null,
    openFile: async () => null,
    discord: { release: () => undefined },
    ...extra,
  };
  return new ModuleView(options as never);
}

describe("closing a panel", () => {
  it("starts no timers when its page finishes loading only after it was closed", () => {
    vi.useFakeTimers();
    try {
      const view = make({ onStatus: () => undefined });
      view.dispose();
      const finished = made.handlers["did-finish-load"];
      expect(finished).toBeTypeOf("function");
      finished!();
      // Electron drops a closed view's page: a timer left running would read `isDestroyed` of undefined.
      (view as unknown as { view: { webContents?: unknown } }).view.webContents = undefined;
      expect(() => vi.advanceTimersByTime(5 * 60_000)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays silent and does not throw when its page is already gone", async () => {
    vi.useFakeTimers();
    try {
      const statuses: string[] = [];
      const view = make({ onStatus: (status: string) => statuses.push(status) });
      const inner = view as unknown as { view: { webContents?: unknown }; setStatus(status: string): void; hideUntilSettled(): void };
      // Electron drops a closed view's page.
      inner.view.webContents = undefined;
      await expect(view.dispose()).resolves.toBeUndefined();
      expect(() => {
        inner.setStatus("failed");
        inner.setStatus("crashed");
        inner.hideUntilSettled();
        view.noteGesture();
        view.reload();
        view.leaveGame();
        vi.advanceTimersByTime(5 * 60_000);
      }).not.toThrow();
      expect(statuses).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fail when its page goes while a change over the game is still queued", async () => {
    vi.useFakeTimers();
    try {
      const view = make({ onStatus: () => undefined });
      view.enterGame(() => false);
      view.setGameOpacity(50);
      // Electron drops the page before the queued steps run.
      (view as unknown as { view: { webContents?: unknown } }).view.webContents = undefined;
      view.leaveGame();
      await expect(vi.runAllTimersAsync()).resolves.not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("one press", () => {
  const take = (view: InstanceType<typeof ModuleView>) => (view as unknown as { takeGesture(what: string): Promise<void> }).takeGesture("links.open");
  /** The page writes to the clipboard through its session: 403 when no unused press allows it. */
  const copy = () => made.serve!(new Request(`tavora-module://tavora.todos${CLIPBOARD_PATH}`, { method: "POST" }));

  it("allows one call, whether the bridge or an address the session answers makes it", async () => {
    const view = make();
    view.noteGesture();
    await take(view);
    expect((await copy()).status).toBe(403);

    view.noteGesture();
    expect((await copy()).status).not.toBe(403);
    await expect(take(view)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect((await copy()).status).toBe(403);
  });
});

describe("files.exportJson", () => {
  const exportJson = () => made.serve!(new Request(`tavora-module://tavora.todos${JSON_EXPORT_PATH}?name=Plan`, { method: "POST", body: "{}" }));

  // The session's addresses are set up by the first view of a session (the save dialogs of make(): closed at once).
  it("saves through Tavora's save dialog, as files.saveJson does: closing it refuses", async () => {
    const view = make();
    view.noteGesture();
    const reply = await exportJson();
    expect(reply.status).toBe(403);
    expect((await reply.json()).error).toMatchObject({ code: "PERMISSION_DENIED", message: "the save dialog was closed" });
  });

  it("is not for a panel over the game, and opens no dialog there", async () => {
    const told = vi.fn();
    const view = make({ onNeedsTavora: told });
    view.enterGame(() => true);
    view.noteGesture();
    const reply = await exportJson();
    expect(reply.status).toBe(403);
    expect((await reply.json()).error.message).not.toBe("the save dialog was closed");
    expect(told).toHaveBeenCalledTimes(1);
  });
});

describe("panel.overGame", () => {
  const bridged = { launch: () => ({ reason: "add" }), data: { blobs: {}, documents: { on: () => undefined, off: () => undefined } } };

  it("tells the page once when it goes over the game and once when it comes back, and answers panel.isOverGame the same", () => {
    const view = make(bridged);
    view.connect();
    const bridge = (view as unknown as { bridge: { emit(event: string, data: unknown): void; context: { isOverGame(): boolean } } }).bridge;
    const emit = vi.spyOn(bridge, "emit");
    const told = () => emit.mock.calls.filter(([event]) => event === "panel.overGame").map(([, data]) => data);
    expect(bridge.context.isOverGame()).toBe(false);
    view.enterGame(() => true);
    view.enterGame(() => true);
    expect(bridge.context.isOverGame()).toBe(true);
    view.leaveGame();
    view.leaveGame();
    expect(bridge.context.isOverGame()).toBe(false);
    expect(told()).toEqual([{ over: true }, { over: false }]);
  });
});

describe("panels.openMany", () => {
  /** Enough for a page to connect: its launch and documents that can be watched. */
  const bridged = { launch: () => ({ reason: "add" }), data: { blobs: {}, documents: { on: () => undefined, off: () => undefined } } };
  /** The bridge's side of the page: what the page's calls reach once checked. */
  const context = (view: InstanceType<typeof ModuleView>) => {
    view.connect();
    return (view as unknown as { bridge: { context: { openPanels(types: string[]): Promise<unknown> } } }).bridge.context;
  };

  it("opens the whole list on one press, and refuses a second call on the same press", async () => {
    const asked: string[][] = [];
    const view = make({ ...bridged, openPanels: async (types: string[]) => (asked.push(types), { map: "opened", bosses: "opened" }) });
    const bridge = context(view);
    await expect(bridge.openPanels(["map", "bosses"])).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    view.noteGesture();
    await expect(bridge.openPanels(["map", "bosses"])).resolves.toEqual({ map: "opened", bosses: "opened" });
    await expect(bridge.openPanels(["paldeck"])).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(asked).toEqual([["map", "bosses"]]);
  });

  it("is not for a panel over the game, and keeps the press for later", async () => {
    const told = vi.fn();
    const opened = vi.fn(async () => ({}));
    const view = make({ ...bridged, openPanels: opened, onNeedsTavora: told });
    const bridge = context(view);
    view.enterGame(() => true);
    view.noteGesture();
    await expect(bridge.openPanels(["map"])).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(told).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
  });
});

describe("folders.showInFolder", () => {
  type Target = { path: string; kind: "file" | "folder" } | null;
  const bridged = { launch: () => ({ reason: "add" }), data: { blobs: {}, documents: { on: () => undefined, off: () => undefined } }, networkHosts: () => new Set(), connectors: () => new Set() };
  /** A module view whose folders answer `target` and note what they were asked. */
  function folderView(target: Target, granted = true) {
    const asked: unknown[][] = [];
    const folders = {
      granted: () => granted,
      state: async () => ({ found: true }),
      list: async () => ({ files: [], truncated: false }),
      read: async () => Buffer.alloc(0),
      watch: async () => null,
      choose: async () => false,
      reveal: async (...args: unknown[]) => (asked.push(args), target),
    };
    const view = make({ ...bridged, folders });
    view.connect();
    const show = (folder = "Documents/StarCraft II", file = "Replays/a.SC2Replay") =>
      (view as unknown as { bridge: { context: { folders: { showInFolder(folder: string, file: string): Promise<void> } } } }).bridge.context.folders.showInFolder(folder, file);
    return { view, asked, show };
  }
  const shell = made.shell;
  beforeEach(() => {
    shell.showItemInFolder.mockClear();
    shell.openPath.mockClear();
  });

  it("selects a file in its folder after a press", async () => {
    const { view, asked, show } = folderView({ path: "/docs/StarCraft II/Replays/a.SC2Replay", kind: "file" });
    view.noteGesture();
    await show();
    expect(asked).toEqual([["Documents/StarCraft II", "Replays/a.SC2Replay"]]);
    expect(shell.showItemInFolder.mock.calls).toEqual([["/docs/StarCraft II/Replays/a.SC2Replay"]]);
  });

  it("selects the folder a gone file was in the same way, and never opens or launches anything", async () => {
    const { view, show } = folderView({ path: "/docs/StarCraft II/Replays", kind: "folder" });
    view.noteGesture();
    await show();
    expect(shell.showItemInFolder.mock.calls).toEqual([["/docs/StarCraft II/Replays"]]);
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("shows nothing, and says nothing, when there is nothing to show", async () => {
    const { view, show } = folderView(null);
    view.noteGesture();
    await expect(show()).resolves.toBeUndefined();
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("needs a press for every call", async () => {
    const { view, asked, show } = folderView({ path: "/docs/a.SC2Replay", kind: "file" });
    await expect(show()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    view.noteGesture();
    await show();
    await expect(show()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(asked).toHaveLength(1);
    expect(shell.showItemInFolder).toHaveBeenCalledTimes(1);
  });

  it("is refused for a panel over the game, before the folder is even looked at", async () => {
    const told = vi.fn();
    const asked: unknown[][] = [];
    const view = make({
      ...bridged,
      onNeedsTavora: told,
      folders: { granted: () => true, state: async () => ({ found: true }), list: async () => ({ files: [], truncated: false }), read: async () => Buffer.alloc(0), watch: async () => null, choose: async () => false, reveal: async (...args: unknown[]) => (asked.push(args), null) },
    });
    view.connect();
    view.enterGame(() => true);
    view.noteGesture();
    const folders = (view as unknown as { bridge: { context: { folders: { showInFolder(folder: string, file: string): Promise<void> } } } }).bridge.context.folders;
    await expect(folders.showInFolder("Documents/StarCraft II", "Replays/a.SC2Replay")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(told).toHaveBeenCalledTimes(1);
    expect(asked).toEqual([]);
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it("shows nothing once the grant is taken back while the folder was looked at", async () => {
    let granted = true;
    const { view, show } = folderView({ path: "/docs/a.SC2Replay", kind: "file" });
    (view as unknown as { options: { folders: { granted(): boolean; reveal(): Promise<Target> } } }).options.folders.granted = () => granted;
    const reveal = (view as unknown as { options: { folders: { reveal(): Promise<Target> } } }).options.folders.reveal;
    (view as unknown as { options: { folders: { reveal(): Promise<Target> } } }).options.folders.reveal = async () => ((granted = false), reveal());
    view.noteGesture();
    await show();
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });
});

describe("links.open", () => {
  it("opens no address on this PC or the local network, and keeps the press", async () => {
    const opened: string[] = [];
    const view = make({ onOpenLink: (url: string) => void opened.push(url) });
    const open = (url: string) => (view as unknown as { openLink(url: string): Promise<void> }).openLink(url);
    view.noteGesture();
    for (const url of ["http://127.0.0.1:8080/", "http://localhost/", "http://192.168.1.1/admin", "http://[::1]/", "http://169.254.169.254/"]) {
      await expect(open(url)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
    await open("https://example.com/");
    expect(opened).toEqual(["https://example.com/"]);
  });
});

describe("a panel over the game", () => {
  it("counts a click or key press only while the layer is open (Use or Arrange), and always in the workspace", () => {
    const view = make();
    const taken = () => {
      view.usedAt = 0;
      view.noteGesture();
      return view.usedAt > 0;
    };
    expect(taken()).toBe(true);

    let layerOpen = false;
    view.enterGame(() => layerOpen);
    expect(view.isOverGame).toBe(true);
    expect(taken()).toBe(false);
    layerOpen = true;
    expect(taken()).toBe(true);
    layerOpen = false;
    expect(taken()).toBe(false);

    view.leaveGame();
    expect(view.isOverGame).toBe(false);
    expect(taken()).toBe(true);
  });

  it("drops its colour over the game so the opacity shows through, and gets it back", () => {
    const view = make();
    const state = made.views.at(-1)!;
    expect(state.background).toBe("#202020");
    view.enterGame(() => false);
    expect(state.background).toBe("#00000000");
    // A new theme while over the game doesn't paint the panel opaque again.
    view.applyTheme({ tokens: { background: "#ffffff" } } as never);
    expect(state.background).toBe("#00000000");
    view.leaveGame();
    expect(state.background).toBe("#202020");
  });

  it("swaps the font's stylesheet only when the font changes, and the colours' on every theme", async () => {
    const view = make();
    const state = made.views.at(-1)!;
    const theme = (font: string, background: string) => ({ tokens: { background }, font: { id: font, family: font } }) as never;
    view.applyTheme(theme("inter", "#101010"));
    view.applyTheme(theme("inter", "#202020"));
    await vi.waitFor(() => expect(state.css.filter((css) => css.startsWith("font:"))).toEqual(["font:inter"]));
    view.applyTheme(theme("allo", "#202020"));
    await vi.waitFor(() => expect(state.css.filter((css) => css.startsWith("font:"))).toEqual(["font:inter", "font:allo"]));
    const inter = `key-${state.css.indexOf("font:inter") + 1}`;
    await vi.waitFor(() => expect(state.removed).toContain(inter));
    // Two colour sheets went in (the third theme had the same colours, so nothing changed), and the older one came out.
    await vi.waitFor(() => expect(state.css.filter((css) => !css.startsWith("font:"))).toHaveLength(2));
    await vi.waitFor(() => expect(state.removed).toHaveLength(2));
  });

  it("takes the style away even when it was still being inserted as the panel came back", async () => {
    const view = make();
    const state = made.views.at(-1)!;
    view.enterGame(() => false);
    view.setGameOpacity(50);
    // The style is on its way in when the panel comes back.
    await vi.waitFor(() => expect(state.css).toHaveLength(1));
    view.leaveGame();
    await vi.waitFor(() => expect(state.removed).toEqual(["key-1"]));
  });

  it("never keeps the game's zoom in the workspace, even when it was lent again before it came back", async () => {
    const view = make();
    const state = made.views.at(-1)!;
    view.enterGame(() => true);
    view.setGameZoom(1.33);
    await vi.waitFor(() => expect(state.css.filter((css) => css.includes("zoom:1.33"))).toHaveLength(1));
    // Lent again without coming back first: the zoom it had goes, and the new stay sets its own.
    view.enterGame(() => true);
    view.setGameZoom(1.33);
    await vi.waitFor(() => expect(state.removed).toContain("key-1"));
    view.leaveGame();
    // Every style that went in came out again.
    await vi.waitFor(() => expect(state.removed).toEqual(state.css.map((_, index) => `key-${index + 1}`)));
  });

  it("refuses calls that need Tavora's window while over the game, and tells the user once per press", () => {
    const told = vi.fn();
    const view = make({ onNeedsTavora: told });
    const refuse = (what: string) => (view as unknown as { refuseOverGame(what: string): void }).refuseOverGame(what);
    // In the workspace nothing is refused.
    expect(() => refuse("ui.showMenu")).not.toThrow();
    expect(told).not.toHaveBeenCalled();

    view.enterGame(() => true);
    view.noteGesture();
    expect(() => refuse("ui.showMenu")).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(() => refuse("links.open")).toThrow();
    expect(told).toHaveBeenCalledTimes(1);
    // Another press, another notice.
    view.noteGesture();
    expect(() => refuse("hotkeys.set")).toThrow();
    expect(told).toHaveBeenCalledTimes(2);

    view.leaveGame();
    expect(() => refuse("ui.showMenu")).not.toThrow();
  });

  it("refuses the dialogs the session answers when the last press came from a panel over the game", () => {
    const gesture: { press: { at: number; used: boolean }; overGame?: boolean; refuse?: () => void } = { press: { at: Date.now(), used: false } };
    const refuse = vi.fn();
    const allowed = allowedHere(gesture);
    expect(allowed()).toBe(true);
    gesture.overGame = true;
    gesture.refuse = refuse;
    expect(allowed()).toBe(false);
    expect(refuse).toHaveBeenCalled();
    gesture.overGame = false;
    expect(allowed()).toBe(true);
    gesture.press.used = true;
    expect(allowed()).toBe(false);
    gesture.press = { at: Date.now() - 60_000, used: false };
    expect(allowed()).toBe(false);
  });

  it("fades the page by a style of Tavora's own, and takes it away when it comes back", async () => {
    const view = make();
    const state = made.views.at(-1)!;
    view.enterGame(() => false);
    view.setGameOpacity(50);
    await vi.waitFor(() => expect(state.css.some((css) => css.includes("opacity:0.5"))).toBe(true));
    view.setGameOpacity(100);
    await vi.waitFor(() => expect(state.removed).toHaveLength(1));
    view.setGameOpacity(25);
    await vi.waitFor(() => expect(state.css.some((css) => css.includes("opacity:0.25"))).toBe(true));
    view.leaveGame();
    await vi.waitFor(() => expect(state.removed).toHaveLength(2));
  });
});

describe("a panel shown again", () => {
  const frameRequest = () => made.sent.filter(([channel]) => channel === "tavora:frame").at(-1)?.[1];

  it("is see-through until the page says it has drawn, so what lies under it stays", async () => {
    const drawn = vi.fn();
    const view = make({ onDrawn: drawn });
    const state = made.views.at(-1)!;
    expect(view.phase).toBe("loading");
    view.revealed = true;
    expect(view.phase).toBe("revealed");
    view.setVisible(true);
    expect(state.background).toBe("#00000000");
    const done = vi.fn();
    void view.drawn.then(done);
    const requestId = frameRequest();
    expect(typeof requestId).toBe("number");
    // An answer to another request, or not a number, changes nothing.
    view.framed("1");
    view.framed((requestId as number) + 1);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    view.framed(requestId);
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(view.firstDrawn).toBe(true);
    expect(view.phase).toBe("drawn");
    expect(drawn).toHaveBeenCalledTimes(1);
    // Its colour comes back once the frame has had time to reach the screen, so it does not show plain before that.
    expect(state.background).toBe("#00000000");
    await vi.waitFor(() => expect(state.background).toBe("#202020"));
  });

  it("stops waiting when it is hidden again, or after the cap", async () => {
    vi.useFakeTimers();
    try {
      const view = make();
      const state = made.views.at(-1)!;
      view.setVisible(true);
      const first = view.drawn;
      view.setVisible(false);
      await first;
      await vi.advanceTimersByTimeAsync(250);
      expect(state.background).toBe("#202020");
      // A page that never answers (stuck, broken) gets its colour back and lets the cover go.
      view.setVisible(true);
      const done = vi.fn();
      void view.drawn.then(done);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(done).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(state.background).toBe("#202020");
    } finally {
      vi.useRealTimers();
    }
  });

  // Under the game's loading cover Chromium would count the page as hidden, and it would never draw there.
  it("counts as shown wherever it lies until it has drawn, and is paused as usual after", async () => {
    vi.useFakeTimers();
    try {
      const view = make();
      const state = made.views.at(-1)!;
      view.setVisible(true);
      expect(state.throttled).toBe(false);
      view.framed(frameRequest());
      expect(state.throttled).toBe(true);
      view.setVisible(false);
      view.setVisible(true);
      expect(state.throttled).toBe(false);
      view.setVisible(false);
      expect(state.throttled).toBe(true);
      view.setVisible(true);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(state.throttled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("over the game, asks for a frame after telling the page it is there, and answers once that frame is drawn or the cap ran out", async () => {
    vi.useFakeTimers();
    try {
      const view = make({ launch: () => ({ reason: "restore" }), data: { blobs: {}, documents: { on: () => undefined, off: () => undefined } } });
      view.connect();
      const bridge = (view as unknown as { bridge: { emit(event: string, data: unknown): void } }).bridge;
      const order: string[] = [];
      vi.spyOn(bridge, "emit").mockImplementation((event) => void order.push(event));
      view.setVisible(true);
      made.sent.length = 0;
      view.enterGame(() => true);
      expect(order).toContain("panel.overGame");
      expect(frameRequest()).toBeUndefined();
      const done = vi.fn();
      void view.nextFrame().then(done);
      const requestId = frameRequest();
      expect(made.sent.filter(([channel]) => channel === "tavora:frame")).toHaveLength(1);
      // A frame asked for before (when it was shown in its workspace) is not this one.
      view.framed((requestId as number) - 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(done).not.toHaveBeenCalled();
      view.framed(requestId);
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toHaveBeenCalled();
      // A page that never answers still shows after the cap.
      const late = vi.fn();
      void view.nextFrame().then(late);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(late).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(late).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers a frame request at once while hidden", async () => {
    const view = make();
    await expect(view.nextFrame()).resolves.toBeUndefined();
  });

  it("stays clear over the game", () => {
    const view = make();
    const state = made.views.at(-1)!;
    view.enterGame(() => false);
    view.setVisible(true);
    view.framed(frameRequest());
    expect(state.background).toBe("#00000000");
  });
});

describe("a dialog right after Add", () => {
  type Opened = { open: boolean; byClick: boolean | undefined };
  const SIZE = { width: 560, height: 640 };
  function made_(launch: { reason: string }, extra: Record<string, unknown> = {}) {
    const opened: Opened[] = [];
    const view = make({ setDialog: (open: boolean, _size: unknown, how?: { byClick: boolean }) => void opened.push({ open, byClick: how?.byClick }), ...extra });
    const inner = view as unknown as { startPage(launch: unknown): void; requestDialog(open: boolean, size: typeof SIZE): Promise<void> };
    inner.startPage(launch);
    return { view, opened, ask: (open = true) => inner.requestDialog(open, SIZE) };
  }

  it("opens once without a press for a panel just added, and not as if clicked", async () => {
    const { opened, ask } = made_({ reason: "add" });
    await ask();
    expect(opened).toEqual([{ open: true, byClick: false }]);
    await expect(ask()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(opened).toHaveLength(1);
  });

  it("is gone once the page has run for 10 seconds", async () => {
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);
      const { opened, ask } = made_({ reason: "add" });
      now.mockReturnValue(1_000_000 + ADD_DIALOG_MS + 1);
      await expect(ask()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(opened).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it("is not there after a restore or panels.open", async () => {
    for (const launch of [{ reason: "restore", content: null }, { reason: "open", content: null }]) {
      const { opened, ask } = made_(launch);
      await expect(ask()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(opened).toEqual([]);
    }
  });

  it("is not there for a panel that came with another one from the same click", async () => {
    const { opened, ask } = made_({ reason: "add" }, { mayWelcome: () => false });
    await expect(ask()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(opened).toEqual([]);
  });

  it("is not there over the game", async () => {
    const { view, opened, ask } = made_({ reason: "add" });
    view.enterGame(() => false);
    await expect(ask()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(opened).toEqual([]);
  });

  it("is gone after the page reloads", async () => {
    const { view, opened, ask } = made_({ reason: "add" });
    // A new document asks for its launch again: the host answers restore.
    (view as unknown as { startPage(launch: unknown): void }).startPage({ reason: "restore", content: null });
    await expect(ask()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(opened).toEqual([]);
  });

  it("is not there for a page that held back its hello and loaded again later", async () => {
    const opened: Opened[] = [];
    const view = make({ setDialog: (open: boolean, _size: unknown, how?: { byClick: boolean }) => void opened.push({ open, byClick: how?.byClick }) });
    const inner = view as unknown as { startPage(launch: unknown): void; requestDialog(open: boolean, size: typeof SIZE): Promise<void> };
    const navigate = () => made.handlers["did-start-navigation"]!({ isMainFrame: true, isSameDocument: false });
    // The first page starts and never asks for its bridge; then it loads again and asks at once.
    navigate();
    navigate();
    // The host still holds the Add the first page never took.
    inner.startPage({ reason: "add" });
    await expect(inner.requestDialog(true, SIZE)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(opened).toEqual([]);
  });

  it("is still there when the first page tried to leave the module and was stopped", async () => {
    const opened: Opened[] = [];
    const view = make({ setDialog: (open: boolean, _size: unknown, how?: { byClick: boolean }) => void opened.push({ open, byClick: how?.byClick }) });
    const inner = view as unknown as { startPage(launch: unknown): void; requestDialog(open: boolean, size: typeof SIZE): Promise<void> };
    const prevented = vi.fn();
    made.handlers["did-start-navigation"]!({ isMainFrame: true, isSameDocument: false });
    made.handlers["did-navigate"]!({}, "tavora-module://tavora.todos/dist/index.html", 200);
    // Electron counts a page's own navigation as started before it asks whether it may go; Tavora says no.
    made.handlers["did-start-navigation"]!({ isMainFrame: true, isSameDocument: false });
    made.handlers["will-navigate"]!({ url: "https://example.com/", preventDefault: prevented });
    made.handlers["will-frame-navigate"]!({ url: "https://example.com/", isMainFrame: true, preventDefault: prevented });
    expect(prevented).toHaveBeenCalledTimes(2);
    inner.startPage({ reason: "add" });
    await inner.requestDialog(true, SIZE);
    expect(opened).toEqual([{ open: true, byClick: false }]);
  });

  it("is still there when the first page asks after its own load started", async () => {
    const opened: Opened[] = [];
    const view = make({ setDialog: (open: boolean, _size: unknown, how?: { byClick: boolean }) => void opened.push({ open, byClick: how?.byClick }) });
    const inner = view as unknown as { startPage(launch: unknown): void; requestDialog(open: boolean, size: typeof SIZE): Promise<void> };
    made.handlers["did-start-navigation"]!({ isMainFrame: true, isSameDocument: false });
    inner.startPage({ reason: "add" });
    await inner.requestDialog(true, SIZE);
    expect(opened).toEqual([{ open: true, byClick: false }]);
  });

  it("is not there when the first page asks only once 10 seconds have gone since it started", async () => {
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);
      const opened: Opened[] = [];
      const view = make({ setDialog: (open: boolean, _size: unknown, how?: { byClick: boolean }) => void opened.push({ open, byClick: how?.byClick }) });
      const inner = view as unknown as { startPage(launch: unknown): void; requestDialog(open: boolean, size: typeof SIZE): Promise<void> };
      now.mockReturnValue(1_000_000 + 60 * 60_000);
      inner.startPage({ reason: "add" });
      await expect(inner.requestDialog(true, SIZE)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(opened).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it("opens from a real press as clicked, which uses up the pass", async () => {
    const { view, opened, ask } = made_({ reason: "add" });
    view.noteGesture();
    await ask();
    await ask(false);
    await expect(ask()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(opened).toEqual([{ open: true, byClick: true }, { open: false, byClick: undefined }]);
  });
});

describe("asking for a port", () => {
  const connecting = () => {
    const view = make({ launch: () => ({ reason: "add" }), hostVersion: "0.0.0-test", data: { blobs: {}, documents: { on: () => undefined, off: () => undefined } } });
    const ports = vi.spyOn(view.view.webContents as unknown as { postMessage(channel: string): void }, "postMessage");
    return { view, ports: () => ports.mock.calls.filter(([channel]) => channel === "tavora:port").length };
  };

  it("gives a page at most one port a while, and the asks made meanwhile one port when the time is up", async () => {
    const { view, ports } = connecting();
    view.connect();
    expect(ports()).toBe(1);
    // A page asking in a loop: no new port at once, and one for all of them later.
    for (let i = 0; i < 20; i++) view.connect();
    expect(ports()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, CONNECT_GAP_MS + 100));
    expect(ports()).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, CONNECT_GAP_MS + 100));
    expect(ports()).toBe(2);
  });

  it("hands every port of the panel the same budget, so a new port resets no limit", () => {
    const { view } = connecting();
    view.connect();
    const first = (view as unknown as { bridge: { budget: object } }).bridge.budget;
    (view as unknown as { lastConnect: number }).lastConnect = 0;
    view.connect();
    expect((view as unknown as { bridge: { budget: object } }).bridge.budget).toBe(first);
  });
});

// Every call that needs a click (takeGesture) or Tavora's own window (refuseOverGame), each with what it would do: a
// refused call must do nothing. The last tests hold the tables to module-view.ts and connection.ts, so a new check
// without a row here fails.
describe("guarded calls", () => {
  type Context = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  interface Row {
    /** The call as METHOD_INFO names it. */
    name: string;
    /** Whether it is refused over the game too (refuseOverGame). */
    overGame: boolean;
    call(context: Context): Promise<unknown>;
  }
  /** The spies a guarded call would reach once allowed; none may be called by a refused call. */
  const effects = () => ({
    openPanel: vi.fn(async () => "opened"),
    openPanels: vi.fn(async () => ({})),
    setMaximized: vi.fn(),
    setDialog: vi.fn(),
    leaderboardsShow: vi.fn(async () => true),
    leaderboardsHide: vi.fn(async () => true),
    pickReadOnlyFile: vi.fn(async () => []),
    showMenu: vi.fn(async () => null),
    copyLink: vi.fn(async () => "copied"),
    showOverGame: vi.fn(async () => true),
    preview: vi.fn(async () => true),
    openPage: vi.fn(),
    setHotkey: vi.fn(async () => "set"),
    choose: vi.fn(async () => true),
    reveal: vi.fn(async () => ({ path: "/docs/a.txt", kind: "file" })),
    openLink: vi.fn(),
    tooltip: vi.fn(async () => true),
    mediaControl: vi.fn(async () => true),
    discordConnect: vi.fn(async () => undefined),
    discordAllow: vi.fn(async () => undefined),
    discordCommand: vi.fn(async () => ({})),
    clearLog: vi.fn(),
    setSettings: vi.fn(() => ({})),
  });
  const ROWS: Row[] = [
    { name: "links.open", overGame: true, call: (c) => c.openLink("https://example.com/") },
    { name: "panels.open", overGame: true, call: (c) => c.openPanel("map", null) },
    { name: "panels.openMany", overGame: true, call: (c) => c.openPanels(["map"]) },
    { name: "panel.setMaximized", overGame: true, call: (c) => c.setMaximized(true) },
    { name: "panel.setDialog", overGame: false, call: (c) => c.setDialog(true, "medium") },
    { name: "leaderboards.show", overGame: true, call: (c) => c.leaderboards.show() },
    { name: "leaderboards.hide", overGame: false, call: (c) => c.leaderboards.hide() },
    { name: "files.pickReadOnly", overGame: true, call: (c) => c.readOnlyFiles.pick([".txt"], false) },
    { name: "files.showInFolder", overGame: true, call: (c) => c.readOnlyFiles.showInFolder("file-1") },
    { name: "ui.showMenu", overGame: true, call: (c) => c.showMenu({ items: [] }) },
    { name: "ui.tooltip.show", overGame: false, call: (c) => c.tooltip.show({ id: "t", at: { x: 0, y: 0 }, pinned: true }) },
    { name: "overlay.copyLink", overGame: true, call: (c) => c.overlay.copyLink("item-1") },
    { name: "overlay.showOverGame", overGame: true, call: (c) => c.overlay.showOverGame("item-1") },
    { name: "overlay.preview", overGame: true, call: (c) => c.overlay.preview("item-1") },
    { name: "overlay.openPage", overGame: true, call: (c) => c.overlay.openPage() },
    { name: "hotkeys.set", overGame: true, call: (c) => c.hotkeys.set("start", "item-1", "Timer") },
    { name: "folders.choose", overGame: true, call: (c) => c.folders.choose("Documents/Game") },
    { name: "folders.showInFolder", overGame: true, call: (c) => c.folders.showInFolder("Documents/Game", "a.txt") },
    { name: "media.control", overGame: false, call: (c) => c.media.control("session-1", "play") },
    { name: "discord.connect", overGame: false, call: (c) => c.discord.connect() },
    { name: "discord.allowControl", overGame: false, call: (c) => c.discord.allowControl() },
    { name: "discord.command", overGame: false, call: (c) => c.discord.command("SELECT_VOICE_CHANNEL", { channel_id: null }) },
    { name: "systemInfo.clearConnectionLog", overGame: false, call: (c) => c.systemInfo.clearConnectionLog() },
    { name: "systemInfo.setConnectionSettings", overGame: false, call: (c) => c.systemInfo.setConnectionSettings({ watching: false }) },
  ];

  /** A connected System Monitor panel whose every guarded call ends in a spy of `spies`. */
  function guarded() {
    const spies = effects();
    const view = make({
      module: {
        owner: "official",
        root: "/nowhere",
        provenance: "official",
        manifest: { id: "tavora.system-monitor", entry: "dist/index.html", permissions: {}, actions: [{ id: "start", name: "Start" }] },
      },
      // A reload: no dialog pass for a panel just added.
      launch: () => ({ reason: "reload" }),
      data: { blobs: {}, documents: { on: () => undefined, off: () => undefined } },
      networkHosts: () => new Set(),
      connectors: () => new Set(["media", "discord", "system-info"]),
      openPanel: spies.openPanel,
      openPanels: spies.openPanels,
      setMaximized: spies.setMaximized,
      setDialog: spies.setDialog,
      leaderboards: { status: async () => null, show: spies.leaderboardsShow, hide: spies.leaderboardsHide },
      pickReadOnlyFile: spies.pickReadOnlyFile,
      showMenu: spies.showMenu,
      overlay: { copyLink: spies.copyLink, copyNeedsWindow: () => true, showOverGame: spies.showOverGame, preview: spies.preview, openPage: spies.openPage },
      hotkeys: { list: () => [], set: spies.setHotkey, remove: () => undefined },
      folders: { granted: () => true, state: async () => ({ found: true }), list: async () => ({ files: [], truncated: false }), read: async () => Buffer.alloc(0), watch: async () => null, choose: spies.choose, reveal: spies.reveal },
      onOpenLink: spies.openLink,
      tooltip: { show: spies.tooltip, move: () => undefined, close: () => undefined, defineSkin: async () => undefined },
      media: { subscribe: () => ({ state: () => null, control: spies.mediaControl, close: () => undefined }) },
      discord: {
        release: () => undefined,
        use: async () => undefined,
        state: () => null,
        connectNow: spies.discordConnect,
        allowControl: spies.discordAllow,
        command: spies.discordCommand,
      },
      connection: { outageLog: () => [], clearLog: spies.clearLog, getSettings: () => ({}), setSettings: spies.setSettings },
    });
    view.connect();
    const context = (view as unknown as { bridge: { context: Context } }).bridge.context;
    // media.control acts only on a session the panel watches.
    context.media.watch(true);
    return { view, context, spies };
  }
  const nothingDone = (spies: ReturnType<typeof effects>) => {
    for (const [name, spy] of Object.entries(spies)) expect(spy, name).not.toHaveBeenCalled();
    expect(made.shell.showItemInFolder).not.toHaveBeenCalled();
  };
  beforeEach(() => made.shell.showItemInFolder.mockClear());

  it.each(ROWS.map((row) => [row.name, row] as const))("%s is refused without a press, and does nothing", async (_name, row) => {
    const { context, spies } = guarded();
    await expect(row.call(context)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    nothingDone(spies);
  });

  it.each(ROWS.map((row) => [row.name, row] as const))("%s is refused after a press older than the window, and does nothing", async (_name, row) => {
    const { view, context, spies } = guarded();
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    try {
      view.noteGesture();
      clock.mockReturnValue(start + GESTURE_MS + 1);
      await expect(row.call(context)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      nothingDone(spies);
    } finally {
      clock.mockRestore();
    }
  });

  it.each(ROWS.filter((row) => row.overGame).map((row) => [row.name, row] as const))("%s is refused over the game, even after a press, and does nothing", async (_name, row) => {
    const { view, context, spies } = guarded();
    view.enterGame(() => true);
    view.noteGesture();
    await expect(row.call(context)).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: expect.stringContaining("over the game") });
    nothingDone(spies);
  });

  it("a fresh press gets each call past its check, which uses the press up", async () => {
    for (const row of ROWS) {
      const { view, context } = guarded();
      view.noteGesture();
      // files.showInFolder then looks for a file this test never picked; the press is what counts here.
      await row.call(context).catch((error: { code?: string }) => expect(error.code, row.name).not.toBe("PERMISSION_DENIED"));
      expect((view as unknown as { press: { used: boolean } }).press.used, row.name).toBe(true);
    }
  });

  const source = (file: string) => readFileSync(path.join(import.meta.dirname, file), "utf8");
  it("cover every call module-view.ts checks for a press", () => {
    const checked = [...source("module-view.ts").matchAll(/\btakeGesture\(\s*["'`]([^"'`]+)["'`]/g), ...source("connection.ts").matchAll(/\bawait gesture\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]!);
    expect([...new Set(checked)].sort()).toEqual(ROWS.map((row) => row.name).sort());
  });

  it("cover every call module-view.ts refuses over the game", () => {
    const refused = [...source("module-view.ts").matchAll(/\brefuseOverGame\(\s*["'`]([^"'`]+)["'`]\)/g)].map((match) => match[1]!);
    expect([...new Set(refused)].sort()).toEqual(ROWS.filter((row) => row.overGame).map((row) => row.name).sort());
  });
});

describe("the module's origin", () => {
  it("puts a policy on every answer: not found, not allowed and a route's answer run nothing", async () => {
    make();
    const origin = "tavora-module://tavora.todos";
    for (const request of [new Request(`${origin}/does-not-exist.html`), new Request(`${origin}/dist/index.html`, { method: "POST" }), new Request(`${origin}${CLIPBOARD_PATH}`)]) {
      const answer = await made.serve!(request);
      expect(answer.status, request.url).toBeGreaterThanOrEqual(400);
      expect(answer.headers.get("Content-Security-Policy"), request.url).toBe("default-src 'none'; sandbox");
      expect(answer.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
    // Another module's address, too.
    expect((await made.serve!(new Request("tavora-module://local.other/x"))).headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
  });
});

describe("the storage guard", () => {
  it("measures the module's storage from the start, also while its page never finishes loading", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tavora-view-guard-"));
    vi.useFakeTimers();
    const over: number[] = [];
    let view: InstanceType<typeof ModuleView> | undefined;
    let ses: { storagePath?: string } | undefined;
    try {
      await writeFile(path.join(dir, "big"), Buffer.alloc(100));
      view = make({ storageLimit: 10, onStorageOver: () => over.push(Date.now()), onStatus: () => undefined });
      ses = (view as unknown as { view: { webContents: { session: { storagePath?: string } } } }).view.webContents.session;
      ses.storagePath = dir;
      // The page starts, and holds its load: no did-finish-load ever comes.
      made.handlers["did-start-navigation"]!({ isMainFrame: true, isSameDocument: false });
      expect(view.status).toBe("loading");
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(over.length).toBeGreaterThan(0));

      // One watch only, still one after the page does finish loading, and none once the panel closes.
      made.handlers["did-finish-load"]!();
      over.length = 0;
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.waitFor(() => expect(over.length).toBeGreaterThan(0));
      expect(over.length).toBeLessThanOrEqual(3);
      void view.dispose(true);
      await vi.advanceTimersByTimeAsync(10);
      over.length = 0;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(over).toEqual([]);
    } finally {
      if (ses) delete ses.storagePath;
      vi.useRealTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
