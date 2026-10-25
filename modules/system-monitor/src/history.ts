// A short memory of one value for a graph: the last 5 minutes at the chosen interval, in one plain array
// that is reused. Nothing reactive and nothing saved.
import { HISTORY_MS } from "./settings";

export interface History {
  /** Adds the newest value (0 to 100); the oldest drops out once the window is full. */
  push(value: number): void;
  /** The values, oldest first. */
  values(): number[];
  /** Sets how often values come, which sets how many are kept; empties the history when that changes. */
  setInterval(intervalMs: number): void;
  clear(): void;
}

export function createHistory(intervalMs: number, windowMs = HISTORY_MS): History {
  const size = (ms: number) => Math.max(1, Math.round(windowMs / ms));
  let capacity = size(intervalMs);
  let data: number[] = [];
  return {
    push(value) {
      data.push(value);
      // Trim in batches, so a push is almost always just an append.
      if (data.length > capacity * 2) data = data.slice(-capacity);
    },
    values: () => (data.length > capacity ? data.slice(-capacity) : data.slice()),
    setInterval(next) {
      const wanted = size(next);
      if (wanted !== capacity) data = [];
      capacity = wanted;
    },
    clear() {
      data = [];
    },
  };
}
