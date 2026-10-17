// A small lock on the corner of every picture, to lock or unlock just that one. Excalidraw cannot put buttons on its
// elements, so the locks lie over the board and follow the pictures as they move and as the board is panned and zoomed.
// A locked picture cannot be clicked in Excalidraw at all, so its lock is the way to free it again.

import { t } from "./i18n";

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

interface Props {
  spots: readonly LockSpot[];
  onToggle(id: string, locked: boolean): void;
}

export default function PictureLocks({ spots, onToggle }: Props) {
  if (spots.length === 0) return null;
  return (
    <div className="picture-locks">
      {spots.map((spot) => {
        const label = t(spot.locked ? "image.unlockOne" : "image.lockOne");
        return (
          <button
            key={spot.id}
            type="button"
            className="picture-lock-one"
            style={{ left: spot.x, top: spot.y }}
            data-locked={spot.locked}
            data-testid="picture-lock-one"
            aria-label={label}
            title={label}
            // Excalidraw must not take this press as the start of a drag on the board.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onToggle(spot.id, !spot.locked)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d={spot.locked ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V7a4 4 0 0 1 7.5-2"} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
