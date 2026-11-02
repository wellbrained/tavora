// One highlight that slides behind (or under) whichever item is active, instead of every item drawing its own.
//
// The controller measures the active item (offsetLeft/Width and offsetTop/Height, so it needs the container to be
// the item's offsetParent: `position: relative`) and writes it to the container as CSS variables:
//   --indicator-x, --indicator-y, --indicator-w, --indicator-h   (px)
// plus `data-indicator-axis` ("x" or "y") and `data-indicator`:
//   "off"   no active item, or nothing to measure (hidden, disabled): the highlight is not shown
//   "still" shown and placed without moving (first paint, a resize, a font arriving, a key press)
//   "slide" shown and moving to its new place
// The look is `.tavora-indicator` in motion.css; this file only measures.
//
// It measures again when the container or an item changes size (ResizeObserver), when fonts finish loading
// (document.fonts), and when items come, go or change their active/disabled state (MutationObserver). Only a
// change of the active item slides; a resize, a font or a new list of options just puts the highlight in place.

export type IndicatorAxis = "x" | "y";
export type IndicatorState = "off" | "still" | "slide";

/** What an item has to offer. Every HTMLElement does. */
export interface IndicatorBox {
  offsetLeft: number;
  offsetTop: number;
  offsetWidth: number;
  offsetHeight: number;
}

/** What the container has to offer. Every HTMLElement does. */
export interface IndicatorContainer {
  querySelector(selector: string): IndicatorBox | null;
  readonly children: ArrayLike<unknown>;
  readonly style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
}

/** The browser parts, so a test can stand in for them. Anything missing is simply not used. */
export interface IndicatorEnv {
  ResizeObserver?: new (callback: () => void) => { observe(target: unknown): void; unobserve(target: unknown): void; disconnect(): void };
  MutationObserver?: new (callback: () => void) => { observe(target: unknown, options: Record<string, unknown>): void; disconnect(): void };
  fonts?: {
    ready: Promise<unknown>;
    addEventListener?(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
  };
}

export interface SlidingIndicatorOptions {
  /** Finds the active item inside the container, e.g. `:scope > [data-state="checked"]`. */
  selector: string;
  /** The way the highlight moves (default "x"). */
  axis?: IndicatorAxis;
  /** Asked when the active item changes: false makes that change a jump. */
  smooth?: () => boolean;
  env?: IndicatorEnv;
}

export interface SlidingIndicator {
  /** Measures now. `slide` lets a change of the active item move the highlight (default false). */
  update(slide?: boolean): void;
  destroy(): void;
}

/** The attributes whose change can move or hide the highlight (reka-ui sets these on its items). */
const WATCHED_ATTRIBUTES = ["data-state", "data-disabled", "aria-checked", "aria-selected", "disabled"];

function browserEnv(): IndicatorEnv {
  const g = globalThis as unknown as IndicatorEnv & { document?: { fonts?: IndicatorEnv["fonts"] } };
  return { ResizeObserver: g.ResizeObserver, MutationObserver: g.MutationObserver, fonts: g.document?.fonts };
}

export function createSlidingIndicator(container: IndicatorContainer, options: SlidingIndicatorOptions): SlidingIndicator {
  const axis = options.axis ?? "x";
  const env = options.env ?? browserEnv();
  let shown = false;
  let lastItem: IndicatorBox | null = null;
  let lastPlace = "";
  let destroyed = false;
  const watched = new Set<unknown>();

  container.setAttribute("data-indicator-axis", axis);

  function set(state: IndicatorState) {
    container.setAttribute("data-indicator", state);
  }

  function update(slide = false) {
    if (destroyed) return;
    const item = container.querySelector(options.selector);
    // A hidden container (display: none) measures as 0 x 0: there is nothing to put the highlight on yet. The
    // ResizeObserver tells us when it shows.
    if (!item || (item.offsetWidth === 0 && item.offsetHeight === 0)) {
      shown = false;
      lastItem = null;
      set("off");
      watchItems();
      return;
    }
    const place = `${item.offsetLeft} ${item.offsetTop} ${item.offsetWidth} ${item.offsetHeight}`;
    // Nothing moved (the observers also report changes that don't matter): leave a slide that is running alone.
    if (shown && item === lastItem && place === lastPlace) {
      watchItems();
      return;
    }
    const moving = slide && shown && item !== lastItem && (options.smooth?.() ?? true);
    container.style.setProperty("--indicator-x", `${item.offsetLeft}px`);
    container.style.setProperty("--indicator-y", `${item.offsetTop}px`);
    container.style.setProperty("--indicator-w", `${item.offsetWidth}px`);
    container.style.setProperty("--indicator-h", `${item.offsetHeight}px`);
    set(moving ? "slide" : "still");
    shown = true;
    lastItem = item;
    lastPlace = place;
    watchItems();
  }

  // ── Watching

  const resize = env.ResizeObserver ? new env.ResizeObserver(() => update(false)) : undefined;
  const mutations = env.MutationObserver ? new env.MutationObserver(() => update(true)) : undefined;

  // The container and every direct child: an item growing (a font arriving, a label changing) moves the ones after it.
  function watchItems() {
    if (!resize) return;
    const now = new Set<unknown>([container, ...Array.from(container.children)]);
    for (const target of watched) {
      if (!now.has(target)) {
        resize.unobserve(target);
        watched.delete(target);
      }
    }
    for (const target of now) {
      if (!watched.has(target)) {
        resize.observe(target);
        watched.add(target);
      }
    }
  }

  mutations?.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES });

  const onFonts = () => update(false);
  env.fonts?.ready.then(onFonts, () => {});
  env.fonts?.addEventListener?.("loadingdone", onFonts);

  update(false);

  return {
    update,
    destroy() {
      destroyed = true;
      resize?.disconnect();
      mutations?.disconnect();
      watched.clear();
      env.fonts?.removeEventListener?.("loadingdone", onFonts);
    },
  };
}
