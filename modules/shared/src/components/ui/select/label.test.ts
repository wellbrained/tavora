// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "."
import { choiceLabelsKey, pickedLabel } from "./empty"

// The closed select always shows the current words of the current choice, and a long one wraps between words and
// ends in an ellipsis instead of being cut in the middle of a word.

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
  it("wraps between whole words and clamps with an ellipsis, in a trigger that can grow", async () => {
    const root = mount(() => h(Select, { modelValue: "a" }, () => [
      h(SelectTrigger, { class: "w-40" }, () => h(SelectValue)),
      h(SelectContent, null, () => h(SelectItem, { value: "a" }, () => "Eine ziemlich lange Beschriftung auf Deutsch")),
    ]))
    await tick()
    const text = root.querySelector("[data-slot=select-value] > span")!
    // jsdom has no layout, so check the classes that do the work (the e2e suites look at the pixels).
    expect(text.className).toContain("line-clamp-2")
    expect(text.className).toContain("whitespace-normal")
    expect(text.className).toContain("break-words")
    expect(text.className).toContain("min-w-0")
    const trigger = root.querySelector("[data-slot=select-trigger]")!
    expect(trigger.className).toContain("data-[size=default]:min-h-8")
    expect(trigger.className).not.toMatch(/data-\[size=default\]:h-8/)
    expect(trigger.className).not.toContain("line-clamp-1")
  })
})
