import type { Rectangle } from "electron";

export interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1280, height: 800 } as const;
export const MIN_SIZE = { width: 640, height: 480 } as const;
/** How much of the title bar must be on a screen for saved bounds to be reused. */
const MIN_VISIBLE = { width: 120, height: 40 } as const;

function overlap(a: Rectangle, b: Rectangle): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

const center = (rect: Rectangle) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const holds = (area: Rectangle, point: { x: number; y: number }) => point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height;

/** Whether saved bounds would be reused by initialBounds. */
export function reusable(saved: unknown, workAreas: Rectangle[]): boolean {
  const b = (saved as Partial<WindowState> | null | undefined)?.bounds;
  if (b === undefined || ![b.x, b.y, b.width, b.height].every((n) => Number.isInteger(n)) || b.width < MIN_SIZE.width || b.height < MIN_SIZE.height) return false;
  return workAreas.some((area) => {
    const o = overlap({ x: b.x, y: b.y, width: b.width, height: MIN_VISIBLE.height }, area);
    return o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height / 2;
  });
}

/**
 * Bounds for the Overlay layout window. Where the player left it while that screen is there; else on a screen the game
 * is not on (so the window doesn't cover it), when there is one, else on the main screen. `game` is the game
 * window's place on screen, when it is known.
 */
export function initialLayoutBounds(saved: unknown, workAreas: Rectangle[], primary: Rectangle, game: Rectangle | null): WindowState {
  if (reusable(saved, workAreas)) return initialBounds(saved, workAreas, primary);
  const away = game ? workAreas.find((area) => !holds(area, center(game))) : undefined;
  return initialBounds(null, [], away ?? primary);
}

/**
 * Bounds for the window at startup. Saved bounds are reused while enough of
 * the window's top edge is on a connected display; otherwise (a monitor was
 * unplugged) the window is centred on the primary display.
 */
export function initialBounds(saved: unknown, workAreas: Rectangle[], primary: Rectangle): WindowState {
  const state = saved as Partial<WindowState> | null | undefined;
  const b = state?.bounds;
  const valid =
    b !== undefined &&
    [b.x, b.y, b.width, b.height].every((n) => Number.isInteger(n)) &&
    b.width >= MIN_SIZE.width &&
    b.height >= MIN_SIZE.height;
  if (valid) {
    const titleBar = { x: b.x, y: b.y, width: b.width, height: MIN_VISIBLE.height };
    const visible = workAreas.some((area) => {
      const o = overlap(titleBar, area);
      return o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height / 2;
    });
    if (visible) return { bounds: { ...b }, maximized: state?.maximized === true };
  }
  const width = Math.min(DEFAULT_SIZE.width, primary.width);
  const height = Math.min(DEFAULT_SIZE.height, primary.height);
  return {
    bounds: {
      x: primary.x + Math.round((primary.width - width) / 2),
      y: primary.y + Math.round((primary.height - height) / 2),
      width,
      height,
    },
    maximized: state?.maximized === true,
  };
}
