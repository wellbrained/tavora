// @vitest-environment jsdom
// TextLink and ListRow: what they render, how a chosen row is announced, and that a switched-off one takes no click.
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h, type App } from "vue"
import { ActionList } from "../action-list"
import { TextLink } from "../text-link"
import { ListRow } from "."

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

function render(node: () => ReturnType<typeof h>) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp({ render: node })
  app.mount(host)
  return host
}

const root = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot=${slot}]`)!

describe("TextLink", () => {
  it("is a plain button that takes the text's size and cuts its label off", () => {
    const go = vi.fn()
    const host = render(() => h(TextLink, { onClick: go }, { icon: () => h("svg"), default: () => "Iron Plate" }))
    const link = root(host, "text-link")
    expect(link.tagName).toBe("BUTTON")
    expect(link.getAttribute("type")).toBe("button")
    expect(link.className).toContain("hover:text-primary")
    expect(link.className).not.toMatch(/\bh-\d|text-(sm|xs|base)\b/)
    expect(root(host, "text-link-label").className).toContain("truncate")
    expect(root(host, "text-link-label").className).toContain("group-hover/text-link:underline")
    expect(root(host, "text-link-icon").getAttribute("aria-hidden")).toBe("true")
    link.click()
    expect(go).toHaveBeenCalledOnce()
  })

  it("wraps inside a sentence when asked", () => {
    const host = render(() => h(TextLink, { wrap: true }, () => "a long station name"))
    expect(root(host, "text-link").className).toMatch(/(^|\s)inline(\s|$)/)
    expect(root(host, "text-link-label").className).not.toContain("truncate")
  })

  it("is a page link with as=a", () => {
    const host = render(() => h(TextLink, { as: "a", href: "https://example.com" }, () => "Wiki"))
    const link = root(host, "text-link")
    expect(link.tagName).toBe("A")
    expect(link.getAttribute("href")).toBe("https://example.com")
    expect(link.hasAttribute("type")).toBe(false)
  })

  it("takes no click while off, and loses its hover look", () => {
    const go = vi.fn()
    const host = render(() => h(TextLink, { disabled: true, disabledReason: "Not in this version.", onClick: go }, () => "Iron Plate"))
    const link = root(host, "text-link")
    expect(link.getAttribute("aria-disabled")).toBe("true")
    expect(link.hasAttribute("disabled")).toBe(false)
    expect(link.className).not.toContain("hover:text-primary")
    link.click()
    expect(go).not.toHaveBeenCalled()
  })

  it("an off page link is announced as off and is not followed", () => {
    const go = vi.fn()
    const host = render(() => h(TextLink, { as: "a", href: "#x", disabled: true, onClick: go }, () => "Wiki"))
    const link = root(host, "text-link")
    expect(link.getAttribute("aria-disabled")).toBe("true")
    const click = new MouseEvent("click", { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(go).not.toHaveBeenCalled()
  })
})

describe("ListRow", () => {
  it("is one button with its parts in order", () => {
    const pick = vi.fn()
    const host = render(() =>
      h(ListRow, { onClick: pick }, { leading: () => h("svg"), default: () => "Berlin", description: () => "Light rain", trailing: () => "12°" }),
    )
    const row = root(host, "list-row")
    expect(row.tagName).toBe("BUTTON")
    expect(row.getAttribute("type")).toBe("button")
    expect([...row.children].map((child) => child.getAttribute("data-slot"))).toEqual(["list-row-leading", "list-row-label", "list-row-trailing"])
    expect(root(host, "list-row-description").textContent).toBe("Light rain")
    expect(row.hasAttribute("aria-current")).toBe(false)
    row.click()
    expect(pick).toHaveBeenCalledOnce()
  })

  it("leaves out the parts it is not given", () => {
    const host = render(() => h(ListRow, null, () => "Biomass"))
    expect(host.querySelector("[data-slot=list-row-leading]")).toBeNull()
    expect(host.querySelector("[data-slot=list-row-description]")).toBeNull()
    expect(host.querySelector("[data-slot=list-row-trailing]")).toBeNull()
  })

  it("says the selected row is the current one, with a primary tint", () => {
    const host = render(() => h(ListRow, { selected: true }, { default: () => "Iron Plate", trailing: () => "Item" }))
    const row = root(host, "list-row")
    expect(row.getAttribute("aria-current")).toBe("true")
    expect(row.hasAttribute("data-selected")).toBe(true)
    expect(row.className).toContain("bg-primary/10")
    expect(root(host, "list-row-trailing").className).toContain("text-primary")
  })

  it("in an option row says it with aria-selected instead", () => {
    const host = render(() => h("div", { role: "listbox" }, [h(ListRow, { role: "option", selected: true }, () => "A"), h(ListRow, { role: "option" }, () => "B")]))
    const [a, b] = [...host.querySelectorAll("[data-slot=list-row]")]
    expect(a!.getAttribute("aria-selected")).toBe("true")
    expect(b!.getAttribute("aria-selected")).toBe("false")
    expect(a!.hasAttribute("aria-current")).toBe(false)
  })

  it("shows the keyboard highlight without any aria of its own", () => {
    const host = render(() => h(ListRow, { highlighted: true }, () => "Rain"))
    const row = root(host, "list-row")
    expect(row.hasAttribute("data-highlighted")).toBe(true)
    expect(row.hasAttribute("aria-selected")).toBe(false)
    expect(row.hasAttribute("aria-current")).toBe(false)
  })

  it("is a plain disabled button when off without a reason, and a soft one with", () => {
    const pick = vi.fn()
    const host = render(() =>
      h("div", null, [h(ListRow, { disabled: true, onClick: pick }, () => "A"), h(ListRow, { disabled: true, disabledReason: "Already added.", onClick: pick }, () => "B")]),
    )
    const [plain, soft] = [...host.querySelectorAll<HTMLElement>("[data-slot=list-row]")]
    expect(plain!.hasAttribute("disabled")).toBe(true)
    expect(soft!.hasAttribute("disabled")).toBe(false)
    expect(soft!.getAttribute("aria-disabled")).toBe("true")
    expect(soft!.className).not.toContain("hover:bg-")
    soft!.click()
    expect(pick).not.toHaveBeenCalled()
  })

  it("as a div looks the same but is no control", () => {
    const host = render(() => h(ListRow, { as: "div", disabled: true }, () => "General"))
    const row = root(host, "list-row")
    expect(row.tagName).toBe("DIV")
    expect(row.hasAttribute("type")).toBe(false)
    expect(row.hasAttribute("aria-disabled")).toBe(false)
    expect(row.className).not.toContain("cursor-pointer")
    expect(row.className).not.toContain("hover:bg-")
  })
})

describe("ActionList on ListRow", () => {
  it("renders each entry as a row and reports the pick", () => {
    const picked: string[] = []
    const host = render(() =>
      h(ActionList, {
        entries: [
          { id: "import", label: "Import a build", description: "Start from a file.", testid: "start-import" },
          { id: "later", label: "Not yet", disabled: true },
        ],
        onSelect: (id: string) => picked.push(id),
      }),
    )
    const rows = [...host.querySelectorAll<HTMLElement>("[data-slot=list-row]")]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.getAttribute("data-testid")).toBe("start-import")
    expect(rows[0]!.querySelector("[data-slot=list-row-description]")!.textContent).toBe("Start from a file.")
    expect(rows[1]!.hasAttribute("disabled")).toBe(true)
    rows[0]!.click()
    expect(picked).toEqual(["import"])
  })
})
