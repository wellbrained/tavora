// Popups over panels: the one state of what floats over the module panels and how each panel steps aside for it.
// Panels are native views drawn above the host page, so a host menu, hint, dialog or drag would be cut off under one.
// While one is open, the panels under it are hidden behind still pictures of themselves; once it closes, each comes
// back and its picture stays under it until it has drawn and turned solid. Both sides step this same function: the host
// UI (renderer host.ts) with the requests it sends, the main process (panel-views.ts) with what it did for them. They
// are two copies of the overlay, not one shared value, and follow each other loosely: the renderer opens on
// `overlayOpen` and closes one tick later, main opens on the first request it hears, and the two `session` counters are
// unrelated. Only the renderer's overlay status (`data-status`) and main's panel steps are read; the rest is each side's own.
// A panel's last picture from another tab (`standIns` in panel-views.ts) is not part of this state.

/**
 * What floats over the workspace. `partial`: only menus or hints, so only the panels they lie over step aside (none yet:
 * a menu is open but lies over no panel); `all`: a dialog, a drag or the window being resized, every panel steps aside.
 */
export type Overlay = { status: "closed" } | { status: "partial"; panels: ReadonlySet<string> } | { status: "all" };

/**
 * How one panel stands toward the overlay; a panel not in the list is `live` (in its slot, drawn, nothing under it).
 * - `picturing`: its picture is being taken; it stays in sight until that picture is on screen. `picture`: the newest
 *   one it has (taken now, or one still lying under it from an overlay that closed before).
 * - `out`: hidden behind its picture (`null`: none could stand in for it, under a dialog or drag).
 * - `settling`: back in sight after an overlay, its picture under it until it has drawn and turned solid.
 */
export type PanelStep<P> =
  | { step: "live" }
  | { step: "picturing"; picture: P | null }
  | { step: "out"; picture: P | null }
  | { step: "settling"; picture: P };

export interface PopupsOverPanels<P> {
  /** Counts overlays opened and closed, so the work of one that ended never touches the next. */
  session: number;
  overlay: Overlay;
  /** Every panel that is not `live`. */
  panels: ReadonlyMap<string, PanelStep<P>>;
}

export type PopupsEvent<P> =
  /** An overlay opens: a menu or hint, no panel asked yet. Nothing changes while one is open. */
  | { type: "open" }
  /** These panels step aside (a menu or hint lies over them), added to those asked before; without `only`, every panel. Opens the overlay if it is closed. */
  | { type: "ask"; only?: readonly string[] }
  /** The overlay closed: every panel comes back; one with a picture settles on it. */
  | { type: "close" }
  /** The pictures of these panels are being taken; those out already are left alone. */
  | { type: "picturing"; ids: readonly string[] }
  /** A panel's picture is taken (still `picturing` until it is on screen). */
  | { type: "pictured"; id: string; picture: P }
  /** The panel is hidden behind its picture (or with none). */
  | { type: "out"; id: string }
  /** Its picture came to nothing under a menu: it stays in sight, since its slot would show empty. */
  | { type: "stay"; id: string }
  /** The panel has drawn and turned solid since it showed: `picture` may go, if it is still the one under it. */
  | { type: "settled"; id: string; picture: P }
  /** The panel closed, restarted or went away: nothing of it is kept. */
  | { type: "gone"; id: string };

export const NO_POPUPS: PopupsOverPanels<never> = { session: 0, overlay: { status: "closed" }, panels: new Map() };

export function noPopups<P>(): PopupsOverPanels<P> {
  return NO_POPUPS;
}

/** One step. Returns the same state when nothing changes, so callers can tell. */
export function popupsStep<P>(state: PopupsOverPanels<P>, event: PopupsEvent<P>): PopupsOverPanels<P> {
  switch (event.type) {
    case "open":
      return state.overlay.status === "closed" ? { ...state, session: state.session + 1, overlay: { status: "partial", panels: new Set() } } : state;
    case "ask": {
      const opened = state.overlay.status === "closed" ? popupsStep(state, { type: "open" }) : state;
      const overlay = askStep(opened.overlay, event.only);
      return overlay === opened.overlay ? opened : { ...opened, overlay };
    }
    case "close": {
      if (state.overlay.status === "closed") return state;
      const panels = new Map<string, PanelStep<P>>();
      for (const [id, panel] of state.panels) {
        if (panel.step === "settling") panels.set(id, panel);
        else if (panel.step !== "live" && panel.picture !== null) panels.set(id, { step: "settling", picture: panel.picture });
      }
      return { session: state.session + 1, overlay: { status: "closed" }, panels };
    }
    case "picturing":
      return withPanels(state, event.ids, (panel) => {
        if (panel.step === "out" || panel.step === "picturing") return panel;
        return { step: "picturing", picture: panel.step === "settling" ? panel.picture : null };
      });
    case "pictured":
      return withPanels(state, [event.id], (panel) => (panel.step === "picturing" ? { step: "picturing", picture: event.picture } : panel));
    case "out":
      return withPanels(state, [event.id], (panel) => (panel.step === "out" ? panel : { step: "out", picture: panel.step === "live" ? null : panel.picture }));
    case "stay":
      return withPanels(state, [event.id], (panel) => {
        if (panel.step !== "picturing") return panel;
        return panel.picture === null ? { step: "live" } : { step: "settling", picture: panel.picture };
      });
    case "settled":
      return withPanels(state, [event.id], (panel) => (panel.step === "settling" && panel.picture === event.picture ? { step: "live" } : panel));
    case "gone":
      return withPanels(state, [event.id], () => ({ step: "live" }));
  }
}

function askStep(overlay: Overlay, only: readonly string[] | undefined): Overlay {
  if (overlay.status === "all") return overlay;
  if (!only) return { status: "all" };
  const panels = overlay.status === "partial" ? overlay.panels : new Set<string>();
  const fresh = only.filter((id) => !panels.has(id));
  return fresh.length ? { status: "partial", panels: new Set([...panels, ...fresh]) } : overlay;
}

function withPanels<P>(state: PopupsOverPanels<P>, ids: readonly string[], step: (panel: PanelStep<P>) => PanelStep<P>): PopupsOverPanels<P> {
  let panels: Map<string, PanelStep<P>> | null = null;
  for (const id of ids) {
    const before = (panels ?? state.panels).get(id) ?? LIVE;
    const after = step(before);
    if (after === before || (after.step === "live" && before.step === "live")) continue;
    panels ??= new Map(state.panels);
    if (after.step === "live") panels.delete(id);
    else panels.set(id, after);
  }
  return panels ? { ...state, panels } : state;
}

const LIVE: PanelStep<never> = { step: "live" };

// ── What both sides read ──

export function panelStep<P>(state: PopupsOverPanels<P>, id: string): PanelStep<P> {
  return state.panels.get(id) ?? LIVE;
}

export function isOpen(state: PopupsOverPanels<unknown>): boolean {
  return state.overlay.status !== "closed";
}

/** Whether the overlay asked this panel to step aside. */
export function isAsked(overlay: Overlay, id: string): boolean {
  return overlay.status === "all" || (overlay.status === "partial" && overlay.panels.has(id));
}

/** Out of the way of the overlay: hidden behind its picture, or (under a dialog or drag) waiting for none. */
export function isSteppedAside(state: PopupsOverPanels<unknown>, id: string): boolean {
  const panel = panelStep(state, id);
  return panel.step === "out" || (state.overlay.status === "all" && panel.step !== "picturing");
}

/** The pictures the panels lie on for the overlay: being taken, out, or settling after it. */
export function overlayPictures<P>(state: PopupsOverPanels<P>): Map<string, P> {
  const pictures = new Map<string, P>();
  for (const [id, panel] of state.panels) {
    if (panel.step === "live" || panel.picture === null) continue;
    pictures.set(id, panel.picture);
  }
  return pictures;
}

/** The panels settling on their pictures after the overlay closed. */
export function settlingAfterOverlay<P>(state: PopupsOverPanels<P>): [string, P][] {
  return [...state.panels].flatMap(([id, panel]) => (panel.step === "settling" ? [[id, panel.picture] as [string, P]] : []));
}
