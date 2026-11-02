// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App, type Component } from "vue"
import { Combobox, ComboboxAnchor, ComboboxInput, ComboboxItem, ComboboxList } from "."
import { freeKeys } from "./free-keys"

describe("freeKeys", () => {
  it("commits what is typed on Enter, until the arrows have moved to a suggestion", () => {
    const keys = freeKeys()
    expect(keys.press({ key: "Enter" })).toBe("commit")
    expect(keys.press({ key: "ArrowDown" })).toBe("pass")
    // The list gets the Enter and picks what the arrows reached; the next Enter is the typed text's again.
    expect(keys.press({ key: "Enter" })).toBe("pass")
    expect(keys.press({ key: "Enter" })).toBe("commit")
  })

  it("forgets the arrows when the text changes or the list closes", () => {
    const keys = freeKeys()
    for (const key of ["a", "Backspace", "Delete", "Escape", "Tab"]) {
      keys.press({ key: "ArrowUp" })
      keys.press({ key })
      expect(keys.press({ key: "Enter" }), key).toBe("commit")
    }
    keys.press({ key: "ArrowDown" })
    keys.reset()
    expect(keys.press({ key: "Enter" })).toBe("commit")
  })

  it("leaves the keys of an input method alone", () => {
    const keys = freeKeys()
    expect(keys.press({ key: "Enter", isComposing: true })).toBe("pass")
    keys.press({ key: "ArrowDown", isComposing: true })
    expect(keys.press({ key: "Enter" })).toBe("commit")
  })
})

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

// A free-mode field with a list, as a module uses it: Enter keeps the typed text and says so; the arrow keys and Enter pick a suggestion.
describe("ComboboxInput free", () => {
  Element.prototype.scrollIntoView = () => {}
  const wait = () => new Promise((resolve) => setTimeout(resolve, 40))

  function mount() {
    const picked = ref("")
    const text = ref("m:ss")
    const commits: string[] = []
    const root = document.createElement("div")
    document.body.append(root)
    app = createApp(
      defineComponent({
        render: () =>
          h(Combobox, { modelValue: picked.value, ignoreFilter: true, resetSearchTermOnBlur: false, resetSearchTermOnSelect: false, openOnFocus: true, "onUpdate:modelValue": (value: unknown) => (picked.value = String(value ?? "")) }, () => [
            h(ComboboxAnchor, null, () => h(ComboboxInput as Component, { free: true, icon: false, modelValue: text.value, "onUpdate:modelValue": (value: string) => (text.value = value), onCommit: (value: string) => commits.push(value) })),
            h(ComboboxList, null, () => ["s", "m:ss", "mm:ss"].map((preset) => h(ComboboxItem, { value: preset }, () => preset))),
          ]),
      }),
    )
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
    return { picked, text, commits, input, type, press }
  }

  it("keeps the typed text on Enter and does not pick the first suggestion", async () => {
    const { picked, commits, input, type, press } = mount()
    input.focus()
    await wait()
    await type("h:mm")
    await press("Enter")
    expect(commits).toEqual(["h:mm"])
    expect(picked.value).toBe("")
  })

  it("picks the suggestion the arrows reached, and keeps the typed text after Arrow, Escape, Enter", async () => {
    const { picked, commits, input, type, press } = mount()
    input.focus()
    await wait()
    await type("h:mm")
    await press("ArrowDown")
    await press("Escape")
    await press("Enter")
    expect(commits).toEqual(["h:mm"])
    expect(picked.value).toBe("")
    await nextTick()
  })
})
