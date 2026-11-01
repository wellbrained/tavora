import { describe, expect, it } from "vitest";
import { insert, newItem, startPause, type Clock, type Counter, type ItemList } from "./items";
import { buildLiveState, isLive, LIVE_MAX_ROWS, rowText } from "./live";

const list = (...items: ReturnType<typeof newItem>[]): ItemList => {
  const result: ItemList = { items: [] };
  for (const item of items) insert(result, item);
  return result;
};

describe("buildLiveState", () => {
  it("has nothing to show for an empty list", () => {
    expect(buildLiveState({ items: [] }, "+{count} more")).toBeNull();
  });

  it("lists every item in the order the panel shows, with what the page needs to count a clock itself", () => {
    const watch = newItem("stopwatch", "w", "Run") as Clock;
    startPause(watch, 5_000);
    const state = buildLiveState(list(newItem("counter", "d", "Deaths"), watch), "+{count} more")!;
    expect(state.kind).toBe("live");
    expect(state.rows.map((row) => row.label)).toEqual(["Deaths", "Run"]);
    expect(state.rows[1]).toMatchObject({ kind: "clock", clock: { since: 5_000, counted: 0 } });
    expect(state.more).toBe(0);
  });

  it("keeps the state small and says how many did not fit", () => {
    const many = list(...Array.from({ length: LIVE_MAX_ROWS + 5 }, (_, index) => newItem("counter", `c${index}`, `Counter ${index}`)));
    const state = buildLiveState(many, "+{count} more")!;
    expect(state.rows).toHaveLength(LIVE_MAX_ROWS);
    expect(state.more).toBe(5);
    expect(state.moreText).toBe("+{count} more");
    // Tavora refuses a live state over 16 KB.
    expect(new TextEncoder().encode(JSON.stringify(state)).length).toBeLessThan(16 * 1024);
  });

  it("is plain JSON", () => {
    const state = buildLiveState(list(newItem("countdown", "t", "Boss")), "+{count} more");
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe("isLive", () => {
  it("tells a live state from the state of one item", () => {
    const live = buildLiveState(list(newItem("counter", "d", "Deaths")), "+{count} more");
    expect(isLive(live)).toBe(true);
    expect(isLive({ kind: "counter", label: "Deaths", value: 1, goal: null })).toBe(false);
    expect(isLive({ kind: "live" })).toBe(false);
    expect(isLive(null)).toBe(false);
  });
});

describe("rowText", () => {
  const rowOf = (item: ReturnType<typeof newItem>) => buildLiveState(list(item), "")!.rows[0]!;

  it("shows a counter's number and its goal", () => {
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    deaths.value = 3;
    expect(rowText(rowOf(deaths), 0).text).toBe("3");
    deaths.goal = 10;
    expect(rowText(rowOf(deaths), 0).text).toBe("3 / 10");
  });

  it("counts a running clock from its start time", () => {
    const watch = newItem("stopwatch", "w", "Run") as Clock;
    startPause(watch, 1_000);
    expect(rowText(rowOf(watch), 66_000)).toEqual({ text: "1:05", flashing: false, running: true });
  });

  it("shows a finished countdown as its text, or flashing 0:00", () => {
    const timer = newItem("countdown", "t", "Boss") as Clock;
    timer.duration = 60_000;
    startPause(timer, 0);
    expect(rowText(rowOf(timer), 61_000)).toEqual({ text: "0:00", flashing: true, running: false });
    timer.doneText = "Go!";
    expect(rowText(rowOf(timer), 61_000)).toEqual({ text: "Go!", flashing: false, running: false });
  });
});
