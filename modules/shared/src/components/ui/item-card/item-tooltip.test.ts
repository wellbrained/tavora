// @vitest-environment jsdom
import type { TooltipContent } from "@tavora/sdk"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
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

describe("a card taller than the panel", () => {
  // jsdom lays nothing out: every box gets the height given here.
  async function tall(height: number) {
    const rect = { left: 0, top: 0, right: 280, bottom: height, width: 280, height, x: 0, y: 0, toJSON: () => ({}) }
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect)
    let dismissed = 0
    await render(() => h(ItemTooltip, { open: true, anchor, content: card, onDismiss: () => dismissed++ }))
    for (let pass = 0; pass < 4; pass++) await nextTick()
    spy.mockRestore()
    return { tooltip: document.querySelector<HTMLElement>("[data-slot=tooltip]")!, dismissed: () => dismissed }
  }

  it("is held to the panel's height, from its top, without an arrow", async () => {
    const { tooltip } = await tall(innerHeight + 200)
    expect(tooltip.getAttribute("data-scrolls")).toBe("true")
    expect(tooltip.style.maxHeight).toBe(`${innerHeight - 16}px`)
    expect(tooltip.style.top).toBe("8px")
    expect(tooltip.querySelector(".tavora-tooltip-arrow")).toBeNull()
  })

  it("scrolls with the wheel over its element, keeps the wheel from the page and stays open", async () => {
    const { tooltip, dismissed } = await tall(innerHeight + 200)
    const scroller = tooltip.firstElementChild as HTMLElement
    let top = 0
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => top, set: (value: number) => (top = Math.max(0, Math.min(value, 100))) })
    const turn = (deltaY: number, x = 15) => {
      const event = new WheelEvent("wheel", { deltaY, clientX: x, clientY: 15, bubbles: true, cancelable: true })
      document.body.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(turn(60)).toBe(true)
    expect(top).toBe(60)
    scroller.dispatchEvent(new Event("scroll"))
    expect(dismissed()).toBe(0)
    // At the card's end the wheel stays the card's; away from the element and the card it is the page's.
    turn(60)
    expect(turn(60)).toBe(true)
    expect(turn(60, 900)).toBe(false)
  })

  it("is measured again when a picture in it loads", async () => {
    const { tooltip } = await tall(100)
    const rect = { left: 0, top: 0, right: 280, bottom: innerHeight + 200, width: 280, height: innerHeight + 200, x: 0, y: 0, toJSON: () => ({}) }
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect)
    const picture = tooltip.appendChild(document.createElement("img"))
    picture.dispatchEvent(new Event("load"))
    for (let pass = 0; pass < 4; pass++) await nextTick()
    spy.mockRestore()
    expect(tooltip.getAttribute("data-scrolls")).toBe("true")
  })

  it("is left as it is when it fits", async () => {
    const { tooltip } = await tall(100)
    expect(tooltip.hasAttribute("data-scrolls")).toBe(false)
    expect(tooltip.style.maxHeight).toBe("")
  })
})
