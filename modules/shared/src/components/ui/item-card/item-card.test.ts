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
  it("lays the card out like the tooltip: picture, title with its badges, type line, effect box, stats, rows", () => {
    const el = mount(card)
    expect(el.dataset.layout).toBe("card")
    expect([...el.children].map((c) => c.className)).toEqual(["tavora-item-card-art", "tavora-item-card-name", "tavora-item-card-type", "tavora-item-card-effect", "tavora-item-card-stats", "tavora-item-card-section"])
    expect(el.querySelector(".tavora-item-card-name .tavora-item-card-badges")).not.toBeNull()
    expect(el.querySelector(".tavora-item-card-stats")!.hasAttribute("data-per")).toBe(false)
    expect(el.querySelectorAll(".tavora-item-card-stats > *")).toHaveLength(2)
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
    expect(el.hasAttribute("data-box-edge")).toBe(false)
  })

  it("draws the skin's edge around the effect box only when the skin gives one", () => {
    const el = mount(card, { ...skin, colors: { ...skin.colors, boxBorder: "#a07c40" } })
    expect(el.hasAttribute("data-box-edge")).toBe(true)
    expect(el.style.getPropertyValue("--skin-box-border")).toBe("#a07c40")
    app!.unmount()
    const plain = mount(card)
    expect(plain.hasAttribute("data-box-edge")).toBe(false)
    expect(plain.hasAttribute("data-skinned")).toBe(false)
  })

  it("shows what a stat grows by in a third column with its heading, and after the value in the rich layout", () => {
    const levels: TooltipContent = { ...card, perHeading: "Per level", properties: [{ label: "Damage", value: "12", per: "+3" }, { label: "Range", value: "3" }] }
    const stats = mount(levels).querySelector(".tavora-item-card-stats")!
    expect(stats.hasAttribute("data-per")).toBe(true)
    expect(Array.from(stats.children, (c) => c.textContent)).toEqual(["", "", "Per level", "Damage", "12", "+3", "Range", "3", ""])
    app!.unmount()
    const rich = mount({ ...levels, layout: "rich" })
    expect(Array.from(rich.querySelectorAll(".tavora-item-card-props dd"), (d) => d.textContent)).toEqual(["12 · +3", "3"])
  })

  it("draws a stat's icon before its label as a mask, and keeps its room on every label when only some have one", () => {
    const icons: TooltipContent = { ...card, perHeading: "Per level", properties: [{ label: "HP", value: "40", icon: "icons/heart.png" }, { label: "Damage", value: "12", per: "+3", icon: "data:image/png;base64,iVBORw0KGgo=" }, { label: "Range", value: "3" }] }
    const stats = mount(icons).querySelector(".tavora-item-card-stats")!
    expect(stats.hasAttribute("data-icons")).toBe(true)
    const labels = Array.from(stats.querySelectorAll(".tavora-item-card-label"))
    // The label's text stays its name; the icon is decoration.
    expect(labels.map((l) => l.textContent)).toEqual(["HP", "Damage", "Range"])
    const marks = labels.map((l) => l.firstElementChild as HTMLElement)
    expect(marks.map((m) => m.className)).toEqual(["tavora-item-card-icon", "tavora-item-card-icon", "tavora-item-card-icon"])
    expect(marks.map((m) => m.hasAttribute("data-drawn"))).toEqual([true, true, false])
    expect(marks.every((m) => m.getAttribute("aria-hidden") === "true")).toBe(true)
    // A page path is made absolute against the page, so the stylesheet's address can't change it.
    expect(marks[0]!.style.getPropertyValue("--ic-icon")).toBe(`url("${new URL("icons/heart.png", document.baseURI).href}")`)
    expect(marks[2]!.style.getPropertyValue("--ic-icon")).toBe("")
    expect(Array.from(stats.children, (c) => c.textContent)).toEqual(["", "", "Per level", "HP", "40", "", "Damage", "12", "+3", "Range", "3", ""])
    app!.unmount()
    // A quote in the path can't end the url early.
    const odd = mount({ ...card, properties: [{ label: "HP", value: "40", icon: 'a.png"),url(b.png' }] }).querySelector<HTMLElement>(".tavora-item-card-icon")!
    expect(odd.style.getPropertyValue("--ic-icon")).not.toContain('"),url(')
    app!.unmount()
    // Without any icon the labels are plain text, as before; the rich layout shows none.
    expect(mount(card).querySelector(".tavora-item-card-stats")!.hasAttribute("data-icons")).toBe(false)
    expect(document.querySelector(".tavora-item-card-icon")).toBeNull()
    app!.unmount()
    expect(mount({ ...icons, layout: "rich" }).querySelector(".tavora-item-card-icon")).toBeNull()
  })

  it("lists requirements on the card in the same columns as the stats", () => {
    const grid = mount({ ...card, requirements: [{ label: "Level", value: "12" }] }).querySelector(".tavora-item-card-section:last-child .tavora-item-card-stats")!
    expect(Array.from(grid.children, (c) => c.className)).toEqual(["tavora-item-card-label", "tavora-item-card-value"])
    expect(grid.closest("article")!.querySelector("dl")).toBeNull()
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
