import { describe, expect, it } from "vitest";
import { CLASSIC_STYLE } from "@tavora/sdk/protocol";
import { panelCorners } from "./panel-corners";
import { PANEL_STYLES } from "./library";
import { COVER_RADIUS } from "./panel-cover";

const other = { id: "tavora.hardware" };

describe("panelCorners", () => {
  it("in Classic gives today's corners for every panel style, whatever the radius", () => {
    for (const panelStyle of PANEL_STYLES) {
      for (const radius of [0, 4, 8, 16]) {
        // The view inside a 10 px card with a 1 px border (Classic), or at --panel-body-radius 9 (Framed, Folders).
        expect(panelCorners(CLASSIC_STYLE, panelStyle, radius), `${panelStyle} ${radius}`).toEqual({ module: 9, page: 9, cover: COVER_RADIUS });
      }
    }
  });

  it("in other styles follows the radius in use for the module, the page and the cover", () => {
    expect(panelCorners(other, "framed", 4)).toEqual({ module: 4, page: 4, cover: 4 });
    expect(panelCorners(other, "classic", 12)).toEqual({ module: 12, page: 12, cover: 12 });
    expect(panelCorners(other, "folders", 16)).toEqual({ module: 16, page: 16, cover: 16 });
  });

  it("allows square corners, and never a negative or broken one", () => {
    expect(panelCorners(other, "classic", 0)).toEqual({ module: 0, page: 0, cover: 0 });
    expect(panelCorners(other, "classic", -3)).toEqual({ module: 0, page: 0, cover: 0 });
    expect(panelCorners(other, "classic", Number.NaN)).toEqual({ module: 0, page: 0, cover: 0 });
    expect(panelCorners(other, "classic", 6.4)).toEqual({ module: 6, page: 6, cover: 6 });
  });

  it("ignores the saved panel style outside Classic (the dock draws Framed's frame there)", () => {
    const all = PANEL_STYLES.map((panelStyle) => panelCorners(other, panelStyle, 7));
    expect(new Set(all.map((corners) => JSON.stringify(corners))).size).toBe(1);
  });
});
