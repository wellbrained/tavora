import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutFrame } from "./overlay-layout";

// The canvas needs a window with child views, and views with a page to capture; each is a small fake here.
const world = vi.hoisted(() => ({ views: [] as unknown[], image: "data:image/png;base64,AAAA", captures: 0 }));

vi.mock("electron", () => {
  class FakeContents {
    destroyed = false;
    sent: [string, unknown][] = [];
    id = world.views.length + 100;
    setWindowOpenHandler() {}
    on() {}
    loadURL() {
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      this.destroyed = true;
    }
    send(channel: string, payload: unknown) {
      this.sent.push([channel, payload]);
    }
    getZoomFactor() {
      return 1;
    }
    setZoomFactor() {}
    capturePage() {
      world.captures++;
      return Promise.resolve({ isEmpty: () => world.image === "", toDataURL: () => world.image });
    }
    insertCSS() {
      return Promise.resolve("css");
    }
    removeInsertedCSS() {
      return Promise.resolve();
    }
  }
  class WebContentsView {
    webContents = new FakeContents();
    visible = true;
    bounds = { x: 0, y: 0, width: 10, height: 10 };
    constructor() {
      world.views.push(this);
    }
    setBackgroundColor() {}
    setVisible(visible: boolean) {
      this.visible = visible;
    }
    setBounds(bounds: typeof this.bounds) {
      this.bounds = bounds;
    }
    getBounds() {
      return this.bounds;
    }
  }
  class BrowserWindow {
    webContents = new FakeContents();
    gone = false;
    children: unknown[] = [];
    contentView = {
      addChildView: (view: unknown) => {
        this.children = [...this.children.filter((child) => child !== view), view];
      },
      removeChildView: (view: unknown) => {
        this.children = this.children.filter((child) => child !== view);
      },
    };
    isDestroyed() {
      return this.gone;
    }
  }
  return { BrowserWindow, WebContentsView };
});
vi.mock("./assets", () => ({ GAME_OVERLAY_SCHEME: "tavora-overlay" }));
vi.mock("./game-overlay-page", () => ({ GAME_OVERLAY_FRAME_URL: "tavora-overlay://x/frame", GAME_OVERLAY_ORIGIN: "tavora-overlay://x", serveGameOverlay: () => new Response() }));
vi.mock("./game-overlay-window", () => ({ lockContents: () => undefined, lockedSession: () => ({ protocol: { handle: () => undefined } }) }));

import { OverlayCanvas } from "./overlay-canvas";

interface FakeView {
  webContents: { destroyed: boolean; sent: [string, unknown][] };
  visible: boolean;
}
interface FakeWindow {
  webContents: { sent: [string, unknown][] };
  children: unknown[];
  gone: boolean;
}

const BOUNDS = { x: 0, y: 0, width: 100, height: 100 };
const frame = (id: string): LayoutFrame => ({ id, bounds: BOUNDS, visible: true, zoom: 1, opacity: 1, source: { page: () => "", state: () => "", watch: () => () => undefined } }) as unknown as LayoutFrame;

async function rig() {
  const { BrowserWindow } = await import("electron");
  const window = new BrowserWindow() as unknown as FakeWindow;
  const canvas = new OverlayCanvas({ window: window as never, preload: "p", devTools: false, address: () => "tavora://layer" });
  // The layer was made first, then one view per frame.
  const layer = world.views[0] as FakeView;
  const stills = () => window.webContents.sent.filter(([channel]) => channel === "layout:stills").map(([, payload]) => payload as { items: { id: string }[]; layer: unknown });
  return { canvas, window, layer, stills, items: () => world.views.slice(1) as FakeView[] };
}

beforeEach(() => {
  world.views = [];
  world.captures = 0;
  world.image = "data:image/png;base64,AAAA";
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("the Overlay page's canvas under a list or menu", () => {
  it("covers: freezes the pages behind still pictures, hides them once the shell shows them, and keeps the layer's picture", async () => {
    const { canvas, layer, stills, items } = await rig();
    canvas.place([frame("a")], BOUNDS, false);
    expect([layer.visible, items()[0]!.visible]).toEqual([true, true]);
    canvas.place([frame("a")], BOUNDS, true);
    // Still in sight while the pictures are taken, then sent to the shell.
    expect(items()[0]!.visible).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(stills().at(-1)).toMatchObject({ items: [{ id: "a" }], layer: { url: world.image } });
    // Not hidden until the shell says its stills are on screen...
    expect([layer.visible, items()[0]!.visible]).toEqual([true, true]);
    canvas.stillsShown();
    await vi.advanceTimersByTimeAsync(0);
    expect([layer.visible, items()[0]!.visible]).toEqual([false, false]);
  });

  it("covers: hides them anyway when the shell never answers", async () => {
    const { canvas, layer, items } = await rig();
    canvas.place([frame("a")], BOUNDS, true);
    await vi.advanceTimersByTimeAsync(299);
    expect(layer.visible).toBe(true);
    await vi.advanceTimersByTimeAsync(2);
    expect([layer.visible, items()[0]!.visible]).toEqual([false, false]);
  });

  it("covers: goes on with no pictures at all when none could be taken, and the pages step aside", async () => {
    world.image = "";
    const { canvas, layer, stills } = await rig();
    canvas.place([frame("a")], BOUNDS, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(stills().at(-1)).toMatchObject({ items: [], layer: null });
    expect(layer.visible).toBe(false);
  });

  it("thaws: the pages are back at once and the stills go after a moment", async () => {
    const { canvas, layer, stills, items } = await rig();
    canvas.place([frame("a")], BOUNDS, true);
    await vi.advanceTimersByTimeAsync(0);
    canvas.stillsShown();
    await vi.advanceTimersByTimeAsync(0);
    const before = stills().length;
    canvas.place([frame("a")], BOUNDS, false);
    expect([layer.visible, items()[0]!.visible]).toEqual([true, true]);
    expect(stills()).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(80);
    expect(stills().at(-1)).toEqual({ items: [], layer: null });
  });

  it("thaws before the pictures were taken: the late pictures are never shown or used", async () => {
    const { canvas, layer, stills, items } = await rig();
    canvas.place([frame("a")], BOUNDS, true);
    canvas.place([frame("a")], BOUNDS, false);
    await vi.advanceTimersByTimeAsync(400);
    expect([layer.visible, items()[0]!.visible]).toEqual([true, true]);
    expect(stills().some((sent) => sent.layer !== null)).toBe(false);
  });

  it("covers again after thawing: the older freeze never hides the pages of the newer one", async () => {
    const { canvas, layer } = await rig();
    canvas.place([frame("a")], BOUNDS, true);
    canvas.place([frame("a")], BOUNDS, false);
    canvas.place([frame("a")], BOUNDS, true);
    await vi.advanceTimersByTimeAsync(0);
    canvas.stillsShown();
    await vi.advanceTimersByTimeAsync(0);
    expect(layer.visible).toBe(false);
  });

  it("destroys while nothing is covered: the views leave the window and the shell's stills are cleared", async () => {
    const { canvas, window, layer, stills, items } = await rig();
    canvas.place([frame("a")], BOUNDS, false);
    const page = items()[0]!;
    canvas.destroy();
    expect(canvas.isDestroyed).toBe(true);
    expect(window.children).toEqual([]);
    expect([layer.webContents.destroyed, page.webContents.destroyed]).toEqual([true, true]);
    expect(stills().at(-1)).toEqual({ items: [], layer: null });
    // Again, and every call after it, does nothing.
    canvas.destroy();
    canvas.place([frame("b")], BOUNDS, true);
    expect(world.views).toHaveLength(2);
  });

  it("destroys while covered: a freeze that was waiting ends and nothing is sent after", async () => {
    const { canvas, layer, stills } = await rig();
    canvas.place([frame("a")], BOUNDS, true);
    await vi.advanceTimersByTimeAsync(0);
    const sent = stills().length;
    canvas.destroy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(layer.webContents.destroyed).toBe(true);
    // Only the clearing one came after the pictures.
    expect(stills()).toHaveLength(sent + 1);
    expect(stills().at(-1)).toEqual({ items: [], layer: null });
  });

  it("destroys with its window already gone: nothing is touched on it", async () => {
    const { canvas, window } = await rig();
    canvas.place([frame("a")], BOUNDS, false);
    window.gone = true;
    expect(() => canvas.destroy()).not.toThrow();
  });
});
