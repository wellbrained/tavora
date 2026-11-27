// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import type { TooltipContent } from "@tavora/sdk"
import { ItemCard, type ItemCardSkin } from "."
import { ITEM_CARD_TYPE, TOOLTIP_TYPE, UNIT_CARD_TYPE } from "../../tooltip/typography"
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
    expect(Array.from(rich.querySelectorAll(".tavora-item-card-prop-value"), (d) => d.textContent)).toEqual(["12 · +3", "3"])
  })

  it("shows a stat's extra values in columns of their own under their headings, and after the value in the rich layout", () => {
    const levels: TooltipContent = { ...card, columns: ["Lv 1", "Lv 2", "Lv 3"], perHeading: "Per level", properties: [{ label: "Units", value: "6", more: ["12", "18"] }, { label: "Attack speed", value: "0.6" }, { label: "Damage", value: "6", more: ["", "8.6"], per: "+1" }] }
    const stats = mount(levels).querySelector<HTMLElement>(".tavora-item-card-stats")!
    expect(stats.hasAttribute("data-columns")).toBe(true)
    expect(stats.hasAttribute("data-per")).toBe(true)
    expect(stats.style.getPropertyValue("--ic-columns")).toBe("4")
    expect(Array.from(stats.children, (c) => c.textContent)).toEqual(["", "Lv 1", "Lv 2", "Lv 3", "Per level", "Units", "6", "12", "18", "", "Attack speed", "0.6", "", "", "", "Damage", "6", "", "8.6", "+1"])
    expect(Array.from(stats.querySelectorAll(".tavora-item-card-per-heading"), (h) => h.textContent)).toEqual(["Lv 1", "Lv 2", "Lv 3", "Per level"])
    expect(Array.from(stats.querySelectorAll(".tavora-item-card-more"), (c) => c.textContent)).toEqual(["12", "18", "", "", "", "8.6"])
    app!.unmount()
    // Without columns there is no heading row; a per heading sits over the per column, after the extra ones.
    const bare = mount({ ...card, perHeading: "Per level", properties: [{ label: "Units", value: "6", more: ["12"], per: "+6" }, { label: "Range", value: "3" }] }).querySelector<HTMLElement>(".tavora-item-card-stats")!
    expect(bare.style.getPropertyValue("--ic-columns")).toBe("3")
    expect(Array.from(bare.children, (c) => c.textContent)).toEqual(["", "", "", "Per level", "Units", "6", "12", "+6", "Range", "3", "", ""])
    app!.unmount()
    // A card without extra values keeps its columns as before.
    expect(mount(card).querySelector(".tavora-item-card-stats")!.hasAttribute("data-columns")).toBe(false)
    app!.unmount()
    const rich = mount({ ...levels, layout: "rich", properties: [...levels.properties!, { label: "Shield", value: "", more: ["", "4", " "] }] })
    expect(Array.from(rich.querySelectorAll(".tavora-item-card-prop-value"), (d) => d.textContent)).toEqual(["6 · 12 · 18", "0.6", "6 · – · 8.6 · +1", "– · – · 4"])
  })

  it("draws the tags over the picture in its bottom corners, coloured ones in their colour, and as badges without a picture", () => {
    const tagged: TooltipContent = { ...card, badges: ["Troop"], artTags: [{ text: "Stone", side: "left" }, { text: "Legendary", color: "#e0a243" }, { text: "Odd", color: "red", side: "right" }] }
    const el = mount(tagged)
    const art = el.querySelector(".tavora-item-card-art")!
    expect([...art.querySelectorAll(".tavora-item-card-art-tags > div")].map((row) => `${row.getAttribute("data-side")}: ${[...row.children].map((t) => t.textContent).join(", ")}`)).toEqual(["left: Stone", "right: Legendary, Odd"])
    const [stone, legendary, odd] = [...art.querySelectorAll<HTMLElement>(".tavora-item-card-art-tag")]
    expect(stone!.getAttribute("style")).toBeNull()
    expect([legendary!.style.color, legendary!.style.borderColor]).toEqual(["rgb(224, 162, 67)", "rgb(224, 162, 67)"])
    expect(odd!.getAttribute("style")).toBeNull()
    expect([...el.querySelectorAll(".tavora-item-card-name .tavora-item-card-badge")].map((b) => b.textContent)).toEqual(["Troop"])
    app!.unmount()
    // Without a picture, and in the rich layout, their texts follow the badges, in their order.
    const { image: _image, ...bare } = tagged
    const plain = mount(bare)
    expect(plain.querySelector(".tavora-item-card-art-tags")).toBeNull()
    expect([...plain.querySelectorAll(".tavora-item-card-badge")].map((b) => b.textContent)).toEqual(["Troop", "Stone", "Legendary", "Odd"])
    app!.unmount()
    const rich = mount({ ...tagged, layout: "rich" })
    expect(rich.querySelector(".tavora-item-card-art-tags")).toBeNull()
    expect([...rich.querySelectorAll(".tavora-item-card-badge")].map((b) => b.textContent)).toEqual(["Troop", "Stone", "Legendary", "Odd"])
  })

  it("draws a \u2013 in an extra column faint, and nothing else", () => {
    const stats = mount({ ...card, columns: ["Lv 1", "Lv 2", "Lv 3"], properties: [{ label: "Units", value: "6", more: ["\u2013", "12"] }, { label: "Range", value: "3", more: ["-", "\u2013 1"] }] }).querySelector(".tavora-item-card-stats")!
    expect([...stats.querySelectorAll(".tavora-item-card-more")].map((c) => c.hasAttribute("data-faint"))).toEqual([true, false, false, false])
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
    expect(el.querySelector(".tavora-item-card-rich-art > img")).not.toBeNull()
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

  const unit: TooltipContent = {
    title: "Soldier",
    layout: "unit",
    image: "soldier.webp",
    badges: ["Rare"],
    corner: { text: "1800", icon: "icons/person.png" },
    effect: [{ text: "Gains " }, { text: "+1%", accent: true }, { text: " damage per unit." }],
    properties: [{ label: "Health:", value: "3.95", suffix: "E+12" }, { label: "Hits/Second:", value: "99.999", suffix: " (MAX)" }, { label: "Crit Chance:", value: "5%" }],
    icons: [{ image: "steel-coat.webp", label: "Steel Coat", count: "95" }, { image: "static.webp", label: "Static" }],
    pips: { filled: 2, total: 3, extra: "+67" },
  }

  it("lays a unit out like the tooltip: portrait, title bar with its corner value, effect, stats, icon row and pips", () => {
    const el = mount(unit)
    expect(el.dataset.layout).toBe("unit")
    for (const flag of ["data-portrait", "data-pips", "data-extra"]) expect(el.hasAttribute(flag)).toBe(true)
    expect([...el.children].map((c) => c.className)).toEqual(["tavora-item-card-portrait", "tavora-item-card-bar", "tavora-item-card-unit-body"])
    expect(el.querySelector(".tavora-item-card-bar h3")!.textContent).toBe("Soldier")
    expect(el.querySelector(".tavora-item-card-corner")!.textContent).toBe("1800")
    expect((el.querySelector(".tavora-item-card-corner-icon") as HTMLElement).style.getPropertyValue("--ic-icon")).toContain("icons/person.png")
    const body = el.querySelector(".tavora-item-card-unit-body")!
    expect([...body.children].map((c) => c.className)).toEqual(["tavora-item-card-unit-effect", "tavora-item-card-unit-stats", "tavora-item-card-icons", "tavora-item-card-pips", "tavora-item-card-extra"])
    expect([...body.querySelector(".tavora-item-card-unit-stats")!.children].map((c) => c.textContent)).toEqual(["Health:", "3.95", "E+12", "Hits/Second:", "99.999", " (MAX)", "Crit Chance:", "5%", ""])
    expect([...body.querySelectorAll(".tavora-item-card-unit-icon")].map((i) => i.getAttribute("aria-label"))).toEqual(["Steel Coat, 95", "Static"])
    expect([...body.querySelectorAll(".tavora-item-card-pip")].map((p) => p.hasAttribute("data-on"))).toEqual([true, true, false])
    expect(body.querySelector(".tavora-item-card-extra")!.textContent).toBe("+67")
    expect(el.querySelector(".tavora-item-card-badge")).toBeNull()
    expect(el.style.getPropertyValue("--ic-title-size")).toBe(`${UNIT_CARD_TYPE.title}px`)
    expect(el.style.getPropertyValue("--ic-text-size")).toBe(`${UNIT_CARD_TYPE.text}px`)
  })

  it("dresses a unit in its skin's colours and bar but no frame, and leaves out what it doesn't have", () => {
    const el = mount({ title: "Thief", layout: "unit", properties: [{ label: "Health:", value: "18.8" }] }, { ...skin, colors: { ...skin.colors, bar: "#776538" } })
    expect(el.style.getPropertyValue("--skin-bar")).toBe("#776538")
    expect(el.hasAttribute("data-framed")).toBe(false)
    expect(el.style.borderImageSource).toBe("")
    for (const flag of ["data-portrait", "data-pips", "data-extra"]) expect(el.hasAttribute(flag)).toBe(false)
    expect(el.querySelector(".tavora-item-card-portrait, .tavora-item-card-corner, .tavora-item-card-icons, .tavora-item-card-pips")).toBeNull()
  })

  it("puts a suffix into the value in the card and rich layouts", () => {
    const properties = [{ label: "Health", value: "3.95", suffix: "E+12" }]
    expect(mount({ title: "A", layout: "card", properties }).querySelector(".tavora-item-card-value")!.textContent).toBe("3.95E+12")
    app!.unmount()
    expect(mount({ title: "A", properties }).querySelector(".tavora-item-card-prop-value")!.textContent).toBe("3.95E+12")
  })

  it("keeps text as text, and a plain-text effect as one run", () => {
    const el = mount({ title: "<b>x</b>", layout: "card", effect: "<i>y</i>" })
    expect(el.querySelector("h3")!.textContent).toBe("<b>x</b>")
    expect(el.querySelector("b, i")).toBeNull()
    expect(el.querySelector(".tavora-item-card-effect")!.textContent).toBe("<i>y</i>")
  })
})

describe("ItemCard in the PoE look", () => {
  const item: TooltipContent = { look: "poe", tone: "rare", title: "Doom Loop", subtitle: "Ultimate Robe", image: "robe.png", badges: ["ilvl 82"], requirements: [{ label: "Level", value: "65" }], properties: [{ label: "Energy Shield", value: "312" }], sections: [{ rows: [{ text: "+98 to maximum Energy Shield", badges: ["[P1]"], status: "Crafted" }, { text: "42% increased Energy Shield", connected: true }] }] }

  it("wears the look and colours the title by its rarity, in the rich layout as in the shared tooltip", () => {
    const el = mount(item)
    expect(el.dataset.look).toBe("poe")
    expect(el.querySelector("h3")!.dataset.tone).toBe("rare")
    // The requirements sit under the picture, the stats read "Label: value", the rows keep their status and tags.
    expect(el.querySelector(".tavora-item-card-rich-art > img")).not.toBeNull()
    expect(el.querySelector(".tavora-item-card-rich-art .tavora-item-card-requirements dd")!.textContent).toBe("65")
    expect(el.querySelector(".tavora-item-card-props > div")!.textContent).toBe("Energy Shield: 312")
    expect([...el.querySelector(".tavora-item-card-affixes")!.children].map((c) => [c.tagName, c.textContent])).toEqual([["SMALL", "Crafted"], ["SPAN", "[P1]"]])
    expect(el.style.getPropertyValue("--ic-title-size")).toBe(`${TOOLTIP_TYPE.title}px`)
  })

  it("wears it on a card too, but not with a skin or on a unit", () => {
    expect(mount({ ...item, layout: "card" }).dataset.look).toBe("poe")
    app!.unmount()
    expect(mount({ ...item, layout: "card" }, skin).hasAttribute("data-look")).toBe(false)
    app!.unmount()
    expect(mount({ ...item, layout: "unit" }).hasAttribute("data-look")).toBe(false)
    app!.unmount()
    expect(mount({ ...item, look: "neutral" }).hasAttribute("data-look")).toBe(false)
  })

  it("keeps the left column for the PoE look even without a picture, as the shared tooltip does", () => {
    expect(mount({ ...item, image: undefined, requirements: undefined }).querySelector(".tavora-item-card-rich-art")).not.toBeNull()
    app!.unmount()
    expect(mount({ title: "Plain", properties: [{ label: "A", value: "1" }] }).querySelector(".tavora-item-card-rich-art")).toBeNull()
  })
})

describe("ItemCard with formatting", () => {
  const formatted: TooltipContent = {
    title: "Multi Shot",
    effect: [{ text: "Shooting " }, { text: "Regular Arrows", italic: true }, { text: " has a " }, { text: "20%", accent: true, strong: true }, { text: " chance." }],
    sections: [{ rows: [{ text: "Affix" }] }],
    blocks: [
      { type: "text", runs: [{ text: "A flavour line", italic: true }], tone: "muted", size: "small" },
      { type: "heading", text: "Found in" },
      { type: "list", items: ["Spire", { text: "Shroud", meta: "Rare" }] },
      { type: "tags", tags: ["Stone", { text: "Legendary", color: "#e0a243" }] },
    ],
    footer: [{ text: "Skill points: ", strong: true }, { text: "3" }],
  }
  const partSlots = (el: Element) => [...el.querySelectorAll("[data-slot^=tooltip-]")].map((p) => p.getAttribute("data-slot"))

  it("draws bold and italic runs in the effect", () => {
    expect(mount({ ...formatted, layout: "card" }).querySelector(".tavora-item-card-effect")!.innerHTML).toBe('Shooting <em>Regular Arrows</em> has a <span data-accent=""><strong>20%</strong></span> chance.')
  })

  it("draws the blocks after the sections and the footer at the bottom, with the kit's parts, in every layout", () => {
    for (const layout of ["card", "rich", "unit"] as const) {
      const el = mount({ ...formatted, layout })
      expect(partSlots(el)).toEqual(["tooltip-text", "tooltip-heading", "tooltip-list", "tooltip-tags", "tooltip-footer"])
      const text = el.querySelector("[data-slot=tooltip-text]")!
      expect(text.getAttribute("data-tone")).toBe("muted")
      expect(text.innerHTML).toBe("<em>A flavour line</em>")
      expect(text.previousElementSibling!.className).toBe("tavora-item-card-section")
      expect(el.querySelector("[data-slot=tooltip-footer]")!.innerHTML).toBe("<strong>Skill points: </strong>3")
      app!.unmount()
    }
    // Last in a card and in the rich layout; before the pips in a unit.
    expect(mount({ ...formatted, layout: "card" }).lastElementChild!.getAttribute("data-slot")).toBe("tooltip-footer")
    app!.unmount()
    expect(mount({ ...formatted, layout: "rich" }).lastElementChild!.getAttribute("data-slot")).toBe("tooltip-footer")
  })

  it("draws neither without them", () => {
    expect(partSlots(mount(card))).toEqual([])
  })
})
