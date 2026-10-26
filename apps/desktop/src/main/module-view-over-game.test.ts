import { describe, expect, it, vi } from "vitest";

// ModuleView needs only a little of Electron to be made: a view with a page, and a session to harden.
const made = vi.hoisted(() => ({ views: [] as { background: string; visible: boolean; throttled: boolean; css: string[]; removed: string[] }[], sent: [] as unknown[][] }));

vi.mock("electron", () => {
  const session = () => ({
    protocol: { handle: () => undefined },
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
    MessageChannelMain: class {},
    session: { fromPartition: () => ses },
    WebContentsView,
  };
});

const { ModuleView, allowedHere } = await import("./module-view");

function make(extra: Record<string, unknown> = {}) {
  const options = {
    instanceId: "11111111-1111-4111-8111-111111111111",
    module: { owner: "official", root: "/nowhere", provenance: "official", manifest: { id: "tavora.todos", entry: "dist/index.html", permissions: {} } },
    panelType: null,
    game: { id: "elden", displayName: "Elden Ring", kind: "game" },
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

  it("refuses calls that need Tavora's window while over the game, and tells the player once per press", () => {
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
    (view as unknown as { gestureAt: number }).gestureAt += 1;
    expect(() => refuse("hotkeys.set")).toThrow();
    expect(told).toHaveBeenCalledTimes(2);

    view.leaveGame();
    expect(() => refuse("ui.showMenu")).not.toThrow();
  });

  it("refuses the dialogs the session answers when the last press came from a panel over the game", () => {
    const gesture: { at: number; overGame?: boolean; refuse?: () => void } = { at: Date.now() };
    const refuse = vi.fn();
    const allowed = allowedHere(gesture);
    expect(allowed()).toBe(true);
    gesture.overGame = true;
    gesture.refuse = refuse;
    expect(allowed()).toBe(false);
    expect(refuse).toHaveBeenCalled();
    gesture.overGame = false;
    expect(allowed()).toBe(true);
    gesture.at = Date.now() - 60_000;
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
