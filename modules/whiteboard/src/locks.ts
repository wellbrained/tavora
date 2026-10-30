// A small lock on the corner of every picture, to lock or unlock just that one (PictureLocks.vue). Excalidraw cannot
// put buttons on its elements, so the locks lie over the board and follow the pictures as they move and as the board
// is panned and zoomed. A locked picture cannot be clicked in Excalidraw at all, so its lock is the way to free it again.

export interface LockSpot {
  id: string;
  locked: boolean;
  selected?: boolean;
  /** Where the lock goes, in pixels from the board's top left. */
  x: number;
  y: number;
}

interface Picture {
  id: string;
  type: string;
  isDeleted?: boolean;
  locked: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

/** How far in from the picture's top-right corner the lock sits, in pixels on screen. */
const INSET = 14;
/** Pictures smaller than this on screen get no lock, so it does not cover them. */
const MIN_SIDE = 48;

/** Where the lock of every picture on screen goes: inside its top-right corner, turned with the picture. */
export function lockSpots(elements: readonly Picture[], view: Viewport): LockSpot[] {
  const spots: LockSpot[] = [];
  for (const element of elements) {
    if (element.type !== "image" || element.isDeleted) continue;
    const width = Math.abs(element.width) * view.zoom;
    const height = Math.abs(element.height) * view.zoom;
    if (width < MIN_SIDE || height < MIN_SIDE) continue;
    const centerX = (element.x + element.width / 2 + view.scrollX) * view.zoom;
    const centerY = (element.y + element.height / 2 + view.scrollY) * view.zoom;
    // The corner, moved in a little, from the centre, then turned as the picture is.
    const dx = width / 2 - INSET;
    const dy = -height / 2 + INSET;
    const cos = Math.cos(element.angle);
    const sin = Math.sin(element.angle);
    const x = Math.round(centerX + dx * cos - dy * sin);
    const y = Math.round(centerY + dx * sin + dy * cos);
    if (x < 0 || y < 0 || x > view.width || y > view.height) continue;
    spots.push({ id: element.id, locked: element.locked, x, y });
  }
  return spots;
}

/** A stable description of the spots, so the page only redraws the locks when one moved or changed. */
export function spotsKey(spots: readonly LockSpot[]): string {
  return spots.map((spot) => `${spot.id}:${spot.locked ? 1 : 0}:${spot.x}:${spot.y}:${spot.selected ? 1 : 0}`).join("|");
}

/** How long a lock that is covered waits before it is looked at again. */
const RETRY_MS = 400;

export interface LockWatcherOptions {
  /** Whether the drawing itself, not one of Excalidraw's menus, shows at this point of the page. */
  drawingAt(x: number, y: number): boolean;
  onSpots(spots: LockSpot[]): void;
  /** Where the board starts on the page. */
  origin(): { left: number; top: number };
  frame?: { request(run: () => void): number; cancel(id: number): void };
}

/**
 * Keeps the list of locks the page shows: only those that are really on the drawing and not under Excalidraw's menus
 * (the palette, the toolbar, …). What covers a lock comes and goes with the tool, the selection and the panel's size, so
 * the page is only asked what is where when one of those or a lock itself changed, not on every stroke.
 */
export function createLockWatcher(options: LockWatcherOptions) {
  const frame = options.frame ?? { request: (run: () => void) => requestAnimationFrame(run), cancel: (id: number) => cancelAnimationFrame(id) };
  let spots: LockSpot[] = [];
  let layout = "";
  let shown = "";
  let nextFrame = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function show(again = false) {
    const origin = options.origin();
    const visible = spots.filter((spot) => options.drawingAt(origin.left + spot.x, origin.top + spot.y));
    // Something may cover a lock only for a moment (Excalidraw redrawing its menus); a lock that is covered is looked
    // at again after the next change and a little later, so it is not missed.
    const covered = visible.length < spots.length;
    if (covered) layout = "";
    if (covered && again) {
      clearTimeout(retry);
      retry = setTimeout(() => show(), RETRY_MS);
    }
    const key = spotsKey(visible);
    if (key === shown) return;
    shown = key;
    options.onSpots(visible);
  }

  return {
    /** The board changed: its locks, and `surroundings` (whatever else decides what covers them). */
    update(next: LockSpot[], surroundings: string): void {
      spots = next;
      const now = `${spotsKey(next)}#${surroundings}`;
      if (now === layout) return;
      layout = now;
      show(true);
      // The menus have drawn themselves by the next frame; look once more then.
      frame.cancel(nextFrame);
      nextFrame = frame.request(() => show());
    },
    /** Looks again, after the palette moved, say. */
    recheck: () => show(true),
    dispose(): void {
      frame.cancel(nextFrame);
      clearTimeout(retry);
    },
  };
}
