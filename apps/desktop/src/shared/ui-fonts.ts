// The interface fonts the user can pick (Settings > Appearance), in the order the list shows them. The host page loads
// their files from renderer/fonts.css; module pages and Tavora's own small windows get the picked one's files from
// main/module-fonts.ts. Both name each font after `face` and scale it by `sizeAdjust`, so its lowercase letters stand as
// tall as Inter's: text looks the same size in every font, and the 12 px minimum keeps its meaning.
// A saved id Tavora doesn't know (an older Tavora, or a font that was dropped) shows Inter and is kept.

export interface UiFont {
  id: string;
  /** The font's own name, the same in every language. */
  name: string;
  /** The @font-face name. Tavora's own (not the font's), so a module that bundles the same font keeps its own. */
  face: string;
  /** The @font-face size-adjust, in percent: Inter's x-height over this font's. */
  sizeAdjust: number;
  /** The weights its variable file has, as @font-face font-weight. */
  weight: string;
}

/**
 * The unicode ranges of each font's two files (Latin, Latin Extended), as Fontsource splits its fonts (scripts/subset-allo.mjs
 * cuts Allo the same way). The one list: main/module-fonts.ts uses it, and a test checks that renderer/fonts.css and
 * modules/shared/src/fonts.css (plain CSS, written out) say the same.
 */
export const FONT_RANGES = {
  latin: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  latinExt: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
} as const;

export const UI_FONTS = [
  { id: "inter", name: "Inter", face: "Inter Variable", sizeAdjust: 100, weight: "100 900" },
  { id: "allo", name: "Allo", face: "Tavora Allo", sizeAdjust: 100, weight: "100 900" },
  { id: "mona-sans", name: "Mona Sans", face: "Tavora Mona Sans", sizeAdjust: 105.6, weight: "200 900" },
  { id: "rubik", name: "Rubik", face: "Tavora Rubik", sizeAdjust: 105, weight: "300 900" },
  { id: "nunito", name: "Nunito", face: "Tavora Nunito", sizeAdjust: 112.8, weight: "200 1000" },
  { id: "saira", name: "Saira", face: "Tavora Saira", sizeAdjust: 107, weight: "100 900" },
  { id: "atkinson", name: "Atkinson Hyperlegible Next", face: "Tavora Atkinson Hyperlegible Next", sizeAdjust: 110.1, weight: "200 800" },
  // The Hardware style's font for everything (its own face here; the kit keeps its separate mono face for code).
  { id: "jetbrains-mono", name: "JetBrains Mono", face: "Tavora JetBrains Mono", sizeAdjust: 100, weight: "100 800" },
] as const satisfies readonly UiFont[];

export type UiFontId = (typeof UI_FONTS)[number]["id"];

/** Inter: what a library without a font, and a theme without one, mean. */
export const DEFAULT_FONT_ID: UiFontId = "inter";

/** A font id as it may be saved: lower-case letters, digits and hyphens. */
export const isFontId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value);

/** The CSS font-family for a font: its face, then the system's. */
export const fontFamily = (font: UiFont): string => `"${font.face}", system-ui, sans-serif`;

/** The font for a saved id: that font, or Inter for an id this Tavora doesn't know. */
export function uiFont(id: string | null | undefined): (typeof UI_FONTS)[number] {
  return UI_FONTS.find((font) => font.id === id) ?? UI_FONTS[0];
}

/** The font as the theme carries it to modules: its id and its CSS font-family. */
export function themeFont(id: string | null | undefined): { id: string; family: string } {
  const font = uiFont(id);
  return { id: font.id, family: fontFamily(font) };
}
