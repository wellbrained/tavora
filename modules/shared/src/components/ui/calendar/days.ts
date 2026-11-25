// The plain side of the Calendar: days are "YYYY-MM-DD" strings (what `localDay` in the SDK writes and what modules
// save), months are "YYYY-MM". Only the Calendar itself turns them into reka's date objects.
import { CalendarDate, parseDate } from "@internationalized/date"

/** How a marked day is tinted: the kit's status colours, or muted for a quiet mark. */
export const CALENDAR_TONES = ["success", "destructive", "warning", "info", "muted"] as const
export type CalendarTone = (typeof CALENDAR_TONES)[number]

/** A day's mark: its tint, and a few words screen readers read after the date ("Solved"). */
export interface CalendarMark {
  tone: CalendarTone
  label: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/

/** Today on this computer as "YYYY-MM-DD", the same day `localDay` in the SDK gives. */
export function localToday(now = Date.now()): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** The date object for a "YYYY-MM-DD" day, or undefined for anything that isn't a real day. */
export function toCalendarDate(day: string | undefined): CalendarDate | undefined {
  if (!day || !DAY.test(day)) return undefined
  try {
    const date = parseDate(day)
    // parseDate keeps "2026-02-31" as March 3; a day that moved wasn't a real day.
    return date.toString() === day ? date : undefined
  } catch {
    return undefined
  }
}

/** The first day of a "YYYY-MM" month, or undefined for anything that isn't one. */
export function monthStart(month: string | undefined): CalendarDate | undefined {
  return month && MONTH.test(month) ? toCalendarDate(`${month}-01`) : undefined
}

/** The "YYYY-MM" month a date falls in. */
export const monthOf = (date: { year: number; month: number }): string => `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}`

/**
 * The month to show first: the one asked for, else the picked day's, else today's, moved inside min and max so the
 * calendar never opens on a month where nothing can be picked.
 */
export function firstMonth(options: { month?: string; picked?: string; today: string; min?: string; max?: string }): CalendarDate {
  const start =
    monthStart(options.month) ?? toCalendarDate(options.picked)?.set({ day: 1 }) ?? toCalendarDate(options.today)?.set({ day: 1 }) ?? new CalendarDate(2000, 1, 1)
  const min = toCalendarDate(options.min)?.set({ day: 1 })
  const max = toCalendarDate(options.max)?.set({ day: 1 })
  if (max && start.compare(max) > 0) return max
  if (min && start.compare(min) < 0) return min
  return start
}

/** What a screen reader hears for a day: the full date, then its mark ("Wednesday, 25 November 2026, Solved"). */
export function dayLabel(day: string, locale: string, mark?: CalendarMark): string {
  const date = toCalendarDate(day)
  if (!date) return day
  const text = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day)),
  )
  return mark?.label ? `${text}, ${mark.label}` : text
}
