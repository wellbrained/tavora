// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import type { TooltipContent } from "@tavora/sdk"
import { ItemCard, type ItemCardSkin } from "."
import { ITEM_CARD_TYPE } from "../../tooltip/typography"
import { heldSkinFonts } from "./skin-font"

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

function mount(content: TooltipContent, skin?: ItemCardSkin, copies = 1) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({ render: () => Array.from({ length: copies }, () => h(ItemCard, { content, skin })) })
  app.mount(root)
  return root.querySelector("[data-slot=item-card]") as HTMLElement
}

const card: TooltipContent = { title: "Archer Tower", subtitle: "Tower", layout: "card", image: "archer.png", badges: ["Rare"], effect: [{ text: "Shoots for " }, { text: "12", accent: true }, { text: " damage" }], properties: [{ label: "Range", value: "3" }], sections: [{ title: "Upgrades", rows: [{ text: "Level 2", status: "Next" }] }] }
const skin: ItemCardSkin = { frame: { image: "frame.png", slice: [6, 6, 6, 6] }, colors: { surface: "#14110f", text: "#f2ece0", accent: "#e8b04a" }, pixelArt: true, titleCaps: true }

describe("ItemCard", () => {
  it("lays the card out like the tooltip: picture, name bar, type line, badges, effect box, rows", () => {
    const el = mount(card)
    expect(el.dataset.layout).toBe("card")
    expect([...el.children].map((c) => c.className)).toEqual(["tavora-item-card-art", "tavora-item-card-name", "tavora-item-card-type", "tavora-item-card-badges", "tavora-item-card-effect", "tavora-item-card-props", "tavora-item-card-section"])
    expect(el.querySelector("h3")!.textContent).toBe("Archer Tower")
    expect(el.querySelector(".tavora-item-card-effect")!.textContent).toBe("Shoots for 12 damage")
    expect([...el.querySelectorAll("[data-accent]")].map((a) => a.textContent)).toEqual(["12"])
    expect(el.style.getPropertyValue("--ic-title-size")).toBe(`${ITEM_CARD_TYPE.title}px`)
    expect(el.style.getPropertyValue("--ic-effect-size")).toBe(`${ITEM_CARD_TYPE.effect}px`)
    expect(el.hasAttribute("data-skinned")).toBe(false)
  })

  it("wears a skin on the card: its colours (the rest filled in), frame, capitals, hard pixels and larger title", async () => {
    const el = mount(card, skin)
    await nextTick()
    for (const flag of ["data-skinned", "data-colors", "data-framed", "data-caps", "data-pixel"]) expect(el.hasAttribute(flag)).toBe(true)
    expect(el.style.getPropertyValue("--skin-surface")).toBe("#14110f")
    expect(el.style.getPropertyValue("--skin-muted")).toBe("#f2ece0")
    expect(el.style.getPropertyValue("--skin-box")).toBe("#14110f")
    expect(el.style.getPropertyValue("--ic-title-size")).toBe(`${ITEM_CARD_TYPE.skinTitle}px`)
    expect(el.style.getPropertyValue("--ic-effect-size")).toBe(`${ITEM_CARD_TYPE.skinEffect}px`)
    expect(el.style.borderImageSource).toContain("frame.png")
  })

  it("shows the rich layout with the picture beside the text, and no skin there", () => {
    const el = mount({ ...card, layout: "rich" }, skin)
    expect(el.dataset.layout).toBe("rich")
    expect(el.querySelector(".tavora-item-card-rich > img")).not.toBeNull()
    expect(el.querySelector(".tavora-item-card-heading h3")!.textContent).toBe("Archer Tower")
    expect(el.hasAttribute("data-skinned")).toBe(false)
    expect(el.style.getPropertyValue("--skin-surface")).toBe("")
  })

  it("loads a skin's font once for every card that uses it, and lets go of it with the last card", () => {
    const fonts = new Set<unknown>()
    vi.stubGlobal("FontFace", class { constructor(readonly family: string, readonly source: string) {} load() { return Promise.resolve(this) } })
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true })
    try {
      mount(card, { ...skin, font: "card.woff2" }, 3)
      expect(heldSkinFonts()).toBe(1)
      expect(fonts.size).toBe(1)
      const cards = document.querySelectorAll<HTMLElement>("[data-slot=item-card]")
      expect(cards).toHaveLength(3)
      expect(new Set(Array.from(cards, (c) => c.style.getPropertyValue("--skin-font"))).size).toBe(1)
      app!.unmount()
      app = undefined
      expect(heldSkinFonts()).toBe(0)
      expect(fonts.size).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      delete (document as { fonts?: unknown }).fonts
    }
  })

  it("keeps text as text, and a plain-text effect as one run", () => {
    const el = mount({ title: "<b>x</b>", layout: "card", effect: "<i>y</i>" })
    expect(el.querySelector("h3")!.textContent).toBe("<b>x</b>")
    expect(el.querySelector("b, i")).toBeNull()
    expect(el.querySelector(".tavora-item-card-effect")!.textContent).toBe("<i>y</i>")
  })
})
