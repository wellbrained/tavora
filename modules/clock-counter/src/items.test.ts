import { describe, expect, it } from "vitest";
import {
  count,
  elapsed,
  insert,
  lap,
  lapSplits,
  MAX,
  newItem,
  overlayState,
  parseList,
  readClock,
  remove,
  resetClock,
  startPause,
  type Clock,
  type Counter,
  type ItemList,
} from "./items";

const clock = (kind: "countdown" | "stopwatch", fields: Partial<Clock> = {}): Clock => ({ ...(newItem(kind, "c", "Clock") as Clock), ...fields });
const counter = (id: string, fields: Partial<Counter> = {}): Counter => ({ ...(newItem("counter", id, id) as Counter), ...fields });
const values = (list: ItemList) => list.items.map((item) => (item as Counter).value);

describe("clocks", () => {
  it("keep real time from when they started", () => {
    const watch = clock("stopwatch");
    startPause(watch, 1_000);
    expect(readClock(watch, 61_500)).toEqual({ seconds: 60, running: true, done: false });
    startPause(watch, 61_500);
    expect(watch).toMatchObject({ since: null, counted: 60_500 });
    expect(readClock(watch, 999_999).seconds).toBe(60);
    startPause(watch, 100_000);
    expect(elapsed(watch, 101_000)).toBe(61_500);
  });

  it("count down, showing the seconds left rounded up, and stop at 0", () => {
    const timer = clock("countdown", { duration: 10_000 });
    startPause(timer, 0);
    expect(readClock(timer, 100).seconds).toBe(10);
    expect(readClock(timer, 9_100)).toEqual({ seconds: 1, running: true, done: false });
    expect(readClock(timer, 10_000)).toEqual({ seconds: 0, running: false, done: true });
    expect(readClock(timer, 50_000).seconds).toBe(0);
  });

  it("start a finished countdown again from the full time", () => {
    const timer = clock("countdown", { duration: 10_000 });
    startPause(timer, 0);
    startPause(timer, 20_000);
    expect(readClock(timer, 21_000)).toEqual({ seconds: 9, running: true, done: false });
  });

  it("start a repeating countdown over at 0, never done", () => {
    const timer = clock("countdown", { duration: 10_000, repeat: true });
    startPause(timer, 0);
    expect(readClock(timer, 10_000)).toEqual({ seconds: 10, running: true, done: false });
    expect(readClock(timer, 13_000).seconds).toBe(7);
  });

  it("take laps only while running with laps on, keeping the last MAX.laps", () => {
    const watch = clock("stopwatch");
    startPause(watch, 0);
    lap(watch, 5_000);
    expect(watch.lapTimes).toEqual([]);
    watch.laps = true;
    lap(watch, 5_000);
    lap(watch, 12_000);
    expect(lapSplits(watch)).toEqual([5_000, 7_000]);
    for (let i = 0; i < MAX.laps + 5; i++) lap(watch, 20_000 + i);
    expect(watch.lapTimes).toHaveLength(MAX.laps);
    resetClock(watch);
    expect(watch).toMatchObject({ since: null, counted: 0, lapTimes: [] });
  });
});

describe("counters", () => {
  it("count by their step and stop at 0 unless they may go below", () => {
    const list: ItemList = { items: [counter("deaths", { step: 2 })] };
    count(list, "deaths", 1);
    count(list, "deaths", -1);
    count(list, "deaths", -1);
    expect(values(list)).toEqual([0]);
    (list.items[0] as Counter).negative = true;
    count(list, "deaths", -1);
    expect(values(list)).toEqual([-2]);
  });

  it("add to linked counters: 5 sit-ups per death, taken back by a -1", () => {
    const list: ItemList = { items: [counter("deaths", { links: [{ target: "situps", amount: 5 }, { target: "pushups", amount: 10 }] }), counter("situps"), counter("pushups")] };
    count(list, "deaths", 1);
    count(list, "deaths", 1);
    expect(values(list)).toEqual([2, 10, 20]);
    count(list, "deaths", -1);
    expect(values(list)).toEqual([1, 5, 10]);
    // Working the sit-ups off is the sit-ups counter's own business.
    count(list, "situps", -1);
    expect(values(list)).toEqual([1, 4, 10]);
  });

  it("follow links one level only", () => {
    const list: ItemList = { items: [counter("a", { links: [{ target: "b", amount: 1 }] }), counter("b", { links: [{ target: "c", amount: 1 }] }), counter("c")] };
    count(list, "a", 1);
    expect(values(list)).toEqual([1, 1, 0]);
  });

  it("leave their links alone when they can't move themselves", () => {
    const list: ItemList = { items: [counter("deaths", { links: [{ target: "situps", amount: 5 }] }), counter("situps", { value: 5 })] };
    count(list, "deaths", -1);
    expect(values(list)).toEqual([0, 5]);
  });
});

describe("the list", () => {
  it("reads back what it stored, and leaves out what it can't read", () => {
    const list: ItemList = { items: [] };
    insert(list, clock("stopwatch", { id: "w", laps: true }));
    insert(list, counter("k", { goal: 50 }));
    expect(parseList(JSON.parse(JSON.stringify(list)))).toEqual(list);
    expect(parseList({ items: [{ id: "x", kind: "teapot" }, { kind: "counter" }, 5] })).toEqual({ items: [] });
    expect(parseList(null)).toEqual({ items: [] });
  });

  it("drops links to counters that are gone, and removing a counter removes the links to it", () => {
    const raw = { items: [counter("a", { links: [{ target: "b", amount: 1 }, { target: "gone", amount: 2 }, { target: "a", amount: 1 }] }), counter("b")] };
    const list = parseList(JSON.parse(JSON.stringify(raw)));
    expect((list.items[0] as Counter).links).toEqual([{ target: "b", amount: 1 }]);
    remove(list, "b");
    expect((list.items[0] as Counter).links).toEqual([]);
  });

  it("puts a deleted item back where it was", () => {
    const list: ItemList = { items: [counter("a"), counter("b"), counter("c")] };
    const b = list.items[1]!;
    remove(list, "b");
    insert(list, b, 1);
    expect(list.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});

describe("overlayState", () => {
  it("gives a clock its start time so the overlay can count itself, and the last lap when asked", () => {
    const watch = clock("stopwatch", { laps: true, showLastLap: true });
    startPause(watch, 0);
    lap(watch, 4_000);
    lap(watch, 10_000);
    expect(overlayState(watch)).toMatchObject({ kind: "clock", label: "Clock", clock: { kind: "stopwatch", since: 0, counted: 0 }, lastLap: 6_000 });
    expect(overlayState(counter("k", { value: 3, goal: 10 }))).toMatchObject({ kind: "counter", value: 3, goal: 10 });
  });

  it("stays well under the overlay size limit", () => {
    const watch = clock("stopwatch", { laps: true, label: "x".repeat(MAX.label), lapTimes: Array.from({ length: MAX.laps }, (_, i) => i * 1000) });
    expect(JSON.stringify(overlayState(watch)).length).toBeLessThan(2_000);
  });
});
