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
  if (distance < OUTER_ZONE) return { kind: "edge", side };
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
