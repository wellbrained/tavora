import { describe, expect, it } from "vitest";
import { insert, newItem, setStream, startPause, type Clock, type Counter, type ItemList } from "./items";
import { buildSources, itemForKey, itemSize, overlayKey, VALUE_PX, type Measure } from "./sources";

/** Every character is as wide as half its size, so the numbers are easy to work out. */
const measure: Measure = (text, px) => text.length * px * 0.5;
const name = (item: { label: string; kind: string }) => item.label || item.kind;
const NOW = 1_000_000;

const list = (...items: ReturnType<typeof newItem>[]): ItemList => {
  const result: ItemList = { items: [] };
  for (const item of items) insert(result, item);
  return result;
};

/** Two counters, linked, shown as one line. */
function linked(whole: boolean) {
  const deaths = newItem("counter", "d", "Deaths") as Counter;
  const situps = newItem("counter", "s", "Sit-ups") as Counter;
  deaths.links = [{ target: "s", amount: 5 }];
  deaths.value = 7;
  const result = list(deaths, situps, newItem("countdown", "b", "Boss"));
  if (whole) setStream(result, "d", { whole: true });
  return result;
}

describe("buildSources", () => {
  it("lists each clock and counter on its own, in the panel's order, with the size it needs", () => {
    const sources = buildSources(list(newItem("countdown", "b", "Boss"), newItem("counter", "c", "Deaths")), measure, name, NOW);
    expect(sources.map((source) => [source.key, source.name, source.group ?? false])).toEqual([
      ["b", "Boss", false],
      ["c", "Deaths", false],
    ]);
    expect(sources.every((source) => source.size!.width > 0 && source.size!.height === Math.ceil(VALUE_PX * 1.05))).toBe(true);
  });

  it("lists a linked group that shows as a whole as one line, once, and not its counters again", () => {
    const sources = buildSources(linked(true), measure, name, NOW);
    expect(sources.map((source) => [source.key, source.group ?? false])).toEqual([
      [expect.stringMatching(/^g-d|^.+/), true],
      ["b", false],
    ]);
    expect(sources[0]!.name).toContain("7");
    expect(sources[0]!.name).toContain("Deaths");
  });

  it("lists the counters of a linked group that is not shown as a whole one by one", () => {
    expect(buildSources(linked(false), measure, name, NOW).map((source) => source.key)).toEqual(["d", "s", "b"]);
  });

  it("stops at the most Tavora takes", () => {
    const many = list(...Array.from({ length: 80 }, (_, index) => newItem("counter", `c${index}`, `C${index}`)));
    expect(buildSources(many, measure, name, NOW)).toHaveLength(64);
  });
});

describe("itemSize", () => {
  it("is as wide as the name and the value side by side, with the gap between them", () => {
    const counter = newItem("counter", "c", "Deaths") as Counter;
    counter.value = 10;
    counter.goal = 50;
    // "10 / 50" at 48 px, "Deaths" at half that, and 0.4 of the value's size between them.
    expect(itemSize(counter, measure, NOW).width).toBe(Math.ceil(7 * 48 * 0.5 + 6 * 24 * 0.5 + 48 * 0.4));
    counter.look.showLabel = false;
    expect(itemSize(counter, measure, NOW).width).toBe(Math.ceil(7 * 48 * 0.5));
  });

  it("makes room for the whole time of a countdown that has not run, and the last lap under a stopwatch", () => {
    const boss = newItem("countdown", "b", "Boss") as Clock;
    boss.look.showLabel = false;
    boss.duration = 90 * 60_000;
    boss.format = "h:mm:ss";
    expect(itemSize(boss, measure, NOW).width).toBe(Math.ceil("1:30:00".length * 48 * 0.5));
    const run = newItem("stopwatch", "r", "Run") as Clock;
    run.laps = true;
    run.showLastLap = true;
    run.lapTimes = [65_000];
    startPause(run, NOW - 10_000);
    expect(itemSize(run, measure, NOW).height).toBe(Math.ceil(48 * 1.05 * 1.32));
  });
});

describe("overlayKey and itemForKey", () => {
  it("name the overlay an item belongs to, and find the item for a key", () => {
    const whole = linked(true);
    const deaths = whole.items[0]!;
    const key = overlayKey(whole, deaths);
    expect(key).not.toBe("d");
    expect(overlayKey(whole, whole.items[1]!)).toBe(key);
    expect(itemForKey(whole, key)?.id).toBe("d");
    expect(itemForKey(whole, "b")?.id).toBe("b");
    expect(itemForKey(whole, "nope")).toBeUndefined();
    expect(overlayKey(linked(false), linked(false).items[0]!)).toBe("d");
  });
});
