import { TavoraError } from "./index.js";
import { supportsCall, type MenuRequest, type TooltipAnchor, type TooltipContent, type TooltipRequest } from "./protocol.js";

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

/**
 * The wire form of `ui.tooltip.show`. `pinnable: false` together with `pinned: true` is a mistake in every Tavora; an
 * older Tavora than `ui.tooltip.pinnable` would reject the unknown key, so it is left out there (the card still shows,
 * with the old hint). The same goes for the card's `layout`, `effect` and `skin` on a Tavora older than
 * `ui.tooltip.skin`: the card shows in the rich layout there.
 */
export function tooltipShowParams(request: TooltipShowOptions, hostVersion: string): Omit<TooltipShowOptions, "anchor" | "at"> & { at: TooltipAnchor["at"] } {
  if (request.pinnable === false && request.pinned === true) throw new TavoraError({ code: "INVALID_PARAMS", message: "A card that is not pinnable can't be pinned" });
  const params = tooltipParams(request);
  if (params.pinnable !== undefined && !supportsCall(hostVersion, "ui.tooltip.pinnable")) delete params.pinnable;
  const content = params.content as TooltipContent | undefined;
  if (content && (content.layout !== undefined || content.effect !== undefined || content.skin !== undefined) && !supportsCall(hostVersion, "ui.tooltip.skin")) {
    const { layout: _layout, effect, skin: _skin, ...older } = content;
    params.content = effect === undefined ? older : { ...older, sections: withEffectRow(older.sections, effect) };
  }
  return params;
}

/**
 * For a Tavora without the effect box: the effect as a plain row at the top of the sections, in a section of its own,
 * or as the first section's first row when there are as many sections as Tavora takes (12).
 */
function withEffectRow(sections: TooltipContent["sections"], effect: NonNullable<TooltipContent["effect"]>): NonNullable<TooltipContent["sections"]> {
  const row = { text: typeof effect === "string" ? effect : effect.map((run) => run.text).join("") };
  const list = sections ?? [];
  if (list.length < 12) return [{ rows: [row] }, ...list];
  const [first, ...rest] = list;
  return [{ ...first!, rows: [row, ...first!.rows] }, ...rest];
}

export function tooltipParams<T extends TooltipMoveOptions | TooltipShowOptions>(request: T): Omit<T, "anchor" | "at"> & { at: TooltipAnchor["at"] } {
  const { anchor, at, ...rest } = request as T & { anchor?: AnchorTarget; at?: TooltipAnchor["at"] };
  if (anchor) return { ...rest, at: point(anchor) } as never;
  return at ? ({ ...rest, at } as never) : missing();
}
