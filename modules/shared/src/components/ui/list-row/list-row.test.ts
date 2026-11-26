// @vitest-environment jsdom
// ListRow: what it renders, how a chosen row is announced, and that a switched-off one takes no click.
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h, type App } from "vue"
import { ActionList } from "../action-list"
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

  it("says the selected row is the current page when it navigates", () => {
    const host = render(() => h(ListRow, { selected: true, navigation: true }, () => "About"))
    expect(root(host, "list-row").getAttribute("aria-current")).toBe("page")
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

  it("an off page-link row loses its href", () => {
    const host = render(() => h(ListRow, { as: "a", href: "#place", disabled: true }, () => "Berlin"))
    const row = root(host, "list-row")
    expect(row.hasAttribute("href")).toBe(false)
    expect(row.getAttribute("aria-disabled")).toBe("true")
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
