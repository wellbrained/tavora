// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, nextTick, ref, type App } from "vue"
import { Calendar, CalendarLegend, type CalendarMark } from "."
import { dayLabel, firstMonth, localToday, toCalendarDate } from "./days"
import { setUiLanguage } from "../text"
import { ariaProblems } from "../../../testing"

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  setUiLanguage("en")
})

describe("days", () => {
  it("reads only real days", () => {
    expect(toCalendarDate("2026-11-25")?.toString()).toBe("2026-11-25")
    for (const bad of ["2026-02-31", "2026-13-01", "2026-1-5", "today", "", undefined]) expect(toCalendarDate(bad)).toBeUndefined()
  })

  it("opens on the asked month, else the picked day's, else today's, inside min and max", () => {
    expect(firstMonth({ month: "2026-03", picked: "2026-05-02", today: "2026-11-25" }).toString()).toBe("2026-03-01")
    expect(firstMonth({ picked: "2026-05-02", today: "2026-11-25" }).toString()).toBe("2026-05-01")
    expect(firstMonth({ today: "2026-11-25" }).toString()).toBe("2026-11-01")
    expect(firstMonth({ today: "2026-11-25", max: "2026-08-10" }).toString()).toBe("2026-08-01")
    expect(firstMonth({ month: "2025-01", today: "2026-11-25", min: "2026-10-03" }).toString()).toBe("2026-10-01")
  })

  it("names a day in full, then its mark", () => {
    expect(dayLabel("2026-11-25", "en-GB")).toBe("Wednesday, 25 November 2026")
    expect(dayLabel("2026-11-25", "en-GB", { tone: "success", label: "Solved" })).toBe("Wednesday, 25 November 2026, Solved")
    expect(dayLabel("2026-11-25", "de-DE")).toBe("Mittwoch, 25. November 2026")
  })

  it("writes today as this computer's day", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05")
  })
})

/** Mounts a calendar on November 2026 with today pinned to the 25th, and records what it reports. */
function mount(extra: Record<string, unknown> = {}) {
  const picked = ref<string | undefined>(extra.modelValue as string | undefined)
  const month = ref<string | undefined>(extra.month as string | undefined)
  const picks: string[] = []
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({
    render: () =>
      h(Calendar, {
        label: "Earlier puzzles",
        today: "2026-11-25",
        ...extra,
        modelValue: picked.value,
        "onUpdate:modelValue": (next: string | undefined) => (picked.value = next),
        month: month.value,
        "onUpdate:month": (next: string | undefined) => (month.value = next),
        onPick: (day: string) => picks.push(day),
      }),
  })
  app.mount(root)
  const day = (date: string) => root.querySelector(`[data-slot="calendar-day"][data-value="${date}"]:not([data-outside-view])`) as HTMLElement
  const heading = () => root.querySelector('[data-slot="calendar-heading"]')?.textContent?.trim()
  const button = (label: string) => root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
  return { root, picked, month, picks, day, heading, button }
}

describe("Calendar", () => {
  it("shows the month with Monday first and only its own days", async () => {
    const { root, day, heading } = mount()
    await nextTick()
    expect(heading()).toBe("November 2026")
    const weekdays = [...root.querySelectorAll("th")].map((cell) => cell.textContent?.trim())
    expect(weekdays).toEqual(["M", "T", "W", "T", "F", "S", "S"])
    expect(root.querySelectorAll('[data-slot="calendar-day"]:not([data-outside-view])')).toHaveLength(30)
    // November 1st 2026 is a Sunday: the last cell of the first week.
    const firstWeek = root.querySelector("tbody tr")!
    expect(firstWeek.querySelectorAll('[data-slot="calendar-day"]')[6]?.getAttribute("data-value")).toBe("2026-11-01")
    expect(day("2026-11-01")).toBeTruthy()
  })

  it("starts the week where it is asked to", async () => {
    const { root } = mount({ weekStartsOn: 0 })
    await nextTick()
    expect(root.querySelector("th")?.textContent?.trim()).toBe("S")
  })

  it("rings the pinned today, not this computer's", async () => {
    const { root, day } = mount()
    await nextTick()
    expect(day("2026-11-25").getAttribute("aria-current")).toBe("date")
    expect(day("2026-11-25").hasAttribute("data-today")).toBe(true)
    expect(root.querySelectorAll("[data-today]")).toHaveLength(1)
  })

  it("tints marked days and reads their mark after the date", async () => {
    const marks: Record<string, CalendarMark> = { "2026-11-20": { tone: "success", label: "Solved" }, "2026-11-17": { tone: "destructive", label: "Missed" } }
    const { day } = mount({ marks })
    await nextTick()
    expect(day("2026-11-20").dataset.tone).toBe("success")
    expect(day("2026-11-20").getAttribute("aria-label")).toBe("Friday, 20 November 2026, Solved")
    expect(day("2026-11-17").dataset.tone).toBe("destructive")
    expect(day("2026-11-18").dataset.tone).toBeUndefined()
  })

  it("picks a day by click and keyboard, and says so again for the same day", async () => {
    const { day, picked, picks } = mount()
    await nextTick()
    day("2026-11-12").click()
    await nextTick()
    expect(picked.value).toBe("2026-11-12")
    day("2026-11-12").click()
    day("2026-11-12").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }))
    await nextTick()
    expect(picked.value).toBe("2026-11-12")
    expect(picks).toEqual(["2026-11-12", "2026-11-12", "2026-11-12"])
    expect(day("2026-11-12").hasAttribute("data-selected")).toBe(true)
  })

  it("greys out days outside min and max and stops the months there", async () => {
    const { day, picks, button, heading } = mount({ min: "2026-10-03", max: "2026-11-25" })
    await nextTick()
    day("2026-11-26").click()
    expect(picks).toEqual([])
    expect(day("2026-11-26").hasAttribute("data-disabled")).toBe(true)
    expect(day("2026-11-26").getAttribute("tabindex")).toBeNull()
    expect(button("Next month").disabled).toBe(true)
    button("Previous month").click()
    await wait()
    expect(heading()).toBe("October 2026")
    expect(day("2026-10-02").hasAttribute("data-disabled")).toBe(true)
    expect(day("2026-10-03").hasAttribute("data-disabled")).toBe(false)
    expect(button("Previous month").disabled).toBe(true)
  })

  it("picks with Space too", async () => {
    const { day, picks } = mount()
    await nextTick()
    day("2026-11-12").dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }))
    await nextTick()
    expect(picks).toEqual(["2026-11-12"])
  })

  it("fills the picked day over its mark, and greys a marked day it can't pick", async () => {
    const marks: Record<string, CalendarMark> = { "2026-11-19": { tone: "success", label: "Solved" }, "2026-11-27": { tone: "success", label: "Solved" } }
    const { day } = mount({ marks, modelValue: "2026-11-19", max: "2026-11-25" })
    await nextTick()
    expect(day("2026-11-19").className).toContain("bg-primary")
    expect(day("2026-11-19").className).not.toContain("bg-success")
    expect(day("2026-11-27").className).toContain("opacity-45")
    expect(day("2026-11-27").className).not.toContain("bg-success")
  })

  it("puts the one tab stop on the first day it can pick when min is mid-month", async () => {
    const { root, day } = mount({ month: "2026-10", min: "2026-10-03" })
    await nextTick()
    expect([...root.querySelectorAll('[data-slot="calendar-day"][tabindex="0"]')].map((cell) => cell.getAttribute("data-value"))).toEqual(["2026-10-03"])
    expect(day("2026-10-01").getAttribute("tabindex")).toBeNull()
  })

  it("draws the month arrows in the text colour, the one that can't be used at half strength", async () => {
    const { button } = mount({ max: "2026-11-25" })
    await nextTick()
    for (const label of ["Previous month", "Next month"]) expect(button(label).className).not.toContain("text-muted-foreground")
    expect(button("Previous month").disabled).toBe(false)
    expect(button("Next month").disabled).toBe(true)
    expect(button("Next month").className).toContain("disabled:opacity-50")
  })

  it("can't pick a day isDisabled turns down", async () => {
    const { day, picks } = mount({ isDisabled: (date: string) => date.endsWith("-13") })
    await nextTick()
    day("2026-11-13").click()
    day("2026-11-14").click()
    expect(picks).toEqual(["2026-11-14"])
  })

  it("follows and reports the month shown", async () => {
    const { month, heading, button } = mount({ month: "2026-03" })
    await nextTick()
    expect(heading()).toBe("March 2026")
    button("Next month").click()
    await wait()
    expect(month.value).toBe("2026-04")
    month.value = "2025-12"
    await wait()
    expect(heading()).toBe("December 2025")
  })

  it("speaks German when the controls do", async () => {
    setUiLanguage("de")
    const { root, day, button } = mount()
    await nextTick()
    expect([...root.querySelectorAll("th")].map((cell) => cell.textContent?.trim())).toEqual(["M", "D", "M", "D", "F", "S", "S"])
    expect(day("2026-11-25").getAttribute("aria-label")).toBe("Mittwoch, 25. November 2026")
    expect(button("Nächster Monat")).toBeTruthy()
  })

  it("has no ARIA problems", async () => {
    const { root } = mount({ marks: { "2026-11-20": { tone: "success", label: "Solved" } } })
    await nextTick()
    expect(ariaProblems(root)).toEqual([])
  })
})

describe("CalendarLegend", () => {
  it("lists each mark with a swatch in its tone", () => {
    const root = document.createElement("div")
    document.body.append(root)
    app = createApp({ render: () => h(CalendarLegend, { items: [{ tone: "success", label: "Solved" }, { tone: "warning", label: "Playing" }] }) })
    app.mount(root)
    const items = [...root.querySelectorAll("li")]
    expect(items.map((item) => item.textContent?.trim())).toEqual(["Solved", "Playing"])
    expect(items[0]?.querySelector("span")?.className).toContain("bg-success")
  })
})
