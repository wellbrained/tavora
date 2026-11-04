// The six cell colours and the text colour as Tavora Dark has them, read from the theme file (no colour is typed out
// here). The overlay plate is always dark, like To-Dos', so it uses these whatever theme the app shows; the xlsx
// export writes them into the file.
import tavoraTheme from "../../../themes/tavora/tavora.theme.json";
import { COLORS, type ColorName } from "./model";

export type Rgb = [number, number, number];

const dark = tavoraTheme.variations.find((variation) => variation.id === "dark")!.colors as Record<string, string>;

export function hexRgb(hex: string): Rgb {
  const value = parseInt(hex.replace(/^#/, "").slice(-6), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export const DARK: Record<ColorName, Rgb> = Object.fromEntries(COLORS.map((name) => [name, hexRgb(dark[name]!)])) as Record<ColorName, Rgb>;
export const DARK_TEXT: Rgb = hexRgb(dark.foreground!);

export const cssRgb = ([r, g, b]: Rgb, alpha = 1): string => `rgb(${r} ${g} ${b}${alpha < 1 ? ` / ${alpha}` : ""})`;
