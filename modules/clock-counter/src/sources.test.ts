import { describe, expect, it } from "vitest";
import { insert, newItem, setStream, startPause, type Clock, type Counter, type ItemList } from "./items";
import { buildSources, itemForKey, itemSize, LOOK_AHEAD_MS, nextSizeChange, overlayKey, VALUE_PX, type Measure } from "./sources";

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
  it("is as wide as the words and the value side by side", () => {
    const counter = newItem("counter", "c", "Deaths") as Counter;
    counter.value = 10;
    counter.goal = 50;
    // "Deaths " and "10 / 50" both at M, 48 px.
    expect(itemSize(counter, measure, NOW).width).toBe(Math.ceil(7 * 48 * 0.5 + 7 * 48 * 0.5));
    counter.look.showLabel = false;
    expect(itemSize(counter, measure, NOW).width).toBe(Math.ceil(7 * 48 * 0.5));
  });

  it("follows the text written for the overlay and the sizes of the words and the number", () => {
    const boss = newItem("countdown", "b", "Boss") as Clock;
    boss.look.text = "{time} left";
    // "5:00" and " left" both at M, 48 px.
    const xs = (48 * 12) / 14;
    expect(itemSize(boss, measure, NOW).width).toBe(Math.ceil(4 * 48 * 0.5 + 5 * 48 * 0.5));
    boss.look.wordsStep = "xl";
    boss.look.numberStep = "xs";
    const xl = (48 * 20) / 14;
    expect(itemSize(boss, measure, NOW)).toEqual({ width: Math.ceil(4 * xs * 0.5 + 5 * xl * 0.5), height: Math.ceil(xl * 1.05) });
    boss.look.text = "";
    expect(itemSize(boss, measure, NOW).height).toBe(Math.ceil(xs * 1.05));
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

describe("sources of a text that grows with its frame", () => {
  it("say so, with the alignment, so Tavora keeps the frame around the text", () => {
    const boss = newItem("countdown", "b", "Boss");
    boss.look.align = "right";
    const fixed = newItem("counter", "c", "Deaths");
    fixed.look.textBox = { mode: "fixed", overflow: "scroll", speed: "normal", pause: 2, softEdges: true };
    const [grows, box] = buildSources(list(boss, fixed), measure, name, NOW);
    expect(grows).toMatchObject({ key: "b", fit: "text", align: "right" });
    // A fixed box keeps the size the user gave it.
    expect(box!.fit).toBeUndefined();
    expect(box!.align).toBeUndefined();
  });

  it("say so for a group shown as one line too", () => {
    const [group] = buildSources(linked(true), measure, name, NOW);
    expect(group).toMatchObject({ group: true, fit: "text", align: "center" });
  });

  it("grow with a bigger step: the size Tavora fits the frame to follows the step", () => {
    const deaths = newItem("counter", "c", "Deaths") as Counter;
    const at = (step: "s" | "xl") => {
      deaths.look = { ...deaths.look, wordsStep: step, numberStep: step };
      return itemSize(deaths, measure, NOW);
    };
    const small = at("s");
    const big = at("xl");
    expect(big.width / small.width).toBeCloseTo(20 / 13, 1);
    expect(big.height).toBeGreaterThan(small.height);
  });
});

describe("ticking text the frame has to follow", () => {
  it("lists a running stopwatch as wide as it is in a moment, so the frame is wider before the digit comes", () => {
    const run = newItem("stopwatch", "r", "Run") as Clock;
    run.since = NOW - 598_500; // 9:58.5
    const running = itemSize(run, measure, NOW);
    const stopped = itemSize({ ...run, since: null, counted: 598_500 }, measure, NOW);
    // "10:00" is a digit more than "9:58".
    expect(running.width).toBeGreaterThan(stopped.width);
  });

  it("wakes the panel up just before a running stopwatch gets a digit more, and not for one standing still", () => {
    const run = newItem("stopwatch", "r", "Run") as Clock;
    const since = NOW - 100_000;
    run.since = since;
    // m:ss: 1:40 now; 10:00 (600 s) is the next width, LOOK_AHEAD_MS before it.
    expect(nextSizeChange(list(run), NOW)).toBe(since + 600_000 - LOOK_AHEAD_MS);
    // Counted before it was started again: that counts too.
    const resumed = { ...run, counted: 50_000 };
    expect(nextSizeChange(list(resumed), NOW)).toBe(since + 600_000 - 50_000 - LOOK_AHEAD_MS);
    // Past 10:00, the next is 100:00 (the default m:ss has no hours).
    const later = { ...run, since: NOW - 700_000 };
    expect(nextSizeChange(list(later), NOW)).toBe(NOW - 700_000 + 6_000_000 - LOOK_AHEAD_MS);
    // With hours in the format: 1:00:00 after 59:59.
    const hours = { ...later, format: "h:mm:ss" };
    expect(nextSizeChange(list(hours), NOW)).toBe(NOW - 700_000 + 36_000_000 - LOOK_AHEAD_MS);
    expect(nextSizeChange(list({ ...run, since: null }), NOW)).toBeNull();
    expect(nextSizeChange(list(newItem("counter", "c", "Deaths")), NOW)).toBeNull();
  });

  it("lists a counter as wide as the value one step up or down, so 99 has the room 100 needs", () => {
    const deaths = newItem("counter", "c", "Deaths") as Counter;
    deaths.value = 99;
    const at99 = itemSize(deaths, measure, NOW);
    deaths.value = 100;
    expect(itemSize(deaths, measure, NOW).width).toBe(at99.width);
    // Never below 0 when it can't go there.
    deaths.value = 0;
    deaths.step = 10;
    expect(itemSize(deaths, measure, NOW).width).toBe(itemSize({ ...deaths, value: 10 }, measure, NOW).width);
  });
});
