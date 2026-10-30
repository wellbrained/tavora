// What the page shows of the board that is open: one plain object the board session replaces whenever any of it
// changes. Free of Excalidraw, so the page can read it without loading it.

import type { BoardData } from "./boards";
import type { LockSpot } from "./locks";

export interface View {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

/** The pictures on the board: how many, and whether they are all locked. */
export interface Pictures {
  count: number;
  allLocked: boolean;
}

export interface BoardState {
  save: SaveState;
  /** There are changes that are not stored yet, so a change made in another panel is not taken over them. */
  dirty: boolean;
  /** The size of the board as it would be stored, for the warning. */
  bytes: number;
  /** Another panel deleted the board; it is not saved until it is brought back. */
  deleted: boolean;
  /** Excalidraw has loaded and the board can be asked to do things. */
  ready: boolean;
  /** Whether the board has anything on it (Copy as picture needs something). */
  empty: boolean;
  grid: boolean;
  pictures: Pictures;
  /** How many of the board's stored pictures have been read back (for the page and its tests). */
  picturesLoaded: number;
  /** Where the picture locks go. */
  spots: LockSpot[];
  /** Where the board was last scrolled to, once it has been. */
  view: View | null;
}

export function initialBoardState(data: BoardData): BoardState {
  return {
    save: "idle",
    dirty: false,
    bytes: JSON.stringify(data).length,
    deleted: false,
    ready: false,
    empty: true,
    grid: data.grid,
    pictures: { count: 0, allLocked: false },
    picturesLoaded: 0,
    spots: [],
    view: null,
  };
}
