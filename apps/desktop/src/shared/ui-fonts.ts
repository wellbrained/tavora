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

export const UI_FONTS = [
  { id: "inter", name: "Inter", face: "Inter Variable", sizeAdjust: 100, weight: "100 900" },
  { id: "allo", name: "Allo", face: "Tavora Allo", sizeAdjust: 100, weight: "100 900" },
  { id: "mona-sans", name: "Mona Sans", face: "Tavora Mona Sans", sizeAdjust: 105.6, weight: "200 900" },
  { id: "rubik", name: "Rubik", face: "Tavora Rubik", sizeAdjust: 105, weight: "300 900" },
  { id: "nunito", name: "Nunito", face: "Tavora Nunito", sizeAdjust: 112.8, weight: "200 1000" },
  { id: "saira", name: "Saira", face: "Tavora Saira", sizeAdjust: 107, weight: "100 900" },
  { id: "atkinson", name: "Atkinson Hyperlegible Next", face: "Tavora Atkinson Hyperlegible Next", sizeAdjust: 110.1, weight: "200 800" },
] as const satisfies readonly UiFont[];

export type UiFontId = (typeof UI_FONTS)[number]["id"];

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
