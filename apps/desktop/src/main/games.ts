import type { TavoraTheme } from "@tavora/sdk/protocol";
import { MODULE_TOKENS as T } from "./module-style";

/**
 * The theme every module gets through ui.getTheme. Tavora is dark only for
 * now (docs/decisions.md); the values are the module tokens in
 * module-style.ts, which match the host UI's.
 */
export const THEME: TavoraTheme = {
  mode: "dark",
  colors: { background: T.background, surface: T.card, text: T.foreground, textMuted: T["muted-foreground"], accent: T.primary },
};
