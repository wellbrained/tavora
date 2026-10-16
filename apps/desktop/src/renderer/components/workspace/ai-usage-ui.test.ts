import { describe, expect, it } from "vitest";
import { translate } from "../../../shared/i18n";
import { barTone, durationWording, leftPercent, windowLabel } from "./ai-usage-ui";

const en = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("en", key, params);

describe("AI usage wording", () => {
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
      return en(key, params);
    };
    expect(text(30_000)).toBe("<1m");
    expect(text(12 * 60_000)).toBe("12m");
    expect(text((4 * 60 + 5) * 60_000)).toBe("4h 5m");
    expect(text((2 * 24 + 3) * 3_600_000)).toBe("2d 3h");
    expect(text(-5)).toBe("<1m");
  });

  it("names windows, with the model when there is one, and in German too", () => {
    const de = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("de", key, params);
    expect(windowLabel({ kind: "five-hour", name: null, usedPercent: 1, resetsAt: null }, en)).toBe("5-hour");
    expect(windowLabel({ kind: "weekly", name: "Sonnet", usedPercent: 1, resetsAt: null }, en)).toBe("Weekly · Sonnet");
    expect(windowLabel({ kind: "other", name: "3-day", usedPercent: 1, resetsAt: null }, en)).toBe("3-day");
    expect(windowLabel({ kind: "weekly", name: null, usedPercent: 1, resetsAt: null }, de)).toBe("Woche");
  });
});
