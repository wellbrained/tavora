// The interface fonts' files for module pages and Tavora's small windows, embedded in the main bundle (esbuild's base64
// loader), so a page gets Tavora's font without loading anything. Only the font in use goes into a page
// (moduleFontCss); each one's stylesheet is made once.
import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";
import interLatinExt from "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2";
import type { ThemeFont } from "@tavora/sdk/protocol";
import { moduleFontCss, type ModuleFontFiles } from "./module-style";
import { uiFont } from "./ui-fonts";

// Unicode ranges as Fontsource splits its fonts.
export const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
export const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

const woff2 = (base64: string) => `data:font/woff2;base64,${base64}`;

/** Each font's files by id; ui-fonts.ts lists the same ids. */
const FILES: Record<string, ModuleFontFiles> = {
  inter: {
    name: "Inter Variable",
    weight: "100 900",
    faces: [
      { src: woff2(interLatin), range: LATIN },
      { src: woff2(interLatinExt), range: LATIN_EXT },
    ],
  },
};

const made = new Map<string, string>();

/** The stylesheet for a page in the given font: its files and --tavora-font-sans. An unknown font gets Inter's. */
export function fontCss(font: ThemeFont | undefined): string {
  const known = uiFont(font?.id);
  let css = made.get(known.id);
  if (css === undefined) {
    css = moduleFontCss(known, FILES[known.id] ?? FILES.inter!);
    made.set(known.id, css);
  }
  return css;
}
