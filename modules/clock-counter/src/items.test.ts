import { DEFAULT_PAUSE as KIT_PAUSE, OVERLAY_TEXT_BOXES, OVERLAY_TEXT_PAUSES, OVERLAY_TEXT_SPEEDS, OVERLAY_TEXT_TOO_LONG } from "@tavora/official-ui/components/ui/overlay-text";
import { describe, expect, it } from "vitest";
import {
  BOX_PAUSES,
  BOXES,
  boxOf,
  DEFAULT_PAUSE,
  SPEEDS,
  TOO_LONG,
  count,
  defaultLook,
  defaultStored,
  elapsed,
  groupLine,
  groupOf,
  groupOverlayState,
  insert,
  itemText,
  lap,
  lapSplits,
  linkedGroups,
  MAX,
  memberNames,
  canMove,
  move,
  moveTo,
  newItem,
  overlayState,
  parseList,
  readClock,
  remove,
  resetClock,
  setStream,
  oldStepOf,
  readSizes,
  SIZE_SCALE,
  SIZES,
  sizeScales,
  sizesOf,
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

  it("say whether a move would change anything, so the menu can switch Move up and Move down off at the ends", () => {
    const data = list();
    // deaths, situps, squats (a group), run, solo.
    expect(canMove(data, "deaths", -1)).toBe(false);
    expect(canMove(data, "deaths", 1)).toBe(true);
    expect(canMove(data, "situps", -1)).toBe(true);
    // The last counter of the group still moves: at the edge the whole group goes past the next row.
    expect(canMove(data, "squats", 1)).toBe(true);
    expect(canMove(data, "solo", 1)).toBe(false);
    expect(canMove(data, "solo", -1)).toBe(true);
    expect(canMove(data, "nobody", 1)).toBe(false);
    // It agrees with move() everywhere.
    for (const item of data.items) {
      for (const by of [-1, 1] as const) {
        const copy = structuredClone(data);
        move(copy, item.id, by);
        expect(canMove(data, item.id, by)).toBe(ids(visualOrder(copy)).join() !== ids(visualOrder(data)).join());
      }
    }
  });

  it("move a whole linked group as one block among the rows, and a counter inside it first", () => {
    const data = list();
    move(data, "deaths", 1);
    expect(ids(visualOrder(data))).toEqual(["situps", "deaths", "squats", "run", "solo"]);
    move(data, "deaths", 1);
    expect(ids(visualOrder(data))).toEqual(["situps", "squats", "deaths", "run", "solo"]);
    // At the group's end it goes on as a block: one place down, never into the middle of another row.
    move(data, "deaths", 1);
    expect(ids(visualOrder(data))).toEqual(["run", "situps", "squats", "deaths", "solo"]);
  });

  it("can be dropped before or after another row, a group going as one block", () => {
    const data = list();
    moveTo(data, "run", "deaths", false);
    expect(ids(visualOrder(data))).toEqual(["run", "deaths", "situps", "squats", "solo"]);
    // Any counter of the group takes the whole group along.
    moveTo(data, "squats", "solo", true);
    expect(ids(visualOrder(data))).toEqual(["run", "solo", "deaths", "situps", "squats"]);
    // Dropped on a group, the item lands before or after all of it.
    moveTo(data, "solo", "situps", true);
    expect(ids(visualOrder(data))).toEqual(["run", "deaths", "situps", "squats", "solo"]);
    // Inside a group two counters change places.
    moveTo(data, "squats", "deaths", false);
    expect(ids(visualOrder(data))).toEqual(["run", "squats", "deaths", "situps", "solo"]);
    moveTo(data, "run", "run", true);
    moveTo(data, "run", "nobody", true);
    expect(ids(visualOrder(data))).toEqual(["run", "squats", "deaths", "situps", "solo"]);
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

describe("the text of an overlay", () => {
  const raw = (look: Record<string, unknown>, label = "Plank timer") => ({
    items: [{ id: "t", kind: "countdown", label, format: "m:ss", duration: 60_000, look: { showLabel: true, color: "#ffffff", outline: true, font: "inter", align: "center", ...look } }],
  });
  const first = (data: ItemList) => data.items[0]!;

  it("is the name before the value for data saved before the text field (Show the name on)", () => {
    const item = first(parseList(raw({})));
    expect(item.look.text).toBeUndefined();
    expect(itemText(item)).toBe("Plank timer {time}");
    expect(overlayState(item)).toMatchObject({ text: "Plank timer {time}" });
  });

  it("is the value alone when Show the name was off, and follows a rename until a text is saved", () => {
    expect(itemText(first(parseList(raw({ showLabel: false }))))).toBe("{time}");
    const item = first(parseList(raw({})));
    item.label = "Plank";
    expect(itemText(item)).toBe("Plank {time}");
    item.look.text = "{time}";
    item.label = "Other";
    expect(itemText(item)).toBe("{time}");
  });

  it("gives a counter {count}", () => {
    const data = parseList({ items: [{ id: "d", kind: "counter", label: "Deaths", look: {} }] });
    expect(itemText(first(data))).toBe("Deaths {count}");
  });

  it("keeps a text, even an empty one, and the new colours and sizes", () => {
    const item = first(parseList(raw({ text: "", wordsColor: "#facc15", wordsStep: "xl", numberStep: "xs", wordsSize: "xl", numberSize: "s" })));
    expect(item.look).toMatchObject({ text: "", wordsColor: "#facc15", wordsStep: "xl", numberStep: "xs", wordsSize: "xl", numberSize: "s" });
    expect(itemText(item)).toBe("");
  });

  it("reads old looks with the old sizes, and drops what it can't read", () => {
    const old = first(parseList(raw({})));
    expect(old.look).toMatchObject({ wordsStep: "m", numberStep: "m", wordsSize: "xl", numberSize: "m" });
    expect(old.look.wordsColor).toBeUndefined();
    const bad = first(parseList(raw({ text: 5, wordsColor: "red", wordsStep: "huge", numberStep: 3, wordsSize: "huge", numberSize: 3 })));
    expect(bad.look).toMatchObject({ wordsStep: "m", numberStep: "m", wordsSize: "xl", numberSize: "m" });
    expect(bad.look.text).toBeUndefined();
    expect(bad.look.wordsColor).toBeUndefined();
    expect(first(parseList(raw({ text: "x".repeat(MAX.text + 50) }))).look.text).toHaveLength(MAX.text);
  });

  it("is written so the previous version still reads it: the old look fields stay, the new ones are added", () => {
    const item = first(parseList(raw({})));
    item.look.text = "{time} left";
    item.look.showLabel = false;
    const saved = JSON.parse(JSON.stringify(parseList({ items: [item] }))) as { items: { look: Record<string, unknown> }[] };
    expect(Object.keys(saved.items[0]!.look)).toEqual(expect.arrayContaining(["showLabel", "color", "outline", "font", "align"]));
    expect(saved.items[0]!.look).toMatchObject({ showLabel: false, color: "#ffffff", text: "{time} left", wordsStep: "m", numberStep: "m", wordsSize: "xl", numberSize: "m" });
    // The previous version keeps only the old fields; this one then reads that as "Show the name off".
    const { text: _text, wordsColor: _wordsColor, wordsStep: _wordsStep, numberStep: _numberStep, wordsSize: _wordsSize, numberSize: _numberSize, ...oldLook } = saved.items[0]!.look;
    expect(itemText(first(parseList(raw(oldLook))))).toBe("{time}");
  });
});

/** The look reader of the version before the one scale (0.1.19): its own steps, nothing else, and what it doesn't know is dropped. */
const OLD_STEP_SHARE = { words: { s: 0.3, m: 0.5, l: 0.75, xl: 1 }, number: { s: 0.6, m: 1, l: 1.5, xl: 2 } } as const;
const previousParse = (look: Record<string, unknown>) => {
  const step = (value: unknown): "s" | "m" | "l" | "xl" => (["s", "m", "l", "xl"].includes(value as string) ? (value as "s") : "m");
  return {
    showLabel: look.showLabel !== false,
    color: look.color,
    outline: look.outline !== false,
    font: look.font,
    align: look.align,
    wordsSize: step(look.wordsSize),
    numberSize: step(look.numberSize),
    ...(typeof look.text === "string" ? { text: look.text } : {}),
    ...(typeof look.wordsColor === "string" ? { wordsColor: look.wordsColor } : {}),
  };
};
/** The sizes the version before drew for a look (items.ts 0.1.19): its own words and number steps, M when there are none. */
const previousSizeScales = (look: { wordsSize?: "s" | "m" | "l" | "xl"; numberSize?: "s" | "m" | "l" | "xl" }) => ({
  words: OLD_STEP_SHARE.words[look.wordsSize ?? "m"] ?? OLD_STEP_SHARE.words.m,
  number: OLD_STEP_SHARE.number[look.numberSize ?? "m"] ?? OLD_STEP_SHARE.number.m,
});

describe("the one size scale", () => {
  it("has the kit's text sizes, XS to XL, for the words and the number alike", () => {
    expect(SIZES).toEqual(["xs", "s", "m", "l", "xl"]);
    // 12, 13, 14, 16 and 20 px, scaled so that M is the 48 px the number always had.
    expect(SIZES.map((size) => Math.round(SIZE_SCALE[size] * 48 * 100) / 100)).toEqual([41.14, 44.57, 48, 54.86, 68.57]);
    expect(sizeScales({ wordsStep: "xl", numberStep: "xs" })).toEqual({ words: SIZE_SCALE.xl, number: SIZE_SCALE.xs });
  });

  it("is M for the words and the number when there are no sizes, and for ones it can't read", () => {
    expect(sizeScales({})).toEqual({ words: 1, number: 1 });
    expect(sizeScales({ wordsStep: "nope", wordsSize: "nope" })).toEqual({ words: 1, number: 1 });
  });

  it("reads the new step first, then the old step moved to the nearest new one", () => {
    // Words had S 14, M 24, L 36 and XL 48 px; the number S 29, M 48, L 72 and XL 96 px.
    expect(["s", "m", "l", "xl"].map((size) => readSizes({ wordsSize: size }).wordsStep)).toEqual(["xs", "xs", "xs", "m"]);
    expect(["s", "m", "l", "xl"].map((size) => readSizes({ numberSize: size }).numberStep)).toEqual(["xs", "m", "xl", "xl"]);
    expect(readSizes({ wordsStep: "s", numberStep: "s", wordsSize: "xl", numberSize: "xl" })).toEqual({ wordsStep: "s", numberStep: "s" });
  });

  it("keeps the old steps as they were saved, and writes the nearest old step for a new one", () => {
    const data = parseList({ items: [{ id: "t", kind: "countdown", label: "T", look: { wordsSize: "s", numberSize: "l" } }] });
    expect(data.items[0]!.look).toMatchObject({ wordsSize: "s", numberSize: "l", wordsStep: "xs", numberStep: "xl" });
    expect(sizesOf("l", "xs")).toEqual({ wordsStep: "l", numberStep: "xs", wordsSize: "xl", numberSize: "m" });
    expect(SIZES.map((size) => sizesOf(size, size).wordsSize)).toEqual(["l", "xl", "xl", "xl", "xl"]);
    expect(SIZES.map((size) => sizesOf(size, size).numberSize)).toEqual(["m", "m", "m", "m", "l"]);
  });

  it("is read by the version before as its own steps: no gaps, never NaN", () => {
    for (const step of SIZES) {
      const look = JSON.parse(JSON.stringify({ ...defaultLook(), ...sizesOf(step, step) }));
      const sizes = previousSizeScales(previousParse(look));
      expect(Number.isFinite(sizes.words) && sizes.words > 0 && Number.isFinite(sizes.number) && sizes.number > 0).toBe(true);
      // About what the new step draws (the old steps are coarser than the new ones, on a different base).
      expect(sizes.number).toBeCloseTo(OLD_STEP_SHARE.number[oldStepOf("number", step)], 6);
    }
    // And a state with the new keys, as a panel publishes it, gives the version before its old step, not undefined.
    const state = JSON.parse(JSON.stringify(overlayState({ ...clock("countdown"), look: { ...defaultLook(), ...sizesOf("l", "xl") } })));
    expect(previousSizeScales(state.look)).toEqual({ words: 1, number: 1.5 });
  });

  it("does not drift when the version before saves it and this one reads it again", () => {
    const start = { ...defaultLook(), ...sizesOf("l", "xl") };
    const again = (look: Record<string, unknown>) => {
      const saved = previousParse(JSON.parse(JSON.stringify(look)));
      return parseList(JSON.parse(JSON.stringify({ items: [{ id: "t", kind: "countdown", label: "T", look: saved }] }))).items[0]!.look;
    };
    // The version before drops the new steps; this one then takes them from the old steps, once, and keeps them from then on.
    const once = again(start);
    const twice = again(once);
    const thrice = again(twice);
    expect([twice.wordsStep, twice.numberStep]).toEqual([once.wordsStep, once.numberStep]);
    expect([thrice.wordsStep, thrice.numberStep, thrice.wordsSize, thrice.numberSize]).toEqual([once.wordsStep, once.numberStep, once.wordsSize, once.numberSize]);
    // Data from before the one scale, kept by the version before as it was, reads the same every time.
    const old = { showLabel: true, color: "#ffffff", outline: true, font: "inter", align: "center", wordsSize: "l", numberSize: "xl" };
    const first1 = again(old);
    expect([first1.wordsStep, first1.numberStep, first1.wordsSize, first1.numberSize]).toEqual(["xs", "xl", "l", "xl"]);
    expect(again(first1)).toEqual(first1);
  });
});

describe("the box of an overlay", () => {
  const raw = (look: Record<string, unknown>) => ({ items: [{ id: "d", kind: "counter", label: "Deaths", look: { showLabel: true, color: "#ffffff", outline: true, font: "inter", align: "center", ...look } }] });
  const lookOf = (look: Record<string, unknown>) => parseList(raw(look)).items[0]!.look;

  it("offers exactly the choices of the kit's OverlayText", () => {
    expect(BOXES).toEqual(OVERLAY_TEXT_BOXES);
    expect(TOO_LONG).toEqual(OVERLAY_TEXT_TOO_LONG);
    expect(SPEEDS).toEqual(OVERLAY_TEXT_SPEEDS);
    expect(BOX_PAUSES).toEqual(OVERLAY_TEXT_PAUSES);
    expect(DEFAULT_PAUSE).toBe(KIT_PAUSE);
  });

  it("grows with the text for data saved before the box, and keeps that data as it was saved", () => {
    const look = lookOf({});
    expect(boxOf(look)).toEqual({ box: "grow", tooLong: "scroll", speed: "normal", pause: 2, softEdges: true });
    for (const key of ["box", "tooLong", "speed", "pause", "softEdges"]) expect(key in look).toBe(false);
    expect(boxOf(defaultLook()).box).toBe("grow");
  });

  it("keeps a fixed box and its settings, and drops what it can't read", () => {
    expect(lookOf({ box: "fixed", tooLong: "cut", speed: "fast", pause: 0.5, softEdges: false })).toMatchObject({ box: "fixed", tooLong: "cut", speed: "fast", pause: 0.5, softEdges: false });
    expect(boxOf(lookOf({ pause: 0 })).pause).toBe(0);
    const bad = lookOf({ box: "huge", tooLong: "wrap", speed: 9, pause: 0.7, softEdges: "yes" });
    for (const key of ["box", "tooLong", "speed", "pause", "softEdges"]) expect(key in bad).toBe(false);
    expect(boxOf({ pause: 7 }).pause).toBe(2);
  });

  it("is written so the previous version still reads it: the box only adds fields, and the old ones stay", () => {
    const look = lookOf({ box: "fixed", tooLong: "shrink" });
    const saved = JSON.parse(JSON.stringify({ items: [{ id: "d", kind: "counter", label: "Deaths", look }] }));
    expect(Object.keys(saved.items[0].look)).toEqual(expect.arrayContaining(["showLabel", "color", "outline", "font", "align", "wordsSize", "numberSize"]));
    // The previous version drops what it doesn't know when it saves; this version then reads a box that grows, as before.
    const { box: _box, tooLong: _tooLong, ...older } = saved.items[0].look;
    expect(boxOf(lookOf(older)).box).toBe("grow");
  });

  it("goes out with what the overlay publishes, so the page can draw the box", () => {
    const item = parseList(raw({ box: "fixed", speed: "slow" })).items[0]!;
    expect(overlayState(item).look).toMatchObject({ box: "fixed", speed: "slow" });
  });
});
