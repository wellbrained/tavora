import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("reads stored choices", () => {
    expect(parseSettings({ mode: "basic", history: false, historyLength: 50, decimals: 0, short: true })).toEqual({
      mode: "basic",
      history: false,
      historyLength: 50,
      decimals: 0,
      short: true,
    });
  });

  it("falls back to the defaults for missing or broken values", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ mode: "scientific", history: "yes", historyLength: 12, decimals: 7, short: 1 })).toEqual(DEFAULT_SETTINGS);
  });
});
