import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_THEME_FONT } from "@tavora/sdk/protocol";
import { describe, expect, it } from "vitest";
import { fontStylesheet } from "./module-fonts";
import { FONT_RANGES, fontFamily, isFontId, themeFont, UI_FONTS, uiFont } from "../shared/ui-fonts";

const appFonts = readFileSync(path.join(__dirname, "..", "renderer", "fonts.css"), "utf8");
const kitFonts = readFileSync(path.join(__dirname, "..", "..", "..", "..", "modules", "shared", "src", "fonts.css"), "utf8");
/** Every unicode-range a stylesheet declares. */
const rangesIn = (css: string) => [...css.matchAll(/unicode-range:\s*([^;]+);/g)].map((match) => match[1]!.trim());

describe("the interface fonts", () => {
  it("start with Inter, which is what a theme without a font means", () => {
    expect(UI_FONTS[0].id).toBe("inter");
    expect(themeFont("inter")).toEqual(DEFAULT_THEME_FONT);
  });

  it("show Inter for an id this Tavora doesn't know, or none", () => {
    expect(uiFont("gone").id).toBe("inter");
    expect(uiFont(null).id).toBe("inter");
    expect(themeFont("allo")).toEqual({ id: "allo", family: '"Tavora Allo", system-ui, sans-serif' });
  });

  it("take only short lower-case ids", () => {
    expect(UI_FONTS.every((font) => isFontId(font.id))).toBe(true);
    for (const bad of ["", "Allo", "../x", "a b", "x".repeat(41), 3, null]) expect(isFontId(bad), String(bad)).toBe(false);
  });

  it("each have both files in the app page under the same name, weights and size", () => {
    for (const font of UI_FONTS.slice(1)) {
      const faces = appFonts.split("@font-face").filter((face) => face.includes(`font-family: '${font.face}';`));
      expect(faces, font.id).toHaveLength(2);
      for (const face of faces) {
        expect(face, font.id).toContain(`font-weight: ${font.weight};`);
        if (font.sizeAdjust === 100) expect(face, font.id).not.toContain("size-adjust");
        else expect(face, font.id).toContain(`size-adjust: ${font.sizeAdjust}%;`);
      }
    }
  });

  it("cut every file of every font the same way in the app page, the kit's Inter and the module pages", () => {
    const allowed = new Set<string>(Object.values(FONT_RANGES));
    for (const [name, css] of [["renderer/fonts.css", appFonts], ["modules/shared/src/fonts.css", kitFonts]] as const) {
      const ranges = rangesIn(css);
      expect(ranges.length, name).toBeGreaterThan(0);
      for (const range of ranges) expect(allowed.has(range), `${name}: ${range}`).toBe(true);
    }
    for (const font of UI_FONTS) for (const range of rangesIn(fontStylesheet(themeFont(font.id)))) expect(allowed.has(range), font.id).toBe(true);
  });

  it("each give module pages their own files under the same name and size", () => {
    for (const font of UI_FONTS) {
      const css = fontStylesheet(themeFont(font.id));
      expect(css.match(/@font-face/g), font.id).toHaveLength(2);
      expect(css, font.id).toContain(`font-family: "${font.face}";`);
      expect(css, font.id).toContain(`:root { --tavora-font-sans: ${fontFamily(font)}; }`);
      if (font.sizeAdjust !== 100) expect(css, font.id).toContain(`size-adjust: ${font.sizeAdjust}%;`);
      expect(css.match(/url\(data:font\/woff2;base64,/g), font.id).toHaveLength(2);
    }
  });
});
