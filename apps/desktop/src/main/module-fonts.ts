// The interface fonts' files for module pages and Tavora's small windows, embedded in the main bundle (esbuild's base64
// loader), so a page gets Tavora's font without loading anything. Only the font in use goes into a page
// (moduleFontCss); each one's stylesheet is made once, when it is first used.
import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";
import interLatinExt from "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2";
import monaLatin from "@fontsource-variable/mona-sans/files/mona-sans-latin-wght-normal.woff2";
import monaLatinExt from "@fontsource-variable/mona-sans/files/mona-sans-latin-ext-wght-normal.woff2";
import rubikLatin from "@fontsource-variable/rubik/files/rubik-latin-wght-normal.woff2";
import rubikLatinExt from "@fontsource-variable/rubik/files/rubik-latin-ext-wght-normal.woff2";
import nunitoLatin from "@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2";
import nunitoLatinExt from "@fontsource-variable/nunito/files/nunito-latin-ext-wght-normal.woff2";
import sairaLatin from "@fontsource-variable/saira/files/saira-latin-wght-normal.woff2";
import sairaLatinExt from "@fontsource-variable/saira/files/saira-latin-ext-wght-normal.woff2";
import atkinsonLatin from "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2";
import atkinsonLatinExt from "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-normal.woff2";
import alloLatin from "../fonts/allo/allo-latin-wght-normal.woff2";
import alloLatinExt from "../fonts/allo/allo-latin-ext-wght-normal.woff2";
import type { ThemeFont } from "@tavora/sdk/protocol";
import { moduleFontCss } from "./module-style";
import { themeFont, uiFont, type UiFontId } from "../shared/ui-fonts";

// Unicode ranges as Fontsource splits its fonts (scripts/subset-allo.mjs cuts Allo the same way).
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

const woff2 = (base64: string) => `data:font/woff2;base64,${base64}`;

/** Each font's two files (Latin, Latin Extended), by the id ui-fonts.ts gives it. */
const FILES: Record<UiFontId, [string, string]> = {
  inter: [interLatin, interLatinExt],
  allo: [alloLatin, alloLatinExt],
  "mona-sans": [monaLatin, monaLatinExt],
  rubik: [rubikLatin, rubikLatinExt],
  nunito: [nunitoLatin, nunitoLatinExt],
  saira: [sairaLatin, sairaLatinExt],
  atkinson: [atkinsonLatin, atkinsonLatinExt],
};

const made = new Map<string, string>();

/** The stylesheet for a page in the given font: its files and --tavora-font-sans. An unknown font gets Inter's. */
export function fontStylesheet(font: ThemeFont | undefined): string {
  const known = uiFont(font?.id);
  let css = made.get(known.id);
  if (css === undefined) {
    const [latin, latinExt] = FILES[known.id];
    css = moduleFontCss(
      themeFont(known.id),
      {
        name: known.face,
        weight: known.weight,
        sizeAdjust: known.sizeAdjust,
        faces: [
          { src: woff2(latin), range: LATIN },
          { src: woff2(latinExt), range: LATIN_EXT },
        ],
      },
    );
    made.set(known.id, css);
  }
  return css;
}
