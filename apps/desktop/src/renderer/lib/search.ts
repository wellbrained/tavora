// Matching for the search box (Ctrl+K) and the Settings search. Every word
// the user types has to appear somewhere in an item; items where words
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

// ── Game names ────────────────────────────────────────────────────────────────
// The Add a game list and the Ctrl+K catalog suggestions rank whole names:
// "eld" should list Elden Ring before Battlefield 6.

/** Lower case, no accents, every run of punctuation a single space: "Counter-Strike 2" → "counter strike 2". */
function words(text: string): string {
  return normalize(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** How well a name fits the whole query: 5 exact, 4 starts with it, 3 has it as a whole word, 2 as a word's start, 1 somewhere inside, 0 not at all. */
export function nameScore(query: string, name: string): number {
  const q = words(query);
  const title = words(name);
  if (!q) return 0;
  if (title === q) return 5;
  if (title.startsWith(q)) return 4;
  if (` ${title} `.includes(` ${q} `)) return 3;
  if (` ${title}`.includes(` ${q}`)) return 2;
  if (title.includes(q)) return 1;
  return 0;
}

/** The query starts the name or sits in it as a whole word: a match worth suggesting unasked. */
export function startsOrIsWord(query: string, name: string): boolean {
  return nameScore(query, name) >= 3;
}

/** Items by how well their name fits, best first; equal fits go by name. Nothing is dropped. */
export function rankByName<T>(items: readonly T[], query: string, name: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, name: name(item), score: nameScore(query, name(item)) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((entry) => entry.item);
}
