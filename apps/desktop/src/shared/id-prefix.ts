// Module id prefixes: the part of a module id before the first dot, which an account holds in the catalog.

/** A module id prefix, by the catalog's rule for the first part of a module id. */
export const isIdPrefix = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9]{0,125}$/.test(value);

/** A prefix made from a developer name: its letters and digits, lowercase, starting with a letter. */
export function suggestPrefix(name: string): string | null {
  const prefix = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 32);
  return isIdPrefix(prefix) ? prefix : null;
}
