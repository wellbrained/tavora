// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import { HoverRow } from "."
import { StatTile } from "../stat-tile"

// A row that shows a card on hover or focus but isn't a button: in the Tab order, no button role, any content.

let app: App | undefined
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
  return host
}

describe("HoverRow", () => {
  it("is a focusable block with the hover-row look, no button role, holding anything", async () => {
    const host = await render(() => h(HoverRow, { "aria-describedby": "x" }, () => [h("b", "Fireball"), h("span", "12,480")]))
    const row = host.querySelector<HTMLElement>("[data-slot=hover-row]")!
    expect(row.tagName).toBe("DIV")
    expect(row.getAttribute("tabindex")).toBe("0")
    expect(row.hasAttribute("role")).toBe(false)
    expect(row.classList.contains("tavora-hover-row")).toBe(true)
    expect(row.getAttribute("aria-describedby")).toBe("x")
    expect(row.textContent).toBe("Fireball12,480")
  })

  it("can be a list item, with the fill kept inside", async () => {
    const host = await render(() => h(HoverRow, { as: "li", inset: "0" }, () => "Row"))
    const row = host.querySelector<HTMLElement>("li[data-slot=hover-row]")!
    expect(row.style.getPropertyValue("--hover-row-inset")).toBe("0")
  })
})

describe("StatTile hoverable", () => {
  it("takes the hover-row look inside the tile and joins the Tab order; a plain tile doesn't", async () => {
    const host = await render(() => h("div", [h(StatTile, { value: 3, label: "Runs", hoverable: true }), h(StatTile, { value: 4, label: "Wins" })]))
    const [hoverable, plain] = [...host.querySelectorAll<HTMLElement>("[data-slot=stat-tile]")]
    expect(hoverable!.classList.contains("tavora-hover-row")).toBe(true)
    expect(hoverable!.getAttribute("tabindex")).toBe("0")
    expect(plain!.classList.contains("tavora-hover-row")).toBe(false)
    expect(plain!.hasAttribute("tabindex")).toBe(false)
  })
})
