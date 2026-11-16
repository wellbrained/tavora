// The interface fonts the user can pick (Settings > Appearance). The host page loads their files from fonts.css; module
// pages and Tavora's own small windows get the picked one's files from module-fonts.ts. A saved id Tavora doesn't know
// (an older Tavora, or a font that was dropped) shows Inter and is kept, so the font comes back where it is known.
import { DEFAULT_THEME_FONT, type ThemeFont } from "@tavora/sdk/protocol";

export const UI_FONTS: readonly ThemeFont[] = [DEFAULT_THEME_FONT];

/** The font for a saved id: that font, or Inter for an id this Tavora doesn't know. */
export function uiFont(id: string | null | undefined): ThemeFont {
  return { ...(UI_FONTS.find((font) => font.id === id) ?? DEFAULT_THEME_FONT) };
}
