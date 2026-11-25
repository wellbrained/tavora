// @vitest-environment jsdom
import type { TooltipContent } from "@tavora/sdk"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import { fromBundle, ItemCard, ItemCardName, ItemCardStats, ItemTooltip, type ItemCardSkin } from "."

// One card, described once (TooltipContent), in the panel's own tooltip; and cards put together from the item card's parts.

let app: App | undefined
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

async function render(node: () => ReturnType<typeof h>) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp({ render: node })
  app.mount(host)
  await nextTick()
  await nextTick()
}

const anchor = { left: 10, top: 10, right: 20, bottom: 20 }
const card: TooltipContent = { title: "Archer Tower", subtitle: "Tower", layout: "card", badges: ["Rare"], properties: [{ label: "Range", value: "3" }] }

describe("ItemTooltip", () => {
  it("shows the item card in the panel's tooltip, with the tooltip's own surface left out", async () => {
    await render(() => h(ItemTooltip, { open: true, anchor, content: card }))
    const tooltip = document.querySelector<HTMLElement>("[data-slot=tooltip]")!
    expect(tooltip.getAttribute("data-bare")).toBe("true")
    expect(tooltip.querySelector(":scope > [data-slot=item-card]")?.getAttribute("data-layout")).toBe("card")
    expect(tooltip.querySelector("h3")?.textContent).toBe("Archer Tower")
    expect(tooltip.querySelector(".tavora-tooltip-title")).toBeNull()
    expect(tooltip.querySelector(".tavora-tooltip-arrow")).not.toBeNull()
  })

  it("shows nothing without a card", async () => {
    await render(() => h(ItemTooltip, { open: true, anchor, content: null }))
    expect(document.querySelector("[data-slot=tooltip]")).toBeNull()
  })

  it("leaves the arrow out on a card in a skin's colours", async () => {
    const skin: ItemCardSkin = { colors: { surface: "#14110f", text: "#f2ece0" } }
    await render(() => h(ItemTooltip, { open: true, anchor, content: card, skin }))
    expect(document.querySelector(".tavora-tooltip-arrow")).toBeNull()
  })

  it("leaves the arrow out on a unit and on a card in a skin's frame", async () => {
    await render(() => h(ItemTooltip, { open: true, anchor, content: { ...card, layout: "unit" } }))
    expect(document.querySelector(".tavora-tooltip-arrow")).toBeNull()
    app!.unmount()
    document.body.replaceChildren()
    await render(() => h(ItemTooltip, { open: true, anchor, content: card, skin: { frame: { image: "frame.png", slice: [6, 6, 6, 6] } } }))
    expect(document.querySelector(".tavora-tooltip-arrow")).toBeNull()
  })

  it("puts what's in its slot into the card instead of the layout's parts", async () => {
    await render(() => h(ItemTooltip, { open: true, anchor, content: card }, () => [h(ItemCardName, { content: card }), h("p", { class: "own" }, "Mine")]))
    const el = document.querySelector("[data-slot=item-card]")!
    expect([...el.children].map((child) => child.className)).toEqual(["tavora-item-card-name", "own"])
  })
})

describe("ItemCard parts", () => {
  it("make a card of your own that keeps the layout's look", async () => {
    await render(() => h(ItemCard, { content: card }, () => [h(ItemCardStats, { content: card }), h(ItemCardName, { content: card })]))
    const el = document.querySelector<HTMLElement>("[data-slot=item-card]")!
    expect(el.dataset.layout).toBe("card")
    expect([...el.children].map((child) => child.className)).toEqual(["tavora-item-card-stats", "tavora-item-card-name"])
  })

  it("draw nothing for what the card doesn't have", async () => {
    await render(() => h(ItemCard, { content: { title: "Bare", layout: "card" } }, () => [h(ItemCardStats, { content: { title: "Bare" } })]))
    expect(document.querySelector("[data-slot=item-card]")!.children).toHaveLength(0)
  })
})

describe("fromBundle", () => {
  it("turns the bundle's picture paths into addresses under the module's folder, and leaves addresses be", () => {
    const content: TooltipContent = { title: "A", image: "dist/a.webp", corner: { text: "1", icon: "dist/c.png" }, icons: [{ label: "x", image: "dist/i.png" }, { label: "y", image: "data:image/png;base64,AA" }], properties: [{ label: "p", value: "1", icon: "https://cdn.example/p.png" }, { label: "q", value: "2" }] }
    const local = fromBundle(content, "tavora-module://my.module/")
    expect(local.image).toBe("tavora-module://my.module/dist/a.webp")
    expect(local.corner?.icon).toBe("tavora-module://my.module/dist/c.png")
    expect(local.icons?.map((icon) => icon.image)).toEqual(["tavora-module://my.module/dist/i.png", "data:image/png;base64,AA"])
    expect(local.properties?.map((p) => p.icon)).toEqual(["https://cdn.example/p.png", undefined])
    expect(content.image).toBe("dist/a.webp")
  })
})
