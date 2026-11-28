import { describe, expect, it } from "vitest";
import { DailyOnce } from "./daily-once.ts";

describe("DailyOnce", () => {
  it("says yes once per key a UTC day and forgets every key when the day changes", () => {
    let now = Date.parse("2026-11-28T10:00:00Z");
    const once = new DailyOnce(() => now);
    expect(once.first("a")).toBe(true);
    expect(once.first("a")).toBe(false);
    expect(once.first("b")).toBe(true);
    now = Date.parse("2026-11-28T23:59:59Z");
    expect(once.first("a")).toBe(false);
    now = Date.parse("2026-11-29T00:00:00Z");
    expect(once.first("a")).toBe(true);
    expect(once.first("a")).toBe(false);
  });

  it("forgets its oldest mark once full, so a flood can't grow memory or stop others from counting", () => {
    const now = Date.parse("2026-11-28T10:00:00Z");
    const once = new DailyOnce(() => now, 2);
    expect(once.first("a")).toBe(true);
    expect(once.first("b")).toBe(true);
    expect(once.first("c")).toBe(true);
    expect(once.first("b")).toBe(false);
    expect(once.first("c")).toBe(false);
    expect(once.first("a")).toBe(true);
  });
});
