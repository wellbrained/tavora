// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { Chip } from "../chip"
import { TagInput } from "."

let app: App | undefined
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

const wait = () => new Promise((resolve) => setTimeout(resolve, 30))

function mount(start: string[], props: Record<string, unknown> = {}) {
  const tags = ref([...start])
  const added: string[] = []
  const removed: string[] = []
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(defineComponent({
    render: () => h(TagInput, {
      "modelValue": tags.value,
      "onUpdate:modelValue": (next: string[]) => (tags.value = next),
      "onAdd": (tag: string) => added.push(tag),
      "onRemove": (tag: string) => removed.push(tag),
      "aria-label": "Tags",
      ...props,
    }),
  }))
  app.mount(root)
  const input = root.querySelector("input") as HTMLInputElement
  const type = async (value: string) => {
    input.value = value
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await wait()
  }
  const press = async (key: string) => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
    await wait()
  }
  const chips = () => [...root.querySelectorAll<HTMLElement>("[data-slot=chip]")]
  return { tags, added, removed, input, type, press, chips, root }
}

describe("TagInput", () => {
  it("adds typed text on Enter and on a comma, once, and says so", async () => {
    const field = mount(["Boss"])
    field.input.focus()
    await field.type("pvp")
    await field.press("Enter")
    await field.type("BOSS")
    await field.press(",")
    expect(field.tags.value).toEqual(["Boss", "pvp"])
    expect(field.added).toEqual(["pvp"])
    expect(field.input.value).toBe("")
  })

  it("splits a paste with commas into chips, up to max", async () => {
    const field = mount(["a"], { max: 3 })
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "b, c, d" } })
    field.input.dispatchEvent(paste)
    await wait()
    expect(field.tags.value).toEqual(["a", "b", "c"])
    expect(paste.defaultPrevented).toBe(true)
    expect(field.input.readOnly).toBe(true)
    expect(field.input.placeholder).toBe("3 at most")
  })

  it("marks the last chip on Backspace and removes it on the second press", async () => {
    const field = mount(["a", "b"])
    field.input.focus()
    field.input.setSelectionRange(0, 0)
    await field.press("Backspace")
    expect(field.chips()[1]?.hasAttribute("data-marked")).toBe(true)
    expect(field.tags.value).toEqual(["a", "b"])
    await field.press("ArrowLeft")
    expect(field.chips()[0]?.hasAttribute("data-marked")).toBe(true)
    await field.press("Delete")
    expect(field.tags.value).toEqual(["b"])
    expect(field.removed).toEqual(["a"])
    expect(field.chips().some((chip) => chip.hasAttribute("data-marked"))).toBe(false)
  })

  it("removes a chip with its ×, which Tab skips", async () => {
    const field = mount(["a", "b"])
    const remove = field.root.querySelector<HTMLButtonElement>("[data-slot=chip-remove]")!
    expect(remove.tabIndex).toBe(-1)
    expect(remove.getAttribute("aria-label")).toBe("Remove a")
    remove.click()
    await wait()
    expect(field.tags.value).toEqual(["b"])
  })

  it("adds only suggestions when it isn't free", async () => {
    const field = mount([], { free: false, suggestions: ["Units", "Spells"] })
    field.input.focus()
    await field.type("zzz")
    await field.press("Enter")
    await field.press(",")
    expect(field.tags.value).toEqual([])
  })
})

describe("Chip", () => {
  function render(props: Record<string, unknown>) {
    const root = document.createElement("div")
    document.body.append(root)
    const events: unknown[] = []
    app = createApp({ render: () => h(Chip, { ...props, "onRemove": () => events.push("remove"), "onUpdate:selected": (on: boolean) => events.push(on) }) })
    app.mount(root)
    return { root, events }
  }

  it("is a pressed button with a check when it toggles", async () => {
    const { root, events } = render({ label: "Units", toggle: true, selected: true })
    const button = root.querySelector("button")!
    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(button.querySelector("svg")).not.toBeNull()
    button.click()
    await nextTick()
    expect(events).toEqual([false])
  })

  it("sends remove from its ×, not when disabled", async () => {
    const on = render({ label: "Fire", removable: true })
    on.root.querySelector<HTMLButtonElement>("[data-slot=chip-remove]")!.click()
    expect(on.events).toEqual(["remove"])
    app?.unmount()
    const off = render({ label: "Fire", removable: true, disabled: true })
    expect(off.root.querySelector("[data-slot=chip]")!.hasAttribute("data-disabled")).toBe(true)
    off.root.querySelector<HTMLButtonElement>("[data-slot=chip-remove]")!.click()
    expect(off.events).toEqual([])
  })
})
