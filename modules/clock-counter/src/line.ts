// What an overlay shows for a state at a moment: the line as runs of words and values (each drawn in its own style), the last
// lap under it, and whether a countdown that ended flashes. Pure, so the overlay page, its preview in the settings and the tests
// all get the same line.
import { counterShown, readClock, type OverlayState } from "./items";
import { COUNT, legacyText, segments, TIME, type Segment } from "./template";
import { formatSeconds } from "./time";

export type Line = {
  segments: Segment[];
  /** The last lap's time, or empty. */
  lap: string;
  /** A countdown that reached 0 without a text of its own: the value flashes. */
  flashing: boolean;
};

/** A text with its placeholder filled in; a text that can't be used, and an empty one, show the value alone. */
function fill(stored: string, name: string, value: string): Segment[] {
  return segments(stored, new Map([[name, value]])) ?? [{ text: value, value: true }];
}

export function lineOf(state: OverlayState, now: number): Line {
  if (state.kind === "group") return { segments: state.segments ?? [{ text: state.line, value: true }], lap: "", flashing: false };
  if (state.kind === "counter") {
    const text = state.text ?? legacyText(state.label, state.look.showLabel, COUNT);
    return { segments: fill(text, COUNT, counterShown(state.value, state.goal)), lap: "", flashing: false };
  }
  const reading = readClock({ id: "", label: "", look: state.look, ...state.clock, laps: false, showLastLap: false, lapTimes: [] }, now);
  const value = reading.done && state.clock.doneText ? state.clock.doneText : formatSeconds(reading.seconds, state.clock.format);
  const text = state.text ?? legacyText(state.label, state.look.showLabel, TIME);
  return {
    segments: fill(text, TIME, value),
    lap: state.lastLap === null ? "" : formatSeconds(Math.floor(state.lastLap / 1000), state.clock.format),
    flashing: reading.done && !state.clock.doneText,
  };
}

/** The runs joined: what a reader of the screen reads. */
export const lineText = (line: Line): string => line.segments.map((part) => part.text).join("");
