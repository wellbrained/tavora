// Where a dragged panel is aimed: pure maths on the dock's rectangles, no DOM. The pointer decides one drop target
// (dock-model.ts says what it would do): over a tab strip a tab slot, over a group's content its edges (a new column or
// row, 30 % each) or its middle (a tab), next to the dock's edge the whole dock's edge.
import { TAB_HEIGHT } from "./dock";
import type { DropTarget, Rect, Side } from "./dock-model";

/** How much of a group's width or height, from each edge, makes a new column or row. */
export const EDGE_ZONE = 0.3;
/** How close to the dock's own edge, in px, aims at the dock's edge. */
export const OUTER_ZONE = 14;

export interface Slot {
  /** Left edge and width of a tab that stays, in the dock's coordinates, as it sits once the dragged one is gone. */
  left: number;
  width: number;
}

export interface Aim {
  /** The dock's size. */
  width: number;
  height: number;
  /** Where each visible group is now. */
  rects: Record<string, Rect>;
  /** The tabs of each group. */
  slots: Record<string, Slot[]>;
}

/** Which side of a group's content a pointer is at: the nearest edge within the edge zone, else null (the middle). */
export function zone(nx: number, ny: number): Side | null {
  const edges = (
    [
      ["left", nx],
      ["right", 1 - nx],
      ["top", ny],
      ["bottom", 1 - ny],
    ] as const
  ).filter(([, distance]) => distance < EDGE_ZONE);
  if (!edges.length) return null;
  return edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best))[0];
}

/** The target under the pointer (x, y in the dock's coordinates), or null outside the dock and its groups. */
export function aimAt(aim: Aim, x: number, y: number): DropTarget | null {
  if (x < 0 || y < 0 || x > aim.width || y > aim.height) return null;
  const near: [Side, number][] = [
    ["left", x],
    ["right", aim.width - x],
    ["top", y],
    ["bottom", aim.height - y],
  ];
  const [side, distance] = near.reduce((best, item) => (item[1] < best[1] ? item : best));
  // A tab strip that runs to the dock's left or right edge keeps its first and last slots: only the top edge is the dock's there.
  const inStrip = Object.values(aim.rects).some((rect) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y - rect.y < TAB_HEIGHT);
  if (distance < OUTER_ZONE && !(inStrip && (side === "left" || side === "right"))) return { kind: "edge", side };
  for (const [group, rect] of Object.entries(aim.rects)) {
    if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) continue;
    if (y - rect.y < TAB_HEIGHT) {
      const index = (aim.slots[group] ?? []).filter((slot) => slot.left + slot.width / 2 < x).length;
      return { kind: "tab", group, index };
    }
    const found = zone((x - rect.x) / rect.width, (y - rect.y - TAB_HEIGHT) / Math.max(1, rect.height - TAB_HEIGHT));
    return found ? { kind: "split", group, side: found } : { kind: "tab", group };
  }
  return null;
}

/** Whether two targets are the same aim, so nothing needs redoing. */
export const sameTarget = (a: DropTarget | null, b: DropTarget | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A place to aim at, and a point (in the dock's coordinates) that the pointer would aim there from. */
export interface Spot {
  target: DropTarget;
  x: number;
  y: number;
}

/**
 * Every place a drag can aim at, for the keyboard: a point for each the pointer can reach, run through `aimAt` so each is
 * exactly what the pointer would aim at there. In reading order: the dock's top and left edge, then each group (its tab
 * slots, top, left, middle, right, bottom), then the dock's right and bottom edge.
 */
export function spots(aim: Aim): Spot[] {
  const { width, height } = aim;
  const found: Spot[] = [];
  const add = (x: number, y: number) => {
    const target = aimAt(aim, x, y);
    if (target && !found.some((spot) => sameTarget(spot.target, target))) found.push({ target, x, y });
  };
  // A dock edge beside a tab strip is that strip's: try a few points along it.
  const edge = (side: Side) => {
    const near = OUTER_ZONE / 2;
    for (const along of [0.5, 0.25, 0.75]) {
      const x = side === "left" ? near : side === "right" ? width - near : width * along;
      const y = side === "top" ? near : side === "bottom" ? height - near : height * along;
      const target = aimAt(aim, x, y);
      if (target?.kind === "edge" && target.side === side) {
        add(x, y);
        return;
      }
    }
  };
  edge("top");
  edge("left");
  const groups = Object.entries(aim.rects).sort(([, a], [, b]) => a.y - b.y || a.x - b.x);
  for (const [group, rect] of groups) {
    const strip = rect.y + TAB_HEIGHT / 2;
    const middles = (aim.slots[group] ?? []).map((slot) => slot.left + slot.width / 2);
    // Slot i lies between the middles of the tabs before and after it.
    for (let index = 0; index <= middles.length; index++) {
      const before = middles[index - 1] ?? rect.x;
      const after = middles[index] ?? Math.max(before + 2, rect.x + rect.width - 2);
      add((before + after) / 2, strip);
    }
    const top = rect.y + TAB_HEIGHT;
    const content = rect.height - TAB_HEIGHT;
    const inset = EDGE_ZONE / 2;
    add(rect.x + rect.width / 2, top + content * inset);
    add(rect.x + rect.width * inset, top + content / 2);
    add(rect.x + rect.width / 2, top + content / 2);
    add(rect.x + rect.width * (1 - inset), top + content / 2);
    add(rect.x + rect.width / 2, top + content * (1 - inset));
  }
  edge("right");
  edge("bottom");
  return found;
}

/**
 * The spot an arrow key goes to from `from`: the nearest one that way, a spot straight ahead before one off to the
 * side; null when there is none.
 */
export function stepToward(all: readonly Spot[], from: Spot, side: Side): Spot | null {
  let best: Spot | null = null;
  let bestScore = Infinity;
  for (const spot of all) {
    const dx = spot.x - from.x;
    const dy = spot.y - from.y;
    const ahead = side === "left" ? -dx : side === "right" ? dx : side === "top" ? -dy : dy;
    const aside = Math.abs(side === "left" || side === "right" ? dy : dx);
    if (ahead < 1) continue;
    const score = ahead + 2 * aside;
    if (score < bestScore) {
      best = spot;
      bestScore = score;
    }
  }
  return best;
}
