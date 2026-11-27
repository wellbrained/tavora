// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "."
import { choiceLabelsKey, pickedLabel } from "./empty"

// The closed select always shows the current words of the current choice. A long one ends in an ellipsis on one line
// (two with `wrap`), and the trigger's tooltip then says it whole.

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

const tick = async () => { for (let i = 0; i < 4; i++) await nextTick(); await new Promise((resolve) => setTimeout(resolve, 10)) }

function mount(render: () => ReturnType<typeof h>) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(defineComponent({ render }))
  app.mount(root)
  return root
}
const shown = (root: HTMLElement) => root.querySelector("[data-slot=select-value]")!.textContent!.trim()

describe("Select shows the current label", () => {
  it("follows a rename and a language switch of the picked choice", async () => {
    const names = ref({ a: "Alpha", b: "Beta" })
    const picked = ref("a")
    const root = mount(() => h(Select, { modelValue: picked.value }, () => [
      h(SelectTrigger, null, () => h(SelectValue, { placeholder: "Pick one" })),
      h(SelectContent, null, () => [
        h(SelectItem, { value: "a" }, () => names.value.a),
        h(SelectItem, { value: "b" }, () => names.value.b),
      ]),
    ]))
    await tick()
    expect(shown(root)).toBe("Alpha")

    names.value = { a: "Alpha renamed", b: "Beta" }
    await tick()
    expect(shown(root)).toBe("Alpha renamed")

    names.value = { a: "Alfa auf Deutsch", b: "Beta" }
    await tick()
    expect(shown(root)).toBe("Alfa auf Deutsch")

    picked.value = "b"
    await tick()
    expect(shown(root)).toBe("Beta")
  })

  it("shows the placeholder while nothing is picked", async () => {
    const root = mount(() => h(Select, { modelValue: "" }, () => [
      h(SelectTrigger, null, () => h(SelectValue, { placeholder: "Pick one" })),
      h(SelectContent, null, () => h(SelectItem, { value: "a" }, () => "Alpha")),
    ]))
    await tick()
    expect(shown(root)).toBe("Pick one")
  })

  it("lets a choice that goes away leave the trigger empty instead of showing stale words", async () => {
    const present = ref(true)
    const root = mount(() => h(Select, { modelValue: "a" }, () => [
      h(SelectTrigger, null, () => h(SelectValue, { placeholder: "Pick one" })),
      h(SelectContent, null, () => (present.value ? [h(SelectItem, { value: "a" }, () => "Alpha")] : [])),
    ]))
    await tick()
    expect(shown(root)).toBe("Alpha")
    present.value = false
    await tick()
    expect(shown(root)).toBe("Pick one")
  })

  it("picks the live label of each value, else Reka's", () => {
    const map = new Map([["a", "Alpha"], ["b", "Beta"]])
    const labels = { get: (value: unknown) => map.get(value as string) }
    expect(pickedLabel("a", labels, ["old"])).toBe("Alpha")
    expect(pickedLabel(["a", "b"], labels, [])).toBe("Alpha, Beta")
    expect(pickedLabel("zzz", labels, ["Reka's"])).toBe("Reka's")
    expect(choiceLabelsKey).toBeDefined()
  })
})

describe("Select shows a long value", () => {
  const LONG = "Eine ziemlich lange Beschriftung auf Deutsch"
  // jsdom has no layout: say how much of the value shows. The e2e suites look at the pixels.
  const cut = ref(false)
  const heights = (kind: "scrollHeight" | "clientHeight") => ({
    configurable: true,
    get(this: HTMLElement) { return this.parentElement?.dataset.slot !== "select-value" ? 0 : kind === "scrollHeight" && cut.value ? 40 : 20 },
  })
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", heights("scrollHeight"))
    Object.defineProperty(HTMLElement.prototype, "clientHeight", heights("clientHeight"))
  })
  afterAll(() => {
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  })
  beforeEach(() => { cut.value = true })

  function long(trigger: Record<string, unknown> = {}, value: Record<string, unknown> = {}, select: Record<string, unknown> = {}, label = ref(LONG)) {
    return mount(() => h(Select, { modelValue: "a", ...select }, () => [
      h(SelectTrigger, trigger, () => h(SelectValue, value)),
      h(SelectContent, null, () => h(SelectItem, { value: "a" }, () => label.value)),
    ]))
  }
  const text = (root: HTMLElement) => root.querySelector("[data-slot=select-value] > span")!
  const trigger = (root: HTMLElement) => root.querySelector("[data-slot=select-trigger]")!

  it("stays on one line that ends in an ellipsis, and never holds the field wider than its place", async () => {
    const root = long({ class: "w-40" })
    await tick()
    expect(text(root).className).toContain("line-clamp-1")
    expect(text(root).className).toContain("break-all")
    expect(text(root).className).toContain("whitespace-normal")
    expect(root.querySelector("[data-slot=select-value]")!.className).toContain("min-w-0")
    expect(root.querySelector("[data-slot=select-value]")!.hasAttribute("wrap")).toBe(false)
  })

  it("takes a second line with `wrap`, breaking between words, in a trigger that can grow", async () => {
    const root = long({ class: "w-40" }, { wrap: true })
    await tick()
    expect(text(root).className).toContain("line-clamp-2")
    expect(text(root).className).toContain("break-words")
    expect(text(root).className).not.toContain("line-clamp-1")
    expect(trigger(root).className).toContain("data-[size=default]:min-h-[var(--style-control-height,32px)]")
    expect(trigger(root).className).not.toMatch(/data-\[size=default\]:h-/)
    expect(root.querySelector("[data-slot=select-value]")!.hasAttribute("wrap")).toBe(false)
  })

  it("says the whole value in the trigger's tooltip only while it is cut", async () => {
    const label = ref(LONG)
    const root = long({}, {}, {}, label)
    await tick()
    expect(trigger(root).getAttribute("title")).toBe(LONG)

    cut.value = false
    label.value = "Kurz"
    await tick()
    expect(trigger(root).hasAttribute("title")).toBe(false)

    cut.value = true
    label.value = `${LONG}, umbenannt`
    await tick()
    expect(trigger(root).getAttribute("title")).toBe(`${LONG}, umbenannt`)
  })

  it("keeps a hint of the trigger's own first, with the value under it", async () => {
    const root = long({ title: "World" })
    await tick()
    expect(trigger(root).getAttribute("title")).toBe("World")
    expect(trigger(root).getAttribute("data-tooltip-description")).toBe(LONG)
  })

  it("does not repeat a value the trigger's own hint already says", async () => {
    const root = long({ title: LONG })
    await tick()
    expect(trigger(root).getAttribute("title")).toBe(LONG)
    expect(trigger(root).hasAttribute("data-tooltip-description")).toBe(false)
  })

  it("leaves the tooltip to the reason while the select is off with one", async () => {
    const root = long({}, {}, { disabled: true, disabledReason: "Sign in first." })
    await tick()
    expect(trigger(root).hasAttribute("title")).toBe(false)
    expect(trigger(root).getAttribute("data-tavora-reason")).toBe("Sign in first.")
  })
})
