// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, nextTick, type App, type VNode } from "vue"
import { setUiLanguage } from "../ui/text"
import { ItemCard } from "../ui/item-card"
import { TooltipArt, TooltipFooter, TooltipHeading, TooltipIcons, TooltipList, TooltipTags, TooltipText } from "./parts"

// The freestanding parts: plain values in, the tooltip's classes out, and text always as text.

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  setUiLanguage("en")
})

async function render(node: () => VNode | VNode[]) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp({ render: node })
  app.mount(host)
  await nextTick()
  return host
}

describe("TooltipText", () => {
  it("draws runs with accent, bold and italic parts, and keeps a line break in the text", async () => {
    const host = await render(() => h(TooltipText, { runs: [{ text: "Deals " }, { text: "25%", accent: true, strong: true }, { text: " more.\nStacks.", italic: true }] }))
    const p = host.querySelector("p.tavora-tooltip-text")!
    expect(p.textContent).toBe("Deals 25% more.\nStacks.")
    expect(p.querySelector("[data-accent] strong")!.textContent).toBe("25%")
    expect(p.querySelector("em")!.textContent).toBe(" more.\nStacks.")
  })

  it("takes a plain text, a muted tone, the small size and the effect box", async () => {
    const host = await render(() => h(TooltipText, { text: "<b>2</b> left", tone: "muted", size: "small", box: true }))
    const p = host.querySelector<HTMLElement>("p")!
    expect(p.textContent).toBe("<b>2</b> left")
    expect(p.querySelector("b")).toBeNull()
    expect([p.dataset.tone, p.dataset.size, p.hasAttribute("data-box")]).toEqual(["muted", "small", true])
  })
})

describe("the other parts", () => {
  it("draw a heading, tags with their own colour (hex only), a list with meta text, and a footer", async () => {
    const host = await render(() => [
      h(TooltipHeading, { text: "Found in" }),
      h(TooltipTags, { tags: ["Fire", { text: "Legendary", color: "#e0a243" }, { text: "Odd", color: "red" }] }),
      h(TooltipList, { items: ["Ashen Caves", { text: "Sunken Halls", meta: "Rare" }] }),
      h(TooltipFooter, null, () => [h("strong", "Cost:"), " 3"]),
    ])
    expect(host.querySelector("h4.tavora-tooltip-heading")!.textContent).toBe("Found in")
    const tags = [...host.querySelectorAll<HTMLElement>(".tavora-tooltip-tags li")]
    expect(tags.map((t) => t.textContent)).toEqual(["Fire", "Legendary", "Odd"])
    expect(tags[1]!.style.color).toBe("rgb(224, 162, 67)")
    expect(tags[2]!.style.color).toBe("")
    expect([...host.querySelectorAll(".tavora-tooltip-list li")].map((li) => [...li.children].map((c) => c.textContent))).toEqual([["Ashen Caves"], ["Sunken Halls", "Rare"]])
    expect(host.querySelector("footer.tavora-tooltip-footer")!.textContent).toBe("Cost: 3")
  })

  it("draw nothing for an empty list, tag row or icon row", async () => {
    const host = await render(() => [h(TooltipTags, { tags: [] }), h(TooltipList, { items: [] }), h(TooltipIcons, { icons: [] })])
    expect(host.children).toHaveLength(0)
  })

  it("name each icon with its count in the language shown", async () => {
    const host = await render(() => h(TooltipIcons, { icons: [{ image: "coat.webp", label: "Steel Coat", count: "95" }, { label: "Static" }] }))
    const icons = [...host.querySelectorAll(".tavora-tooltip-icon")]
    expect(icons.map((i) => [i.getAttribute("role"), i.getAttribute("aria-label")])).toEqual([["img", "Steel Coat, 95"], ["img", "Static"]])
    expect(icons[0]!.querySelector("img")!.getAttribute("alt")).toBe("")
    expect(icons[0]!.querySelector(".tavora-tooltip-icon-count")!.getAttribute("aria-hidden")).toBe("true")
  })

  it("draw the art header with a picture, or pictures laid over each other in its slot", async () => {
    const host = await render(() => [
      h(TooltipArt, { title: "Glider", subtitle: "Unlocked", image: "glider.webp" }),
      h(TooltipArt, { title: "Wand" }, { art: () => [h("img", { src: "frame.webp", alt: "" }), h("img", { src: "icon.webp", alt: "" })] }),
    ])
    const [one, two] = [...host.querySelectorAll("header.tavora-tooltip-art")]
    expect(one!.querySelector("h3")!.textContent).toBe("Glider")
    expect(one!.querySelector("p")!.textContent).toBe("Unlocked")
    expect(one!.querySelector(".tavora-tooltip-art-picture")!.getAttribute("aria-hidden")).toBe("true")
    expect(two!.querySelectorAll(".tavora-tooltip-art-picture img")).toHaveLength(2)
    expect(two!.querySelector("p")).toBeNull()
  })

  it("fit inside an item card's slot", async () => {
    const host = await render(() => h(ItemCard, { content: { title: "Relic", layout: "card" } }, () => [h(TooltipText, { text: "You have 2 of these.", tone: "muted" })]))
    expect(host.querySelector("[data-slot=item-card] > p.tavora-tooltip-text")).not.toBeNull()
  })
})

describe("unit card labels", () => {
  it("say the pips in the language shown", async () => {
    setUiLanguage("de")
    const host = await render(() => h(ItemCard, { content: { title: "Soldier", layout: "unit", pips: { filled: 2, total: 3, extra: "+67" }, icons: [{ image: "a.webp", label: "Mantel", count: "9" }] } }))
    expect(host.querySelector(".tavora-item-card-pips")!.getAttribute("aria-label")).toBe("2 von 3, +67")
    expect(host.querySelector(".tavora-item-card-unit-icon")!.getAttribute("aria-label")).toBe("Mantel, 9")
    setUiLanguage("en")
    await nextTick()
    expect(host.querySelector(".tavora-item-card-pips")!.getAttribute("aria-label")).toBe("2 of 3, +67")
  })
})
