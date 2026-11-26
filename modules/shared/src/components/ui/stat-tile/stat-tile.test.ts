// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import { setUiLanguage, writeNumber } from "../text"
import { StatStrip, StatTile, stripColumns } from "."

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  setUiLanguage("en")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mount(render: () => ReturnType<typeof h>) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp(defineComponent({ render }))
  app.mount(host)
  await nextTick()
  return host
}

describe("stripColumns", () => {
  // 7rem tiles (112 px) with an 8 px gap.
  const columns = (count: number, width: number) => stripColumns(count, width, 112, 8)

  it("puts four tiles in a row when they fit, else 2×2, never 3 and 1", () => {
    expect(columns(4, 472)).toBe(4)
    expect(columns(4, 471)).toBe(2)
    expect(columns(4, 360)).toBe(2)
    expect(columns(4, 200)).toBe(1)
  })

  it("keeps rows as even as it can for other counts", () => {
    expect(columns(3, 352)).toBe(3)
    expect(columns(3, 300)).toBe(2)
    expect(columns(5, 400)).toBe(3)
    expect(columns(1, 50)).toBe(1)
  })
})

describe("writeNumber", () => {
  it("writes numbers the way the language does, and short when asked", () => {
    expect(writeNumber(12345678, "en-GB")).toBe("12,345,678")
    expect(writeNumber(12345678, "de-DE")).toBe("12.345.678")
    expect(writeNumber(82.5, "de-DE")).toBe("82,5")
    expect(writeNumber(12345678, "en-GB", true)).toBe("12.3m")
  })
})

describe("StatTile", () => {
  it("shows a dash, read out as no data yet, for a missing value", async () => {
    for (const value of ["", Number.NaN]) {
      const host = await mount(() => h(StatTile, { label: "Win rate", value, unit: "%" }))
      const dd = host.querySelector("dd")!
      expect(dd.textContent).toBe("—No data yet")
      expect(dd.querySelector("[aria-hidden=true]")?.textContent).toBe("—")
      app?.unmount()
      app = undefined
    }
  })

  it("is a dl of its own when alone: the label names the value", async () => {
    const host = await mount(() => h(StatTile, { value: 1240, label: "Played" }))
    const tile = host.querySelector("[data-slot=stat-tile]")!
    expect(tile.tagName).toBe("DL")
    expect(tile.querySelector("dt")!.textContent).toBe("Played")
    expect(tile.querySelector("dd")!.textContent?.trim()).toBe("1,240")
    expect(tile.getAttribute("data-variant")).toBe("filled")
  })

  it("follows the language for numbers and shows text as it is", async () => {
    setUiLanguage("de")
    const host = await mount(() => h("div", [h(StatTile, { value: 82.5, label: "Siegquote", unit: "%" }), h(StatTile, { value: "3:42", label: "Bestzeit" })]))
    const values = [...host.querySelectorAll("dd")].map((dd) => dd.textContent?.trim())
    expect(values).toEqual(["82,5%", "3:42"])
  })

  it("writes a big number short with the full number in a title", async () => {
    const host = await mount(() => h(StatTile, { value: 12345678, label: "Points", compact: true }))
    const value = host.querySelector("dd")!
    expect(value.textContent?.trim()).toBe("12.3m")
    expect(value.getAttribute("title")).toBe("12,345,678")
  })

  it("puts the trend on the hint, with an arrow and a word, or after the value without one", async () => {
    const host = await mount(() =>
      h("div", [h(StatTile, { value: 82, label: "Win rate", hint: "+4 vs last week", trend: "better" }), h(StatTile, { value: 6, label: "Streak", trend: "worse" })]),
    )
    const [first, second] = [...host.querySelectorAll("[data-slot=stat-tile]")]
    const hint = first!.querySelectorAll("dd")[1]!
    expect(hint.className).toContain("text-success")
    expect(hint.querySelector("[data-slot=trend-mark]")).not.toBeNull()
    expect(hint.textContent).toBe("+4 vs last week better")
    expect(second!.querySelector("dd")!.textContent).toContain("worse")
    expect(second!.querySelector(".text-destructive [data-slot=trend-mark]")).not.toBeNull()
  })

  it("sits in a strip's dl, taking the strip's look", async () => {
    const host = await mount(() =>
      h(StatStrip, { variant: "outlined" }, () => [h(StatTile, { value: 1, label: "A" }), h(StatTile, { value: 2, label: "B" })]),
    )
    const strip = host.querySelector("[data-slot=stat-strip]")!
    expect(strip.tagName).toBe("DL")
    const tiles = [...strip.querySelectorAll("[data-slot=stat-tile]")]
    expect(tiles.map((tile) => tile.tagName)).toEqual(["DIV", "DIV"])
    expect(tiles.every((tile) => tile.getAttribute("data-variant") === "outlined")).toBe(true)
  })

  it("lets a strip fix its columns", async () => {
    const host = await mount(() => h(StatStrip, { columns: 3 }, () => [h(StatTile, { value: 1, label: "A" })]))
    expect((host.querySelector("[data-slot=stat-strip]") as HTMLElement).style.gridTemplateColumns).toBe("repeat(3, minmax(0px, 1fr))")
  })

  it("drops the value one size when it doesn't fit, wraps it when even that is too wide, and grows back", async () => {
    // jsdom has no layout: the tile is 100 px wide, and the value at full size is as wide as `needed`.
    let needed = 80
    let resize = () => {}
    vi.stubGlobal("ResizeObserver", class { constructor(fn: () => void) { resize = fn } observe() {} disconnect() {} })
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: needed }) as DOMRect)
    const host = await mount(() => h(StatTile, { value: 12345678, label: "Points" }))
    const value = () => host.querySelector("dd")!
    expect(value().className).toContain("text-xl")
    needed = 110
    resize()
    await nextTick()
    expect(value().className).toContain("text-lg")
    expect(value().className).toContain("whitespace-nowrap")
    needed = 140
    resize()
    await nextTick()
    expect(value().className).toContain("[overflow-wrap:anywhere]")
    needed = 90
    resize()
    await nextTick()
    expect(value().className).toContain("text-xl")
    expect(value().className).toContain("whitespace-nowrap")
  })
})

describe("StatTile for a live reading", () => {
  it("makes the value larger and centres the tile", async () => {
    const host = await mount(() => h(StatTile, { value: 34, label: "CPU", unit: "%", size: "xl", align: "center" }))
    const tile = host.querySelector("[data-slot=stat-tile]")!
    expect(tile.className).toContain("items-center")
    expect(tile.getAttribute("data-size")).toBe("xl")
    expect(host.querySelector("[data-slot=stat-value]")!.className).toContain("text-[2.125rem]")
  })

  it("shows a second value beside the first, and a dash with its hint until it arrives", async () => {
    const host = await mount(() => h(StatTile, { value: 25, unit: "%", label: "GPU", secondValue: 67, secondUnit: "°C", secondClass: "text-warning" }))
    const second = host.querySelector("[data-slot=stat-second-value]")!
    expect(second.textContent?.trim()).toBe("67°C")
    expect(second.className).toContain("text-warning")
    app?.unmount()
    document.body.innerHTML = ""
    const dash = await mount(() => h(StatTile, { value: 25, label: "GPU", secondValue: "", secondUnit: "°C", secondHint: "Only some cards report it." }))
    const missing = dash.querySelector("[data-slot=stat-second-value]")!
    expect(missing.textContent).toContain("–")
    expect(missing.getAttribute("title")).toBe("Only some cards report it.")
    expect(missing.getAttribute("tabindex")).toBe("0")
  })

  it("puts the value's classes on the value, so a colour can follow its state", async () => {
    const host = await mount(() => h(StatTile, { value: "Smooth", label: "Status", valueClass: "text-success" }))
    expect(host.querySelector("[data-slot=stat-value] .text-success")?.textContent?.trim()).toBe("Smooth")
  })

  it("has no second value unless one is given", async () => {
    const host = await mount(() => h(StatTile, { value: 61, label: "Memory" }))
    expect(host.querySelector("[data-slot=stat-second-value]")).toBeNull()
  })

  it("holds an icon in the corner, a graph under the label and a footer instead of the hint", async () => {
    const host = await mount(() =>
      h(StatTile, { value: 34, label: "CPU", hint: "ignored" }, { icon: () => h("i", { id: "icon" }), graph: () => h("canvas", { id: "graph" }), footer: () => h("span", { id: "foot" }, "16 threads") }),
    )
    const tile = host.querySelector("[data-slot=stat-tile]")!
    expect(tile.querySelector("[data-slot=stat-tile-icon] #icon")).not.toBeNull()
    expect(tile.querySelector("[data-slot=stat-tile-graph] #graph")).not.toBeNull()
    expect(tile.querySelector("[data-slot=stat-tile-footer] #foot")).not.toBeNull()
    expect(tile.textContent).not.toContain("ignored")
    // The value stays first, then the label, the graph and the footer.
    const order = [...tile.children].map((child) => child.getAttribute("data-slot") ?? child.tagName)
    expect(order.filter((slot) => slot !== "SPAN")).toEqual(["DT", "stat-tile-icon", "stat-value", "stat-tile-graph", "stat-tile-footer"])
  })
})
