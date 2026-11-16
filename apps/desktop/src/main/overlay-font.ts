// The interface font for overlay pages (Stream overlays in OBS, overlays over the game, previews). They get no theme, so
// they read the font from `_font.css` next to them (OVERLAY_FONT_PATH), and the stream they read their state from
// (`_state`) says which font is in use, so the SDK's watchOverlay swaps the stylesheet when the user picks another one.
// One font for the whole app: the host sets it whenever the theme changes (Host.applyTheme), and both overlay servers
// (overlays.ts, game-overlay-page.ts) read it here.
import { DEFAULT_THEME_FONT, type ThemeFont } from "@tavora/sdk/protocol";
import { fontStylesheet } from "./module-fonts";

let font: ThemeFont = DEFAULT_THEME_FONT;
const listeners = new Set<() => void>();

/** The host's font changed (or not: only a new id is passed on). */
export function setOverlayFont(next: ThemeFont | undefined): void {
  const known = next ?? DEFAULT_THEME_FONT;
  if (known.id === font.id) return;
  font = { ...known };
  for (const listener of [...listeners]) listener();
}

/** The id of the font in use, as the state stream sends it. */
export function overlayFontId(): string {
  return font.id;
}

/** `_font.css`: the font's files (embedded) and --tavora-font-sans. */
export function overlayFontCss(): string {
  return fontStylesheet(font);
}

/** Calls `fn` when the font changes. Returns a function that stops it. */
export function watchOverlayFont(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
