// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, h, nextTick, type App, type VNode } from "vue"
import Tooltip, { tooltipMaxWidth } from "./Tooltip"
import TooltipRows, { type TooltipRow } from "./TooltipRows"

// The card's head parts (badge, meta, divider) and the rows' units and columns. A card without them must render as it
// did before, so every tooltip that exists keeps its look.

let app: App | undefined
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

const anchor = { left: 10, top: 10, right: 20, bottom: 20 }
async function card(props: Record<string, unknown>, slots: Record<string, () => VNode | VNode[] | string> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp({ render: () => h(Tooltip, { open: true, anchor, ...props }, slots) })
  app.mount(host)
  await nextTick()
  return document.querySelector<HTMLElement>("[data-slot=tooltip]")!
}
async function rows(props: { rows: TooltipRow[]; columns?: string[] }) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp({ render: () => h(TooltipRows, props) })
  app.mount(host)
  await nextTick()
  return host.querySelector("dl")!
}

describe("Tooltip head", () => {
  it("keeps a plain title as it was: the title and the keys, nothing else", async () => {
    const el = await card({ title: "Save", shortcut: "Ctrl+S", description: "Saves the file." })
    const head = el.querySelector(".tavora-tooltip-head")!
    expect(head.hasAttribute("data-parts")).toBe(false)
    expect([...head.children].map((child) => child.className)).toEqual(["tavora-tooltip-title", "tavora-tooltip-keys"])
    expect(el.querySelector("hr")).toBeNull()
  })

  it("puts a badge after the title and meta text at the right, before the keys", async () => {
    const el = await card({ title: "Fireball", badge: "Passive", meta: "Level 3", shortcut: "F" })
    const head = el.querySelector(".tavora-tooltip-head")!
    expect(head.getAttribute("data-parts")).toBe("true")
    expect([...head.children].map((child) => child.className)).toEqual(["tavora-tooltip-name", "tavora-tooltip-meta", "tavora-tooltip-keys"])
    expect(head.querySelector(".tavora-tooltip-name .tavora-tooltip-badge")?.textContent).toBe("Passive")
    expect(head.querySelector(".tavora-tooltip-meta")?.textContent).toBe("Level 3")
  })

  it("takes slots for the title, badges and meta in place of the props", async () => {
    const el = await card({ title: "Plain", badge: "Prop", meta: "Prop" }, {
      title: () => h("em", "Styled"),
      badges: () => [h("b", "One"), h("b", "Two")],
      meta: () => h("i", "Corner"),
    })
    expect(el.querySelector(".tavora-tooltip-title")?.innerHTML).toBe("<em>Styled</em>")
    expect([...el.querySelectorAll(".tavora-tooltip-badges b")].map((b) => b.textContent)).toEqual(["One", "Two"])
    expect(el.querySelector(".tavora-tooltip-badge")).toBeNull()
    expect(el.querySelector(".tavora-tooltip-meta")?.innerHTML).toBe("<i>Corner</i>")
  })

  it("draws the divider only when asked and when there is content under it", async () => {
    let el = await card({ title: "Bow", divider: true }, { default: () => h("p", "Pierces.") })
    expect(el.querySelector("hr.tavora-tooltip-divider + p")).not.toBeNull()
    app!.unmount()
    document.body.replaceChildren()
    el = await card({ title: "Bow", divider: true })
    expect(el.querySelector("hr")).toBeNull()
  })
})

describe("tooltipMaxWidth", () => {
  it("is 280 px by default and grows for md and lg", () => {
    expect(tooltipMaxWidth()).toBe(280)
    expect(tooltipMaxWidth("sm")).toBe(280)
    expect(tooltipMaxWidth("md")).toBeGreaterThan(280)
    expect(tooltipMaxWidth("lg")).toBeGreaterThan(tooltipMaxWidth("md"))
    expect(tooltipMaxWidth(400)).toBe(400)
  })
})

describe("TooltipRows", () => {
  it("keeps label and value rows as they were", async () => {
    const dl = await rows({ rows: [{ label: "Damage", value: "142", trend: "better" }] })
    expect(dl.getAttribute("style")).toBeNull()
    expect(dl.innerHTML).toBe('<dt>Damage</dt><dd data-trend="better">142</dd>')
  })

  it("gives a unit its own column, empty for rows without one", async () => {
    const dl = await rows({ rows: [{ label: "Share", value: "42", unit: "%" }, { label: "Hits", value: "7" }] })
    expect(dl.style.gridTemplateColumns).toBe("minmax(0px, 1fr) repeat(1, auto) auto")
    expect([...dl.querySelectorAll(".tavora-tooltip-unit")].map((cell) => cell.textContent)).toEqual(["%", ""])
  })

  it("lines values up under column headings, a dash faint, trends per cell", async () => {
    const dl = await rows({
      columns: ["Common", "Rare", "Epic"],
      rows: [{ label: "Damage", values: ["4", "–", "9"], trend: [undefined, undefined, "better"] }, { label: "Range", value: "3" }],
    })
    expect(dl.getAttribute("data-columns")).toBe("3")
    expect([...dl.querySelectorAll(".tavora-tooltip-rows-heading")].map((cell) => cell.textContent)).toEqual(["Common", "Rare", "Epic"])
    const cells = [...dl.querySelectorAll("dd")]
    expect(cells.map((cell) => cell.textContent)).toEqual(["4", "–", "9", "3", "", ""])
    expect(cells[1]!.hasAttribute("data-faint")).toBe(true)
    expect(cells[2]!.getAttribute("data-trend")).toBe("better")
    expect(cells[0]!.hasAttribute("data-trend")).toBe(false)
  })
})
