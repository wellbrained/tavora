// A double-click on the line between two panels gives the panel that scrolls the room it needs, so its scrollbars go.
// Only grows: the panel above (or left of) the line first, else the one below (or right). The room comes from the
// panels on the other side, nearest first, and stops at their smallest size: the line is moved as a drag would move it.
// It never makes the other side start to scroll: once the line moved, it goes back by however much a part there that
// fitted before scrolls now (all the way when that can't be told, or when it scrolls the other way, as text that wraps).

/** "y" moves a line between panels stacked above each other, "x" one between panels side by side. */
export type Axis = "x" | "y";

/** How a double-click on a line goes: `moving` while the dock moves it itself (no drag), `settling` while it checks. */
export type FitPhase = "idle" | "moving" | "settling";

export interface SashSides {
  axis: Axis;
  /** The dock's areas (a group, or a row or column of them) before and after the line, nearest first. */
  before: HTMLElement[];
  after: HTMLElement[];
}

/**
 * How far to move the line, in px, from what the panels on each side need along the line's axis: the most any panel
 * next to the line scrolls. Positive grows the side before the line, negative the side after it; 0 leaves it.
 */
export function fitDelta(before: number, after: number): number {
  if (before > 0) return before;
  if (after > 0) return -after;
  return 0;
}

/** What the giving side scrolls now that did not before: along the line's axis and across it; null when unknown. */
export interface Squeeze {
  along: number;
  across: number;
}

/**
 * How far to move the line back when it is `moved` px away from where it started and the giving side scrolls as
 * `squeeze` says: just enough along the axis; all the way when that side now scrolls across (the room it lost can't be
 * read from that), when it is unknown, or when `last` says this is the final check.
 */
export function backOff(moved: number, squeeze: Squeeze | null, last = false): number {
  if (moved === 0 || (squeeze && squeeze.along <= 0 && squeeze.across <= 0)) return 0;
  if (!squeeze || squeeze.across > 0 || last) return -moved;
  return -Math.sign(moved) * Math.min(squeeze.along, Math.abs(moved));
}

/** The areas a dockview line sits between, read from the page: the visible ones on each side, nearest first. */
export function sashSides(sash: HTMLElement): SashSides | null {
  const container = sash.parentElement?.parentElement;
  if (!container?.classList.contains("dv-split-view-container")) return null;
  const axis: Axis = container.classList.contains("dv-vertical") ? "y" : "x";
  const views = Array.from(container.querySelector(":scope > .dv-view-container")?.children ?? []).filter(
    (view): view is HTMLElement => view instanceof HTMLElement && view.classList.contains("dv-view"),
  );
  const line = sash.getBoundingClientRect();
  const middle = axis === "y" ? line.top + line.height / 2 : line.left + line.width / 2;
  const before: { view: HTMLElement; at: number }[] = [];
  const after: { view: HTMLElement; at: number }[] = [];
  for (const view of views) {
    const rect = view.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const [start, end] = axis === "y" ? [rect.top, rect.bottom] : [rect.left, rect.right];
    if ((start + end) / 2 < middle) before.push({ view, at: middle - end });
    else after.push({ view, at: start - middle });
  }
  const nearest = (items: { view: HTMLElement; at: number }[]) => items.sort((a, b) => a.at - b.at).map((item) => item.view);
  return before.length && after.length ? { axis, before: nearest(before), after: nearest(after) } : null;
}

/** Moves a dockview line by `delta` px along `axis`, as a drag of it would. */
export function moveSash(sash: HTMLElement, axis: Axis, delta: number): void {
  const rect = sash.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const at = (dx: number, dy: number): PointerEventInit => ({ clientX: x + dx, clientY: y + dy, bubbles: true, button: 0, isPrimary: true, pointerId: 1 });
  const end = axis === "x" ? at(delta, 0) : at(0, delta);
  const doc = sash.ownerDocument;
  sash.dispatchEvent(new PointerEvent("pointerdown", at(0, 0)));
  doc.dispatchEvent(new PointerEvent("pointermove", end));
  doc.dispatchEvent(new PointerEvent("pointerup", end));
}
