// The user's Calculator choices from the toolbar and its ⚙ menu, the same in every workspace (kept in the module's app
// storage).
import type { JsonValue } from "@tavora/sdk";

export type Mode = "basic" | "plus";
export type Decimals = "auto" | 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const HISTORY_LENGTHS = [10, 25, 50] as const;
export const DECIMALS: Decimals[] = ["auto", 0, 1, 2, 3, 4, 5, 6];

export interface Settings {
  /** Basic is the classic pocket calculator; Plus adds √, x², ±, ans and the k m b ⌈x⌉ row. */
  mode: Mode;
  /** Whether the history list shows. Results are saved either way. */
  history: boolean;
  /** How many results the history keeps. */
  historyLength: (typeof HISTORY_LENGTHS)[number];
  /** How many decimal places results show; the numbers themselves keep every digit. */
  decimals: Decimals;
  /** Results from a million on show as 1.5M, 2B or 3T. */
  short: boolean;
}

export const SETTINGS_KEY = "settings";
export const DEFAULT_SETTINGS: Settings = { mode: "plus", history: true, historyLength: 10, decimals: "auto", short: false };

/** Turns what storage holds into settings, falling back to the defaults for anything missing or broken. */
export function parseSettings(raw: JsonValue | null): Settings {
  const stored = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const length = HISTORY_LENGTHS.find((value) => value === stored.historyLength);
  const decimals = DECIMALS.find((value) => value === stored.decimals);
  return {
    mode: stored.mode === "basic" || stored.mode === "plus" ? stored.mode : DEFAULT_SETTINGS.mode,
    history: typeof stored.history === "boolean" ? stored.history : DEFAULT_SETTINGS.history,
    historyLength: length ?? DEFAULT_SETTINGS.historyLength,
    decimals: decimals ?? DEFAULT_SETTINGS.decimals,
    short: typeof stored.short === "boolean" ? stored.short : DEFAULT_SETTINGS.short,
  };
}
