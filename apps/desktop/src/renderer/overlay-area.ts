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

// ── Which panels a menu or hint asks to step aside, and which popups wait ──

/** After this many frames with no popup placed (one POPUPS does not know), every panel steps aside instead. */
export const POPUP_WAIT_FRAMES = 6;

/**
 * What the host UI has asked the host while an overlay is open. Request numbers keep counting across overlays, so an
 * answer to an older one is never taken for a newer one.
 */
export interface PopupWatch {
  /**
   * The panels a menu or hint asked to step aside, each with the request that asked; null before the first request.
   * Whether every panel is asked is not kept here: it is the overlay's `all` (shared/popups-over-panels.ts), passed in.
   */
  asked: ReadonlyMap<string, number> | null;
  /** The last request number used. */
  seq: number;
  /** The newest request the host has answered. */
  answered: number;
  /** The request whose answer shows everything that waits (the first one, or the one for every panel); Infinity before it is sent. */
  awaited: number;
  /** Frames measured with no popup placed yet. */
  quietFrames: number;
}

export const NO_WATCH: PopupWatch = { asked: null, seq: 0, answered: 0, awaited: Infinity, quietFrames: 0 };

/** An overlay opens: nothing asked yet; the request numbers go on. */
export function openWatch(watch: PopupWatch): PopupWatch {
  return { ...watch, asked: null, awaited: Infinity, quietFrames: 0 };
}

/** What to tell the host: a request for these panels (perhaps none: a menu is open), or for every panel. */
export interface PopupRequest {
  seq: number;
  only?: string[];
}

/** Every panel steps aside (a dialog, a drag, the window being resized, or a menu that was not found). */
export function askAllStep(watch: PopupWatch): { watch: PopupWatch; request: PopupRequest } {
  const seq = watch.seq + 1;
  return { watch: { ...watch, seq, awaited: seq }, request: { seq } };
}

export interface MeasuredPopup<P> {
  popup: P;
  box: Box;
  /** Measuring itself unseen (`visibility: hidden`). */
  hidden: boolean;
}

/**
 * One frame's look at the popups while only menus or hints are open. The first request goes once a popup is placed (or
 * every panel is asked after POPUP_WAIT_FRAMES without one); later ones ask for panels a popup reaches that were not
 * asked yet. Each placed popup either waits for the answer to the newest request that asked for a panel under it
 * (`hold`), or may show (`show`). Not called once every panel is asked (the overlay's `all`): nothing is left to measure.
 */
export function measureStep<P>(
  watch: PopupWatch,
  popups: readonly MeasuredPopup<P>[],
  panels: readonly (Box & { instanceId: string })[],
  viewport: { width: number; height: number },
): { watch: PopupWatch; request: PopupRequest | null; hold: { popup: P; seq: number }[]; show: P[] } {
  const placed = popups.filter((item) => isPlaced(item.box, item.hidden, viewport)).map((item) => ({ popup: item.popup, ids: panelsUnder(item.box, panels) }));
  if (watch.asked === null && !placed.length) {
    const quiet = { ...watch, quietFrames: watch.quietFrames + 1 };
    return quiet.quietFrames >= POPUP_WAIT_FRAMES ? { ...askAllStep(quiet), hold: [], show: [] } : { watch: quiet, request: null, hold: [], show: [] };
  }
  const asked = new Map(watch.asked ?? []);
  const fresh = [...new Set(placed.flatMap(({ ids }) => ids.filter((id) => !asked.has(id))))];
  let next: PopupWatch = { ...watch, asked };
  let request: PopupRequest | null = null;
  // The first request goes even with no panel under the popups: the host learns that a menu is open.
  if (fresh.length || watch.asked === null) {
    const seq = watch.seq + 1;
    for (const id of fresh) asked.set(id, seq);
    request = { seq, only: fresh };
    next = { ...next, seq, awaited: watch.asked === null ? seq : watch.awaited };
  }
  const hold: { popup: P; seq: number }[] = [];
  const show: P[] = [];
  for (const { popup, ids } of placed) {
    const wanted = Math.max(0, ...ids.map((id) => asked.get(id) ?? 0));
    if (wanted > watch.answered) hold.push({ popup, seq: wanted });
    else show.push(popup);
  }
  return { watch: next, request, hold, show };
}

/** The host answered request `seq`. `showAll`: what waited for the awaited request may show; an older answer shows nothing. */
export function answerStep(watch: PopupWatch, seq: number): { watch: PopupWatch; showAll: boolean } {
  return { watch: { ...watch, answered: Math.max(watch.answered, seq) }, showAll: seq >= watch.awaited };
}
