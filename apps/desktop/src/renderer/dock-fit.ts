// A double-click on the line between two panels gives the panel that scrolls the room it needs, so its scrollbars go.
// Only grows: the panel above (or left of) the line first, else the one below (or right). The room comes from the
// panels on the other side, nearest first, and stops at their smallest size: the line is moved as a drag would move it.

export interface SashSides {
  /** Which way the line moves: "y" for panels stacked above each other, "x" for panels side by side. */
  axis: "x" | "y";
  /** The dock's area just before and just after the line (a group, or a row or column of them). */
  before: HTMLElement;
  after: HTMLElement;
}

/**
 * How far to move the line, in px, from what the panels on each side need along the line's axis: the most any panel
 * in that area scrolls. Positive grows the side before the line, negative the side after it; 0 leaves it.
 */
export function fitDelta(before: number, after: number): number {
  if (before > 0) return before;
  if (after > 0) return -after;
  return 0;
}

/** The two areas a dockview line sits between, read from the page: the nearest visible one on each side. */
export function sashSides(sash: HTMLElement): SashSides | null {
  const container = sash.parentElement?.parentElement;
  if (!container?.classList.contains("dv-split-view-container")) return null;
  const axis = container.classList.contains("dv-vertical") ? "y" : "x";
  const views = Array.from(container.querySelector(":scope > .dv-view-container")?.children ?? []).filter(
    (view): view is HTMLElement => view instanceof HTMLElement && view.classList.contains("dv-view"),
  );
  const line = sash.getBoundingClientRect();
  const middle = axis === "y" ? line.top + line.height / 2 : line.left + line.width / 2;
  let before: { view: HTMLElement; end: number } | undefined;
  let after: { view: HTMLElement; start: number } | undefined;
  for (const view of views) {
    const rect = view.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const [start, end] = axis === "y" ? [rect.top, rect.bottom] : [rect.left, rect.right];
    if ((start + end) / 2 < middle) {
      if (!before || end > before.end) before = { view, end };
    } else if (!after || start < after.start) after = { view, start };
  }
  return before && after ? { axis, before: before.view, after: after.view } : null;
}

/** Moves a dockview line by `delta` px along `axis`, as a drag of it would. */
export function moveSash(sash: HTMLElement, axis: "x" | "y", delta: number): void {
  const rect = sash.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const at = (dx: number, dy: number): PointerEventInit => ({ clientX: x + dx, clientY: y + dy, bubbles: true, button: 0, isPrimary: true, pointerId: 1 });
  const doc = sash.ownerDocument;
  sash.dispatchEvent(new PointerEvent("pointerdown", at(0, 0)));
  doc.dispatchEvent(new PointerEvent("pointermove", axis === "x" ? at(delta, 0) : at(0, delta)));
  doc.dispatchEvent(new PointerEvent("pointerup", axis === "x" ? at(delta, 0) : at(0, delta)));
}
