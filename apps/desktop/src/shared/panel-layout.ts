// A module's starter layout (manifest `panelLayout`) for panels.openMany: what is left of it once panels drop out, and
// where each slot lands inside an area. Shared, so the main process can trim it to the panels it opens and the host UI
// can fit it into the clicking panel's group; it must not import Electron or Node.

/** The manifest's `panelLayout` (PanelLayoutNode in @tavora/module-schema, which the host UI doesn't import), already checked. */
export type LayoutPart = { panel: string; size?: number } | { row: readonly LayoutPart[]; size?: number } | { column: readonly LayoutPart[]; size?: number };
export type LayoutSplit = Exclude<LayoutPart, { panel: string }>;

/** A slot for one panel, or a split whose parts sit side by side (`row`) or stacked (`column`), each with its share. */
export type Slots<T = string> = { panel: T } | { split: "row" | "column"; parts: { size: number; slots: Slots<T> }[] };

/** The manifest's layout in the form below; sizes left out count 1. */
export function fromManifest(layout: LayoutSplit): Slots {
  const node = (value: LayoutPart): Slots => {
    if ("panel" in value) return { panel: value.panel };
    const [split, list] = "row" in value ? (["row", value.row] as const) : (["column", value.column] as const);
    return { split, parts: list.map((part) => ({ size: part.size ?? 1, slots: node(part) })) };
  };
  return node(layout);
}

/** Each slot's panel, in the layout's order. */
export function slotPanels<T>(slots: Slots<T>): T[] {
  return "panel" in slots ? [slots.panel] : slots.parts.flatMap((part) => slotPanels(part.slots));
}

/** The layout with each panel replaced; slots `to` answers undefined for drop out (see keepSlots). */
export function mapSlots<T, U>(slots: Slots<T>, to: (panel: T) => U | undefined): Slots<U> | null {
  if ("panel" in slots) {
    const panel = to(slots.panel);
    return panel === undefined ? null : { panel };
  }
  const parts: { size: number; slots: Slots<U> | null }[] = slots.parts.map((part) => ({ size: part.size, slots: mapSlots(part.slots, to) }));
  return tidy(slots.split, parts);
}

/** The layout with only the panels `keep` says yes to. A part that leaves gives its room to the part before it (the one after, for the first). */
export function keepSlots<T>(slots: Slots<T>, keep: (panel: T) => boolean): Slots<T> | null {
  return mapSlots(slots, (panel) => (keep(panel) ? panel : undefined));
}

/**
 * A split whose emptied parts (null) left: each one's room goes to its neighbour before it, or after it for the
 * first. A split left with one part folds away into that part, and a part running the same way as its split joins it.
 */
function tidy<T>(split: "row" | "column", parts: { size: number; slots: Slots<T> | null }[]): Slots<T> | null {
  const kept: { size: number; slots: Slots<T> }[] = [];
  let owed = 0;
  for (const part of parts) {
    if (part.slots === null) {
      const before = kept.at(-1);
      if (before) before.size += part.size;
      else owed += part.size;
      continue;
    }
    kept.push({ size: part.size + owed, slots: part.slots });
    owed = 0;
  }
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]!.slots;
  // A row inside a row (left when its column folded away) is one row: its parts share the room it had.
  const flat = kept.flatMap((part) => {
    if ("panel" in part.slots || part.slots.split !== split) return [part];
    const inner = part.slots.parts;
    const total = inner.reduce((sum, item) => sum + item.size, 0);
    return inner.map((item) => ({ size: (part.size * item.size) / total, slots: item.slots }));
  });
  return { split, parts: flat };
}

/** A place in pixels. */
export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where each slot lands when the layout fills `area`. */
export function slotRects<T>(slots: Slots<T>, area: SlotRect): { panel: T; rect: SlotRect }[] {
  if ("panel" in slots) return [{ panel: slots.panel, rect: area }];
  const total = slots.parts.reduce((sum, part) => sum + part.size, 0);
  const row = slots.split === "row";
  let along = row ? area.x : area.y;
  return slots.parts.flatMap((part) => {
    const length = ((row ? area.width : area.height) * part.size) / total;
    const rect = row ? { x: along, y: area.y, width: length, height: area.height } : { x: area.x, y: along, width: area.width, height: length };
    along += length;
    return slotRects(part.slots, rect);
  });
}

/**
 * Fits the layout into an area of `width` by `height`: a new panel whose slot would be too small for it (`fits` says
 * no) leaves the layout and opens as a tab next to `anchor` instead, giving its room to its neighbour. The anchor's slot
 * holds those tabs too (`fits` gets them), so when it gets too small, the new panel laid out last leaves the same way.
 * Answers the layout that fits and the panels that become tabs, in the layout's order.
 */
export function fitSlots<T>(slots: Slots<T>, anchor: T, width: number, height: number, fits: (panel: T, width: number, height: number, tabs: readonly T[]) => boolean): { slots: Slots<T>; tabs: T[] } {
  let current: Slots<T> = slots;
  const tabs: T[] = [];
  for (;;) {
    const rects = slotRects(current, { x: 0, y: 0, width, height });
    if (rects.length <= 1) break;
    const fresh = rects.filter((item) => item.panel !== anchor);
    const anchorFits = rects.every((item) => item.panel !== anchor || fits(item.panel, item.rect.width, item.rect.height, tabs));
    const leaving = anchorFits ? fresh.find((item) => !fits(item.panel, item.rect.width, item.rect.height, tabs)) : fresh.at(-1);
    if (!leaving) break;
    tabs.push(leaving.panel);
    current = keepSlots(current, (panel) => panel !== leaving.panel) ?? { panel: anchor };
  }
  const order = slotPanels(slots);
  return { slots: current, tabs: tabs.sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
}

/**
 * The layout one panels.openMany call docks by (by instance id): the module's `layout` with only the asking panel
 * (`anchorType`, `anchorId`) and the panels it opens new (`fresh`, type to instance id). Null when the module has no
 * layout, the asking panel's type is not in it, or nothing new opens: each panel then docks where a new panel goes.
 */
export function openManySlots(layout: LayoutSplit | undefined, anchorType: string | undefined, anchorId: string, fresh: ReadonlyMap<string, string>): Slots | null {
  if (!layout || anchorType === undefined || fresh.size === 0) return null;
  const slots = fromManifest(layout);
  if (!slotPanels(slots).includes(anchorType)) return null;
  const trimmed = mapSlots(slots, (type) => (type === anchorType ? anchorId : fresh.get(type)));
  return trimmed && !("panel" in trimmed) ? trimmed : null;
}
