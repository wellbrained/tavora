// @vitest-environment jsdom
// Edit in place (bare fields, autosize), a picture in a Select or Picker, numbers in a Badge, a preview that grows and
// RadioField.
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { Badge } from "./badge"
import { Input } from "./input"
import { SettingsPreview } from "./module-settings"
import { Picker } from "./picker"
import { RadioField } from "./radio-field"
import { RadioGroup } from "./radio-group"
import { Select, SelectTrigger } from "./select"
import { Textarea } from "./textarea"

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  localStorage.clear()
})

async function mount(render: () => ReturnType<typeof h>) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(defineComponent({ render }))
  app.mount(root)
  await nextTick()
  await wait()
  return root
}

describe("bare fields", () => {
  it("an Input has no edge or fill until it is used, and looks.css can tell", async () => {
    const root = await mount(() => h(Input, { variant: "bare", modelValue: "Title" }))
    const input = root.querySelector("input")!
    expect(input.dataset.variant).toBe("bare")
    expect(input.className).toContain("border-transparent")
    expect(input.className).toContain("hover:border-input")
    expect(input.className).not.toContain("dark:bg-input/10")
  })

  it("a plain Input keeps its edge and says nothing about a variant", async () => {
    const root = await mount(() => h(Input, { modelValue: "" }))
    const input = root.querySelector("input")!
    expect(input.hasAttribute("data-variant")).toBe(false)
    expect(input.className).toContain("border-input")
  })

  it("a caller's own fill wins over bare", async () => {
    const root = await mount(() => h(Input, { variant: "bare", class: "bg-muted dark:bg-muted" }))
    const input = root.querySelector("input")!
    expect(input.className).toContain("dark:bg-muted")
    expect(input.className).not.toContain("dark:bg-transparent")
  })

  it("an autosize Textarea starts at one line, without a resize handle or a least height", async () => {
    const root = await mount(() => h(Textarea, { autosize: true, variant: "bare", modelValue: "One" }))
    const area = root.querySelector("textarea")!
    expect(area.rows).toBe(1)
    expect(area.dataset.variant).toBe("bare")
    expect(area.className).toContain("resize-none")
    expect(area.className).toContain("min-h-0")
    expect(area.className).not.toContain("min-h-16")
  })

  it("an autosize Textarea takes the caller's rows", async () => {
    const root = await mount(() => h(Textarea, { autosize: true, rows: "3" }))
    expect(root.querySelector("textarea")!.rows).toBe(3)
  })
})

describe("a picture in the field", () => {
  it("a SelectTrigger lays out its value slot and grows with size auto", async () => {
    const root = await mount(() => h(Select, { modelValue: "a" }, () => h(SelectTrigger, { size: "auto" }, { value: () => [h("i", { id: "mark" }), "Alpha"] })))
    const trigger = root.querySelector("[data-slot=select-trigger]") as HTMLElement
    expect(trigger.dataset.size).toBe("auto")
    expect(trigger.querySelector("[data-slot=select-trigger-value] #mark")).not.toBeNull()
    expect(trigger.textContent).toContain("Alpha")
  })

  it("a Picker shows the picked value slot and keeps room for the others", async () => {
    const options = [{ value: "a", label: "Alpha" }, { value: "b", label: "A much longer one" }]
    const root = await mount(() => h(Picker, { modelValue: "a", options, label: "Pick" }, { value: ({ option }: { option: { label: string } }) => h("span", option.label) }))
    const button = root.querySelector("button")!
    const hidden = [...button.querySelectorAll("[aria-hidden=true].invisible")].map((el) => el.textContent)
    expect(hidden).toEqual(["Alpha", "A much longer one"])
    expect([...button.querySelectorAll("span.col-start-1:not(.invisible)")].map((el) => el.textContent)).toEqual(["Alpha"])
  })
})

describe("Badge numbers", () => {
  it("takes even digits and tight padding", async () => {
    const root = await mount(() => h(Badge, { numeric: true, size: "sm" }, () => "12"))
    const badge = root.querySelector("[data-slot=badge]")!
    expect(badge.classList.contains("tabular-nums")).toBe(true)
    expect(badge.classList.contains("px-1")).toBe(true)
    expect(badge.classList.contains("px-1.5")).toBe(false)
  })

  it("is unchanged without them", async () => {
    const root = await mount(() => h(Badge, null, () => "New"))
    const badge = root.querySelector("[data-slot=badge]")!
    expect(badge.classList.contains("tabular-nums")).toBe(false)
    expect(badge.classList.contains("px-1.5")).toBe(true)
  })
})

describe("SettingsPreview align", () => {
  it("grows with the preview and starts under the switch", async () => {
    const root = await mount(() => h(SettingsPreview, { label: "Preview", align: "start" }))
    const box = root.querySelector("[data-slot=settings-preview]")!
    for (const name of ["h-auto", "min-h-36", "items-start", "pt-10"]) expect(box.classList.contains(name), name).toBe(true)
    for (const name of ["h-36", "items-center"]) expect(box.classList.contains(name), name).toBe(false)
  })

  it("stays the fixed box by default", async () => {
    const root = await mount(() => h(SettingsPreview, { label: "Preview" }))
    expect(root.querySelector("[data-slot=settings-preview]")!.classList.contains("h-36")).toBe(true)
  })
})

describe("RadioField", () => {
  const group = (value: { value: string }, extra: Record<string, unknown> = {}) =>
    mount(() => h(RadioGroup, { modelValue: value.value, "onUpdate:modelValue": (v: unknown) => (value.value = String(v)) }, () => [
      h(RadioField, { value: "a", label: "Alpha" }),
      h(RadioField, { value: "b", label: "Beta", description: "The second one.", "data-testid": "beta", ...extra }, { trailing: () => "124" }),
    ]))

  it("picks from its label and names the dot by the label only", async () => {
    const value = ref("a")
    const root = await group(value)
    const row = root.querySelector("[data-testid=beta]") as HTMLElement
    const radio = row.querySelector("[role=radio]") as HTMLElement
    expect(root.querySelector("#" + CSS.escape(radio.getAttribute("aria-labelledby")!))?.textContent).toBe("Beta")
    expect(radio.getAttribute("aria-describedby")).toBe(row.querySelector("[id$=description]")?.id)
    ;(row.querySelector("[data-slot=radio-field-label]") as HTMLElement).click()
    await nextTick()
    expect(value.value).toBe("b")
  })

  it("that is off says why and does not pick", async () => {
    const value = ref("a")
    const root = await group(value, { disabled: true, disabledReason: "Sign in first." })
    const row = root.querySelector("[data-testid=beta]") as HTMLElement
    const radio = row.querySelector("[role=radio]") as HTMLElement
    expect(row.getAttribute("data-tavora-reason")).toBe("Sign in first.")
    expect(radio.getAttribute("aria-disabled")).toBe("true")
    radio.click()
    ;(row.querySelector("[data-slot=radio-field-label]") as HTMLElement).click()
    await nextTick()
    expect(value.value).toBe("a")
  })
})
