import { describe, expect, it } from "vitest";
import type { Layer } from "@tavora/official-ui/lib/layers";
import { CLOSING_HOLD_MS, dialogsHolding, isPlaced, panelsUnder, POPUP_MARGIN } from "./overlay-area";

const panels = [
  { instanceId: "left", x: 0, y: 40, width: 400, height: 600 },
  { instanceId: "right", x: 408, y: 40, width: 400, height: 600 },
];

describe("panelsUnder", () => {
  it("names only the panels a popup lies over", () => {
    expect(panelsUnder({ x: 100, y: 100, width: 200, height: 200 }, panels)).toEqual(["left"]);
    expect(panelsUnder({ x: 300, y: 100, width: 200, height: 200 }, panels)).toEqual(["left", "right"]);
  });

  it("counts the popup's shadow, and leaves a popup over the header alone", () => {
    // A hint below a header button, ending just above the panels.
    expect(panelsUnder({ x: 100, y: 0, width: 80, height: 40 - POPUP_MARGIN - 1 }, panels)).toEqual([]);
    expect(panelsUnder({ x: 100, y: 0, width: 80, height: 40 - POPUP_MARGIN + 1 }, panels)).toEqual(["left"]);
  });
});

describe("isPlaced", () => {
  const viewport = { width: 1000, height: 800 };
  it("waits for a popup that is hidden, has no size or still waits above the window", () => {
    expect(isPlaced({ x: 10, y: 10, width: 100, height: 50 }, false, viewport)).toBe(true);
    expect(isPlaced({ x: 10, y: 10, width: 100, height: 50 }, true, viewport)).toBe(false);
    expect(isPlaced({ x: 10, y: 10, width: 0, height: 50 }, false, viewport)).toBe(false);
    expect(isPlaced({ x: 10, y: -500, width: 100, height: 50 }, false, viewport)).toBe(false);
  });
});

describe("dialogsHolding", () => {
  const layer = (id: number, state: Layer["state"], kind: Layer["kind"] = "dialog"): Layer => ({ id, kind, state, modal: true, element: null, name: undefined });

  it("counts open dialogs and closing ones until their fade is over, never menus", () => {
    const since = new Map<number, number>();
    expect(dialogsHolding([layer(1, "open"), layer(2, "open", "menu")], since, 0)).toEqual({ count: 1, recheckIn: null });
    expect(dialogsHolding([layer(1, "closing")], since, 1000)).toEqual({ count: 1, recheckIn: CLOSING_HOLD_MS });
    expect(dialogsHolding([layer(1, "closing")], since, 1100)).toEqual({ count: 1, recheckIn: CLOSING_HOLD_MS - 100 });
    // Kept on the page while closed: it lets go all the same.
    expect(dialogsHolding([layer(1, "closing")], since, 1000 + CLOSING_HOLD_MS)).toEqual({ count: 0, recheckIn: null });
  });

  it("starts over for a dialog that opens again and closes once more", () => {
    const since = new Map<number, number>();
    dialogsHolding([layer(1, "closing")], since, 0);
    dialogsHolding([layer(1, "open")], since, 50);
    expect(since.size).toBe(0);
    expect(dialogsHolding([layer(1, "closing")], since, 5000)).toEqual({ count: 1, recheckIn: CLOSING_HOLD_MS });
    dialogsHolding([], since, 5100);
    expect(since.size).toBe(0);
  });
});
