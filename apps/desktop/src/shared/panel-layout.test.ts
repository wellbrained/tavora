import type { LayoutSplit as PanelLayoutSplit } from "./panel-layout";
import { describe, expect, it } from "vitest";
import { fitSlots, fromManifest, keepSlots, mapSlots, openManySlots, slotPanels, slotRects, type Slots } from "./panel-layout";

// The Palworld example from the decision log: Map over Bosses on the left, Paldeck on the right.
const palworld = fromManifest({
  row: [
    { size: 50, column: [{ panel: "map", size: 60 }, { panel: "bosses", size: 40 }] },
    { size: 50, panel: "paldeck" },
  ],
});

describe("fromManifest", () => {
  it("reads rows, columns and sizes, counting a size left out as 1", () => {
    expect(palworld).toEqual({
      split: "row",
      parts: [
        { size: 50, slots: { split: "column", parts: [{ size: 60, slots: { panel: "map" } }, { size: 40, slots: { panel: "bosses" } }] } },
        { size: 50, slots: { panel: "paldeck" } },
      ],
    });
    expect(fromManifest({ column: [{ panel: "a" }, { panel: "b", size: 3 }] })).toEqual({
      split: "column",
      parts: [
        { size: 1, slots: { panel: "a" } },
        { size: 3, slots: { panel: "b" } },
      ],
    });
    expect(slotPanels(palworld)).toEqual(["map", "bosses", "paldeck"]);
  });
});

describe("keepSlots", () => {
  it("keeps the layout whole when every panel stays", () => {
    expect(keepSlots(palworld, () => true)).toEqual(palworld);
  });

  it("gives a leaving panel's room to its sibling and folds a split left with one part", () => {
    // Bosses is not asked for: Map takes the whole left column.
    expect(keepSlots(palworld, (panel) => panel !== "bosses")).toEqual({
      split: "row",
      parts: [
        { size: 50, slots: { panel: "map" } },
        { size: 50, slots: { panel: "paldeck" } },
      ],
    });
  });

  it("folds the whole layout to one slot, or to nothing", () => {
    expect(keepSlots(palworld, (panel) => panel === "paldeck")).toEqual({ panel: "paldeck" });
    expect(keepSlots(palworld, () => false)).toBeNull();
  });

  it("gives the room to the part before, or to the one after for the first", () => {
    const three: Slots = { split: "row", parts: [{ size: 1, slots: { panel: "a" } }, { size: 2, slots: { panel: "b" } }, { size: 3, slots: { panel: "c" } }] };
    expect(keepSlots(three, (panel) => panel !== "b")).toEqual({ split: "row", parts: [{ size: 3, slots: { panel: "a" } }, { size: 3, slots: { panel: "c" } }] });
    expect(keepSlots(three, (panel) => panel !== "a")).toEqual({ split: "row", parts: [{ size: 3, slots: { panel: "b" } }, { size: 3, slots: { panel: "c" } }] });
    expect(keepSlots(three, (panel) => panel !== "c")).toEqual({ split: "row", parts: [{ size: 1, slots: { panel: "a" } }, { size: 5, slots: { panel: "b" } }] });
  });

  it("joins a row left inside a row once the column between them folds away", () => {
    // row[a, column[row[b, c], d]] without d: the column folds and its row joins the outer one, sharing the column's room.
    const nested: Slots = {
      split: "row",
      parts: [
        { size: 2, slots: { panel: "a" } },
        { size: 2, slots: { split: "column", parts: [{ size: 1, slots: { split: "row", parts: [{ size: 1, slots: { panel: "b" } }, { size: 3, slots: { panel: "c" } }] } }, { size: 1, slots: { panel: "d" } }] } },
      ],
    };
    expect(keepSlots(nested, (panel) => panel !== "d")).toEqual({
      split: "row",
      parts: [
        { size: 2, slots: { panel: "a" } },
        { size: 0.5, slots: { panel: "b" } },
        { size: 1.5, slots: { panel: "c" } },
      ],
    });
  });
});

describe("mapSlots", () => {
  it("swaps each panel and drops the ones it has nothing for", () => {
    const ids: Record<string, string> = { map: "id-map", paldeck: "id-paldeck" };
    expect(mapSlots(palworld, (type) => ids[type])).toEqual({
      split: "row",
      parts: [
        { size: 50, slots: { panel: "id-map" } },
        { size: 50, slots: { panel: "id-paldeck" } },
      ],
    });
  });
});

describe("slotRects", () => {
  it("measures each slot against the area, along its split", () => {
    expect(slotRects(palworld, { x: 10, y: 20, width: 1000, height: 500 })).toEqual([
      { panel: "map", rect: { x: 10, y: 20, width: 500, height: 300 } },
      { panel: "bosses", rect: { x: 10, y: 320, width: 500, height: 200 } },
      { panel: "paldeck", rect: { x: 510, y: 20, width: 500, height: 500 } },
    ]);
  });
});

describe("fitSlots", () => {
  const roomy = () => true;

  it("leaves a layout that fits alone", () => {
    expect(fitSlots(palworld, "map", 1000, 600, roomy)).toEqual({ slots: palworld, tabs: [] });
  });

  it("opens a panel as a tab when its slot would be under its minimum, and its sibling takes the room", () => {
    // Bosses wants 250 px of height; its slot is 40 % of 500.
    const fits = (panel: string, _width: number, height: number) => panel !== "bosses" || height >= 250;
    expect(fitSlots(palworld, "paldeck", 1000, 500, fits)).toEqual({
      slots: { split: "row", parts: [{ size: 50, slots: { panel: "map" } }, { size: 50, slots: { panel: "paldeck" } }] },
      tabs: ["bosses"],
    });
  });

  it("gives up new slots, the last first, while the anchor's own slot is too small", () => {
    // Paldeck (the clicking panel) needs 700 px of width: it only gets them alone.
    const fits = (panel: string, width: number) => panel !== "paldeck" || width >= 700;
    expect(fitSlots(palworld, "paldeck", 1000, 500, fits)).toEqual({ slots: { panel: "paldeck" }, tabs: ["map", "bosses"] });
  });

  it("checks again after a panel left: the room it gave may be enough for the next", () => {
    // Map and Bosses each want 260 px of height. Bosses' 200 px fail; once it left, Map has the whole 500.
    const fits = (panel: string, _width: number, height: number) => panel === "paldeck" || height >= 260;
    expect(fitSlots(palworld, "paldeck", 1000, 500, fits).tabs).toEqual(["bosses"]);
  });

  it("checks the layout's own minimums at the group's size, so a narrow group stacks everything as tabs", () => {
    const fits = (_panel: string, width: number) => width >= 400;
    // Map gets 300 px and needs 400: Paldeck, laid out last, leaves. Bosses stays: Map and Bosses now share the full width.
    expect(fitSlots(palworld, "map", 600, 800, fits)).toEqual({
      slots: { split: "column", parts: [{ size: 60, slots: { panel: "map" } }, { size: 40, slots: { panel: "bosses" } }] },
      tabs: ["paldeck"],
    });
    expect(fitSlots(palworld, "map", 300, 800, fits)).toEqual({ slots: { panel: "map" }, tabs: ["bosses", "paldeck"] });
  });
});

describe("openManySlots", () => {
  const layout: PanelLayoutSplit = { row: [{ size: 50, column: [{ panel: "map", size: 60 }, { panel: "bosses", size: 40 }] }, { size: 50, panel: "paldeck" }] };

  it("keeps the asking panel and the new ones, by instance id", () => {
    expect(openManySlots(layout, "paldeck", "me", new Map([["map", "new-map"]]))).toEqual({
      split: "row",
      parts: [
        { size: 50, slots: { panel: "new-map" } },
        { size: 50, slots: { panel: "me" } },
      ],
    });
  });

  it("drops types that stay where they are or are not asked for, and their sibling takes the room", () => {
    // Bosses is open elsewhere already (not in `fresh`), Paldeck asks: Map takes the left column alone.
    const slots = openManySlots(layout, "paldeck", "me", new Map([["map", "new-map"]]));
    expect(slotPanels(slots!)).toEqual(["new-map", "me"]);
  });

  it("has nothing to lay out without a layout, with the asking type not in it, or with nothing new", () => {
    expect(openManySlots(undefined, "map", "me", new Map([["bosses", "b"]]))).toBeNull();
    expect(openManySlots(layout, "breeding", "me", new Map([["bosses", "b"]]))).toBeNull();
    expect(openManySlots(layout, undefined, "me", new Map([["bosses", "b"]]))).toBeNull();
    expect(openManySlots(layout, "map", "me", new Map())).toBeNull();
    // A new type the layout doesn't place leaves only the asking panel: nothing to lay out.
    expect(openManySlots(layout, "map", "me", new Map([["breeding", "b"]]))).toBeNull();
  });
});
