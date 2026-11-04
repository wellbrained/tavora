// Function names for the formula being typed: the word right before the caret, if it starts a function name.
import { FUNCTION_NAMES } from "./formula/evaluate";

export interface FunctionWord {
  /** Where the word starts. */
  start: number;
  prefix: string;
}

/** The function name being typed at the caret, or null (not a formula, inside quotes, after a cell name). */
export function functionWord(text: string, caret: number): FunctionWord | null {
  if (!text.startsWith("=") || caret < 2) return null;
  const before = text.slice(0, caret);
  // Inside a "string" or a 'sheet name' nothing is suggested.
  if ((before.match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const match = /[A-Za-z][A-Za-z.]*$/.exec(before);
  if (!match) return null;
  const start = caret - match[0].length;
  const previous = text[start - 1];
  if (previous === undefined || !/[=(,;+\-*/^&<>\s:]/.test(previous)) return null;
  if (/[A-Za-z0-9_$!'(]/.test(text[caret] ?? "")) return null;
  return { start, prefix: match[0] };
}

/** Functions starting with the prefix, at most `limit`. */
export function suggest(prefix: string, limit = 8): string[] {
  const upper = prefix.toUpperCase();
  return FUNCTION_NAMES.filter((name) => name.startsWith(upper) && name !== upper).slice(0, limit);
}

/** The text with a function name put in for the word, and where the caret goes (inside its brackets). */
export function insertFunction(text: string, word: FunctionWord, caret: number, name: string): { text: string; caret: number } {
  const next = `${text.slice(0, word.start)}${name}(${text.slice(caret)}`;
  return { text: next, caret: word.start + name.length + 1 };
}
