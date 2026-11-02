import { describe, expect, it } from "vitest";
import { SETTINGS_DIALOG, SETTINGS_MENU_WIDTH, settingsDialogSize } from "./dialog-size";

describe("settingsDialogSize", () => {
  it("gives several pages the usual size", () => {
    expect(settingsDialogSize({ pages: 3 })).toEqual({ width: 960, height: 680 });
    expect(settingsDialogSize({ pages: 2, rows: 2 })).toEqual({ width: 960, height: 680 });
  });

  it("makes a single page narrower by the menu", () => {
    expect(settingsDialogSize({ pages: 1, rows: 6 }).width).toBe(SETTINGS_DIALOG.width - SETTINGS_MENU_WIDTH);
    expect(settingsDialogSize({ pages: 1 }).width).toBe(760);
  });

  it("keeps a single page at six rows or more, and grows with its rows up to the usual height", () => {
    const six = settingsDialogSize({ pages: 1, rows: 6 }).height;
    expect(settingsDialogSize({ pages: 1, rows: 2 }).height).toBe(six);
    expect(settingsDialogSize({ pages: 1, rows: 0 }).height).toBe(six);
    expect(settingsDialogSize({ pages: 1, rows: 8 }).height).toBeGreaterThan(six);
    expect(settingsDialogSize({ pages: 1, rows: 7 }).height).toBeLessThanOrEqual(680);
    expect(settingsDialogSize({ pages: 1, rows: 30 }).height).toBe(680);
    expect(settingsDialogSize({ pages: 1 }).height).toBe(680);
    expect(six).toBeLessThan(680);
  });

  it("asks for sizes Tavora accepts (whole numbers from 240 to 2000)", () => {
    for (const rows of [0, 1, 6, 7, 9, 40]) {
      const { width, height } = settingsDialogSize({ pages: 1, rows });
      for (const side of [width, height]) {
        expect(Number.isSafeInteger(side)).toBe(true);
        expect(side).toBeGreaterThanOrEqual(240);
        expect(side).toBeLessThanOrEqual(2000);
      }
    }
  });
});
