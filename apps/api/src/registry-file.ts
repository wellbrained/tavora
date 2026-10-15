import type { IdRegistry } from "./dataset.ts";

// data/ids.tsv keeps every canonical id ever issued, so a rebuild on any PC
// gives the same ids. One line per fact: `id<TAB>key`, where the key is
// `wd:Q42`, `steam:123` or empty for an id with no key.

const HEADER = "# Canonical ids issued so far: id, then a matching key. Ids are frozen; never edit or delete a line.";

export function parseRegistry(text: string): IdRegistry {
  const keys = new Map<string, string>();
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [id, key] = line.split("\t");
    if (!id) continue;
    ids.add(id);
    if (key) keys.set(key, id);
  }
  return { keys, ids };
}

export function formatRegistry(registry: IdRegistry): string {
  const keysOf = new Map<string, string[]>();
  for (const [key, id] of registry.keys) keysOf.set(id, [...(keysOf.get(id) ?? []), key]);
  const lines: string[] = [];
  for (const id of [...registry.ids].sort()) {
    const keys = (keysOf.get(id) ?? []).sort();
    if (keys.length === 0) lines.push(id);
    for (const key of keys) lines.push(`${id}\t${key}`);
  }
  return `${HEADER}\n${lines.join("\n")}\n`;
}
