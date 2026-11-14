// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, h, nextTick, ref, type App, type VNode } from "vue"
import { ariaProblems, focusLostAfter } from "../../../testing"
import { Checkbox } from "../checkbox"
import { Combobox, ComboboxAnchor, ComboboxInput, ComboboxItem, ComboboxList } from "../combobox"
import { Input } from "../input"
import { NumberField } from "../number-field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select"
import { Switch } from "../switch"
import { Textarea } from "../textarea"
import { Field } from "."

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
beforeAll(() => {
  // jsdom has no scrolling; Reka scrolls the combobox list to its highlighted item.
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

async function mount(render: () => VNode) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({ render })
  app.mount(root)
  await nextTick()
  await wait()
  const label = root.querySelector("label") as HTMLLabelElement | null
  const hint = root.querySelector("[data-slot=field-hint]")
  const error = () => root.querySelector("[data-slot=field-error]")
  return { root, label, hint, error }
}

/** Mounts `control` in a Field and returns the element the label points at. */
async function inField(control: () => VNode | VNode[], props: Record<string, unknown> = { label: "Name", hint: "Shown in the tab." }) {
  const mounted = await mount(() => h(Field, props, control))
  const target = mounted.label ? (document.getElementById(mounted.label.htmlFor) as HTMLElement | null) : null
  return { ...mounted, target }
}

const described = (element: Element | null) => (element?.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)

describe("Field with an Input", () => {
  it("names it with the label and describes it with the hint", async () => {
    const { root, label, hint, target } = await inField(() => h(Input, { modelValue: "Waystone" }))
    expect(target?.matches("[data-slot=input]")).toBe(true)
    expect(label?.textContent).toBe("Name")
    expect(described(target)).toEqual([hint!.id])
    expect(target?.getAttribute("aria-labelledby")).toBe(label!.id)
    expect(target?.hasAttribute("aria-invalid")).toBe(false)
    expect(ariaProblems(root)).toEqual([])
  })

  it("marks it invalid and adds the error to its description", async () => {
    const { root, hint, error, target } = await inField(() => h(Input, { modelValue: "ab" }), { label: "Name", hint: "Shown in the tab.", error: "Use at least three letters." })
    expect(target?.getAttribute("aria-invalid")).toBe("true")
    expect(error()?.textContent).toBe("Use at least three letters.")
    expect(described(target).sort()).toEqual([hint!.id, error()!.id].sort())
    expect(ariaProblems(root)).toEqual([])
  })

  it("reads an error out when it appears, from a live region that was there before", async () => {
    const problem = ref("")
    const { root, error } = await mount(() => h(Field, { label: "Name", error: problem.value }, () => h(Input, { modelValue: "" })))
    const region = root.querySelector("[aria-live]")
    expect(region?.getAttribute("aria-live")).toBe("polite")
    expect(error()).toBeNull()
    problem.value = "Give it a name."
    await nextTick()
    await wait()
    const input = root.querySelector("input")!
    expect(root.querySelector("[aria-live]")).toBe(region)
    expect(region?.textContent).toBe("Give it a name.")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(described(input)).toEqual([error()!.id])
    problem.value = ""
    await nextTick()
    await wait()
    expect(input.hasAttribute("aria-invalid")).toBe(false)
    expect(input.hasAttribute("aria-describedby")).toBe(false)
    expect(ariaProblems(root)).toEqual([])
  })

  it("keeps an id and a description the input was given", async () => {
    const { root, hint, target } = await inField(() => [h("p", { id: "extra" }, "More"), h(Input, { id: "own", "aria-describedby": "extra" })])
    expect(target?.id).toBe("own")
    expect(described(target)).toEqual(["extra", hint!.id])
    expect(ariaProblems(root)).toEqual([])
  })

  it("takes a hint from its slot, and describes the input with all of it", async () => {
    const { root, hint, target } = await mount(() =>
      h(Field, { label: "Name" }, { default: () => h(Input), hint: () => [h("span", { "data-testid": "one" }, "First line."), h("span", "Second line.")] }),
    ).then(async (mounted) => ({ ...mounted, target: document.getElementById(mounted.label!.htmlFor) }))
    expect(hint?.querySelector("[data-testid=one]")?.textContent).toBe("First line.")
    expect(hint?.textContent).toBe("First line.Second line.")
    expect(described(target)).toEqual([hint!.id])
    expect(ariaProblems(root)).toEqual([])
  })

  it("keeps an input that is off invalid while there is an error, as Reka does for a Select", async () => {
    const { target } = await inField(() => h(Input, { disabled: true }), { label: "Name", error: "Not like this." })
    expect(target?.getAttribute("aria-invalid")).toBe("true")
  })

  it("labels one control only, so no two share an id", async () => {
    const { root, target } = await inField(() => [h(Input, { "data-testid": "first" }), h(Input, { "data-testid": "second" })])
    expect(target?.getAttribute("data-testid")).toBe("first")
    const second = root.querySelector("[data-testid=second]")!
    expect(second.hasAttribute("id")).toBe(false)
    expect(second.hasAttribute("aria-describedby")).toBe(false)
  })

})

describe("Field with the other kit controls", () => {
  it("Textarea", async () => {
    const { root, hint, target } = await inField(() => h(Textarea, { modelValue: "Hi" }), { label: "Note", hint: "A sentence or two.", error: "Write a bit more." })
    expect(target?.tagName).toBe("TEXTAREA")
    expect(target?.getAttribute("aria-invalid")).toBe("true")
    expect(described(target)).toContain(hint!.id)
    expect(ariaProblems(root)).toEqual([])
  })

  it("NumberField: the number box, not the buttons, without an aria-label of its own", async () => {
    const { root, hint, target } = await inField(() => h(NumberField, { modelValue: 3, min: 1, max: 9 }), { label: "Copies", hint: "Up to nine." })
    expect(target?.matches("[data-slot=number-field-input]")).toBe(true)
    expect(target?.hasAttribute("aria-label")).toBe(false)
    expect(described(target)).toEqual([hint!.id])
    expect(ariaProblems(root)).toEqual([])
  })

  it("NumberField: a description it was given goes on the number box only", async () => {
    const { root, hint, target } = await inField(() => [h("p", { id: "extra" }, "More"), h(NumberField, { modelValue: 3, "aria-describedby": "extra", "data-testid": "count" })], { label: "Copies", hint: "Up to nine." })
    expect(described(target).sort()).toEqual(["extra", hint!.id].sort())
    const frame = root.querySelector("[data-slot=number-field]")!
    expect(frame.getAttribute("data-testid")).toBe("count")
    expect(frame.hasAttribute("aria-describedby")).toBe(false)
    expect(ariaProblems(root)).toEqual([])
  })

  it("Select: its trigger", async () => {
    const { root, hint, target } = await inField(
      () =>
        h(Select, { modelValue: "a" }, () => [
          h(SelectTrigger, () => h(SelectValue)),
          h(SelectContent, () => [h(SelectItem, { value: "a" }, () => "Alpha"), h(SelectItem, { value: "b" }, () => "Beta")]),
        ]),
      { label: "Letter", hint: "Pick one.", error: "Not this one." },
    )
    expect(target?.matches("[data-slot=select-trigger]")).toBe(true)
    expect(target?.getAttribute("aria-invalid")).toBe("true")
    expect(described(target)).toContain(hint!.id)
    expect(ariaProblems(root)).toEqual([])
  })

  it("Combobox: its input, and clearing it keeps the focus there", async () => {
    const games = ["Diablo IV", "Satisfactory"]
    const { root, hint, target } = await inField(
      () =>
        h(Combobox, null, () => [
          h(ComboboxAnchor, () => h(ComboboxInput, { placeholder: "Search games" })),
          h(ComboboxList, () => games.map((game) => h(ComboboxItem, { value: game, key: game }, () => game))),
        ]),
      { label: "Game", hint: "Type to search." },
    )
    const input = target as HTMLInputElement
    expect(input.matches("[data-slot=combobox-input]")).toBe(true)
    expect(described(input)).toEqual([hint!.id])
    input.focus()
    input.value = "Dia"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    await wait()
    const clear = root.querySelector<HTMLButtonElement>("[data-slot=combobox-input-clear]")!
    expect(await focusLostAfter(() => clear.click())).toEqual([])
    expect(document.activeElement).toBe(input)
    expect(ariaProblems(root)).toEqual([])
  })

  it("Switch: a click on the label turns it on", async () => {
    const on = ref(false)
    const { root, label, hint, target } = await inField(() => h(Switch, { modelValue: on.value, "onUpdate:modelValue": (value: boolean) => (on.value = value) }), {
      label: "Sounds",
      hint: "Plays a sound for new messages.",
      orientation: "horizontal",
    })
    expect(target?.getAttribute("role")).toBe("switch")
    expect(described(target)).toEqual([hint!.id])
    label!.click()
    await nextTick()
    expect(on.value).toBe(true)
    expect(root.querySelector("[data-slot=field]")?.getAttribute("data-orientation")).toBe("horizontal")
    expect(ariaProblems(root)).toEqual([])
  })

  it("beside the label, the error still comes after the control, so it stays under it when the row wraps", async () => {
    const { root, error } = await inField(() => h(Input, { class: "w-24" }), { label: "Port", hint: "Where overlays are served.", error: "Use 1024 to 65535.", orientation: "horizontal" })
    const control = root.querySelector("[data-slot=field-control]")!
    expect(control.compareDocumentPosition(error()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(control.contains(error())).toBe(false)
  })

  it("Checkbox", async () => {
    const { root, hint, target } = await inField(() => h(Checkbox), { label: "Remember me", hint: "On this PC only." })
    expect(target?.getAttribute("role")).toBe("checkbox")
    expect(described(target)).toContain(hint!.id)
    expect(ariaProblems(root)).toEqual([])
  })
})

describe("Outside a Field", () => {
  it("the controls get nothing extra", async () => {
    const { root } = await mount(() => h("div", [h(Input), h(Textarea), h(Switch), h(NumberField, { modelValue: 1, label: "Count" })]))
    for (const element of root.querySelectorAll("input, textarea, button[role=switch]")) {
      expect(element.hasAttribute("aria-describedby")).toBe(false)
      expect(element.hasAttribute("aria-labelledby")).toBe(false)
      expect(element.hasAttribute("aria-invalid")).toBe(false)
    }
    expect(root.querySelector("[data-slot=input]")?.hasAttribute("id")).toBe(false)
  })
})
