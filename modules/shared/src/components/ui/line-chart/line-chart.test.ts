// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { LineChart, type LineChartSeries } from "."

// jsdom has no layout: the chart is told it is 400 px wide, and the pointer's x is the x in the chart.
const WIDTH = 400

let app: App | undefined
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} })
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(WIDTH)
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const you: LineChartSeries = { label: "You", points: [{ x: 0, y: 12 }, { x: 60, y: 30 }, { x: 120, y: 44 }, { x: 180, y: 52 }] }
const them: LineChartSeries = { label: "Opponent", points: [{ x: 0, y: 12 }, { x: 60, y: 28 }, { x: 120, y: 40 }, { x: 180, y: 55 }] }

async function mount(series: LineChartSeries[], extra: Record<string, unknown> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp(defineComponent({ render: () => h(LineChart, { series, label: "Workers", emptyTitle: "No games yet", ...extra }) }))
  app.mount(host)
  await nextTick() // it learns its width once mounted
  const chart = () => host.querySelector("[data-slot=line-chart]") as HTMLElement
  const tip = () => document.body.querySelector("[role=tooltip]") as HTMLElement | null
  return { host, chart, tip }
}

const press = async (element: HTMLElement, key: string) => {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
  await nextTick()
}

describe("LineChart", () => {
  it("shows the empty state instead of a chart when no line has a point", async () => {
    const { host, chart } = await mount([{ label: "You", points: [] }])
    expect(host.textContent).toContain("No games yet")
    expect(host.querySelector("svg")).toBeNull()
    expect(chart().getAttribute("tabindex")).toBeNull()
  })

  it("draws a path per line, the second one dashed, in theme colours", async () => {
    const { host } = await mount([you, them])
    const paths = [...host.querySelectorAll("path")]
    expect(paths).toHaveLength(2)
    expect(paths[0]!.getAttribute("stroke-dasharray")).toBeNull()
    expect(paths[1]!.getAttribute("stroke-dasharray")).toBeTruthy()
    expect(paths[0]!.getAttribute("style")).toContain("var(--primary)")
    expect(paths[1]!.getAttribute("style")).toContain("var(--muted-foreground)")
    expect(host.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i)
  })

  it("leaves out lines after the second", async () => {
    const { host } = await mount([you, them, { label: "Third", points: [{ x: 0, y: 1 }, { x: 60, y: 2 }] }])
    expect(host.querySelectorAll("path")).toHaveLength(2)
  })

  it("writes game time on the axis as m:ss", async () => {
    const { host } = await mount([you])
    const labels = [...host.querySelectorAll("text")].map((text) => text.textContent)
    expect(labels).toContain("1:00")
    expect(labels).toContain("3:00")
  })

  it("keeps a lone point as a dot", async () => {
    const { host } = await mount([{ label: "Rating", points: [{ x: 90, y: 3000 }] }])
    expect(host.querySelectorAll("path")[0]?.getAttribute("d")).toBe("")
    expect(host.querySelectorAll("circle")).toHaveLength(1)
  })

  it("opens the tooltip with each line's value when you reach a point with the keys, and closes it with Escape", async () => {
    const { chart, tip } = await mount([you, them], { formatY: (y: number) => `${y} workers` })
    expect(tip()).toBeNull()
    await press(chart(), "ArrowRight")
    expect(tip()?.textContent).toContain("0:00")
    await press(chart(), "ArrowRight")
    expect(tip()?.textContent).toContain("1:00")
    expect(tip()?.textContent).toContain("You30 workers")
    expect(tip()?.textContent).toContain("Opponent28 workers")
    expect(chart().getAttribute("aria-describedby")).toBe(tip()!.id)
    await press(chart(), "End")
    expect(tip()?.textContent).toContain("3:00")
    await press(chart(), "ArrowRight")
    expect(tip()?.textContent).toContain("3:00")
    await press(chart(), "Escape")
    expect(tip()).toBeNull()
  })

  it("leaves a line out of the tooltip where it has no point at that moment", async () => {
    const { chart, tip } = await mount([you, { label: "Opponent", points: [{ x: 0, y: 12 }, { x: 90, y: 33 }] }])
    await press(chart(), "ArrowRight")
    await press(chart(), "ArrowRight")
    expect(tip()?.textContent).toContain("1:00")
    expect(tip()?.textContent).toContain("You")
    expect(tip()?.textContent).not.toContain("Opponent")
  })

  it("keeps the tooltip on its point when the same data arrives again, and closes it when the point is gone", async () => {
    const data = ref<LineChartSeries[]>([you])
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp(defineComponent({ render: () => h(LineChart, { series: [...data.value], label: "Workers" }) }))
    app.mount(host)
    await nextTick()
    const chart = host.querySelector("[data-slot=line-chart]") as HTMLElement
    await press(chart, "ArrowRight")
    await press(chart, "ArrowRight")
    expect(document.body.querySelector("[role=tooltip]")?.textContent).toContain("1:00")
    data.value = [{ ...you }]
    await nextTick()
    expect(document.body.querySelector("[role=tooltip]")?.textContent).toContain("1:00")
    data.value = [{ label: "You", points: [{ x: 0, y: 1 }, { x: 90, y: 2 }] }]
    await nextTick()
    expect(document.body.querySelector("[role=tooltip]")).toBeNull()
  })

  it("follows the pointer to the nearest point and hides when it leaves the plot", async () => {
    const { chart, tip } = await mount([you, them])
    const at = async (clientX: number) => {
      chart().dispatchEvent(new MouseEvent("pointermove", { clientX, bubbles: true }))
      await nextTick()
    }
    await at(WIDTH - 12) // the right end of the plot
    expect(tip()?.textContent).toContain("3:00")
    await at(1)
    expect(tip()).toBeNull()
    await at(WIDTH - 12)
    chart().dispatchEvent(new MouseEvent("pointerleave", { bubbles: true }))
    await nextTick()
    expect(tip()).toBeNull()
  })
})
