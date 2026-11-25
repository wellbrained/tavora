// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import { FactList, type FactRow } from "."

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

async function mount(props: { rows: FactRow[] } & Record<string, unknown>) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp(defineComponent({ render: () => h(FactList, props) }))
  app.mount(host)
  await nextTick()
  return host.querySelector("[data-slot=fact-list]") as HTMLElement
}

const rows: FactRow[] = [
  { label: "Power", value: "1,240", unit: "MW" },
  { label: "Belt speed", value: "780", unit: "/min", trend: "better" },
  { label: "Machines", value: "12" },
]

describe("FactList", () => {
  it("says there's no data yet without rows, keeping its class", async () => {
    const el = await mount({ rows: [], class: "mt-2" })
    expect(el.dataset.slot).toBe("fact-list")
    expect(el.textContent).toContain("No data yet")
    expect(el.classList.contains("mt-2")).toBe(true)
  })

  it("lines values up on the right, a unit in its own column", async () => {
    const dl = await mount({ rows })
    expect(dl.tagName).toBe("DL")
    expect(dl.dataset.layout).toBe("inline")
    expect(dl.style.gridTemplateColumns).toBe("minmax(min(7rem, 45%), 1fr) repeat(1, auto) auto")
    expect(dl.className).toContain("[&_dd]:text-right")
    expect([...dl.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Power", "Belt speed", "Machines"])
    const belt = dl.querySelectorAll("dl > div")[1]!
    expect(belt.querySelector("dd[data-trend=better] [data-slot=trend-mark]")).not.toBeNull()
    expect(belt.textContent).toBe("Belt speed780 better/min")
  })

  it("puts plain rows in the same grid", async () => {
    const dl = await mount({ rows: [{ label: "Biome", value: "Revelwood" }] })
    expect(dl.style.gridTemplateColumns).toBe("minmax(min(7rem, 45%), 1fr) auto")
    expect(dl.innerHTML).toBe("<dt>Biome</dt><dd>Revelwood</dd>")
  })

  it("puts values right after the label with align start", async () => {
    const dl = await mount({ rows: [{ label: "Biome", value: "Revelwood" }], align: "start" })
    expect(dl.style.gridTemplateColumns).toBe("fit-content(50%) auto")
    expect(dl.className).toContain("[&_dd]:text-left")
    expect(dl.dataset.align).toBe("start")
  })

  it("takes columns of values the way TooltipRows does", async () => {
    const dl = await mount({ columns: ["Common", "Rare"], rows: [{ label: "Damage", values: ["4", "–"] }] })
    expect(dl.getAttribute("data-columns")).toBe("2")
    const cells = [...dl.querySelectorAll("dl > div:last-child dd")]
    expect(cells.map((cell) => cell.textContent)).toEqual(["4", "–"])
    expect(cells[1]!.hasAttribute("data-faint")).toBe(true)
  })

  it("stacks label over value in columns that fit", async () => {
    const dl = await mount({ rows, layout: "stacked" })
    expect(dl.dataset.layout).toBe("stacked")
    const items = [...dl.children]
    expect(items).toHaveLength(3)
    expect(items[0]!.querySelector("dt")!.textContent).toBe("Power")
    expect(items[0]!.querySelector("dd")!.textContent).toBe("1,240MW")
    expect(items[1]!.querySelector("dd")!.textContent).toBe("780/min better")
  })
})
