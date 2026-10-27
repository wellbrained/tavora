// Names, slugs and the id rules of Tavora's game database.

/** Same rule as `isGameId` in @tavora/module-schema; a test keeps them equal. */
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Custom games made on a user's PC start with this; no canonical id may. */
export const LOCAL_PREFIX = "local-";

export function isCanonicalId(value: unknown): value is string {
  return typeof value === "string" && GAME_ID.test(value) && !value.startsWith(LOCAL_PREFIX);
}

/** Lowercase, no accents or apostrophes, punctuation as single spaces. Search and matching run on this. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A name as an id candidate; empty when the name has no Latin letters or digits. */
export function slugify(name: string): string {
  const slug = normalize(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  if (!slug) return "";
  return slug.startsWith(LOCAL_PREFIX) ? `game-${slug}` : slug;
}
