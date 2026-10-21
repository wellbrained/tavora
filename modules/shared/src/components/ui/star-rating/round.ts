/** A rating as the stars show it: to the nearest half, 0 to 5 (4.7 shows 4½, 4.8 shows 5). */
export function roundToHalf(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(5, Math.max(0, Math.round(value * 2) / 2))
}
