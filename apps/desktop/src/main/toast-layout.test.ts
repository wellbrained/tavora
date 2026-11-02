import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_GUTTER } from "../shared/host-toasts";
import type { Place } from "../shared/host-toasts";
import { keepOnTop, SHRINK_AFTER_MS, ToastLayout, type ToastSurface } from "./toast-layout";

const AREA = { width: 1200, height: 800 };

class FakeSurface implements ToastSurface {
  bounds: Place | null = null;
  visible = false;
  raised = 0;
  setBounds(place: Place) {
    this.bounds = place;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
  }
  raise() {
    this.raised++;
  }
}

describe("ToastLayout", () => {
  let surface: FakeSurface;
  let layout: ToastLayout;
  beforeEach(() => {
    vi.useFakeTimers();
    surface = new FakeSurface();
    layout = new ToastLayout(surface, { area: () => AREA });
  });

  it("stays hidden without toasts", () => {
    layout.setCount(0);
    expect(surface.visible).toBe(false);
    expect(layout.visible).toBe(false);
  });

  it("shows at once with the first toast, on top, until the toast has measured itself", () => {
    layout.setCount(1);
    expect(surface.visible).toBe(true);
    expect(surface.raised).toBe(1);
    expect(surface.bounds).not.toBeNull();
    layout.setExtent({ width: 280, height: 48 });
    // Bigger than the toast for now: it shrinks after a moment, never while the toast moves.
    expect(surface.bounds!.width).toBeGreaterThan(280 + 2 * TOAST_GUTTER);
    vi.advanceTimersByTime(SHRINK_AFTER_MS);
    expect(surface.bounds).toMatchObject({ width: 280 + 2 * TOAST_GUTTER, height: 16 + 48 + TOAST_GUTTER });
  });

  it("grows at once when the stack opens", () => {
    layout.setCount(2);
    layout.setExtent({ width: 280, height: 48 });
    vi.advanceTimersByTime(SHRINK_AFTER_MS);
    const small = surface.bounds!;
    layout.setExtent({ width: 280, height: 48 * 2 + 8 });
    expect(surface.bounds!.height).toBeGreaterThan(small.height);
    expect(surface.bounds!.y + surface.bounds!.height).toBe(AREA.height);
  });

  it("shrinks only after a moment, when the stack gets smaller", () => {
    layout.setCount(2);
    layout.setExtent({ width: 280, height: 104 });
    vi.advanceTimersByTime(SHRINK_AFTER_MS);
    const tall = surface.bounds!.height;
    layout.setCount(1);
    layout.setExtent({ width: 280, height: 48 });
    expect(surface.bounds!.height).toBe(tall);
    vi.advanceTimersByTime(SHRINK_AFTER_MS);
    expect(surface.bounds!.height).toBeLessThan(tall);
  });

  it("hides after the last toast has faded out, and shows again for the next one", () => {
    layout.setCount(1);
    layout.setExtent({ width: 280, height: 48 });
    layout.setCount(0);
    layout.setExtent({ width: 0, height: 0 });
    expect(surface.visible).toBe(true);
    vi.advanceTimersByTime(SHRINK_AFTER_MS);
    expect(surface.visible).toBe(false);
    expect(layout.visible).toBe(false);
    layout.setCount(1);
    expect(surface.visible).toBe(true);
    expect(surface.raised).toBe(2);
  });

  it("stays when a new toast comes while the last one is still leaving", () => {
    layout.setCount(1);
    layout.setExtent({ width: 280, height: 48 });
    layout.setCount(0);
    layout.setExtent({ width: 0, height: 0 });
    layout.setCount(1);
    layout.setExtent({ width: 300, height: 48 });
    vi.advanceTimersByTime(SHRINK_AFTER_MS * 2);
    expect(surface.visible).toBe(true);
    expect(surface.bounds!.width).toBe(300 + 2 * TOAST_GUTTER);
  });

  it("moves with the position and the window", () => {
    layout.setCount(1);
    layout.setExtent({ width: 280, height: 48 });
    vi.advanceTimersByTime(SHRINK_AFTER_MS);
    layout.setPosition("bottom-right");
    expect(surface.bounds!.x + surface.bounds!.width).toBe(AREA.width);
    layout.setPosition("top-center");
    expect(surface.bounds!.y).toBeLessThan(AREA.height / 2);
    expect(surface.bounds!.y).toBeGreaterThan(0);
  });

  it("hides while the window has no room", () => {
    let area = AREA;
    const small = new ToastLayout(surface, { area: () => area });
    small.setCount(1);
    small.setExtent({ width: 280, height: 48 });
    area = { width: 0, height: 0 };
    small.windowResized();
    expect(surface.visible).toBe(false);
  });
});

describe("keepOnTop", () => {
  it("puts the view back on top after anything else is added", () => {
    const order: string[] = [];
    const window = {
      addChildView(view: string) {
        const at = order.indexOf(view);
        if (at >= 0) order.splice(at, 1);
        order.push(view);
      },
    };
    window.addChildView("toasts");
    const top = keepOnTop(window, "toasts");
    window.addChildView("panel-1");
    window.addChildView("cover");
    expect(order).toEqual(["panel-1", "cover", "toasts"]);
    window.addChildView("panel-2");
    expect(order.at(-1)).toBe("toasts");
    top.stop();
    window.addChildView("late");
    expect(order.at(-1)).toBe("late");
  });
});
