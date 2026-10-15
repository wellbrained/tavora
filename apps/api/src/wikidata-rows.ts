import type { WikidataGame } from "./dataset.ts";

// Turns the rows of the Wikidata query into games. A name that is the same in
// every language is stored under the label language "mul", with no "en" label
// (Elden Ring, Portal, Starfield), so both are read and "en" wins when an item
// has both.

export interface WikidataRow {
  item: { value: string };
  label: { value: string };
  lang: { value: string };
  appid: { value: string };
  alts?: { value: string };
}

export function collectWikidata(rows: readonly WikidataRow[], into = new Map<string, WikidataGame>(), langs = new Map<string, string>()): Map<string, WikidataGame> {
  for (const row of rows) {
    const qid = row.item.value.split("/").pop()!;
    const appid = Number(row.appid.value);
    const lang = row.lang.value;
    const label = row.label.value.trim();
    if (!/^Q\d+$/.test(qid) || !Number.isInteger(appid) || appid <= 0 || !label) continue;
    // An item with a label in both languages keeps the English one.
    if (langs.get(qid) === "en" || (langs.has(qid) && lang !== "en")) continue;
    langs.set(qid, lang);
    into.set(qid, { qid, label, aliases: row.alts?.value ? row.alts.value.split("|").filter(Boolean) : [], steamAppId: appid });
  }
  return into;
}
