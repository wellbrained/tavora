import { describe, expect, it, vi } from "vitest";

// The window needs a little of Electron: a window with handlers, views, and a session to lock.
const world = vi.hoisted(() => ({ windows: [] as unknown[], quit: [] as (() => void)[] }));

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
    on: () => undefined,
    once: () => undefined,
    loadURL: async () => undefined,
    isDestroyed: () => false,
    close: () => undefined,
    send: () => undefined,
    focus: () => undefined,
    ipc: { on: () => undefined },
  });
  class BrowserWindow {
    log: string[] = [];
    handlers = new Map<string, ((...args: never[]) => void)[]>();
    gone = false;
    visible = false;
    webContents = contents();
    contentView = { addChildView: () => undefined, removeChildView: () => undefined };
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
    setIgnoreMouseEvents() {}
    setOpacity() {}
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
    setBounds() {
      this.log.push("bounds");
    }
    getBounds() {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    getContentBounds() {
      return { x: 0, y: 0, width: 400, height: 300 };
    }
    setFocusable() {}
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
    setBackgroundColor() {}
    setVisible() {}
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

function make() {
  const calls: string[] = [];
  const panel = {
    view: { webContents: { focus: () => undefined } },
    enterGame: () => calls.push("enter"),
    leaveGame: () => calls.push("leave"),
    setBounds: () => undefined,
    setVisible: () => undefined,
    setGameOpacity: () => undefined,
    setGameZoom: (factor: number) => calls.push(`zoom ${factor}`),
    suspend: () => calls.push("suspend"),
    resume: () => calls.push("resume"),
  };
  const window = new GameOverlayWindow({
    preload: "x",
    hidden: true,
    source: {} as never,
    id: "panel",
    gameBounds: () => null,
    moved: () => undefined,
    closeRequested: () => calls.push("closeRequested"),
    layoutRequested: () => calls.push("layoutRequested"),
    ended: () => calls.push("ended"),
    frameText: () => ({ name: "To-Dos", closeLabel: "Bring back", layoutLabel: "Layout" }),
    panel: panel as never,
    released: () => calls.push("released"),
  });
  const raw = world.windows.at(-1) as { emit(name: string, ...args: unknown[]): void; log: string[] };
  return { window, raw, calls };
}

describe("a game overlay window holding a panel", () => {
  it("refuses to be closed (Alt+F4 while arranging), so the panel is not stranded", () => {
    const { raw, calls } = make();
    const event = { preventDefault: vi.fn() };
    raw.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(calls).not.toContain("released");
  });

  it("lets Tavora destroy it, and lets an app quit close it", () => {
    world.quit.length = 0;
    const { window, raw, calls } = make();
    window.destroy();
    expect(calls).toEqual(expect.arrayContaining(["leave", "released"]));
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
    expect(calls).toEqual(expect.arrayContaining(["leave", "released", "ended"]));
    expect(window.isDestroyed).toBe(true);
    // Nothing is released twice by a later destroy.
    const before = calls.length;
    window.destroy();
    expect(calls).toHaveLength(before);
  });

  it("scales the panel's content with the game window, through the panel and not the page's shared zoom", () => {
    const { window, calls } = make();
    window.setZoom(1.5);
    expect(calls).toContain("zoom 1.5");
  });

  it("is placed and shown on top before the panel takes the keyboard", () => {
    const { window, raw } = make();
    window.setRect({ x: 1, y: 2, width: 300, height: 200 });
    window.setShown(true);
    window.setArranging(true);
    window.focusPanel();
    expect(raw.log.filter((step) => ["bounds", "show", "focus"].includes(step))).toEqual(["bounds", "show", "focus"]);
    // setArranging itself no longer takes the keyboard.
    expect(raw.log.filter((step) => step === "focus")).toHaveLength(1);
  });
});
