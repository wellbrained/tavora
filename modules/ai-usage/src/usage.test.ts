import { describe, expect, it } from "vitest";
import { en } from "./locales";
import {
  barTone,
  durationWording,
  leftPercent,
  moved,
  nextWait,
  ordered,
  parseClaudeWindows,
  parseCodexResets,
  parseCodexWindows,
  parseOrder,
  parseReadings,
  parseSettings,
  windowLabel,
} from "./usage";

/** English texts, filled in like the module's translator does. */
const t = (key: keyof typeof en, params?: Record<string, string | number>) => en[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match));

describe("parseClaudeWindows", () => {
  it("reads the self-describing limits, keeping model scopes and inactive windows", () => {
    const windows = parseClaudeWindows({
      limits: [
        { kind: "session", percent: 12.5, resets_at: "2026-10-16T15:00:00Z", is_active: true },
        { kind: "weekly_all", percent: 40, resets_at: "2026-10-20T00:00:00Z", is_active: false },
        { kind: "weekly_scoped", percent: 70, resets_at: null, scope: { model: { display_name: "Sonnet" } } },
        { kind: "something_new", percent: 5 },
        { kind: "session", percent: 140 },
      ],
    });
    expect(windows).toEqual([
      { kind: "five-hour", name: null, usedPercent: 12.5, resetsAt: Date.parse("2026-10-16T15:00:00Z") },
      { kind: "weekly", name: null, usedPercent: 40, resetsAt: Date.parse("2026-10-20T00:00:00Z") },
      { kind: "weekly", name: "Sonnet", usedPercent: 70, resetsAt: null },
      { kind: "other", name: "something_new", usedPercent: 5, resetsAt: null },
    ]);
  });

  it("falls back to the older flat fields", () => {
    const windows = parseClaudeWindows({ five_hour: { utilization: 10, resets_at: "2026-10-16T15:00:00Z" }, seven_day: { utilization: 20 }, seven_day_opus: { utilization: 30 } });
    expect(windows.map((w) => [w.kind, w.name, w.usedPercent])).toEqual([
      ["five-hour", null, 10],
      ["weekly", null, 20],
      ["weekly", "Opus", 30],
    ]);
  });

  it("returns nothing for answers it does not understand, never zeros", () => {
    for (const answer of [null, "x", 5, [], {}, { limits: [] }, { limits: [{ kind: "session" }] }, { five_hour: { utilization: "10" } }]) {
      expect(parseClaudeWindows(answer)).toEqual([]);
    }
  });

  it("cleans names from the provider", () => {
    const [window] = parseClaudeWindows({ limits: [{ kind: "weekly_scoped", percent: 1, scope: { model: { display_name: `Son\u0007net${"x".repeat(100)}` } } }] });
    expect(window?.name).toBe(`Sonnet${"x".repeat(34)}`);
  });
});

describe("parseCodexWindows", () => {
  it("names windows by their length and keeps extra limits' own names", () => {
    const windows = parseCodexWindows({
      rateLimitsByLimitId: {
        codex: { limitName: null, primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_760_000_000 }, secondary: { usedPercent: 50, windowDurationMins: 10_080, resetsAt: 1_760_500_000 } },
        spark: { limitName: "GPT-Spark", primary: { usedPercent: 1, windowDurationMins: 4320 } },
      },
    });
    expect(windows).toEqual([
      { kind: "five-hour", name: null, usedPercent: 25, resetsAt: 1_760_000_000_000 },
      { kind: "weekly", name: null, usedPercent: 50, resetsAt: 1_760_500_000_000 },
      { kind: "other", name: "3-day · GPT-Spark", usedPercent: 1, resetsAt: null },
    ]);
  });

  it("uses the single older bucket when there is no list", () => {
    expect(parseCodexWindows({ rateLimits: { primary: { usedPercent: 9, windowDurationMins: 300 } } })).toEqual([{ kind: "five-hour", name: null, usedPercent: 9, resetsAt: null }]);
  });

  it("ignores broken windows and impossible reset times", () => {
    const windows = parseCodexWindows({ rateLimits: { primary: { usedPercent: "9" }, secondary: { usedPercent: 3, windowDurationMins: 90, resetsAt: 9e15 } } });
    expect(windows).toEqual([{ kind: "other", name: "90-minute", usedPercent: 3, resetsAt: null }]);
  });
});

describe("parseCodexResets", () => {
  it("reads how many resets Codex offers and when the first expires", () => {
    expect(
      parseCodexResets({
        rateLimitResetCredits: {
          availableCount: 2,
          credits: [
            { status: "available", expiresAt: 1_760_900_000 },
            { status: "available", expiresAt: 1_760_800_000 },
            { status: "used", expiresAt: 1_700_000_000 },
            { status: "available", expiresAt: "soon" },
          ],
        },
      }),
    ).toEqual({ available: 2, earliestExpiry: 1_760_800_000_000 });
  });

  it("keeps an explicit zero but treats anything unclear as unknown", () => {
    expect(parseCodexResets({ rateLimitResetCredits: { availableCount: 0 } })).toEqual({ available: 0, earliestExpiry: null });
    for (const answer of [null, {}, { rateLimitResetCredits: null }, { rateLimitResetCredits: { availableCount: -1 } }, { rateLimitResetCredits: { availableCount: "2" } }, { rateLimitResetCredits: { availableCount: 1.5 } }]) {
      expect(parseCodexResets(answer)).toBeNull();
    }
  });
});

describe("saved settings", () => {
  it("default and clamp odd settings", () => {
    expect(parseSettings(null)).toEqual({ refreshMinutes: 5, style: "remaining" });
    expect(parseSettings({ refreshMinutes: 15, style: "used" })).toEqual({ refreshMinutes: 15, style: "used" });
    expect(parseSettings({ refreshMinutes: 500, style: "weird" })).toEqual({ refreshMinutes: 60, style: "remaining" });
    expect(parseSettings({ refreshMinutes: 2.5 })).toEqual({ refreshMinutes: 5, style: "remaining" });
  });

  it("keep only well-formed readings, also those Tavora's built-in panel left", () => {
    const readings = parseReadings({
      a: { fetchedAt: 1, windows: [{ kind: "weekly", name: null, usedPercent: 20, resetsAt: null }, { kind: "nope" }, { kind: "weekly", name: null, usedPercent: 120, resetsAt: null }] },
      b: { fetchedAt: "yesterday", windows: [] },
      c: "x",
    });
    expect(readings).toEqual({ a: { fetchedAt: 1, windows: [{ kind: "weekly", name: null, usedPercent: 20, resetsAt: null }] } });
    expect(parseReadings(null)).toEqual({});
  });

  it("keep each account once in the order", () => {
    expect(parseOrder(["a", "b", "a", 7, "x".repeat(65)])).toEqual(["a", "b"]);
    expect(parseOrder("a")).toEqual([]);
  });
});

describe("order", () => {
  const accounts = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("puts accounts in the player's order, new ones at the end in Tavora's order", () => {
    expect(ordered(accounts, ["c", "a"]).map((a) => a.id)).toEqual(["c", "a", "b"]);
    expect(ordered(accounts, ["gone", "b"]).map((a) => a.id)).toEqual(["b", "a", "c"]);
    expect(ordered(accounts, []).map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("moves one account up or down, not past either end", () => {
    expect(moved(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moved(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moved(["a", "b"], "x", 1)).toEqual(["a", "b"]);
  });
});

describe("schedule", () => {
  it("waits the interval, doubling after each failure up to a day, and at least what the provider asked", () => {
    expect(nextWait(5, 0, null)).toBe(5 * 60_000);
    expect(nextWait(5, 1, null)).toBe(10 * 60_000);
    expect(nextWait(60, 6, null)).toBe(24 * 3_600_000);
    expect(nextWait(60, 60, null)).toBe(24 * 3_600_000);
    expect(nextWait(5, 1, 30 * 60_000)).toBe(30 * 60_000);
  });
});

describe("wording", () => {
  it("shows what is left, rounded and kept between 0 and 100", () => {
    expect(leftPercent({ usedPercent: 12.4 })).toBe(88);
    expect(leftPercent({ usedPercent: 100 })).toBe(0);
    expect(leftPercent({ usedPercent: 0 })).toBe(100);
  });

  it("changes the bar's tone as the allowance runs low", () => {
    expect(barTone(80)).toBe("ok");
    expect(barTone(30)).toBe("low");
    expect(barTone(10)).toBe("empty");
  });

  it("words a time span with its two largest units", () => {
    const text = (ms: number) => {
      const { key, params } = durationWording(ms);
      return t(key, params);
    };
    expect(text(30_000)).toBe("<1m");
    expect(text(12 * 60_000)).toBe("12m");
    expect(text((4 * 60 + 5) * 60_000)).toBe("4h 5m");
    expect(text((2 * 24 + 3) * 3_600_000)).toBe("2d 3h");
    expect(text(-5)).toBe("<1m");
  });

  it("names windows, with the model when there is one", () => {
    expect(windowLabel({ kind: "five-hour", name: null, usedPercent: 1, resetsAt: null }, t)).toBe("5-hour");
    expect(windowLabel({ kind: "weekly", name: "Sonnet", usedPercent: 1, resetsAt: null }, t)).toBe("Weekly · Sonnet");
    expect(windowLabel({ kind: "other", name: "3-day", usedPercent: 1, resetsAt: null }, t)).toBe("3-day");
  });
});
