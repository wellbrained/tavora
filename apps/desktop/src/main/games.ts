import type { TavoraTheme } from "@tavora/sdk/protocol";

/**
 * The theme every module gets through ui.getTheme. Tavora is dark only for
 * now (docs/decisions.md); the values match the host UI tokens in
 * src/renderer/styles.css.
 */
export const THEME: TavoraTheme = {
  mode: "dark",
  colors: { background: "#171412", surface: "#201c19", text: "#f2ece0", textMuted: "#9a958c", accent: "#e0a243" },
};
