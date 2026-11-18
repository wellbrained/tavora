import { describe, expect, it } from "vitest";
import { CARD_ROOM, CARD_TOP_GAP, cardWindowRect, isLayerMode, layerCardContent } from "./layer-card";

describe("the layer card's content", () => {
  it("names Use and Arrange, Close and the layer key's caps, in English and German", () => {
    expect(layerCardContent("en", "use", "Ctrl+Shift+T")).toEqual({
      mode: "use",
      keys: ["Ctrl", "Shift", "T"],
      texts: {
        label: "Tavora over game",
        title: "Overlay",
        mode: "Use or arrange",
        use: "Use",
        useHint: "Click and type in your panels",
        arrange: "Arrange",
        arrangeHint: "Move and resize what you see",
        close: "Close",
        closeHint: "Close Tavora over game",
      },
    });
    const de = layerCardContent("de", "arrange", "Alt+num5");
    expect(de.mode).toBe("arrange");
    expect(de.keys).toEqual(["Alt", "Num 5"]);
    expect(de.texts).toMatchObject({ title: "Overlay", use: "Benutzen", arrange: "Anordnen", close: "Schließen" });
  });

  it("shows no key caps without a layer key", () => {
    expect(layerCardContent("en", "use", null).keys).toEqual([]);
  });

  it("takes only the two modes from the page", () => {
    expect(isLayerMode("use")).toBe(true);
    expect(isLayerMode("arrange")).toBe(true);
    for (const value of ["off", "", null, 1, { mode: "use" }]) expect(isLayerMode(value)).toBe(false);
  });
});

describe("cardWindowRect", () => {
  it("sits at the top centre of the area, with room for the shadow and the tooltips", () => {
    const area = { x: 100, y: 50, width: 1280, height: 720 };
    const rect = cardWindowRect(area, { width: 300.4, height: 40 });
    expect(rect).toEqual({ x: 100 + Math.round((1280 - (301 + 2 * CARD_ROOM.side)) / 2), y: 50 + CARD_TOP_GAP, width: 301 + 2 * CARD_ROOM.side, height: 40 + CARD_ROOM.top + CARD_ROOM.below });
  });

  it("stays inside a small area", () => {
    const area = { x: 0, y: 0, width: 200, height: 60 };
    const rect = cardWindowRect(area, { width: 400, height: 40 });
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(200);
    expect(rect.y + rect.height).toBeLessThanOrEqual(60);
  });
});

describe("where the card goes", () => {
  const area = { x: 0, y: 0, width: 2560, height: 1440 };
  const extent = { width: 300, height: 40 };
  it("sits at the top centre when nothing is there", () => {
    const rect = cardWindowRect(area, extent, [{ x: 0, y: 0, width: 600, height: 400 }]);
    expect(rect.x + rect.width / 2).toBeCloseTo(1280, -1);
  });
  it("moves along the top off an item at the top centre, and to the bottom when the top is full", () => {
    const middle = { x: 1000, y: 0, width: 560, height: 300 };
    const moved = cardWindowRect(area, extent, [middle]);
    expect(moved.y).toBeLessThan(100);
    expect(moved.x + 24 >= middle.x + middle.width || moved.x + 24 + extent.width <= middle.x).toBe(true);
    const bottom = cardWindowRect(area, extent, [{ x: 0, y: 0, width: 2560, height: 300 }]);
    expect(bottom.y).toBeGreaterThan(1000);
  });
});
