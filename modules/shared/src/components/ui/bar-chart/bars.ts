import type { TooltipRow } from "../../tooltip/rows"

export interface BarChartBar {
  /** The label beside or under the bar: "4", "Mon". */
  label: string
  /** Its tooltip's title when the label is too short to say it: "4 guesses", "Monday". */
  title?: string
  /** 0 or more; a negative or missing value is drawn as 0. */
  value: number
  /** Drawn in the full colour with a bold label: this game's guess, today. */
  highlight?: boolean
  /** More rows for this bar's tooltip, after its value. */
  tooltip?: TooltipRow[]
}

/** A value the chart can draw: a finite number, at least 0. */
export const drawable = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)

/** The top of the scale: `max` when given, else the biggest value; never 0, so empty bars stay empty. */
export function scaleMax(bars: readonly BarChartBar[], max?: number): number {
  const top = max ?? Math.max(0, ...bars.map((bar) => drawable(bar.value)))
  return top > 0 ? top : 1
}

/** How much of the scale a value fills, 0 to 1 (a value over `max` fills it). */
export const fill = (value: number, top: number): number => Math.min(1, drawable(value) / top)

/** A value's part of all the bars together, 0 to 1 (0 when they are all 0). */
export function shareOf(bars: readonly BarChartBar[], value: number): number {
  const total = bars.reduce((sum, bar) => sum + drawable(bar.value), 0)
  return total > 0 ? drawable(value) / total : 0
}

/** The bar the arrow keys, Home and End go to from `from` (none yet: the first or the last). */
export function stepBar(count: number, from: number | null, key: string): number | undefined {
  if (count === 0) return undefined
  const last = count - 1
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return from === null ? 0 : Math.min(last, from + 1)
    case "ArrowLeft":
    case "ArrowUp":
      return from === null ? last : Math.max(0, from - 1)
    case "Home":
      return 0
    case "End":
      return last
    default:
      return undefined
  }
}
