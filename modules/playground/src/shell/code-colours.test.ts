import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CODE_COLOURS, NUMBER_COLOUR, cssColour, type CodeColour } from "./code-colours";

// Every variation (light and dark) of every official theme.
const THEMES = new URL("../../../../themes/", import.meta.url);
type Rgb = [number, number, number];
const hex = (value: string): Rgb => [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16)) as Rgb;
const variations = readdirSync(THEMES).flatMap((dir) => {
  const theme = JSON.parse(readFileSync(new URL(`${dir}/tavora.theme.json`, THEMES), "utf8")) as { variations: { id: string; colors: Record<string, string> }[] };
  return theme.variations.map((variation) => ({ name: `${dir}/${variation.id}`, colors: Object.fromEntries(Object.entries(variation.colors).map(([token, value]) => [token, hex(value)])) as Record<string, Rgb> }));
});

/** color-mix(in srgb, a pa%, b). */
const mix = (a: Rgb, percent: number, b: Rgb): Rgb => a.map((value, i) => (value * percent) / 100 + (b[i]! * (100 - percent)) / 100) as Rgb;
const linear = (value: number) => ((value /= 255) <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const luminance = (c: Rgb) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
const contrast = (a: Rgb, b: Rgb) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};
const colourOf = (colour: CodeColour, colors: Record<string, Rgb>): Rgb =>
  colour.percent === undefined || !colour.with ? colors[colour.from]! : mix(colors[colour.from]!, colour.percent, colors[colour.with]!);

describe("code colours", () => {
  it("read every official theme, light and dark", () => {
    expect(variations.length).toBeGreaterThanOrEqual(9);
    expect(variations.some((variation) => variation.name.endsWith("/light"))).toBe(true);
  });

  it("are at least 4.5:1 on the code background in every variation, line numbers included", () => {
    for (const { name, colors } of variations) {
      // The code sits on the muted surface at 40% over the page (bg-muted/40).
      const background = mix(colors.muted!, 40, colors.background!);
      for (const [kind, colour] of Object.entries({ ...CODE_COLOURS, numbers: NUMBER_COLOUR })) expect(contrast(colourOf(colour, colors), background), `${name} ${kind}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("only use tokens a theme has", () => {
    const tokens = new Set(Object.keys(variations[0]!.colors));
    for (const colour of [...Object.values(CODE_COLOURS), NUMBER_COLOUR]) for (const token of [colour.from, colour.with]) if (token) expect(tokens.has(token), token).toBe(true);
  });

  it("become CSS from tokens", () => {
    expect(cssColour("plain")).toBe("var(--foreground)");
    expect(cssColour("punct")).toBe("color-mix(in srgb, var(--foreground) 70%, var(--background))");
  });
});
