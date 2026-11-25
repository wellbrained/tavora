import type { InjectionKey, Ref } from "vue"

export type StatTileVariant = "filled" | "outlined"

/** What a StatStrip tells its tiles: their look, and that they sit in its `<dl>`. */
export const STAT_STRIP: InjectionKey<{ variant: Ref<StatTileVariant> }> = Symbol("stat-strip")

/**
 * How many columns a strip of `count` tiles gets in `width` px: the most that fit, each at least `min` wide, chosen so
 * the rows come out even (four tiles are 4, then 2×2, never 3 and 1).
 */
export function stripColumns(count: number, width: number, min: number, gap: number): number {
  if (count <= 1) return 1
  for (let rows = 1; rows <= count; rows++) {
    const columns = Math.ceil(count / rows)
    if (columns * min + (columns - 1) * gap <= width) return columns
  }
  return 1
}
