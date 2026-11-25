// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import { setUiLanguage } from "../text"
import { BarChart, scaleMax, shareOf, stepBar, type BarChartBar } from "."

let app: App | undefined
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
  setUiLanguage("en")
})

const guesses: BarChartBar[] = [
  { label: "1", value: 2 },
  { label: "2", value: 9 },
  { label: "3", value: 24, highlight: true },
  { label: "4", value: 31 },
  { label: "5", value: 14 },
  { label: "6", value: 0 },
]

async function mount(extra: Record<string, unknown> = {}, bars: readonly BarChartBar[] = guesses) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp(defineComponent({ render: () => h(BarChart, { bars, label: "Games by guesses", valueLabel: "Games", ...extra }) }))
  app.mount(host)
  await nextTick()
  const chart = host.querySelector("[data-slot=bar-chart]") as HTMLElement
  const tip = () => document.body.querySelector("[role=tooltip]") as HTMLElement | null
  return { host, chart, tip }
}

const press = async (element: HTMLElement, key: string) => {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
  await nextTick()
}
const fills = (chart: HTMLElement) => [...chart.querySelectorAll<HTMLElement>("[data-bar] > span")].map((bar) => bar.style.width)

describe("bars", () => {
  it("scales to the biggest bar or the given max, never 0", () => {
    expect(scaleMax(guesses)).toBe(31)
    expect(scaleMax(guesses, 50)).toBe(50)
    expect(scaleMax([{ label: "a", value: 0 }])).toBe(1)
    expect(scaleMax([{ label: "a", value: Number.NaN }, { label: "b", value: -3 }])).toBe(1)
  })

  it("gives a bar's part of the total, 0 when all are 0", () => {
    expect(shareOf(guesses, 31)).toBeCloseTo(31 / 80)
    expect(shareOf([{ label: "a", value: 0 }], 0)).toBe(0)
  })

  it("steps with the arrow keys, Home and End, and stops at the ends", () => {
    expect(stepBar(3, null, "ArrowDown")).toBe(0)
    expect(stepBar(3, null, "ArrowUp")).toBe(2)
    expect(stepBar(3, 2, "ArrowRight")).toBe(2)
    expect(stepBar(3, 0, "ArrowLeft")).toBe(0)
    expect(stepBar(3, 1, "End")).toBe(2)
    expect(stepBar(3, 1, "Home")).toBe(0)
    expect(stepBar(3, 1, "a")).toBeUndefined()
    expect(stepBar(0, null, "Home")).toBeUndefined()
  })
})

describe("BarChart", () => {
  it("draws each bar in its track, scaled to the biggest, with its label and count", async () => {
    const { chart } = await mount()
    expect(chart.getAttribute("role")).toBe("group")
    expect(chart.getAttribute("aria-label")).toBe("Games by guesses")
    expect(chart.tabIndex).toBe(0)
    expect(fills(chart).map((width) => Math.round(parseFloat(width)))).toEqual([6, 29, 77, 100, 45, 0])
    const items = [...chart.querySelectorAll("[role=listitem]")]
    expect(items.map((item) => item.textContent)).toEqual(["1: 2", "2: 9", "3: 24", "4: 31", "5: 14", "6: 0"])
  })

  it("draws the highlighted bar in the full colour with a bold label", async () => {
    const { chart } = await mount()
    const bars = [...chart.querySelectorAll("[data-bar] > span")]
    expect(bars[2]!.classList.contains("bg-primary")).toBe(true)
    expect(bars[0]!.className).toContain("bg-primary/55")
    expect(chart.querySelectorAll("[role=listitem]")[2]!.querySelector("span")!.className).toContain("font-semibold")
  })

  it("shows a bar's values in the tooltip as the keys reach it, with its share", async () => {
    const { chart, tip } = await mount({ showShare: true })
    await press(chart, "ArrowDown")
    await press(chart, "End")
    await press(chart, "ArrowUp")
    await press(chart, "ArrowUp")
    expect(tip()?.querySelector(".tavora-tooltip-title")?.textContent).toBe("4")
    expect([...tip()!.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Games", "Share"])
    expect([...tip()!.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual(["31", "39%"])
    expect(chart.getAttribute("aria-describedby")).toBe(tip()!.id)
    expect(chart.querySelector("[data-bar='3']")!.hasAttribute("data-active")).toBe(true)
    await press(chart, "Escape")
    expect(tip()).toBeNull()
  })

  it("adds a bar's own rows to its tooltip", async () => {
    const { chart, tip } = await mount({}, [{ label: "Monday", value: 3, tooltip: [{ label: "Best", value: "1:12" }] }])
    await press(chart, "Home")
    expect([...tip()!.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Games", "Best"])
  })

  it("writes values in the language shown, or your way", async () => {
    setUiLanguage("de")
    const { chart } = await mount({}, [{ label: "a", value: 1240 }])
    expect(chart.querySelector("[role=listitem]")!.textContent).toBe("a: 1.240")
    app!.unmount()
    const again = await mount({ format: (value: number) => `${value} min` }, [{ label: "a", value: 5 }])
    expect(again.chart.querySelector("[role=listitem]")!.textContent).toBe("a: 5 min")
  })

  it("stands bars on a value axis when vertical, with every value for screen readers", async () => {
    const days: BarChartBar[] = [{ label: "Mo", value: 3 }, { label: "Tu", value: 6, highlight: true }, { label: "We", value: 0 }]
    const { chart } = await mount({ orientation: "vertical", height: 160 }, days)
    expect(chart.dataset.orientation).toBe("vertical")
    const bars = [...chart.querySelectorAll<HTMLElement>("[data-bar]")]
    expect(bars.map((bar) => bar.style.height)).toEqual(["50%", "100%", "1px"])
    expect([...chart.querySelectorAll("[role=listitem] .sr-only")].map((item) => item.textContent)).toEqual(["Mo: 3", "Tu: 6", "We: 0"])
    expect(chart.textContent).toContain("Tu")
  })

  it("shows the empty state, and no focus stop, without bars", async () => {
    const { chart } = await mount({ emptyTitle: "No games yet" }, [])
    expect(chart.textContent).toContain("No games yet")
    expect(chart.hasAttribute("tabindex")).toBe(false)
  })
})
