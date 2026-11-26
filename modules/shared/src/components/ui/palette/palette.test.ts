// @vitest-environment jsdom
import { Plus } from "@lucide/vue"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, h, nextTick, ref, type App } from "vue"
import { PaletteFooter, PaletteGroup, PaletteItem, PaletteList, PaletteSearch } from "."
import { Listbox } from "../listbox"
import { setUiLanguage } from "../text"

let app: App | undefined
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  setUiLanguage("en")
})

async function mount(render: () => unknown) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({ render })
  app.mount(root)
  for (let tick = 0; tick < 3; tick++) await nextTick()
  return root
}

describe("PaletteSearch", () => {
  it("is the list's combobox only with a list, and leaves Escape to what is around it", async () => {
    const query = ref("pal")
    let escapes = 0
    const root = await mount(() =>
      h("div", { onKeydown: (event: KeyboardEvent) => event.key === "Escape" && escapes++ }, [
        h(PaletteSearch, { "modelValue": query.value, "onUpdate:modelValue": (value: string) => (query.value = value), "list": "results", "activeId": "row-2", "aria-label": "Search", "data-testid": "field" }),
        h(PaletteSearch, { "aria-label": "Start", "data-testid": "plain", "variant": "field" }),
      ]),
    )
    const field = root.querySelector<HTMLInputElement>("[data-testid=field]")!
    expect(field.tagName).toBe("INPUT")
    expect(field.getAttribute("role")).toBe("combobox")
    expect(field.getAttribute("aria-controls")).toBe("results")
    expect(field.getAttribute("aria-activedescendant")).toBe("row-2")
    expect(field.getAttribute("aria-expanded")).toBe("true")
    const plain = root.querySelector<HTMLInputElement>("[data-testid=plain]")!
    expect(plain.hasAttribute("role")).toBe(false)
    expect(plain.hasAttribute("aria-activedescendant")).toBe(false)
    expect(plain.closest("[data-slot=palette-search]")!.getAttribute("data-variant")).toBe("field")

    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    await nextTick()
    expect(query.value).toBe("pal")
    expect(escapes).toBe(1)
  })

  it("puts the caret in the field on a press of its frame, not of what sits at its end", async () => {
    const root = await mount(() =>
      h(PaletteSearch, { "aria-label": "Search" }, { trailing: () => h("button", { "data-testid": "switch" }, "Personal") }),
    )
    const frame = root.querySelector<HTMLElement>("[data-slot=palette-search]")!
    const field = root.querySelector("input")!
    frame.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(field)
    field.blur()
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    root.querySelector("[data-testid=switch]")!.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(false)
  })
})

describe("PaletteList, PaletteGroup and PaletteItem", () => {
  it("draws a listbox of labelled groups; the lit row says aria-selected, a busy one spins", async () => {
    const root = await mount(() =>
      h(PaletteList, { id: "results", label: "Results", busy: true }, () => [
        h(PaletteGroup, { label: "Workspaces" }, () => [
          h(PaletteItem, { "id": "a", "label": "Palworld", "match": "pal", "active": true, "data-testid": "a" }, { trailing: () => "Open now" }),
        ]),
        h(PaletteGroup, { label: "Add a game" }, () => [
          h(PaletteItem, { "id": "b", "label": "Add Palia", "icon": Plus, "busy": true, "data-testid": "b" }, { trailing: () => "New game" }),
          h(PaletteItem, { "id": "c", "label": "Add Pal Hunters", "disabled": true, "data-testid": "c" }),
        ]),
      ]),
    )
    const list = root.querySelector("[role=listbox]")!
    expect(list.id).toBe("results")
    expect(list.getAttribute("aria-label")).toBe("Results")
    expect(list.getAttribute("aria-busy")).toBe("true")

    const groups = [...root.querySelectorAll("[role=group]")]
    expect(groups).toHaveLength(2)
    expect(document.getElementById(groups[0]!.getAttribute("aria-labelledby")!)!.textContent).toBe("Workspaces")

    const [a, b, c] = ["a", "b", "c"].map((id) => root.querySelector<HTMLElement>(`[data-testid=${id}]`)!)
    expect(a!.getAttribute("role")).toBe("option")
    expect(a!.getAttribute("aria-selected")).toBe("true")
    expect(a!.hasAttribute("data-highlighted")).toBe(true)
    expect(a!.querySelector("b")!.textContent).toBe("Pal")
    expect(a!.textContent).toContain("Open now")

    expect(b!.getAttribute("aria-selected")).toBe("false")
    expect(b!.getAttribute("aria-busy")).toBe("true")
    expect(b!.hasAttribute("data-highlighted")).toBe(true)
    expect(b!.querySelector("[data-slot=palette-item-spinner]")).not.toBeNull()
    expect(b!.textContent).not.toContain("New game")
    expect(b!.querySelector("[data-slot=list-row-leading] svg")).not.toBeNull()

    expect(c!.getAttribute("aria-disabled")).toBe("true")
    expect(c!.querySelector("b")).toBeNull()
  })

  it("keeps the focus where it is on a press in the list", async () => {
    const root = await mount(() => h(PaletteList, { id: "results", label: "Results" }, () => h(PaletteItem, { label: "One" })))
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    root.querySelector("[role=option]")!.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
  })

  it("leaves a group without a label unnamed", async () => {
    const root = await mount(() => h(PaletteGroup, null, () => h(PaletteItem, { label: "One" })))
    expect(root.querySelector("[role=group]")).toBeNull()
    expect(root.querySelector("[data-slot=palette-group-label]")).toBeNull()
  })
})

describe("PaletteFooter", () => {
  it("shows the keys as caps, hidden from screen readers, with the slot at the end", async () => {
    const root = await mount(() => h(PaletteFooter, { hints: [{ keys: ["↑", "↓"], label: "to move" }, { keys: ["Enter"], label: "to open" }] }, () => h("a", { href: "#" }, "Import")))
    expect([...root.querySelectorAll("kbd")].map((key) => key.textContent)).toEqual(["↑", "↓", "Enter"])
    expect(root.querySelector("[aria-hidden=true]")!.textContent).toContain("to move")
    expect(root.querySelector("a")!.closest("[aria-hidden]")).toBeNull()
  })
})

describe("Listbox size lg", () => {
  const OPTIONS = [
    { value: "plate", label: "Iron Plate", description: "3 Iron Ingot → 2 Iron Plate", meta: "Constructor", icon: Plus, group: "Standard recipes" },
    { value: "rod", label: "Iron Rod", description: "1 Iron Ingot → 1 Iron Rod", meta: "Constructor", group: "Standard recipes", busy: true },
    { value: "bolted", label: "Bolted Iron Plate", meta: "Assembler", group: "Alternate recipes" },
  ]

  it("has the big search, icons, a busy row that takes no pick, and the keys in a foot", async () => {
    const picks: string[] = []
    const root = await mount(() =>
      h(Listbox, { label: "Add a recipe", search: "Add a recipe", options: OPTIONS, size: "lg", hints: true, autofocus: false, testid: "lb", onPick: (value: string) => picks.push(value) }),
    )
    const field = root.querySelector<HTMLInputElement>("[data-testid=lb-search]")!
    expect(field.closest("[data-slot=palette-search]")).not.toBeNull()
    expect(field.getAttribute("role")).toBe("combobox")
    expect(field.getAttribute("aria-activedescendant")).toBe(root.querySelector("[data-testid=lb-option-plate]")!.id)
    expect(root.querySelector("[data-testid=lb-option-plate] [data-slot=list-row-leading] svg")).not.toBeNull()
    expect(root.querySelector("[data-testid=lb-option-rod]")!.getAttribute("aria-busy")).toBe("true")
    expect([...root.querySelectorAll("[data-slot=palette-group-label]")].map((label) => label.textContent?.trim())).toEqual(["Standard recipes", "Alternate recipes"])
    expect([...root.querySelectorAll("[data-slot=palette-footer] kbd")].map((key) => key.textContent)).toEqual(["↑", "↓", "Enter"])

    ;(root.querySelector("[data-testid=lb-option-rod]") as HTMLElement).click()
    ;(root.querySelector("[data-testid=lb-option-bolted]") as HTMLElement).click()
    expect(picks).toEqual(["bolted"])
  })

  it("keeps the compact look without a size", async () => {
    const root = await mount(() => h(Listbox, { label: "Places", search: "Search", options: OPTIONS, autofocus: false }))
    expect(root.querySelector("[data-slot=palette-search]")).toBeNull()
    expect(root.querySelector("[data-slot=search-input]")).not.toBeNull()
    expect(root.querySelector("[data-slot=palette-footer]")).toBeNull()
  })
})
