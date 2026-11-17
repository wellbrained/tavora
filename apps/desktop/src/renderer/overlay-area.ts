// Which module panels step aside for what floats over the workspace (host.ts). Panels are native views above the host
// page, so a menu, hint or dialog under one would be cut off: the panels it covers are hidden behind still pictures of
// themselves while it is open. A menu or hint only needs the panels it lies over, the rest stay live; a dialog's backdrop
// covers them all, until it has faded out.
import type { Layer } from "@tavora/official-ui/lib/layers";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room around a popup for its shadow, and for it growing a little while it zooms in. */
export const POPUP_MARGIN = 16;

/** What floats over panels like a menu: the kit's menus, popovers, selects and hints. */
export const POPUPS = [
  '[data-slot$="-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
  '[data-slot="context-menu-sub-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="select-content"]',
  ".tavora-tooltip",
].join(", ");

/** The panels a popup lies over, its shadow included: only these step aside. */
export function panelsUnder(popup: Box, panels: readonly (Box & { instanceId: string })[], margin = POPUP_MARGIN): string[] {
  const left = popup.x - margin;
  const top = popup.y - margin;
  const right = popup.x + popup.width + margin;
  const bottom = popup.y + popup.height + margin;
  return panels.filter((panel) => panel.x < right && panel.x + panel.width > left && panel.y < bottom && panel.y + panel.height > top).map((panel) => panel.instanceId);
}

/**
 * Whether a popup is where it will be shown: drawn (not `visibility: hidden` while it measures itself) and on screen
 * (a menu waits above the window until it is placed). One that is not yet is looked at again next frame.
 */
export function isPlaced(box: Box, hidden: boolean, viewport: { width: number; height: number }): boolean {
  return !hidden && box.width > 0 && box.height > 0 && box.x + box.width > 0 && box.y + box.height > 0 && box.x < viewport.width && box.y < viewport.height;
}

/**
 * How long a dialog that is closing still keeps the panels out of the way: its backdrop fades out meanwhile, and a panel
 * back in sight would show at full brightness beside it. A dialog kept on the page while closed lets go after this.
 */
export const CLOSING_HOLD_MS = 400;

/**
 * How many dialogs keep the panels out of the way now: those open, and those closing for less than CLOSING_HOLD_MS.
 * `since` remembers when each started closing between calls. `recheckIn`: when the count can drop without the layers
 * changing (null: it can't).
 */
export function dialogsHolding(list: readonly Layer[], since: Map<number, number>, now: number): { count: number; recheckIn: number | null } {
  const closing = new Set<number>();
  let count = 0;
  let recheckIn: number | null = null;
  for (const layer of list) {
    if (layer.kind !== "dialog") continue;
    if (layer.state === "open") {
      count++;
      continue;
    }
    closing.add(layer.id);
    const started = since.get(layer.id) ?? now;
    since.set(layer.id, started);
    const left = started + CLOSING_HOLD_MS - now;
    if (left <= 0) continue;
    count++;
    recheckIn = recheckIn === null ? left : Math.min(recheckIn, left);
  }
  // A dialog that opens again, or has gone, starts over the next time it closes.
  for (const id of since.keys()) if (!closing.has(id)) since.delete(id);
  return { count, recheckIn };
}
