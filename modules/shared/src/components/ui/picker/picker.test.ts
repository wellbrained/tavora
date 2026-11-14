// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import { Picker, type PickerOption } from "."

let app: App | undefined
// jsdom has no layout: the list scrolls its highlighted row into view.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

const OPTIONS: PickerOption[] = [
  { value: "tower", label: "Tower wall", group: "Stone" },
  { value: "gold", label: "Gold town", group: "Greed" },
  { value: "free", label: "Free build" },
  { value: "towers", label: "Double towers", group: "Stone", keywords: "endless" },
]

async function mount(props: Record<string, unknown>, slots: Record<string, (props: never) => unknown> = {}) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({ render: () => h(Picker, { modelValue: "tower", label: "Build", options: OPTIONS, open: true, testid: "pick", ...props }, slots) })
  app.mount(root)
  for (let tick = 0; tick < 4; tick++) await nextTick()
  return root
}

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-testid^=pick-option-]")].map((row) => row.dataset.testid!.slice("pick-option-".length))
const headings = () => [...document.querySelectorAll<HTMLElement>("[data-slot=picker-group]")].map((label) => label.textContent?.trim())

describe("Picker", () => {
  it("lists the options without a group first, then each group under its heading in the order it first comes", async () => {
    await mount({})
    expect(rows()).toEqual(["free", "tower", "towers", "gold"])
    expect(headings()).toEqual(["Stone", "Greed"])
  })

  it("narrows by label and keywords, and drops a group with nothing left", async () => {
    await mount({ search: "Search builds" })
    const field = document.querySelector<HTMLInputElement>("[data-testid=pick-search]")!
    field.value = "endless"
    field.dispatchEvent(new Event("input"))
    for (let tick = 0; tick < 4; tick++) await nextTick()
    expect(rows()).toEqual(["towers"])
    expect(headings()).toEqual(["Stone"])
  })

  it("fills the button, the rows, the headings and the room above the list from its slots", async () => {
    const root = await mount(
      {},
      {
        current: ({ option }: { option?: PickerOption }) => h("b", { "data-testid": "current" }, `Now: ${option?.label}`),
        option: ({ option }: { option: PickerOption }) => h("span", `${option.label}!`),
        group: ({ group }: { group: string }) => h("i", `King of ${group}`),
        filters: () => h("button", { "data-testid": "only-endless" }, "endless"),
      },
    )
    expect(root.querySelector("[data-testid=current]")?.textContent).toBe("Now: Tower wall")
    expect(document.querySelector("[data-testid=pick-option-gold]")?.textContent).toContain("Gold town!")
    expect(headings()).toEqual(["King of Stone", "King of Greed"])
    expect(document.querySelector("[data-testid=pick-filters] [data-testid=only-endless]")).not.toBeNull()
  })
})
