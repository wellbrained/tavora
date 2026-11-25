import { createMemoryHost } from "@tavora/sdk/testing";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, saveSettings, SETTINGS_KEY } from "./settings";

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

describe("saveSettings", () => {
  it("saves only what changed, so another workspace's choice and a newer version's value stay", async () => {
    const { sdk } = createMemoryHost();
    // This panel read the defaults; since then a panel in another workspace picked 2 decimals, and a newer version a mode it has.
    await sdk.storage.app.set(SETTINGS_KEY, { mode: "scientific", decimals: 2 });
    const stored = await saveSettings(sdk, { history: false });
    expect(await sdk.storage.app.get(SETTINGS_KEY)).toEqual({ mode: "scientific", decimals: 2, history: false });
    expect(stored).toMatchObject({ mode: "plus", decimals: 2, history: false });
  });
});
