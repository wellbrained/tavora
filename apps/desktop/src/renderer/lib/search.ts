// Matching for the search box (Ctrl+K) and the Settings search. Every word
// the player types has to appear somewhere in an item; items where words
// start the name rank first.

/** Lower case without accents, so "pokemon" finds "Pokémon". */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function queryWords(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

/**
 * Scores an item against the query's words, or returns null when a word is
 * missing. `name` counts more than `extra` (descriptions, keywords). An
 * empty query matches everything with score 0.
 */
export function matchScore(words: readonly string[], name: string, extra: readonly string[] = []): number | null {
  const title = normalize(name);
  const rest = extra.map(normalize);
  let score = 0;
  for (const word of words) {
    const at = title.indexOf(word);
    if (at === 0) score += 4;
    else if (at > 0 && /[^\p{L}\p{N}]/u.test(title[at - 1]!)) score += 3;
    else if (at > 0) score += 2;
    else if (rest.some((text) => text.includes(word))) score += 1;
    else return null;
  }
  return score;
}

/** Items that match, best first; ties keep their original order. */
export function rank<T>(items: readonly T[], query: string, fields: (item: T) => { name: string; extra?: string[] }): T[] {
  const words = queryWords(query);
  return items
    .map((item, index) => {
      const { name, extra } = fields(item);
      return { item, index, score: matchScore(words, name, extra) };
    })
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
