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
import monoLatin from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2";
import monoLatinExt from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2";
import alloLatin from "../fonts/allo/allo-latin-wght-normal.woff2";
import alloLatinExt from "../fonts/allo/allo-latin-ext-wght-normal.woff2";
import type { ThemeFont } from "@tavora/sdk/protocol";
import { moduleFontCss } from "./module-style";
import { FONT_RANGES, themeFont, uiFont, type UiFontId } from "../shared/ui-fonts";

const LATIN = FONT_RANGES.latin;
const LATIN_EXT = FONT_RANGES.latinExt;

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
  "jetbrains-mono": [monoLatin, monoLatinExt],
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
