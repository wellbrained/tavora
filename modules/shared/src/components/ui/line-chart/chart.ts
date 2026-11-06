// The maths behind LineChart, kept apart from the component so it can be tested on its own: nice axis ticks, the labels
// of a time or date axis, and finding the point under the pointer.

export interface LineChartPoint {
  /** Seconds on a time axis, milliseconds since 1970 (`Date.getTime()`) on a date axis. */
  x: number
  y: number
}

export interface LineChartSeries {
  /** The name shown in the tooltip. */
  label: string
  points: readonly LineChartPoint[]
  /** A theme token name (`primary`, `success`, `warning`, ...). The first line is `primary`, the second `muted-foreground`. */
  color?: string
  /** Dashed instead of solid. The second line is dashed unless you say otherwise. */
  dashed?: boolean
}

/** What the date ticks are counted in; the label's shape follows it. */
export type DateUnit = "hour" | "day" | "month" | "year"

/** The points that can be drawn (finite numbers), left to right. */
export function drawable(points: readonly LineChartPoint[]): LineChartPoint[] {
  return points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x)
}

/** Nice round values for a value axis, and the range they cover (a little wider than `min`..`max`). A flat range is widened. */
export function niceTicks(min: number, max: number, count: number): { ticks: number[]; min: number; max: number } {
  if (!(max - min > 0)) {
    const pad = Math.abs(min) * 0.05 || 1
    return niceTicks(min - pad, max + pad, count)
  }
  const raw = (max - min) / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / magnitude
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  const first = Math.floor(min / step + 1e-9)
  const last = Math.ceil(max / step - 1e-9)
  const ticks: number[] = []
  for (let n = first; n <= last; n++) ticks.push(Number((n * step).toFixed(decimals)))
  return { ticks, min: ticks[0]!, max: ticks[ticks.length - 1]! }
}

/** Game time as m:ss, or h:mm:ss from an hour on. */
export function formatTime(seconds: number): string {
  const total = Math.round(Math.abs(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, "0")
  const sign = seconds < 0 && total > 0 ? "−" : ""
  return hours > 0 ? `${sign}${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${sign}${minutes}:${rest}`
}

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400]

/** Ticks on whole seconds, minutes or hours between `min` and `max`: at most about `count` of them. */
export function timeTicks(min: number, max: number, count: number): number[] {
  const span = max - min
  const step = TIME_STEPS.find((candidate) => span / candidate <= count)
  if (!step) return niceTicks(min, max, count).ticks.filter((t) => t >= min && t <= max)
  const ticks: number[] = []
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t)
  return ticks
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const DATE_STEPS: { unit: DateUnit; every: number; approx: number }[] = [
  { unit: "hour", every: 1, approx: HOUR },
  { unit: "hour", every: 3, approx: 3 * HOUR },
  { unit: "hour", every: 6, approx: 6 * HOUR },
  { unit: "hour", every: 12, approx: 12 * HOUR },
  { unit: "day", every: 1, approx: DAY },
  { unit: "day", every: 2, approx: 2 * DAY },
  { unit: "day", every: 7, approx: 7 * DAY },
  { unit: "day", every: 14, approx: 14 * DAY },
  { unit: "month", every: 1, approx: 30.44 * DAY },
  { unit: "month", every: 3, approx: 91.3 * DAY },
  { unit: "month", every: 6, approx: 182.6 * DAY },
  { unit: "year", every: 1, approx: 365.25 * DAY },
  { unit: "year", every: 2, approx: 730.5 * DAY },
  { unit: "year", every: 5, approx: 1826 * DAY },
  { unit: "year", every: 10, approx: 3652 * DAY },
]

/** Ticks on whole hours, days, months or years (local time) between `min` and `max`: at most about `count` of them. */
export function dateTicks(min: number, max: number, count: number): { ticks: number[]; unit: DateUnit } {
  const span = max - min
  const step = DATE_STEPS.find((candidate) => span / candidate.approx <= count) ?? DATE_STEPS[DATE_STEPS.length - 1]!
  const at = new Date(min)
  if (step.unit === "hour") {
    at.setMinutes(0, 0, 0)
    at.setHours(Math.floor(at.getHours() / step.every) * step.every)
  } else if (step.unit === "day") {
    at.setHours(0, 0, 0, 0)
    // Weeks start on a Monday.
    if (step.every >= 7) at.setDate(at.getDate() - ((at.getDay() + 6) % 7))
  } else if (step.unit === "month") {
    at.setDate(1)
    at.setHours(0, 0, 0, 0)
    at.setMonth(Math.floor(at.getMonth() / step.every) * step.every)
  } else {
    at.setMonth(0, 1)
    at.setHours(0, 0, 0, 0)
    at.setFullYear(Math.floor(at.getFullYear() / step.every) * step.every)
  }
  const ticks: number[] = []
  for (let guard = 0; at.getTime() <= max && guard < 500; guard++) {
    if (at.getTime() >= min) ticks.push(at.getTime())
    if (step.unit === "hour") at.setHours(at.getHours() + step.every)
    else if (step.unit === "day") at.setDate(at.getDate() + step.every)
    else if (step.unit === "month") at.setMonth(at.getMonth() + step.every)
    else at.setFullYear(at.getFullYear() + step.every)
  }
  return { ticks, unit: step.unit }
}

const DATE_LABELS: Record<DateUnit, Intl.DateTimeFormatOptions> = {
  hour: { hour: "numeric", minute: "2-digit" },
  day: { month: "short", day: "numeric" },
  month: { month: "short", year: "numeric" },
  year: { year: "numeric" },
}

/** How a tick of the given unit is written. */
export function dateTickLabel(unit: DateUnit, locale?: string): (ms: number) => string {
  const format = new Intl.DateTimeFormat(locale, DATE_LABELS[unit])
  return (ms) => format.format(ms)
}

/** A date with its time, for the heading of the tooltip. */
export function dateHeading(locale?: string): (ms: number) => string {
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
  return (ms) => format.format(ms)
}

/** The x of the point nearest to `x` over all the lines (each sorted by x), or `null` when there are none. */
export function nearestX(lines: readonly (readonly LineChartPoint[])[], x: number): number | null {
  let best: number | null = null
  for (const points of lines) {
    let low = 0
    let high = points.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (points[middle]!.x < x) low = middle + 1
      else high = middle
    }
    for (const candidate of [points[low - 1], points[low]]) {
      if (candidate && (best === null || Math.abs(candidate.x - x) < Math.abs(best - x))) best = candidate.x
    }
  }
  return best
}

/** Every x there is a point at, once, left to right. */
export function allX(lines: readonly (readonly LineChartPoint[])[]): number[] {
  return [...new Set(lines.flatMap((points) => points.map((p) => p.x)))].sort((a, b) => a - b)
}

/** The point of a line (sorted by x) at exactly `x`, if it has one. */
export function pointAt(points: readonly LineChartPoint[], x: number): LineChartPoint | undefined {
  let low = 0
  let high = points.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (points[middle]!.x < x) low = middle + 1
    else high = middle
  }
  return points[low]?.x === x ? points[low] : undefined
}

/** The x after (`1`) or before (`-1`) `from` in `xs` (sorted), staying at the end; with nothing active, the first or the last. */
export function stepX(xs: readonly number[], from: number | null, direction: 1 | -1): number | null {
  if (xs.length === 0) return null
  const first = xs[0]!
  const last = xs[xs.length - 1]!
  if (from === null) return direction === 1 ? first : last
  if (direction === 1) return xs.find((x) => x > from) ?? last
  let before = first
  for (const x of xs) if (x < from) before = x
  return before
}
