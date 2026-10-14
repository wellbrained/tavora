// The look every module page starts from: Tavora's tokens as CSS custom
// properties, plus defaults for the page and native controls in the same
// style as the host UI. It is inserted as a user stylesheet, which sits
// below every rule a module writes: it only replaces the browser's own
// defaults (white margins, light form controls, serif text), so a module
// that styles nothing still looks like part of Tavora, and one with its own
// design keeps it.
import { THEME } from "./games";

/** The theme's tokens, as modules see them (games.ts, kept equal to the host UI's). */
export const MODULE_TOKENS: Readonly<Record<string, string>> = { ...THEME.tokens, radius: `${THEME.radius}px` };

export interface ModuleFonts {
  /** Inter's Latin subset as a woff2 data URL. */
  latin: string;
  /** Inter's Latin Extended subset as a woff2 data URL. */
  latinExt: string;
}

// Unicode ranges as Fontsource splits Inter.
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

export function moduleBaseCss(fonts: ModuleFonts): string {
  const face = (src: string, range: string) =>
    `@font-face { font-family: "Inter Variable"; font-style: normal; font-display: swap; font-weight: 100 900; ` +
    `src: url(${src}) format("woff2-variations"); unicode-range: ${range}; }`;
  const tokens = Object.entries(MODULE_TOKENS)
    .map(([name, value]) => `--tavora-${name}: ${value};`)
    .join(" ");
  return `
${face(fonts.latin, LATIN)}
${face(fonts.latinExt, LATIN_EXT)}
:root {
  ${tokens}
  --tavora-font-sans: "Inter Variable", system-ui, sans-serif;
  --tavora-font-mono: ui-monospace, monospace;
  color-scheme: dark;
  background: var(--tavora-background);
  color: var(--tavora-foreground);
  font: 14px/1.5 var(--tavora-font-sans);
  scrollbar-color: var(--tavora-input) transparent;
  accent-color: var(--tavora-primary);
}
body { margin: 0; }
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
  min-height: 32px; padding: 0 12px; border: 0; border-radius: var(--tavora-radius);
  background: var(--tavora-secondary); color: var(--tavora-foreground); cursor: pointer;
}
button:hover:not(:disabled) { background: color-mix(in srgb, var(--tavora-foreground) 10%, var(--tavora-secondary)); }
button:disabled { opacity: 0.5; cursor: default; }
input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"]), select, textarea {
  appearance: none;
  box-sizing: border-box; min-height: 32px; padding: 6px 8px;
  border: 1px solid var(--tavora-input); border-radius: var(--tavora-radius);
  background: var(--tavora-card); color: var(--tavora-foreground);
}
select {
  padding-right: 28px;
  background: var(--tavora-card) no-repeat right 8px center / 12px
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239a958c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
}
input::placeholder, textarea::placeholder { color: var(--tavora-muted-foreground); }
hr { border: 0; border-top: 1px solid var(--tavora-border); }
code, pre, kbd { font-family: var(--tavora-font-mono); }
`;
}
