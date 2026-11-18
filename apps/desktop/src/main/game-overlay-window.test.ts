import { describe, expect, it, vi } from "vitest";

// The window needs a little of Electron: a window with handlers, views, and a session to lock.
const world = vi.hoisted(() => ({ windows: [] as unknown[], quit: [] as (() => void)[], focusedContents: null as unknown }));

vi.mock("electron", () => {
  const ses = {
    protocol: { isProtocolHandled: () => false, unhandle: () => undefined, handle: () => undefined },
    webRequest: { onBeforeRequest: () => undefined },
    setProxy: async () => undefined,
    setPermissionRequestHandler: () => undefined,
    setPermissionCheckHandler: () => undefined,
    setDevicePermissionHandler: () => undefined,
    setSpellCheckerEnabled: () => undefined,
    on: () => undefined,
  };
  const contents = () => ({
    setWindowOpenHandler: () => undefined,
    setWebRTCIPHandlingPolicy: () => undefined,
    on: () => undefined,
    once: () => undefined,
    loadURL: async () => undefined,
    isDestroyed: () => false,
    close: () => undefined,
    send: () => undefined,
    focus() {
      world.focusedContents = this;
    },
    ipc: { on: () => undefined },
  });
  class BrowserWindow {
    log: string[] = [];
    handlers = new Map<string, ((...args: never[]) => void)[]>();
    gone = false;
    visible = false;
    webContents = contents();
    /** The views in the window, bottom first. */
    children: unknown[] = [];
    contentView = {
      addChildView: (view: unknown) => {
        this.children = [...this.children.filter((child) => child !== view), view];
      },
      removeChildView: (view: unknown) => {
        this.children = this.children.filter((child) => child !== view);
      },
    };
    ignoring = true;
    focusable = false;
    constructor() {
      world.windows.push(this);
    }
    on(name: string, fn: (...args: never[]) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
    }
    once(name: string, fn: (...args: never[]) => void) {
      this.on(name, fn);
    }
    emit(name: string, ...args: unknown[]) {
      for (const fn of this.handlers.get(name) ?? []) (fn as (...a: unknown[]) => void)(...args);
    }
    removeMenu() {}
    setAlwaysOnTop() {
      this.log.push("top");
    }
    setIgnoreMouseEvents(ignore: boolean) {
      this.ignoring = ignore;
    }
    opacity = 1;
    setOpacity(opacity: number) {
      this.opacity = opacity;
    }
    isDestroyed() {
      return this.gone;
    }
    isVisible() {
      return this.visible;
    }
    showInactive() {
      this.visible = true;
      this.log.push("show");
    }
    hide() {
      this.visible = false;
    }
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    setBounds(rect: { x: number; y: number; width: number; height: number }) {
      this.bounds = rect;
      this.log.push("bounds");
    }
    getBounds() {
      return this.bounds;
    }
    getContentBounds() {
      return { x: 0, y: 0, width: 400, height: 300 };
    }
    setFocusable(focusable: boolean) {
      this.focusable = focusable;
    }
    focus() {
      this.log.push("focus");
    }
    isFocused() {
      return false;
    }
    setContentProtection() {}
    destroy() {
      this.gone = true;
      this.emit("closed");
    }
  }
  class WebContentsView {
    webContents = contents();
    visible = true;
    setBackgroundColor() {}
    setVisible(visible: boolean) {
      this.visible = visible;
    }
    setBounds() {}
  }
  return {
    BrowserWindow,
    WebContentsView,
    app: {
      on: (name: string, fn: () => void) => name === "before-quit" && world.quit.push(fn),
      removeListener: (name: string, fn: () => void) => void (name === "before-quit" && world.quit.splice(world.quit.indexOf(fn), 1)),
    },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    session: { fromPartition: () => ses },
  };
});

const { GameOverlayWindow } = await import("./game-overlay-window");

type Rect = { x: number; y: number; width: number; height: number };
type RawWindow = {
  emit(name: string, ...args: unknown[]): void;
  log: string[];
  bounds: Rect;
  children: unknown[];
  ignoring: boolean;
  focusable: boolean;
  opacity: number;
  visible: boolean;
};

function make(game: Rect | null = null, options: { overlay?: boolean; hidden?: boolean } = {}) {
  const calls: string[] = [];
  /** Answers the frame requests, oldest first (the page has drawn). */
  const frames: (() => void)[] = [];
  const state = { bounds: null as Rect | null, layerOpen: (() => false) as () => boolean, focused: false };
  const panel = {
    view: {
      webContents: {
        focus: () => (state.focused = true),
        isFocused: () => state.focused,
        isDestroyed: () => false,
      },
    },
    enterGame: (layerOpen: () => boolean) => {
      state.layerOpen = layerOpen;
      calls.push("enter");
    },
    leaveGame: () => calls.push("leave"),
    setBounds: (rect: Rect) => void (state.bounds = rect),
    setVisible: () => undefined,
    setGameOpacity: () => undefined,
    setGameZoom: (factor: number) => calls.push(`zoom ${factor}`),
    suspend: () => calls.push("suspend"),
    resume: () => calls.push("resume"),
    nextFrame: () => {
      calls.push("frame");
      return new Promise<void>((resolve) => frames.push(resolve));
    },
  };
  const window = new GameOverlayWindow({
    preload: "x",
    hidden: options.hidden ?? true,
    source: {} as never,
    id: "panel",
    gameBounds: () => game,
    moved: () => undefined,
    closeRequested: () => calls.push("closeRequested"),
    layoutRequested: () => calls.push("layoutRequested"),
    ended: () => calls.push("ended"),
    activated: () => calls.push("activated"),
    frameText: () => ({ name: "To-Dos", closeLabel: "Bring back", layoutLabel: "Layout" }),
    ...(options.overlay ? {} : { panel: panel as never }),
  });
  const raw = world.windows.at(-1) as RawWindow;
  // The frame is Tavora's own view in the window; a panel's view is the other one.
  const frame = raw.children.find((child) => child !== panel.view) as { visible: boolean; webContents: unknown };
  return { window, raw, calls, panel, state, frame, frames };
}

describe("a game overlay window holding a panel", () => {
  it("refuses to be closed (Alt+F4 while it has the keyboard), so the panel is not stranded", () => {
    const { raw, calls } = make();
    const event = { preventDefault: vi.fn() };
    raw.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(calls).not.toContain("leave");
  });

  it("lets Tavora destroy it, and lets an app quit close it", () => {
    world.quit.length = 0;
    const { window, raw, calls } = make();
    window.destroy();
    expect(calls).toEqual(expect.arrayContaining(["leave"]));
    expect(world.quit).toHaveLength(0);

    const quitting = make();
    for (const fn of world.quit) fn();
    const event = { preventDefault: vi.fn() };
    quitting.raw.emit("close", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    void raw;
  });

  it("lets go of the panel and tells the service when it was closed all the same", () => {
    const { window, raw, calls } = make();
    raw.emit("closed");
    expect(calls).toEqual(expect.arrayContaining(["leave", "ended"]));
    expect(window.isDestroyed).toBe(true);
    // Nothing is released twice by a later destroy.
    const before = calls.length;
    window.destroy();
    expect(calls).toHaveLength(before);
  });

  it("says when its window gets the keyboard, so the layer's card can go above it again", () => {
    const { raw, calls } = make();
    raw.emit("focus");
    expect(calls).toContain("activated");
  });

  it("scales the panel's content with the game window, through the panel and not the page's shared zoom", () => {
    const { window, calls } = make();
    window.setZoom(1.5);
    expect(calls).toContain("zoom 1.5");
  });

  it("grows around the panel's place in Arrange, so the panel itself doesn't move", () => {
    const { window, raw } = make({ x: 0, y: 0, width: 2560, height: 1440 });
    const place = { x: 100, y: 100, width: 400, height: 300 };
    window.setRect(place);
    expect(raw.bounds).toEqual(place);
    window.setMode("arrange");
    expect(raw.bounds).toEqual({ x: 92, y: 70, width: 416, height: 338 });
    window.setMode("use");
    expect(raw.bounds).toEqual(place);
  });

  it("in Use, is exactly the panel's place with no frame, and the panel takes the mouse, the keyboard and the whole window", () => {
    const { window, raw, state, frame } = make({ x: 0, y: 0, width: 2560, height: 1440 });
    const place = { x: 100, y: 100, width: 400, height: 300 };
    window.setRect(place);
    window.setMode("use");
    expect(window.layerMode).toBe("use");
    expect(raw.bounds).toEqual(place);
    expect(state.bounds).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(raw.ignoring).toBe(false);
    expect(raw.focusable).toBe(true);
    expect(frame.visible).toBe(false);
    // Its clicks count as the user's while the layer is open, in Use and in Arrange; not before.
    expect(state.layerOpen()).toBe(true);
    window.setMode("arrange");
    expect(state.layerOpen()).toBe(true);
    window.setMode("off");
    expect(state.layerOpen()).toBe(false);
  });

  it("in Arrange, grows by the frame, which lies over the panel and takes the mouse and the keys, so a drag never reaches the panel", () => {
    const { window, raw, state, frame, panel } = make({ x: 0, y: 0, width: 2560, height: 1440 });
    window.setRect({ x: 100, y: 100, width: 400, height: 300 });
    window.setMode("use");
    window.focusPanel();
    expect(state.focused).toBe(true);
    window.setMode("arrange");
    expect(raw.bounds).toEqual({ x: 92, y: 70, width: 416, height: 338 });
    // The panel sits inside the frame, and the frame is the top view, shown.
    expect(state.bounds).toMatchObject({ x: 8, y: 30 });
    expect(raw.children.at(-1)).toBe(frame);
    expect(raw.children.indexOf(panel.view)).toBeLessThan(raw.children.indexOf(frame));
    expect(frame.visible).toBe(true);
    expect(raw.ignoring).toBe(false);
    // The keys go to the frame, and the panel can't take them back. The window stays focusable: on Windows taking that
    // away from the focused window hands the keyboard to another program, which ended the layer.
    expect(world.focusedContents).toBe(frame.webContents);
    expect(raw.focusable).toBe(true);
    state.focused = false;
    window.focusPanel();
    expect(state.focused).toBe(false);
  });

  it("is placed and shown on top before the panel takes the keyboard", () => {
    const { window, raw } = make();
    window.setRect({ x: 1, y: 2, width: 300, height: 200 });
    window.setShown(true);
    window.setMode("use");
    window.focusPanel();
    expect(raw.log.filter((step) => ["bounds", "show", "focus"].includes(step))).toEqual(["bounds", "show", "focus"]);
    // setMode itself never takes the keyboard.
    expect(raw.log.filter((step) => step === "focus")).toHaveLength(1);
  });
});

describe("a game overlay window showing its panel", () => {
  it("stays see-through until the page has drawn after being shown, so the panel's look from its workspace never flashes", async () => {
    const { window, raw, calls, frames } = make(null, { hidden: false });
    window.setShown(true);
    expect(raw.visible).toBe(true);
    expect(raw.opacity).toBe(0);
    // The page is told it is over the game first (when lent), woken, and only then asked for a frame.
    expect(calls.filter((call) => ["enter", "resume", "frame"].includes(call))).toEqual(["enter", "resume", "frame"]);
    await Promise.resolve();
    expect(raw.opacity).toBe(0);
    frames.shift()!();
    await vi.waitFor(() => expect(raw.opacity).toBe(1));
  });

  it("lets clicks through while it is still see-through, and takes them once drawn", async () => {
    const { window, raw, frames } = make(null, { hidden: false });
    window.setMode("use");
    window.setShown(true);
    // Invisible, so a click there must reach what is below instead of landing on nothing.
    expect(raw.ignoring).toBe(true);
    window.setMode("arrange");
    expect(raw.ignoring).toBe(true);
    frames.shift()!();
    await vi.waitFor(() => expect(raw.opacity).toBe(1));
    expect(raw.ignoring).toBe(false);
  });

  it("waits again each time it is shown, and an old frame never shows a newer showing early", async () => {
    const { window, raw, frames } = make(null, { hidden: false });
    window.setShown(true);
    window.setShown(false);
    window.setShown(true);
    expect(raw.opacity).toBe(0);
    frames.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(raw.opacity).toBe(0);
    frames.shift()!();
    await vi.waitFor(() => expect(raw.opacity).toBe(1));
  });

  it("stays invisible in test runs once drawn", async () => {
    const { window, raw, frames } = make();
    raw.opacity = 0;
    window.setShown(true);
    frames.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(raw.opacity).toBe(0);
  });
});

describe("a game overlay window holding an overlay page", () => {
  it("stays click-through without a frame in Use, and shows its frame and takes the mouse only in Arrange", () => {
    const { window, raw, frame } = make(null, { overlay: true });
    window.setMode("use");
    expect(raw.ignoring).toBe(true);
    expect(frame.visible).toBe(false);
    window.setMode("arrange");
    expect(raw.ignoring).toBe(false);
    expect(frame.visible).toBe(true);
    // Never the keyboard.
    expect(raw.focusable).toBe(false);
    window.setMode("off");
    expect(raw.ignoring).toBe(true);
    expect(frame.visible).toBe(false);
  });
});
