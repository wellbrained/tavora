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

/** `value` held between `low` and `high`. */
export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
