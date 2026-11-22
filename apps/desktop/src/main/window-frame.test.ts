import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowState } from "./window-state";
import { TITLE_BAR_HEIGHT, WINDOW_SAVE_MS, WindowFrame } from "./window-frame";

function setup(options: { overlay?: boolean } = {}) {
  const overlays: { color: string; symbolColor: string; height: number }[] = [];
  const saved: WindowState[] = [];
  const window = {
    destroyed: false,
    maximized: false,
    bounds: { x: 10, y: 20, width: 1280, height: 800 },
  };
  const colors = { background: "#202020", text: "#ffffff" };
  const frame = new WindowFrame({
    window: () => ({
      isDestroyed: () => window.destroyed,
      setTitleBarOverlay: (overlay: { color: string; symbolColor: string; height: number }) => {
        if (options.overlay === false) throw new Error("no window controls overlay here");
        overlays.push(overlay);
      },
      getNormalBounds: () => ({ ...window.bounds }),
      isMaximized: () => window.maximized,
    }),
    colors: () => colors,
    save: (state) => void saved.push(state),
  });
  return { frame, overlays, saved, window, colors };
}

afterEach(() => void vi.useRealTimers());

describe("WindowFrame", () => {
  it("paints the window buttons in the theme's colours, on the colour the page reports behind them", () => {
    const { frame, overlays, colors } = setup();
    expect(frame.titleBar()).toEqual({ color: "#202020", symbolColor: "#ffffff", height: TITLE_BAR_HEIGHT });
    frame.setButtonsBackground("#101010");
    expect(overlays).toEqual([{ color: "#101010", symbolColor: "#ffffff", height: TITLE_BAR_HEIGHT }]);
    // A new theme is painted when asked; the page's colour still counts.
    colors.text = "#000000";
    frame.recolour();
    expect(overlays.at(-1)).toEqual({ color: "#101010", symbolColor: "#000000", height: TITLE_BAR_HEIGHT });
  });

  it("ignores anything but a #rrggbb colour from the page, and the same colour again", () => {
    const { frame, overlays } = setup();
    for (const color of ["red", "#12345", "#1234567", 0x101010, null]) frame.setButtonsBackground(color);
    frame.setButtonsBackground("#ABCDEF");
    frame.setButtonsBackground("#ABCDEF");
    expect(overlays.map((overlay) => overlay.color)).toEqual(["#abcdef"]);
  });

  it("dims the buttons like the page under a dialog backdrop, and only when that changes", () => {
    const { frame, overlays } = setup();
    frame.dim(true);
    frame.dim(true);
    expect(overlays).toEqual([{ color: "#060606", symbolColor: "#333333", height: TITLE_BAR_HEIGHT }]);
    frame.dim(false);
    expect(overlays.at(-1)).toEqual({ color: "#202020", symbolColor: "#ffffff", height: TITLE_BAR_HEIGHT });
  });

  it("has nothing to paint where the system has no window controls overlay, or once the window is gone", () => {
    expect(() => setup({ overlay: false }).frame.dim(true)).not.toThrow();
    const { frame, overlays, window } = setup();
    window.destroyed = true;
    frame.dim(true);
    expect(overlays).toEqual([]);
  });

  it("saves the window's place a moment after it stops moving, and at once when it closes", () => {
    vi.useFakeTimers();
    const { frame, saved, window } = setup();
    frame.saveSoon();
    vi.advanceTimersByTime(WINDOW_SAVE_MS - 1);
    frame.saveSoon();
    vi.advanceTimersByTime(WINDOW_SAVE_MS - 1);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(saved).toEqual([{ bounds: { x: 10, y: 20, width: 1280, height: 800 }, maximized: false }]);

    window.maximized = true;
    frame.saveSoon();
    frame.save();
    vi.advanceTimersByTime(WINDOW_SAVE_MS);
    // The save at closing took the waiting one's place.
    expect(saved).toHaveLength(2);
    expect(saved[1]!.maximized).toBe(true);
    window.destroyed = true;
    frame.save();
    expect(saved).toHaveLength(2);
  });
});
