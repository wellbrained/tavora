// The player's Calculator choices from the toolbar, the same in every game (kept in the module's app storage).
import type { JsonValue } from "@tavora/sdk";

export type Mode = "basic" | "plus";

export interface Settings {
  /** Basic is the classic pocket calculator; Plus adds √, x², ± and ans. */
  mode: Mode;
  /** Whether the history list shows. Results are saved either way. */
  history: boolean;
}

export const SETTINGS_KEY = "settings";
export const DEFAULT_SETTINGS: Settings = { mode: "plus", history: true };

/** Turns what storage holds into settings, falling back to the defaults for anything missing or broken. */
export function parseSettings(raw: JsonValue | null): Settings {
  const stored = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    mode: stored.mode === "basic" || stored.mode === "plus" ? stored.mode : DEFAULT_SETTINGS.mode,
    history: typeof stored.history === "boolean" ? stored.history : DEFAULT_SETTINGS.history,
  };
}
