// What tavora-catalog-sign shows before it signs: every entry the new list adds (+), drops (-) or changes (~) against
// the list served now. The entries come from the service, so this is where the maintainer sees what a broken-into
// service slipped in or left out (catalog threat model, C2): an entry in force is dropped or changed only when the
// maintainer names it.
import { catalogListChanges, type CatalogListKind, type CatalogListOf, type Succession } from "../packages/pack/src/catalog-lists.ts";

export interface CatalogListReview {
  /** What to print, one line each. */
  lines: string[];
  /** Entries in force the new list drops or changes that the maintainer didn't name: nothing is signed while there are any. */
  refused: string[];
  /** Named ids that match no dropped or changed entry, likely a typo. */
  unused: string[];
  /** Successions the new list adds or changes: each hands a publisher's modules to another key, so each is checked by hand. */
  successions: Succession[];
}

const show = (entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join(", ");

/**
 * The versions a revocations file still asks a decision on (the service's `decide`), one line each. They were listed after the key
 * was first asked about and before it was reported as leaked, so only the maintainer can say whether they are the developer's.
 */
export function undecidedRevocations(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry: { fingerprint?: unknown; decide?: unknown }) => {
    if (typeof entry !== "object" || entry === null || !("decide" in entry)) return [];
    const versions = Array.isArray(entry.decide) ? (entry.decide as { sha256?: unknown; id?: unknown; version?: unknown; listedAt?: unknown }[]) : [];
    if (versions.length === 0) return [`key ${String(entry.fingerprint)}: an empty or unreadable decide field`];
    return versions.map(({ sha256, id, version, listedAt }) => `key ${String(entry.fingerprint)}: ${String(id)} ${String(version)}, listed ${String(listedAt)}, zip ${String(sha256)}`);
  });
}

/** The changes from `previous` (the verified list served now, or null for the first) to `next`; `allowed` are the ids named with --allow-change. */
export function reviewCatalogList<K extends CatalogListKind>(kind: K, previous: CatalogListOf<K> | null, next: CatalogListOf<K>, allowed: readonly string[]): CatalogListReview {
  const changes = catalogListChanges(kind, previous, next);
  const lines = [previous ? `Changes against ${kind} list ${previous.sequence}:` : `No signed ${kind} list yet: every entry is new.`];
  if (previous && changes.length === 0) lines.push("  none, the entries are the same.");
  const refused: string[] = [];
  const named = new Set(allowed);
  const used = new Set<string>();
  const successions: Succession[] = [];
  for (const { change, id, before, after } of changes) {
    if (change === "added") lines.push(`+ ${show(after)}`);
    else if (change === "removed") lines.push(`- ${show(before)}`);
    else lines.push(`~ ${show(before)}`, `  -> ${show(after)}`);
    if (change !== "added") {
      if (named.has(id)) used.add(id);
      else refused.push(id);
    }
    if (kind === "successions") successions.push(...(after as Succession[]));
  }
  return { lines, refused, unused: [...named].filter((id) => !used.has(id)), successions };
}
