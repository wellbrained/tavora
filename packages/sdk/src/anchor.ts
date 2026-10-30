import { TavoraError } from "./index.js";
import type { MenuRequest, TooltipAnchor, TooltipRequest } from "./protocol.js";

/** What a menu or tooltip is for: an element (its box is read when you call) or a box you measured yourself. */
export type AnchorTarget = Element | { x: number; y: number; width?: number; height?: number };

/** ui.showMenu: `anchor` (an element or its box) is the way; `at` stays for the rare case without an element. One of the two. */
export type MenuOptions = Omit<MenuRequest, "at"> &
  ({ anchor: AnchorTarget; at?: undefined } | { at: MenuRequest["at"]; anchor?: undefined });

/** ui.tooltip.move: the tooltip's id, and `anchor` (an element or its box) or `at` (a point). */
export type TooltipMoveOptions = { id: string } & ({ anchor: AnchorTarget; at?: undefined } | { at: TooltipAnchor["at"]; anchor?: undefined });

/** ui.tooltip.show: a tooltip request with `anchor` instead of `at`, if you like. */
export type TooltipShowOptions = Omit<TooltipRequest, "at"> & ({ anchor: AnchorTarget; at?: undefined } | { at: TooltipAnchor["at"]; anchor?: undefined });

function box(target: AnchorTarget): { x: number; y: number; width: number; height: number } {
  const rect: { x: number; y: number; width?: number; height?: number } =
    typeof (target as Element).getBoundingClientRect === "function" ? (target as Element).getBoundingClientRect() : (target as { x: number; y: number });
  const { x, y, width = 0, height = 0 } = rect;
  if (![x, y, width, height].every(Number.isFinite)) throw new TavoraError({ code: "INVALID_PARAMS", message: "anchor has no box" });
  return { x, y, width, height };
}

function missing(): never {
  throw new TavoraError({ code: "INVALID_PARAMS", message: "Give an anchor (the element the menu is for) or at" });
}

/** The wire form: the element's box as `at` (the host adds the gap). */
export function menuParams(request: MenuOptions): MenuRequest {
  const { anchor, at, ...rest } = request;
  if (anchor) return { ...rest, at: box(anchor) };
  return at ? { ...rest, at } : missing();
}

/** The tooltip's point: next to the element, at the middle of its right edge, never on top of it. */
function point(target: AnchorTarget): TooltipAnchor["at"] {
  const b = box(target);
  return { x: b.x + b.width, y: b.y + b.height / 2 };
}

export function tooltipParams<T extends TooltipMoveOptions | TooltipShowOptions>(request: T): Omit<T, "anchor" | "at"> & { at: TooltipAnchor["at"] } {
  const { anchor, at, ...rest } = request as T & { anchor?: AnchorTarget; at?: TooltipAnchor["at"] };
  if (anchor) return { ...rest, at: point(anchor) } as never;
  return at ? ({ ...rest, at } as never) : missing();
}
