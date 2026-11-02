// One highlight that slides behind (or under) whichever item is active, instead of every item drawing its own.
//
// The controller measures the active item with getBoundingClientRect, relative to the container's padding box
// (fractions included: Inter's widths are not whole pixels, and a whole-pixel offset would be a pixel off), and
// writes it to the container as CSS variables:
//   --indicator-x, --indicator-y, --indicator-w, --indicator-h   (px)
// The container must be `position: relative`, so the highlight's own `left`/`top` start at the same corner. The item
// may sit anywhere inside the container, not only directly in it.
// It also sets `data-indicator-axis` ("x" or "y") and `data-indicator`:
//   "off"   no active item, or nothing to measure (hidden, disabled): the highlight is not shown
//   "still" shown and placed without moving (first paint, a resize, a font arriving, a new list of options)
//   "slide" shown and moving to the newly picked item. From "off" (nothing was picked, or it was disabled) it grows out of
//           where it last was, or out of the first item, fading in: the first click is not a jump
//   "jump"  shown, and the picked item changed without moving the highlight (a key press): labels should not fade either
// The look is `.tavora-indicator` in motion.css; this file only measures.
//
// It measures again when the container or an item changes size (ResizeObserver), when fonts finish loading
// (document.fonts), and when items come, go or change their active/disabled state (MutationObserver). Only a
// change of the active item slides; a resize, a font or a new list of options just puts the highlight in place.

export type IndicatorAxis = "x" | "y";
export type IndicatorState = "off" | "still" | "slide" | "jump";

/** What an item has to offer. Every HTMLElement does. */
export interface IndicatorBox {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

/** What the container has to offer. Every HTMLElement does. */
export interface IndicatorContainer extends IndicatorBox {
  /** The border, which the highlight's `left`/`top` do not include, and how far the container is scrolled. */
  readonly clientLeft: number;
  readonly clientTop: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  querySelector(selector: string): IndicatorBox | null;
  readonly children: ArrayLike<unknown>;
  readonly style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
}

/** The browser parts, so a test can stand in for them. Anything missing is simply not used. */
export interface IndicatorEnv {
  ResizeObserver?: new (callback: () => void) => { observe(target: unknown, options?: { box?: "border-box" | "content-box" }): void; unobserve(target: unknown): void; disconnect(): void };
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

const isIndicator = (node: unknown) => !!(node as { classList?: { contains(name: string): boolean } }).classList?.contains("tavora-indicator");

function browserEnv(): IndicatorEnv {
  const g = globalThis as unknown as IndicatorEnv & { document?: { fonts?: IndicatorEnv["fonts"] } };
  return { ResizeObserver: g.ResizeObserver, MutationObserver: g.MutationObserver, fonts: g.document?.fonts };
}

export function createSlidingIndicator(container: IndicatorContainer, options: SlidingIndicatorOptions): SlidingIndicator {
  const axis = options.axis ?? "x";
  const env = options.env ?? browserEnv();
  let shown = false;
  /** Whether the variables hold a place to move from: set by the first placement, or by seeding while nothing is picked. */
  let placed = false;
  let lastItem: IndicatorBox | null = null;
  let lastPlace = "";
  let destroyed = false;
  const watched = new Set<unknown>();

  container.setAttribute("data-indicator-axis", axis);

  function set(state: IndicatorState) {
    container.setAttribute("data-indicator", state);
  }

  const round = (value: number) => Math.round(value * 100) / 100;

  // With nothing picked there is nowhere yet to slide from: rest the hidden highlight on the first item, so the first
  // pick (a click) slides and fades in instead of appearing in place.
  function seed() {
    const first = Array.from(container.children).find((child) => !isIndicator(child)) as Partial<IndicatorBox> | undefined;
    const box = first?.getBoundingClientRect?.();
    if (!box || (box.width === 0 && box.height === 0)) return;
    const origin = container.getBoundingClientRect();
    container.style.setProperty("--indicator-x", `${round(box.left - origin.left - container.clientLeft + container.scrollLeft)}px`);
    container.style.setProperty("--indicator-y", `${round(box.top - origin.top - container.clientTop + container.scrollTop)}px`);
    container.style.setProperty("--indicator-w", `${round(box.width)}px`);
    container.style.setProperty("--indicator-h", `${round(box.height)}px`);
    placed = true;
  }

  function update(slide = false) {
    if (destroyed) return;
    const item = container.querySelector(options.selector);
    const box = item?.getBoundingClientRect();
    // A hidden container (display: none) measures as 0 x 0: there is nothing to put the highlight on yet. The
    // ResizeObserver tells us when it shows.
    if (!item || !box || (box.width === 0 && box.height === 0)) {
      shown = false;
      lastItem = null;
      if (!placed) seed();
      set("off");
      watchItems();
      return;
    }
    const origin = container.getBoundingClientRect();
    const x = round(box.left - origin.left - container.clientLeft + container.scrollLeft);
    const y = round(box.top - origin.top - container.clientTop + container.scrollTop);
    const place = `${x} ${y} ${round(box.width)} ${round(box.height)}`;
    // Nothing moved (the observers also report changes that don't matter): leave a slide that is running alone.
    if (shown && item === lastItem && place === lastPlace) {
      watchItems();
      return;
    }
    const picked = slide && item !== lastItem;
    const smooth = picked ? (options.smooth?.() ?? true) : true;
    // `placed`, not `shown`: a pick made while nothing was picked slides in from where the highlight rests.
    const state: IndicatorState = picked && placed && smooth ? "slide" : picked && !smooth ? "jump" : "still";
    container.style.setProperty("--indicator-x", `${x}px`);
    container.style.setProperty("--indicator-y", `${y}px`);
    container.style.setProperty("--indicator-w", `${round(box.width)}px`);
    container.style.setProperty("--indicator-h", `${round(box.height)}px`);
    set(state);
    shown = true;
    placed = true;
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
    // Not the highlight itself: it changes size every frame of a slide.
    const now = new Set<unknown>([container, ...Array.from(container.children).filter((child) => !isIndicator(child))]);
    for (const target of watched) {
      if (!now.has(target)) {
        resize.unobserve(target);
        watched.delete(target);
      }
    }
    for (const target of now) {
      if (!watched.has(target)) {
        // The border box, so a change of padding (which moves the items without resizing them) counts too.
        resize.observe(target, { box: "border-box" });
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
