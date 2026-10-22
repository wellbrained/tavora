// The last results, newest first, kept in the game's module storage so every panel of the game shows them.
import type { JsonValue } from "@tavora/sdk";

export interface Calculation {
  /** What was typed, in plain signs. */
  expression: string;
  result: string;
}

export const HISTORY_KEY = "history";
export const MAX_HISTORY = 10;

/** Turns what storage holds into a valid history, dropping anything broken. */
export function parseHistory(raw: JsonValue | null): Calculation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is { expression: string; result: string } => {
      const entry = item as Record<string, unknown> | null;
      return typeof entry?.expression === "string" && typeof entry.result === "string";
    })
    .map(({ expression, result }) => ({ expression, result }))
    .slice(0, MAX_HISTORY);
}

/** Puts a calculation on top; the same one again only moves up. */
export function remember(history: Calculation[], calculation: Calculation): Calculation[] {
  const others = history.filter((item) => item.expression !== calculation.expression || item.result !== calculation.result);
  return [calculation, ...others].slice(0, MAX_HISTORY);
}
