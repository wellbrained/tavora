import { describe, expect, it } from "vitest";
import { groupOf, groupOverlayState, insert, newItem, overlayState, setStream, startPause, type Clock, type Counter, type ItemList } from "./items";
import { lineOf, lineText } from "./line";

const NOW = 100_000;
const counterName = (counter: Counter) => counter.label;
const countdown = (patch: Partial<Clock> = {}): Clock => ({ ...(newItem("countdown", "t", "Plank timer") as Clock), duration: 90_000, ...patch });

describe("the line an overlay draws", () => {
  it("puts the value into the text and marks which runs are the value", () => {
    const timer = countdown();
    timer.look.text = "Plank {time} left";
    expect(lineOf(overlayState(timer), NOW).segments).toEqual([
      { text: "Plank ", value: false },
      { text: "1:30", value: true },
      { text: " left", value: false },
    ]);
  });

  it("shows only the value for an empty text", () => {
    const timer = countdown();
    timer.look.text = "";
    expect(lineOf(overlayState(timer), NOW).segments).toEqual([{ text: "1:30", value: true }]);
  });

  it("shows the value alone when the text can't be used", () => {
    const timer = countdown();
    timer.look.text = "{nope}";
    expect(lineOf(overlayState(timer), NOW).segments).toEqual([{ text: "1:30", value: true }]);
  });

  it("writes the time in the clock's format and counts a running clock from its start", () => {
    const timer = countdown({ format: "h:mm:ss" });
    startPause(timer, NOW - 30_000);
    expect(lineText(lineOf(overlayState(timer), NOW))).toBe("Plank timer 0:01:00");
  });

  it("shows the text at 0, flashing the value only when there is none", () => {
    const timer = countdown({ duration: 1_000 });
    startPause(timer, 0);
    expect(lineOf(overlayState(timer), NOW)).toMatchObject({ flashing: true });
    timer.doneText = "Go!";
    expect(lineOf(overlayState(timer), NOW)).toMatchObject({ flashing: false });
    expect(lineText(lineOf(overlayState(timer), NOW))).toBe("Plank timer Go!");
  });

  it("puts the last lap under the time", () => {
    const watch = { ...(newItem("stopwatch", "w", "Run") as Clock), laps: true, showLastLap: true, lapTimes: [65_000] };
    startPause(watch, NOW - 70_000);
    expect(lineOf(overlayState(watch), NOW).lap).toBe("1:05");
  });

  it("writes a counter's number with its goal", () => {
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    deaths.value = 4;
    deaths.look.text = "{count} Deaths";
    expect(lineText(lineOf(overlayState(deaths), NOW))).toBe("4 Deaths");
    deaths.goal = 10;
    expect(lineText(lineOf(overlayState(deaths), NOW))).toBe("4 / 10 Deaths");
  });

  it("draws a whole group's line in runs, one value per counter", () => {
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    deaths.value = 2;
    deaths.links = [{ target: "s", amount: 5 }];
    const situps = newItem("counter", "s", "Sit-ups") as Counter;
    situps.value = 10;
    const data: ItemList = { items: [] };
    insert(data, deaths);
    insert(data, situps);
    setStream(data, "d", { whole: true, text: "{@d} lost, {@s} to go" });
    expect(lineOf(groupOverlayState(groupOf(data, "d")!, counterName), NOW).segments).toEqual([
      { text: "2", value: true },
      { text: " lost, ", value: false },
      { text: "10", value: true },
      { text: " to go", value: false },
    ]);
  });

  it("reads a state from a panel that had no text field: the name before the value when the look says so", () => {
    const { text: _text, ...state } = overlayState(countdown()) as Extract<ReturnType<typeof overlayState>, { kind: "clock" }>;
    expect(lineText(lineOf(state, NOW))).toBe("Plank timer 1:30");
    expect(lineText(lineOf({ ...state, look: { ...state.look, showLabel: false } }, NOW))).toBe("1:30");
    expect(lineOf({ kind: "group", look: state.look, line: "3 Deaths" }, NOW).segments).toEqual([{ text: "3 Deaths", value: true }]);
  });
});
