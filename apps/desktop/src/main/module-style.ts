// The look every module page starts from: Tavora's tokens as CSS custom
// properties, plus defaults for the page and native controls in the same
// style as the host UI. It is inserted as a user stylesheet, which sits
// below every rule a module writes: it only replaces the browser's own
// defaults (white margins, light form controls, serif text), so a module
// that styles nothing still looks like part of Tavora, and one with its own
// design keeps it. The colours sit in a second, small stylesheet of their
// own, so a theme change replaces only that one, and the font in a third,
// replaced only when the user picks another font.
//
// A module's stylesheet only wins for the properties it sets, so nothing here
// may set a property that a CSS reset such as Tailwind's leaves alone: no
// min-height on controls (it stretched shadcn checkboxes, radios and switches
// to 32px) and no font size on the root (it made every rem 14px instead of
// 16px). Controls get their height from padding and line height, which
// resets do clear, and the 14px text sits on body.
import { DEFAULT_THEME_FONT, type TavoraTheme, type ThemeFont } from "@tavora/sdk/protocol";

/** A theme's tokens as modules see them: the colour tokens plus the radius. */
export function moduleTokens(theme: TavoraTheme): Record<string, string> {
  return { ...theme.tokens, radius: `${theme.radius}px` };
}

/** The active theme as --tavora-* properties, with the parts of the base look that need a literal colour. */
export function moduleThemeCss(theme: TavoraTheme): string {
  const tokens = Object.entries(moduleTokens(theme))
    .map(([name, value]) => `--tavora-${name}: ${value};`)
    .join(" ");
  const chevron = encodeURIComponent(theme.tokens["muted-foreground"]);
  return `:root { ${tokens} color-scheme: ${theme.mode}; }
select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${chevron}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E"); }
`;
}

/** One file of a font: a woff2 data URL and the characters it covers. */
export interface ModuleFontFace {
  src: string;
  /** A CSS unicode-range. */
  range: string;
}

/**
 * A font's files for a page, under the name its family uses (`"Inter Variable"`), with its weight range (`100 900`) and
 * its size-adjust in percent (100 leaves it as drawn).
 */
export interface ModuleFontFiles {
  name: string;
  weight: string;
  sizeAdjust?: number;
  faces: ModuleFontFace[];
}

/**
 * The font the user picked, in a stylesheet of its own: its files, embedded so the page loads nothing, and
 * `--tavora-font-sans`. It is swapped only when the font changes, as its files are far bigger than the colours.
 */
export function moduleFontCss(font: ThemeFont, files: ModuleFontFiles): string {
  const faces = files.faces.map(
    (face) =>
      `@font-face { font-family: "${files.name}"; font-style: normal; font-display: swap; font-weight: ${files.weight}; ` +
      (files.sizeAdjust && files.sizeAdjust !== 100 ? `size-adjust: ${files.sizeAdjust}%; ` : "") +
      `src: url(${face.src}) format("woff2-variations"); unicode-range: ${face.range}; }`,
  );
  return `${faces.join("\n")}\n:root { --tavora-font-sans: ${font.family}; }\n`;
}

export function moduleBaseCss(): string {
  return `
:root {
  --tavora-font-sans: ${DEFAULT_THEME_FONT.family};
  --tavora-font-mono: ui-monospace, monospace;
  background: var(--tavora-background);
  color: var(--tavora-foreground);
  scrollbar-color: var(--tavora-input) transparent;
  accent-color: var(--tavora-primary);
}
body { margin: 0; font: 14px/1.5 var(--tavora-font-sans); }
h1 { font-size: 16px; font-weight: 600; margin: 0 0 8px; }
h2 { font-size: 14px; font-weight: 600; margin: 16px 0 4px; }
a { color: var(--tavora-primary); }
small, dt { color: var(--tavora-muted-foreground); }
::selection { background: color-mix(in srgb, var(--tavora-primary) 35%, transparent); }
:focus-visible { outline: 2px solid var(--tavora-ring); outline-offset: 2px; }
button, input, select, textarea { font: inherit; color: inherit; }
/* appearance: none, because Chromium keeps native control painting unless the
   page's own styles set a background; ours come from a user stylesheet. */
button {
  appearance: none;
  line-height: 20px; padding: 6px 12px; border: 0; border-radius: var(--tavora-radius);
  background: var(--tavora-secondary); color: var(--tavora-foreground); cursor: pointer;
}
button:hover:not(:disabled) { background: color-mix(in srgb, var(--tavora-foreground) 10%, var(--tavora-secondary)); }
button:disabled { opacity: 0.5; cursor: default; }
input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"]), select, textarea {
  appearance: none;
  box-sizing: border-box; line-height: 20px; padding: 5px 8px;
  border: 1px solid var(--tavora-input); border-radius: var(--tavora-radius);
  background: var(--tavora-card); color: var(--tavora-foreground);
}
select {
  padding-right: 28px;
  background-color: var(--tavora-card);
  background-repeat: no-repeat; background-position: right 8px center; background-size: 12px;
}
input::placeholder, textarea::placeholder { color: var(--tavora-muted-foreground); }
hr { border: 0; border-top: 1px solid var(--tavora-border); }
code, pre, kbd { font-family: var(--tavora-font-mono); }
`;
}
