// The live view: what the panel hands to Tavora (panel.setLive) so the overlay page can show every clock and counter,
// read-only, over the game while the panel's game layer is closed. Pure functions, so the rules are easy to test.
// A running clock keeps its start time, so the page counts it itself and the panel only sends when the list changes.
import { overlayState, readClock, visualOrder, type ItemList, type OverlayState } from "./items";
import { lineOf } from "./line";
import { wordsOf } from "./template";

/** Rows the live view shows; Tavora accepts at most 16 KB, and this many stay far below it. */
export const LIVE_MAX_ROWS = 20;

/** One clock or counter as the live view draws it. */
export type LiveRow = Extract<OverlayState, { kind: "clock" | "counter" }>;

export type LiveState = {
  kind: "live";
  rows: LiveRow[];
  /** Items that did not fit into the rows. */
  more: number;
  /** "+{count} more" in the panel's language, for the page to fill in. */
  moreText: string;
};

/** The state for the live view, or null when there is nothing to show. */
export function buildLiveState(list: ItemList, moreText: string): LiveState | null {
  if (!list.items.length) return null;
  const order = visualOrder(list);
  const rows = order.slice(0, LIVE_MAX_ROWS).map((item) => overlayState(item) as LiveRow);
  return { kind: "live", rows, more: order.length - rows.length, moreText };
}

/** Whether this is a live state (the page also gets the state of one item for OBS). */
export function isLive(state: unknown): state is LiveState {
  return typeof state === "object" && state !== null && (state as { kind?: unknown }).kind === "live" && Array.isArray((state as { rows?: unknown }).rows);
}

/**
 * What a row shows at `now`: the value of a clock or counter (the number), and its words (what the text says around the value, which
 * the row puts before it), as the text of the item has them.
 */
export function rowText(row: LiveRow, now: number): { name: string; text: string; flashing: boolean; running: boolean } {
  const shown = lineOf(row, now);
  const reading = row.kind === "counter" ? null : readClock({ id: "", label: "", look: row.look, ...row.clock, laps: false, showLastLap: false, lapTimes: [] }, now);
  return {
    name: wordsOf(shown.segments),
    text: shown.segments.filter((part) => part.value).map((part) => part.text).join(" "),
    flashing: shown.flashing,
    running: !!reading?.running,
  };
}
