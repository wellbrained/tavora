import { describe, expect, it } from "vitest";
import { monthKey, monthStart, RECORD_MS, sanitizeMonths, TRAFFIC_FRESH_MS, TrafficBook, weekStart, type StoredMonth, type TrafficRange } from "./traffic";

/** Local times, so the tests hold in any time zone. */
const at = (year: number, month: number, day: number, hour = 0) => new Date(year, month - 1, day, hour).getTime();
const NOW = at(2026, 10, 26, 18); // a Monday

function book(options: { stored?: StoredMonth[]; now?: () => number; answer?: (range: TrafficRange) => { downBytes: number; upBytes: number } | null } = {}) {
  const asked: TrafficRange[][] = [];
  const saved: StoredMonth[][] = [];
  let loads = 0;
  const traffic = new TrafficBook({
    now: options.now ?? (() => NOW),
    read: async (ranges) => {
      asked.push(ranges);
      return ranges.map(options.answer ?? (() => ({ downBytes: 100, upBytes: 10 })));
    },
    store: {
      load: async () => (loads++, options.stored ?? []),
      save: (months) => void saved.push(months),
    },
  });
  return { traffic, asked, saved, loads: () => loads };
}

describe("periods", () => {
  it("starts the week on Monday and the month on the 1st, local time", () => {
    expect(weekStart(NOW)).toBe(at(2026, 10, 26));
    expect(weekStart(at(2026, 11, 1, 12))).toBe(at(2026, 10, 26)); // a Sunday
    expect(monthStart(NOW)).toBe(at(2026, 10, 1));
    expect(monthStart(NOW, 3)).toBe(at(2026, 7, 1));
    expect(monthStart(at(2026, 2, 10), 3)).toBe(at(2025, 11, 1));
    expect(monthKey(at(2026, 9, 30, 23))).toBe("2026-09");
  });
});

describe("TrafficBook", () => {
  it("asks Windows for the week, this month and the months it still has, from where its record starts", async () => {
    const { traffic, asked } = book();
    const read = await traffic.read();
    const recordStart = NOW - RECORD_MS;
    expect(asked).toEqual([
      [
        { from: at(2026, 10, 26), to: NOW },
        { from: at(2026, 10, 1), to: NOW },
        { from: at(2026, 9, 1), to: at(2026, 10, 1) },
        { from: recordStart, to: at(2026, 9, 1) },
      ],
    ]);
    expect(read.week).toEqual({ start: at(2026, 10, 26), end: NOW, downBytes: 100, upBytes: 10, countedFrom: at(2026, 10, 26) });
    expect(read.months.map((month) => month.start)).toEqual([at(2026, 10, 1), at(2026, 9, 1), at(2026, 8, 1), at(2026, 7, 1)]);
    // August is counted only from where Windows' record begins; July is gone from it.
    expect(read.months[2]).toMatchObject({ end: at(2026, 9, 1), countedFrom: recordStart, downBytes: 100 });
    expect(read.months[3]).toEqual({ start: at(2026, 7, 1), end: at(2026, 8, 1), downBytes: null, upBytes: null, countedFrom: null });
  });

  it("keeps the months that are over, and asks Windows only for the rest next time", async () => {
    let now = NOW;
    const { traffic, asked, saved } = book({ now: () => now });
    await traffic.read();
    expect(saved.at(-1)!.map((month) => month.month)).toEqual(["2026-09", "2026-08", "2026-07"]);
    now += TRAFFIC_FRESH_MS;
    await traffic.read();
    expect(asked[1]).toEqual([
      { from: at(2026, 10, 26), to: now },
      { from: at(2026, 10, 1), to: now },
    ]);
  });

  it("uses the kept months, also once Windows no longer has them", async () => {
    const stored: StoredMonth[] = [
      { month: "2026-09", downBytes: 9e11, upBytes: 9e9, countedFrom: at(2026, 9, 1) },
      { month: "2026-08", downBytes: 8e11, upBytes: 8e9, countedFrom: at(2026, 8, 1) },
      { month: "2026-07", downBytes: 7e11, upBytes: 7e9, countedFrom: at(2026, 7, 1) },
    ];
    const { traffic, asked, saved } = book({ stored });
    const read = await traffic.read();
    expect(asked[0]).toHaveLength(2);
    expect(read.months.slice(1).map((month) => month.downBytes)).toEqual([9e11, 8e11, 7e11]);
    expect(saved).toEqual([]);
  });

  it("asks again for a month that just ended, until Windows has written its last hours", async () => {
    const { traffic, asked, saved } = book({ now: () => at(2026, 11, 1, 6) });
    await traffic.read();
    expect(asked[0]).toContainEqual({ from: at(2026, 10, 1), to: at(2026, 11, 1) });
    expect(saved[0]!.map((month) => month.month)).not.toContain("2026-10");
  });

  it("doesn't keep a month Windows still has but didn't answer for", async () => {
    const { traffic, saved } = book({ answer: (range) => (range.from === at(2026, 9, 1) ? null : { downBytes: 1, upBytes: 1 }) });
    const read = await traffic.read();
    expect(read.months[1]).toMatchObject({ downBytes: null, countedFrom: null });
    expect(saved[0]!.map((month) => month.month)).toEqual(["2026-08", "2026-07"]);
  });

  it("answers from the last read for 5 minutes, and asks once for callers at the same time", async () => {
    let now = NOW;
    const { traffic, asked, loads } = book({ now: () => now });
    await Promise.all([traffic.read(), traffic.read()]);
    expect(asked).toHaveLength(1);
    now += TRAFFIC_FRESH_MS - 1;
    await traffic.read();
    expect(asked).toHaveLength(1);
    now += 1;
    await traffic.read();
    expect(asked).toHaveLength(2);
    expect(loads()).toBe(1);
  });

  it("passes a failed read on and tries again next time", async () => {
    let fail = true;
    const traffic = new TrafficBook({
      now: () => NOW,
      read: async (ranges) => {
        if (fail) throw new Error("Windows took too long to answer");
        return ranges.map(() => ({ downBytes: 1, upBytes: 1 }));
      },
      store: { load: async () => [], save: () => undefined },
    });
    await expect(traffic.read()).rejects.toThrow("too long");
    fail = false;
    await expect(traffic.read()).resolves.toMatchObject({ week: { downBytes: 1 } });
  });
});

describe("sanitizeMonths", () => {
  it("keeps only well-formed months", () => {
    expect(
      sanitizeMonths({
        months: [
          { month: "2026-09", downBytes: 1, upBytes: 2, countedFrom: 3 },
          { month: "2026-08", downBytes: null, upBytes: null, countedFrom: null },
          { month: "2026-07", downBytes: -1, upBytes: 2, countedFrom: 3 },
          { month: "July", downBytes: 1, upBytes: 2, countedFrom: 3 },
          null,
        ],
      }),
    ).toEqual([
      { month: "2026-09", downBytes: 1, upBytes: 2, countedFrom: 3 },
      { month: "2026-08", downBytes: null, upBytes: null, countedFrom: null },
      { month: "2026-07", downBytes: null, upBytes: null, countedFrom: null },
    ]);
    expect(sanitizeMonths(null)).toEqual([]);
    expect(sanitizeMonths({ months: "x" })).toEqual([]);
  });
});
