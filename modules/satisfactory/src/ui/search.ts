// Finding items, recipes and buildings by name. Both the name in Tavora's
// language and the English one match, so a guide in either language helps.

import type { GameData, Localized } from "../contracts/data";
import { localize } from "./names";

export type EntryKind = "item" | "recipe" | "building";

export interface Entry {
  kind: EntryKind;
  id: string;
}

export interface SearchHit extends Entry {
  /** The name shown, in Tavora's language. */
  name: string;
}

/** Lower case, without accents, umlauts folded, so "Schraube" finds "Schrauben" and "o" finds "ö". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How well a name matches the query, lower is better, or null for no match:
 * 0 the whole name, 1 the start of the name, 2 the start of a word, 3 anywhere.
 * Every word of the query must be in the name.
 */
export function matchScore(name: string, query: string): number | null {
  const text = normalize(name);
  const wanted = normalize(query);
  if (!wanted) return null;
  if (text === wanted) return 0;
  if (text.startsWith(wanted)) return 1;
  const words = wanted.split(" ");
  if (!words.every((word) => text.includes(word))) return null;
  const startsWord = (word: string) => text.startsWith(word) || text.includes(` ${word}`) || text.includes(`:${word}`) || text.includes(`-${word}`);
  return words.every(startsWord) ? 2 : 3;
}

const KIND_ORDER: Record<EntryKind, number> = { item: 0, building: 1, recipe: 2 };

function bestScore(name: Localized, query: string, language: string): number | null {
  const scores = [matchScore(localize(name, language), query), matchScore(name.en, query)].filter((score): score is number => score !== null);
  return scores.length ? Math.min(...scores) : null;
}

/** Entries whose name matches, best first: closer match, then items before buildings before recipes, then shorter names, then A to Z. */
export function search(
  data: GameData,
  query: string,
  language: string,
  options: { kinds?: EntryKind[]; limit?: number; filter?: (entry: Entry) => boolean } = {},
): SearchHit[] {
  const kinds = options.kinds ?? ["item", "recipe", "building"];
  const scored: (SearchHit & { score: number })[] = [];
  const consider = (kind: EntryKind, id: string, name: Localized) => {
    if (!kinds.includes(kind)) return;
    if (options.filter && !options.filter({ kind, id })) return;
    const score = bestScore(name, query, language);
    if (score !== null) scored.push({ kind, id, name: localize(name, language), score });
  };
  for (const item of Object.values(data.items)) consider("item", item.id, item.name);
  for (const recipe of Object.values(data.recipes)) consider("recipe", recipe.id, recipe.name);
  for (const building of Object.values(data.buildings)) consider("building", building.id, building.name);
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.name.length - b.name.length ||
      a.name.localeCompare(b.name),
  );
  return scored.slice(0, options.limit ?? 50).map(({ kind, id, name }) => ({ kind, id, name }));
}
