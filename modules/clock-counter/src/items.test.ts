import { describe, expect, it } from "vitest";
import {
  count,
  defaultStored,
  elapsed,
  groupLine,
  groupOf,
  groupOverlayState,
  insert,
  lap,
  lapSplits,
  linkedGroups,
  MAX,
  memberNames,
  move,
  newItem,
  overlayState,
  parseList,
  readClock,
  remove,
  resetClock,
  setStream,
  sourcesOf,
  startPause,
  visualOrder,
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

const nameOf = (item: Counter) => item.label;
const link = (target: string, amount = 1) => ({ target, amount });
const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("linked groups", () => {
  const list = (): ItemList => ({
    items: [counter("deaths", { links: [link("situps", 5)] }), clock("stopwatch", { id: "run" }), counter("solo"), counter("situps"), counter("squats", { links: [link("situps", 2)] })],
  });

  it("join counters by their links, in both directions", () => {
    const groups = linkedGroups(list());
    expect(groups).toHaveLength(1);
    expect(ids(groups[0]!.members)).toEqual(["deaths", "situps", "squats"]);
    expect(groupOf(list(), "situps")?.key).toBe(groups[0]!.key);
    expect(groupOf(list(), "solo")).toBeNull();
    expect(groupOf(list(), "run")).toBeNull();
  });

  it("keep two separate groups apart", () => {
    const two: ItemList = { items: [counter("a", { links: [link("b")] }), counter("b"), counter("c", { links: [link("d")] }), counter("d")] };
    expect(linkedGroups(two).map((group) => ids(group.members))).toEqual([["a", "b"], ["c", "d"]]);
    expect(new Set(linkedGroups(two).map((group) => group.key)).size).toBe(2);
  });

  it("stand together in the order shown, and a group moves as one block", () => {
    const data = list();
    expect(ids(visualOrder(data))).toEqual(["deaths", "situps", "squats", "run", "solo"]);
    // The stopwatch jumps over the whole group.
    move(data, "run", -1);
    expect(ids(visualOrder(data))).toEqual(["run", "deaths", "situps", "squats", "solo"]);
    // Inside the group a counter moves past its neighbour; at the edge the group moves on.
    move(data, "situps", 1);
    expect(ids(visualOrder(data))).toEqual(["run", "deaths", "squats", "situps", "solo"]);
    move(data, "situps", 1);
    expect(ids(visualOrder(data))).toEqual(["run", "solo", "deaths", "squats", "situps"]);
    move(data, "situps", 1);
    expect(ids(visualOrder(data))).toEqual(["run", "solo", "deaths", "squats", "situps"]);
  });

  it("know who counts from whom", () => {
    expect(ids(sourcesOf(list(), "situps"))).toEqual(["deaths", "squats"]);
    expect(sourcesOf(list(), "deaths")).toEqual([]);
  });

  it("show per counter until a group is set to show as a whole", () => {
    const group = linkedGroups(list())[0]!;
    expect(group.stream).toMatchObject({ whole: false, text: "" });
    expect(list().items.every((item) => item.kind !== "counter" || item.stream === null)).toBe(true);
  });

  it("save the stream settings in every member, and read them the same from any", () => {
    const data = list();
    setStream(data, "squats", { whole: true, text: "{@deaths} x" });
    const streams = data.items.filter((item): item is Counter => item.kind === "counter" && item.id !== "solo").map((item) => item.stream);
    expect(streams.every((stream) => stream?.whole && stream.text === "{@deaths} x")).toBe(true);
    expect(groupOf(data, "deaths")?.stream).toEqual(groupOf(data, "situps")?.stream);
    expect(data.items.find((item) => item.id === "solo")).toMatchObject({ stream: null });
    // The members don't share one look object.
    const a = (data.items[0] as Counter).stream!;
    const b = (data.items[3] as Counter).stream!;
    a.look.color = "#000000";
    expect(b.look.color).not.toBe("#000000");
  });

  it("keep the overlay key when a counter joins, leaves or the first one is deleted", () => {
    const data = list();
    setStream(data, "deaths", { whole: true });
    const key = groupOf(data, "deaths")!.key;
    data.items.push(counter("pushups", { links: [link("deaths")] }));
    expect(groupOf(data, "pushups")?.key).toBe(key);
    remove(data, "deaths");
    expect(groupOf(data, "situps")?.key).toBe(key);
  });

  it("give the group that splits off its own key", () => {
    const data: ItemList = { items: [counter("a", { links: [link("b")] }), counter("b"), counter("c"), counter("d")] };
    setStream(data, "a", { whole: true });
    const key = groupOf(data, "a")!.key;
    // c and d held the same settings before the group split in two.
    (data.items[2] as Counter).stream = { ...(data.items[0] as Counter).stream! };
    (data.items[3] as Counter).stream = { ...(data.items[0] as Counter).stream! };
    (data.items[2] as Counter).links = [link("d")];
    const groups = linkedGroups(data);
    expect(groups.map((group) => group.key)[0]).toBe(key);
    expect(groups[1]!.key).not.toBe(key);
  });

  it("show the line the user wrote with the values in", () => {
    const data: ItemList = { items: [counter("deaths", { label: "Deaths", value: 1, links: [link("situps", 5)] }), counter("situps", { label: "Situps", value: 5 })] };
    setStream(data, "deaths", { whole: true, text: "{@deaths} Death – {@situps} Situps 💀" });
    expect(groupLine(groupOf(data, "deaths")!, nameOf)).toBe("1 Death – 5 Situps 💀");
    expect(groupOverlayState(groupOf(data, "deaths")!, nameOf)).toMatchObject({ kind: "group", line: "1 Death – 5 Situps 💀" });
  });

  it("show the default line for a new group, and when the saved text no longer fits", () => {
    const data: ItemList = { items: [counter("a", { label: "Deaths", value: 2, links: [link("b", 5)] }), counter("b", { label: "Sit-ups", value: 10 })] };
    expect(groupLine(groupOf(data, "a")!, nameOf)).toBe("2 Deaths – 10 Sit-ups");
    setStream(data, "a", { whole: true, text: "{@a} / {@gone}" });
    expect(groupLine(groupOf(data, "a")!, nameOf)).toBe("2 Deaths – 10 Sit-ups");
    expect(defaultStored(memberNames(groupOf(data, "a")!, nameOf))).toBe("{@a} Deaths – {@b} Sit-ups");
  });
});

describe("data from before groups", () => {
  const OLD = {
    items: [
      { id: "a", kind: "counter", label: "Deaths", look: { showLabel: true, color: "#ffffff", outline: true, font: "inter", align: "center" }, value: 3, step: 1, negative: false, goal: null, links: [{ target: "b", amount: 5 }] },
      { id: "b", kind: "counter", label: "Sit-ups", look: { showLabel: true, color: "#ffffff", outline: true, font: "inter", align: "center" }, value: 15, step: 1, negative: false, goal: null, links: [] },
    ],
  };

  it("opens, and shows each counter on its own until a group is set to show as a whole", () => {
    const data = parseList(OLD);
    expect(data.items.every((item) => item.kind === "counter" && item.stream === null)).toBe(true);
    const group = groupOf(data, "a")!;
    expect(group.stream.whole).toBe(false);
    expect(overlayState(data.items[0]!)).toMatchObject({ kind: "counter", value: 3 });
  });

  it("ignores a stream it can't read", () => {
    const data = parseList({ items: [{ ...OLD.items[0], stream: { key: "bad key!", whole: true } }, OLD.items[1]!] });
    expect((data.items[0] as Counter).stream).toBeNull();
    const kept = parseList({ items: [{ ...OLD.items[0], stream: { key: "g-1", whole: true, text: "{@a}", look: { color: "#facc15" } } }, OLD.items[1]!] });
    expect((kept.items[0] as Counter).stream).toMatchObject({ key: "g-1", whole: true, text: "{@a}", look: { color: "#facc15" } });
  });

  it("is written so the previous version still reads it: fields are only added", () => {
    const data = parseList(OLD);
    setStream(data, "a", { whole: true, text: "{@a}" });
    const saved = JSON.parse(JSON.stringify(data)) as { items: Record<string, unknown>[] };
    // What the previous version needs from each counter is all there, with the same shapes.
    for (const item of saved.items) {
      expect(Object.keys(item)).toEqual(expect.arrayContaining(["id", "kind", "label", "look", "value", "step", "negative", "goal", "links"]));
    }
    expect(saved.items[0]!.links).toEqual([{ target: "b", amount: 5 }]);
    // And the previous version saving it back (dropping the new fields) gives the per-counter overlays again.
    const back = parseList(JSON.parse(JSON.stringify({ items: saved.items.map(({ stream: _stream, ...rest }) => rest) })));
    expect(back.items.every((item) => item.kind === "counter" && item.stream === null)).toBe(true);
    expect(groupOf(back, "a")?.stream.whole).toBe(false);
  });
});
