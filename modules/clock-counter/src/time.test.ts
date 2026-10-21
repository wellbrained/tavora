import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT, formatSeconds, isFormat } from "./time";

const t = (h: number, m: number, s: number) => h * 3600 + m * 60 + s;

describe("formatSeconds", () => {
  it.each([
    ["m:ss", t(0, 4, 5), "4:05"],
    ["m:ss", t(1, 15, 12), "75:12"],
    ["h:mm:ss", t(1, 15, 12), "1:15:12"],
    ["hh:mm:ss", t(1, 2, 3), "01:02:03"],
    ["mm:ss", t(0, 0, 9), "00:09"],
    ["s", t(0, 2, 5), "125"],
    ["h:mm", t(2, 5, 59), "2:05"],
    ['m "min"', t(0, 12, 30), "12 min"],
    ['"Boss in" m:ss', t(0, 1, 2), "Boss in 1:02"],
    ["h:ss", t(1, 2, 3), "1:123"],
    ["sss", 7, "007"],
  ])("%s shows %i seconds as %s", (pattern, seconds, text) => {
    expect(formatSeconds(seconds, pattern)).toBe(text);
  });

  it("never shows less than 0 or parts of a second", () => {
    expect(formatSeconds(-5, "m:ss")).toBe("0:00");
    expect(formatSeconds(59.9, "m:ss")).toBe("0:59");
  });

  it("falls back to the default for a pattern without any time", () => {
    expect(formatSeconds(65, "abc")).toBe(formatSeconds(65, DEFAULT_FORMAT));
  });
});

describe("isFormat", () => {
  it.each(["m:ss", "h", '"x" s'])("takes %s", (pattern) => expect(isFormat(pattern)).toBe(true));
  it.each(["", "abc", '"m:ss"', "x".repeat(41), 5])("refuses %j", (pattern) => expect(isFormat(pattern)).toBe(false));
});
