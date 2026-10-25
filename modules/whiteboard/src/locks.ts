// A small lock on the corner of every picture, to lock or unlock just that one (PictureLocks.vue). Excalidraw cannot
// put buttons on its elements, so the locks lie over the board and follow the pictures as they move and as the board
// is panned and zoomed. A locked picture cannot be clicked in Excalidraw at all, so its lock is the way to free it again.

export interface LockSpot {
  id: string;
  locked: boolean;
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
  return spots.map((spot) => `${spot.id}:${spot.locked ? 1 : 0}:${spot.x}:${spot.y}`).join("|");
}
