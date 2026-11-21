import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Just enough of Electron to see what the windows do when they end, stall or are made again.
const world = vi.hoisted(() => ({
  windows: [] as { emit(name: string): void; ignoring: boolean[]; webContents: { emit(name: string): void } }[],
  views: [] as { webContents: { closed: number } }[],
  sessions: new Map<string, { downloadListeners: number }>(),
}));

vi.mock("electron", () => {
  const makeContents = () => {
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    return {
      closed: 0,
      on(name: string, fn: (...args: unknown[]) => void) {
        handlers.set(name, [...(handlers.get(name) ?? []), fn]);
      },
      once(name: string, fn: (...args: unknown[]) => void) {
        this.on(name, fn);
      },
      emit(name: string) {
        for (const fn of handlers.get(name) ?? []) fn();
      },
      setWindowOpenHandler: () => undefined,
      setWebRTCIPHandlingPolicy: () => undefined,
      loadURL: async () => undefined,
      isLoading: () => false,
      executeJavaScript: async () => undefined,
      insertCSS: async () => "",
      isDestroyed: () => false,
      close() {
        this.closed += 1;
      },
    };
  };
  class BrowserWindow {
    webContents = makeContents();
    contentView = { addChildView: () => undefined };
    ignoring: boolean[] = [];
    handlers = new Map<string, (() => void)[]>();
    gone = false;
    constructor() {
      world.windows.push(this as never);
    }
    on(name: string, fn: () => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
    }
    once(name: string, fn: () => void) {
      this.on(name, fn);
    }
    emit(name: string) {
      for (const fn of this.handlers.get(name) ?? []) fn();
    }
    removeMenu() {}
    setAlwaysOnTop() {}
    setIgnoreMouseEvents(ignore: boolean) {
      this.ignoring.push(ignore);
    }
    getContentBounds() {
      return { x: 0, y: 0, width: 480, height: 360 };
    }
    isDestroyed() {
      return this.gone;
    }
    show() {}
    destroy() {
      this.gone = true;
      this.emit("closed");
    }
  }
  class WebContentsView {
    webContents = makeContents();
    constructor() {
      world.views.push(this as never);
    }
    setBackgroundColor() {}
    setBounds() {}
  }
  const session = {
    fromPartition(partition: string) {
      const counts = world.sessions.get(partition) ?? { downloadListeners: 0 };
      world.sessions.set(partition, counts);
      return (sessions[partition] ??= {
        protocol: { isProtocolHandled: () => false, unhandle: () => undefined, handle: () => undefined },
        webRequest: { onBeforeRequest: () => undefined },
        setProxy: async () => undefined,
        setPermissionRequestHandler: () => undefined,
        setPermissionCheckHandler: () => undefined,
        setDevicePermissionHandler: () => undefined,
        setSpellCheckerEnabled: () => undefined,
        on: (name: string) => {
          if (name === "will-download") counts.downloadListeners += 1;
        },
      });
    },
  };
  const sessions: Record<string, unknown> = {};
  return { BrowserWindow, WebContentsView, session, app: { on: () => undefined, removeListener: () => undefined }, screen: {} };
});

const { lockedSession } = await import("./game-overlay-window");
const { OverlayPreviewWindow } = await import("./overlay-preview-window");
const { GameVeilWindow } = await import("./game-veil-window");

beforeEach(() => {
  world.windows.length = 0;
  world.views.length = 0;
});

describe("a session made again for the same overlay", () => {
  it("refuses downloads with one listener, however often it is locked", () => {
    for (let times = 0; times < 20; times += 1) lockedSession("game-overlay-again", () => true);
    expect(world.sessions.get("game-overlay-again")!.downloadListeners).toBe(1);
  });
});

describe("the preview window", () => {
  const open = () => {
    const closed = vi.fn();
    const request = { id: "preview-1", title: "Clock", source: {}, closed } as never;
    return { preview: new OverlayPreviewWindow(request, { hidden: true, labels: { dark: "Dark", light: "Light", checker: "Checkered" } }), closed };
  };

  it("closes both its pages when the user closes it", () => {
    const { closed } = open();
    world.windows[0]!.emit("closed");
    expect(world.views.map((view) => view.webContents.closed)).toEqual([1, 1]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("closes them once when Tavora closes it", () => {
    const { preview, closed } = open();
    preview.destroy();
    expect(world.views.map((view) => view.webContents.closed)).toEqual([1, 1]);
    expect(closed).not.toHaveBeenCalled();
  });
});

describe("the veil", () => {
  let made: InstanceType<typeof GameVeilWindow> | undefined;
  const open = () => {
    made = new GameVeilWindow({ hidden: false });
    return world.windows[0]!;
  };
  afterEach(() => made?.destroy());

  it("lets clicks through during a stall and takes them again after it", () => {
    const veil = open();
    veil.webContents.emit("unresponsive");
    expect(veil.ignoring.at(-1)).toBe(true);
    veil.webContents.emit("responsive");
    expect(veil.ignoring.at(-1)).toBe(false);
  });

  it("stays click-through once its page died", () => {
    const veil = open();
    veil.webContents.emit("render-process-gone");
    veil.webContents.emit("responsive");
    expect(veil.ignoring).toEqual([true]);
  });
});
