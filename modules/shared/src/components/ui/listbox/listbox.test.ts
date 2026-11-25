// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, ref, type App } from "vue"
import { Listbox, type ListboxOption } from "."
import { setUiLanguage } from "../text"
import { filterOptions, sectionsOf } from "../picker/options"
import { matchParts, moveIndex } from "./listbox"

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

const CITIES: ListboxOption[] = [
  { value: "berlin", label: "Berlin", description: "Germany", meta: "±0 h" },
  { value: "bern", label: "Bern", description: "Switzerland", keywords: "schweiz" },
  { value: "bergen", label: "Bergen", disabled: "Already added" },
  { value: "bermuda", label: "Bermuda", group: "Islands" },
  { value: "oslo", label: "Oslo", disabled: true },
]

const settle = async () => {
  for (let tick = 0; tick < 4; tick++) await nextTick()
}

async function mount(props: Record<string, unknown> = {}, slots: Record<string, (props: never) => unknown> = {}) {
  const root = document.createElement("div")
  document.body.append(root)
  const picks: string[] = []
  app = createApp({ render: () => h(Listbox, { label: "Places", options: CITIES, search: "Search places", testid: "lb", autofocus: false, onPick: (value: string) => picks.push(value), ...props }, slots) })
  app.mount(root)
  await settle()
  return { root, picks }
}

const field = () => document.querySelector<HTMLInputElement>("[data-testid=lb-search]")!
const rows = () => [...document.querySelectorAll<HTMLElement>("[role=option]")].map((row) => row.dataset.testid!.slice("lb-option-".length))
const lit = () => document.querySelector<HTMLElement>("[data-highlighted]")?.dataset.testid?.slice("lb-option-".length)
async function type(text: string) {
  field().value = text
  field().dispatchEvent(new Event("input"))
  await settle()
}
async function press(key: string, target: HTMLElement = field()) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
  await settle()
}

describe("filterOptions and matchParts", () => {
  it("keeps options whose label or keywords hold the search, in order", () => {
    expect(filterOptions(CITIES, "ber").map((option) => option.value)).toEqual(["berlin", "bern", "bergen", "bermuda"])
    expect(filterOptions(CITIES, " SCHWEIZ ").map((option) => option.value)).toEqual(["bern"])
    expect(filterOptions(CITIES, "")).toBe(CITIES)
  })

  it("cuts the label around the first match, case-insensitive", () => {
    expect(matchParts("Bermuda", "MUD")).toEqual([{ text: "Ber", match: false }, { text: "mud", match: true }, { text: "a", match: false }])
    expect(matchParts("Berlin", "ber")).toEqual([{ text: "Ber", match: true }, { text: "lin", match: false }])
    expect(matchParts("Bern", "schweiz")).toEqual([{ text: "Bern", match: false }])
  })

  it("groups in the order each group first comes, ungrouped first", () => {
    const sections = sectionsOf([{ value: "a", label: "A", group: "Y" }, { value: "b", label: "B" }, { value: "c", label: "C", group: "X" }, { value: "d", label: "D", group: "Y" }])
    expect(sections.map((section) => [section.group, section.options.map((option) => option.value)])).toEqual([["", ["b"]], ["Y", ["a", "d"]], ["X", ["c"]]])
  })
})

describe("moveIndex", () => {
  const list = [{}, { disabled: true }, {}, {}, { disabled: "used" }, {}]
  it("wraps with the arrows and skips rows that can't be picked", () => {
    expect(moveIndex(list, 0, "next")).toBe(2)
    expect(moveIndex(list, 5, "next")).toBe(0)
    expect(moveIndex(list, 0, "prev")).toBe(5)
    expect(moveIndex(list, 5, "prev")).toBe(3)
  })
  it("stops at the ends for Home, End and the page keys", () => {
    expect(moveIndex(list, 3, "first")).toBe(0)
    expect(moveIndex(list, 0, "last")).toBe(5)
    expect(moveIndex(list, 0, "pageDown", 3)).toBe(3)
    expect(moveIndex(list, 3, "pageDown", 10)).toBe(5)
    expect(moveIndex(list, 5, "pageUp", 3)).toBe(2)
    expect(moveIndex(list, 2, "pageUp", 10)).toBe(0)
  })
  it("starts at an end with nothing lit, and has nowhere to go when nothing can be picked", () => {
    expect(moveIndex(list, -1, "next")).toBe(0)
    expect(moveIndex(list, -1, "prev")).toBe(5)
    expect(moveIndex([{ disabled: true }], -1, "next")).toBeUndefined()
  })
})

describe("Listbox", () => {
  it("lists ungrouped options first, then groups under their heading, with description, meta and the reason a row is off", async () => {
    const { root } = await mount()
    expect(rows()).toEqual(["berlin", "bern", "bergen", "oslo", "bermuda"])
    expect(root.querySelector("[data-slot=listbox-group]")?.textContent?.trim()).toBe("Islands")
    const berlin = root.querySelector("[data-testid=lb-option-berlin]")!
    expect(berlin.textContent).toContain("Germany")
    expect(berlin.textContent).toContain("±0 h")
    const bergen = root.querySelector("[data-testid=lb-option-bergen]")!
    expect(bergen.getAttribute("aria-disabled")).toBe("true")
    expect(bergen.textContent).toContain("Already added")
  })

  it("lights the top row, moves with the keys past rows that are off, and picks with Enter", async () => {
    const { picks } = await mount()
    expect(lit()).toBe("berlin")
    expect(field().getAttribute("aria-activedescendant")).toBe(document.querySelector("[data-testid=lb-option-berlin]")!.id)
    await press("ArrowDown")
    await press("ArrowDown")
    expect(lit()).toBe("bermuda")
    await press("ArrowDown")
    expect(lit()).toBe("berlin")
    await press("End")
    await press("Enter")
    expect(picks).toEqual(["bermuda"])
  })

  it("narrows by the search, bolds what matched, and lights the new top match", async () => {
    const { root } = await mount()
    await press("ArrowDown")
    await type("mud")
    expect(rows()).toEqual(["bermuda"])
    expect(lit()).toBe("bermuda")
    expect(root.querySelector("[data-testid=lb-option-bermuda] b")?.textContent).toBe("mud")
    await type("schweiz")
    expect(rows()).toEqual(["bern"])
    expect(root.querySelector("[data-testid=lb-option-bern] b")).toBeNull()
  })

  it("says so when nothing is left, in the user's language", async () => {
    setUiLanguage("de")
    const { root } = await mount()
    await type("zzz")
    expect(rows()).toEqual([])
    expect(root.querySelector("[role=status]")?.textContent).toContain("Keine Treffer")
  })

  it("shows the page's own empty text", async () => {
    await mount({ empty: "No place found" })
    await type("zzz")
    expect(document.querySelector("[data-testid=lb-none]")?.textContent).toContain("No place found")
  })

  it("never picks a row that is off, by click or by key", async () => {
    const { root, picks } = await mount()
    root.querySelector<HTMLElement>("[data-testid=lb-option-bergen]")!.click()
    await type("oslo")
    expect(lit()).toBeUndefined()
    await press("Enter")
    expect(picks).toEqual([])
  })

  it("marks the chosen row from v-model and lights it first", async () => {
    const chosen = ref("bern")
    const root = document.createElement("div")
    document.body.append(root)
    app = createApp({ render: () => h(Listbox, { label: "Places", options: CITIES, modelValue: chosen.value, "onUpdate:modelValue": (value?: string) => (chosen.value = value ?? ""), autofocus: false, testid: "lb" }) })
    app.mount(root)
    await settle()
    expect(lit()).toBe("bern")
    expect(root.querySelector("[data-testid=lb-option-bern]")?.getAttribute("data-state")).toBe("checked")
    expect(root.querySelector("[data-testid=lb-option-bern]")?.getAttribute("aria-checked")).toBe("true")
    expect(root.querySelector("[data-testid=lb-option-berlin]")?.getAttribute("aria-checked")).toBe("false")
    root.querySelector<HTMLElement>("[data-testid=lb-option-berlin]")!.click()
    await settle()
    expect(chosen.value).toBe("berlin")
  })

  it("clears the search with Escape, and lets Escape on an empty field through", async () => {
    await mount()
    await type("bern")
    const first = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    field().dispatchEvent(first)
    await settle()
    expect(first.defaultPrevented).toBe(true)
    expect(rows()).toHaveLength(5)
    const second = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    field().dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
  })

  it("ignores Enter while an input method composes", async () => {
    const { picks } = await mount()
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }))
    await settle()
    expect(picks).toEqual([])
  })

  it("without search, the list itself takes the keys and the focus on a click", async () => {
    const { picks } = await mount({ search: undefined })
    const list = document.querySelector<HTMLElement>("[role=listbox]")!
    expect(list.tabIndex).toBe(0)
    document.querySelector<HTMLElement>("[data-testid=lb-option-bern]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(list)
    await press("ArrowDown", list)
    await press("Enter", list)
    expect(picks).toEqual(["bern"])
  })

  it("with filter off, shows what the page found for the query and lights its top", async () => {
    const query = ref("")
    const root = document.createElement("div")
    document.body.append(root)
    app = createApp({
      render: () =>
        h(Listbox, {
          label: "Places",
          search: "Search",
          filter: false,
          autofocus: false,
          testid: "lb",
          query: query.value,
          "onUpdate:query": (value: string) => (query.value = value),
          options: query.value ? [CITIES[3]!, CITIES[0]!] : CITIES,
        }),
    })
    app.mount(root)
    await settle()
    await press("ArrowDown")
    expect(lit()).toBe("bern")
    await type("x")
    expect(rows()).toEqual(["berlin", "bermuda"])
    expect(lit()).toBe("berlin")
    expect(root.querySelector("[role=option] b")).toBeNull()
  })

  it("takes the focus on its own and sends a typed letter to the search field", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    const button = document.createElement("button")
    document.body.append(button)
    await mount({ autofocus: true })
    expect(document.activeElement).toBe(field())
    button.focus()
    await new Promise((done) => setTimeout(done, 150))
    expect(document.activeElement).toBe(button)
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }))
    expect(document.activeElement).toBe(field())
    button.focus()
    button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    expect(document.activeElement).toBe(button)
    const other = document.createElement("input")
    document.body.append(other)
    other.focus()
    other.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }))
    expect(document.activeElement).toBe(other)
    vi.restoreAllMocks()
  })
})
