import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** A plain JSON-style object: not null, not an array. */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The fields of a stored object this version doesn't know, to carry along when it is read and saved again: a newer copy
 * of the module may have written them (before a fallback to this one), and they must still be there when it comes
 * back. The `known` fields are left out, so the caller puts its own checked values over what this returns.
 */
export function unknownFields<V = unknown>(value: unknown, known: Iterable<string>): Record<string, V> {
  if (!isRecord(value)) return {}
  const skip = new Set(known)
  return Object.fromEntries(Object.entries(value).filter(([key]) => !skip.has(key))) as Record<string, V>
}

/**
 * An entry of a stored list that this version can't read (a newer copy of the module wrote a kind it doesn't know), kept as it
 * was saved. `after` is the id of the entry it followed (null: it was first), so it goes back in the same place.
 */
export interface KeptEntry {
  after: string | null
  entry: unknown
}

/**
 * Reads a stored list: `read` turns each entry into this version's form, or returns `"newer"` for one it can't read but must
 * keep (it goes into `kept`) and null for one that is simply broken (dropped). Save the list with `withKept`.
 */
export function readEntries<T>(raw: unknown, read: (entry: unknown) => T | "newer" | null): { entries: T[]; kept: KeptEntry[] } {
  const entries: T[] = []
  const kept: KeptEntry[] = []
  let after: string | null = null
  for (const entry of Array.isArray(raw) ? raw : []) {
    const value = read(entry)
    if (value === null) continue
    if (value === "newer") kept.push({ after, entry })
    else entries.push(value)
    if (isRecord(entry) && typeof entry.id === "string") after = entry.id
  }
  return { entries, kept }
}

/**
 * The list to save: the entries, with each kept one back after the entry it followed (also after another kept one). One whose
 * entry was deleted here goes at the end.
 */
export function withKept<T>(entries: readonly T[], kept: readonly KeptEntry[], idOf: (entry: T) => string): unknown[] {
  if (kept.length === 0) return [...entries]
  const placed = new Set<KeptEntry>()
  const ids = new Set<string>([...entries.map(idOf), ...kept.flatMap(({ entry }) => (isRecord(entry) && typeof entry.id === "string" ? [entry.id] : []))])
  const follows = new Map<string | null, KeptEntry[]>()
  for (const one of kept) {
    const at = one.after !== null && !ids.has(one.after) ? undefined : one.after
    const key = at === undefined ? "\u0000end" : at
    follows.set(key, [...(follows.get(key) ?? []), one])
  }
  const out: unknown[] = []
  const place = (after: string | null) => {
    for (const one of follows.get(after) ?? []) {
      if (placed.has(one)) continue
      placed.add(one)
      out.push(one.entry)
      if (isRecord(one.entry) && typeof one.entry.id === "string") place(one.entry.id)
    }
  }
  place(null)
  for (const entry of entries) {
    out.push(entry)
    place(idOf(entry))
  }
  place("\u0000end")
  return out
}

/** A choice a newer version of the module saved that this one doesn't know: kept as it is, so it is saved back unchanged. */
export type NewerChoice = string & { readonly newerChoice?: never }

/**
 * Reads a stored choice (a font, a colour name, a mode): one of `known`, or a newer version's value, kept as it is so the next
 * save doesn't put the default over it; anything that isn't a short text is `fallback`. Show and use it through `choiceOf`.
 */
export function keepChoice<T extends string>(known: readonly T[], value: unknown, fallback: T): T | NewerChoice {
  if ((known as readonly unknown[]).includes(value)) return value as T
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? (value as NewerChoice) : fallback
}

/** The choice to show and use: the stored one when this version knows it, else `fallback` (the value stays stored as it is). */
export function choiceOf<T extends string>(known: readonly T[], value: string | null | undefined, fallback: T): T {
  return (known as readonly (string | null | undefined)[]).includes(value) ? (value as T) : fallback
}

/** `value` held between `low` and `high`. */
export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
