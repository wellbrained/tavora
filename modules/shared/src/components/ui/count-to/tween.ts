/** The maths of counting to a new number, apart from the animation so it can be tested. */

/** Ease-out: quick at first, settling at the end (the shape of `--ease-out-strong`). */
export const easeOut = (progress: number): number => 1 - (1 - Math.min(1, Math.max(0, progress))) ** 4

/** `value` rounded to `decimals` places. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * The number to show `progress` (0 to 1) of the way from `from` to `to`. It stays on whole steps of `decimals` places
 * on the way, and lands exactly on `to`.
 */
export function countAt(from: number, to: number, progress: number, decimals = 0): number {
  if (progress >= 1) return to
  return roundTo(from + (to - from) * easeOut(progress), decimals)
}

export type CountKind = "integer" | "decimal" | "percent"

/**
 * A number in the locale's own style. `percent` takes a fraction (0.25 is "25%"); `decimal` shows exactly `decimals`
 * places (one by default); `integer` none.
 */
export function formatCount(value: number, kind: CountKind, locale: string | undefined, decimals?: number): string {
  if (kind === "percent") return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: decimals ?? 0, minimumFractionDigits: decimals ?? 0 }).format(value)
  const places = kind === "decimal" ? (decimals ?? 1) : 0
  return new Intl.NumberFormat(locale, { minimumFractionDigits: places, maximumFractionDigits: places }).format(value)
}

/** How many decimal places the counting steps are in: a percent counts in steps of its own decimals, two places further in. */
export function stepDecimals(kind: CountKind, decimals?: number): number {
  if (kind === "percent") return (decimals ?? 0) + 2
  return kind === "decimal" ? (decimals ?? 1) : 0
}
