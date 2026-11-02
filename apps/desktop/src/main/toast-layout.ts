import { toastBounds, TOAST_ROOM_MAX, type HostToastPosition, type Place, type Size } from "../shared/host-toasts";

// How big the toast page is, and when. It is only as big as the toasts' box, so a press anywhere else reaches the panels
// under it. It grows at once (the toasts must never be cut off as they open), and shrinks only after a moment, so a toast
// that is fading out is still whole while it goes.

/** How long the page keeps its size after the toasts got smaller: a little longer than a toast takes to leave. */
export const SHRINK_AFTER_MS = 400;
/** The size the page has until the toasts have measured themselves; it is see-through. */
const FIRST_SIZE: Size = { width: TOAST_ROOM_MAX, height: 160 };

/** What ToastLayout moves: the page's view. */
export interface ToastSurface {
  setBounds(place: Place): void;
  setVisible(visible: boolean): void;
  /** Puts the view above everything else in the window. */
  raise(): void;
}

export interface ToastLayoutOptions {
  /** The window's content area, now. */
  area(): Size;
  timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
}

export class ToastLayout {
  private position: HostToastPosition = "bottom-center";
  private count = 0;
  /** What the toasts said they take; null until they have measured themselves. */
  private wanted: Size | null = null;
  /** The size the page has now. */
  private shown: Size | null = null;
  private settling: unknown;
  private readonly timers: NonNullable<ToastLayoutOptions["timers"]>;

  constructor(
    private readonly surface: ToastSurface,
    private readonly options: ToastLayoutOptions,
  ) {
    this.timers = options.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  }

  get visible(): boolean {
    return this.shown !== null;
  }

  /** The size the page has now; null while it is hidden. */
  get size(): Size | null {
    return this.shown;
  }

  setPosition(position: HostToastPosition): void {
    if (position === this.position) return;
    this.position = position;
    this.place();
  }

  /** The toast list changed. The first toast shows the page at once; the last one takes it away after the fade-out. */
  setCount(count: number): void {
    const before = this.count;
    this.count = count;
    if (count > 0 && before === 0) this.wanted = null;
    if (count > 0 && this.shown === null) {
      this.shown = FIRST_SIZE;
      this.place();
      this.surface.raise();
    }
    if (count === 0) this.settleSoon();
  }

  /** The toasts say how much room they take (nothing: they are gone). */
  setExtent(extent: Size): void {
    this.wanted = extent.width > 0 && extent.height > 0 ? extent : null;
    if (this.shown === null) return;
    const wanted = this.wanted;
    if (wanted && (wanted.width > this.shown.width || wanted.height > this.shown.height)) {
      this.shown = { width: Math.max(wanted.width, this.shown.width), height: Math.max(wanted.height, this.shown.height) };
      this.place();
    }
    this.settleSoon();
  }

  /** The window changed size. */
  windowResized(): void {
    this.place();
  }

  private settleSoon(): void {
    if (this.settling !== undefined) this.timers.clear(this.settling);
    this.settling = this.timers.set(() => {
      this.settling = undefined;
      this.settle();
    }, SHRINK_AFTER_MS);
  }

  /** The toasts' own size, or nothing when they are gone. */
  private settle(): void {
    if (this.count === 0) {
      this.shown = null;
      this.wanted = null;
      this.surface.setVisible(false);
      return;
    }
    if (this.wanted) {
      this.shown = this.wanted;
      this.place();
    }
  }

  private place(): void {
    if (!this.shown) return;
    const place = toastBounds(this.position, this.shown, this.options.area());
    if (place) this.surface.setBounds(place);
    this.surface.setVisible(place !== null);
  }

  dispose(): void {
    if (this.settling !== undefined) this.timers.clear(this.settling);
    this.settling = undefined;
  }
}

/**
 * Whatever is added to the window after `view` goes above it; this puts `view` back on top right away. Panels, the cover
 * of a workspace that opens and the Overlay page's layers are added whenever they like, and none of them knows about toasts.
 */
export function keepOnTop<V>(contentView: { addChildView(view: V, index?: number): void }, view: V): { raise(): void; stop(): void } {
  const add = contentView.addChildView.bind(contentView);
  let on = true;
  const raise = () => add(view);
  contentView.addChildView = (other: V, index?: number) => {
    add(other, index);
    if (on && other !== view) raise();
  };
  return {
    raise,
    stop: () => {
      on = false;
    },
  };
}
