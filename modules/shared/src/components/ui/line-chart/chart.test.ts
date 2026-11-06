import { describe, expect, it } from "vitest"
import { allX, dateTicks, dateTickLabel, drawable, formatTime, nearestX, niceTicks, pointAt, stepX, timeTicks } from "./chart"

const line = (...xs: number[]) => xs.map((x) => ({ x, y: x * 10 }))

describe("niceTicks", () => {
  it("rounds to steps of 1, 2, 5 or 10 and covers the range", () => {
    expect(niceTicks(3, 97, 5)).toEqual({ ticks: [0, 20, 40, 60, 80, 100], min: 0, max: 100 })
    expect(niceTicks(2980, 3120, 4)).toEqual({ ticks: [2950, 3000, 3050, 3100, 3150], min: 2950, max: 3150 })
  })
  it("keeps fractions clean", () => {
    expect(niceTicks(0, 1, 5).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })
  it("widens a flat range so there is something to draw against", () => {
    const { ticks, min, max } = niceTicks(3000, 3000, 4)
    expect(min).toBeLessThan(3000)
    expect(max).toBeGreaterThan(3000)
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    const zero = niceTicks(0, 0, 4)
    expect(zero.min).toBeLessThan(0)
    expect(zero.max).toBeGreaterThan(0)
  })
})

describe("formatTime", () => {
  it("writes m:ss, and h:mm:ss from an hour on", () => {
    expect(formatTime(0)).toBe("0:00")
    expect(formatTime(65)).toBe("1:05")
    expect(formatTime(600)).toBe("10:00")
    expect(formatTime(3725)).toBe("1:02:05")
  })
  it("rounds to whole seconds and keeps the sign", () => {
    expect(formatTime(59.6)).toBe("1:00")
    expect(formatTime(-8)).toBe("−0:08")
    expect(formatTime(-0.2)).toBe("0:00")
  })
})

describe("timeTicks", () => {
  it("picks whole seconds or minutes, about `count` of them", () => {
    expect(timeTicks(0, 360, 6)).toEqual([0, 60, 120, 180, 240, 300, 360])
    expect(timeTicks(0, 100, 5)).toEqual([0, 30, 60, 90])
  })
  it("starts at the first round time inside the range", () => {
    expect(timeTicks(25, 130, 6)).toEqual([30, 60, 90, 120])
  })
  it("copes with a very long game", () => {
    const ticks = timeTicks(0, 10 * 86400, 6)
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks.length).toBeLessThanOrEqual(12)
  })
})

describe("dateTicks", () => {
  it("counts in days for a few weeks, on midnight", () => {
    const { ticks, unit } = dateTicks(new Date(2026, 9, 3, 15).getTime(), new Date(2026, 9, 31, 9).getTime(), 6)
    expect(unit).toBe("day")
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks.length).toBeLessThanOrEqual(7)
    for (const tick of ticks) {
      const at = new Date(tick)
      expect([at.getHours(), at.getMinutes()]).toEqual([0, 0])
      expect(at.getDay()).toBe(1) // four weeks: weekly ticks, on Mondays
    }
  })
  it("counts in hours for an evening", () => {
    const { ticks, unit } = dateTicks(new Date(2026, 10, 5, 18, 10).getTime(), new Date(2026, 10, 5, 22, 40).getTime(), 6)
    expect(unit).toBe("hour")
    expect(ticks.map((t) => new Date(t).getMinutes())).toEqual(ticks.map(() => 0))
  })
  it("counts in months, on the first, for a year", () => {
    const { ticks, unit } = dateTicks(new Date(2026, 0, 20).getTime(), new Date(2026, 11, 20).getTime(), 6)
    expect(unit).toBe("month")
    for (const tick of ticks) expect(new Date(tick).getDate()).toBe(1)
    expect(ticks.length).toBeLessThanOrEqual(7)
  })
  it("counts in years for a long time", () => {
    const { ticks, unit } = dateTicks(new Date(2020, 5, 1).getTime(), new Date(2026, 5, 1).getTime(), 6)
    expect(unit).toBe("year")
    for (const tick of ticks) expect([new Date(tick).getMonth(), new Date(tick).getDate()]).toEqual([0, 1])
  })
  it("has no ticks to give for a single moment", () => {
    const at = new Date(2026, 10, 5, 12, 30).getTime()
    expect(dateTicks(at, at, 6).ticks).toEqual([])
  })
  it("writes a label for each unit", () => {
    const at = new Date(2026, 10, 5, 18, 30).getTime()
    expect(dateTickLabel("year", "en-GB")(at)).toBe("2026")
    expect(dateTickLabel("month", "en-GB")(at)).toBe("Nov 2026")
    expect(dateTickLabel("day", "en-GB")(at)).toBe("5 Nov")
    expect(dateTickLabel("hour", "en-GB")(at)).toMatch(/6:30|18:30/)
  })
})

describe("finding points", () => {
  it("drawable drops what can't be placed and sorts", () => {
    expect(drawable([{ x: 2, y: 1 }, { x: Number.NaN, y: 1 }, { x: 1, y: Number.POSITIVE_INFINITY }, { x: 0, y: 5 }])).toEqual([{ x: 0, y: 5 }, { x: 2, y: 1 }])
  })
  it("nearestX looks across all lines", () => {
    const a = line(0, 10, 20)
    const b = line(4, 14)
    expect(nearestX([a, b], 3)).toBe(4)
    expect(nearestX([a, b], 12)).toBe(10)
    expect(nearestX([a, b], 13)).toBe(14)
    expect(nearestX([a, b], -50)).toBe(0)
    expect(nearestX([a, b], 500)).toBe(20)
    expect(nearestX([[], []], 3)).toBeNull()
  })
  it("allX lists each x once", () => {
    expect(allX([line(0, 10, 20), line(10, 15)])).toEqual([0, 10, 15, 20])
  })
  it("pointAt only finds a point exactly there", () => {
    const a = line(0, 10, 20)
    expect(pointAt(a, 10)).toEqual({ x: 10, y: 100 })
    expect(pointAt(a, 11)).toBeUndefined()
    expect(pointAt(a, 25)).toBeUndefined()
    expect(pointAt([], 0)).toBeUndefined()
  })
  it("stepX moves one point and stops at the ends", () => {
    const xs = [0, 10, 15, 20]
    expect(stepX(xs, null, 1)).toBe(0)
    expect(stepX(xs, null, -1)).toBe(20)
    expect(stepX(xs, 10, 1)).toBe(15)
    expect(stepX(xs, 10, -1)).toBe(0)
    expect(stepX(xs, 20, 1)).toBe(20)
    expect(stepX(xs, 0, -1)).toBe(0)
    expect(stepX(xs, 12, 1)).toBe(15)
    expect(stepX(xs, 12, -1)).toBe(10)
    expect(stepX([], null, 1)).toBeNull()
  })
})
