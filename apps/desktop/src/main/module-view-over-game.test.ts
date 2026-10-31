import { describe, expect, it, vi } from "vitest";

// ModuleView needs only a little of Electron to be made: a view with a page, and a session to harden.
const made = vi.hoisted(() => ({
  views: [] as { background: string; visible: boolean; throttled: boolean; css: string[]; removed: string[] }[],
  sent: [] as unknown[][],
  /** What the session answers for the module's own addresses (the clipboard, pictures, files). */
  serve: undefined as ((request: Request) => Promise<Response>) | undefined,
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
      on: () => undefined,
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
    WebContentsView,
  };
});

const { ModuleView, allowedHere, ADD_DIALOG_MS } = await import("./module-view");
const { CLIPBOARD_PATH } = await import("@tavora/sdk/protocol");

function make(extra: Record<string, unknown> = {}) {
  const options = {
    instanceId: "11111111-1111-4111-8111-111111111111",
    module: { owner: "official", root: "/nowhere", provenance: "official", manifest: { id: "tavora.todos", entry: "dist/index.html", permissions: {} } },
    panelType: null,
    workspace: { id: "elden", displayName: "Elden Ring", kind: "game" },
    data: { blobs: {} },
    getTheme: () => ({ tokens: { background: "#202020" } }),
    savePicture: async () => null,
    saveJson: async () => null,
    openJson: async () => null,
    discord: { release: () => undefined },
    ...extra,
  };
  return new ModuleView(options as never);
}

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
  it("counts a click or key press only while arranging, and always in the workspace", () => {
    const view = make();
    const taken = () => {
      view.usedAt = 0;
      view.noteGesture();
      return view.usedAt > 0;
    };
    expect(taken()).toBe(true);

    let arranging = false;
    view.enterGame(() => arranging);
    expect(view.isOverGame).toBe(true);
    expect(taken()).toBe(false);
    arranging = true;
    expect(taken()).toBe(true);
    arranging = false;
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
    view.revealed = true;
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

  it("opens from a real press as clicked, which uses up the pass", async () => {
    const { view, opened, ask } = made_({ reason: "add" });
    view.noteGesture();
    await ask();
    await ask(false);
    await expect(ask()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(opened).toEqual([{ open: true, byClick: true }, { open: false, byClick: undefined }]);
  });
});
