// @vitest-environment jsdom
// Card, ChoiceCard, CheckCard and CheckboxField: what they render, what a click and the arrow keys do, and that a card
// that is off says why.
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { CheckboxField } from "../checkbox-field"
import { RadioGroup } from "../radio-group"
import { Card, CheckCard, ChoiceCard } from "."

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
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

describe("Card", () => {
  it("is a plain box: a header from title and description, the body, a footer", async () => {
    const root = await mount(() => h(Card, { title: "Stats", description: "Today" }, { default: () => h("p", { id: "body" }, "Hi"), footer: () => "Updated" }))
    const card = root.querySelector("[data-slot=card]")!
    expect(card.tagName).toBe("DIV")
    expect(card.querySelector("[data-slot=card-title]")?.textContent).toBe("Stats")
    expect(card.querySelector("[data-slot=card-description]")?.textContent).toBe("Today")
    expect(card.querySelector("#body")).not.toBeNull()
    expect(card.querySelector("[data-slot=card-footer]")?.textContent).toBe("Updated")
  })

  it("has no header when it has no title, description or action", async () => {
    const root = await mount(() => h(Card, null, { default: () => "Just this" }))
    expect(root.querySelector("[data-slot=card-header]")).toBeNull()
  })

  it("takes its padding from the size", async () => {
    const root = await mount(() => h("div", [h(Card, { size: "sm", id: "a" }), h(Card, { size: "lg", id: "b" })]))
    expect(root.querySelector("#a")?.classList.contains("p-2.5")).toBe(true)
    expect(root.querySelector("#b")?.classList.contains("p-5")).toBe(true)
  })

  it("is a button when interactive, and answers a click", async () => {
    let clicks = 0
    const root = await mount(() => h(Card, { interactive: true, title: "Open", onClick: () => clicks++ }))
    const card = root.querySelector("[data-slot=card]") as HTMLElement
    expect(card.tagName).toBe("BUTTON")
    expect(card.getAttribute("type")).toBe("button")
    card.click()
    expect(clicks).toBe(1)
  })

  it("an interactive card that is off stays focusable, says why and does nothing", async () => {
    let clicks = 0
    const root = await mount(() => h(Card, { interactive: true, disabled: true, disabledReason: "Sign in first.", title: "Share", onClick: () => clicks++ }))
    const card = root.querySelector("[data-slot=card]") as HTMLElement
    expect(card.getAttribute("aria-disabled")).toBe("true")
    expect(card.hasAttribute("disabled")).toBe(false)
    card.click()
    expect(clicks).toBe(0)
  })

  it("marks the picked one", async () => {
    const root = await mount(() => h(Card, { interactive: true, selected: true }))
    const card = root.querySelector("[data-slot=card]")!
    expect(card.getAttribute("aria-current")).toBe("true")
    expect(card.classList.contains("border-primary")).toBe(true)
  })
})

describe("ChoiceCard", () => {
  function group() {
    const mode = ref("casual")
    const render = () => h(RadioGroup, { modelValue: mode.value, "onUpdate:modelValue": (v: unknown) => (mode.value = String(v)), "aria-label": "Mode" }, () => [
      h(ChoiceCard, { value: "casual", title: "Casual", description: "No timer." }),
      h(ChoiceCard, { value: "ranked", title: "Ranked" }, { media: () => h("i", { id: "pic" }) }),
    ])
    return { mode, render }
  }

  it("is a radio with its title and line, and no radio mark", async () => {
    const { render } = group()
    const root = await mount(render)
    const cards = root.querySelectorAll("[data-slot=choice-card]")
    expect(cards).toHaveLength(2)
    expect(cards[0]!.getAttribute("role")).toBe("radio")
    expect(cards[0]!.getAttribute("aria-checked")).toBe("true")
    expect(cards[0]!.querySelector("[data-slot=choice-card-title]")?.textContent).toBe("Casual")
    expect(cards[0]!.querySelector("[data-slot=choice-card-description]")?.textContent).toBe("No timer.")
    expect(root.querySelector("[data-slot=radio-group-indicator]")).toBeNull()
    expect(cards[1]!.querySelector("[data-slot=choice-card-media] #pic")).not.toBeNull()
  })

  it("picks on click", async () => {
    const { mode, render } = group()
    const root = await mount(render)
    ;(root.querySelectorAll("[data-slot=choice-card]")[1] as HTMLElement).click()
    await nextTick()
    expect(mode.value).toBe("ranked")
    expect(root.querySelectorAll("[data-slot=choice-card]")[1]!.getAttribute("data-state")).toBe("checked")
  })
})

describe("CheckCard and CheckboxField", () => {
  it("a CheckCard ticks when its card is clicked, and keeps the box", async () => {
    const on = ref(false)
    const root = await mount(() => h(CheckCard, { modelValue: on.value, "onUpdate:modelValue": (v: boolean) => (on.value = v), title: "Notes" }))
    expect(root.querySelector("[data-slot=checkbox]")).not.toBeNull()
    ;(root.querySelector("[data-slot=check-card]") as HTMLElement).click()
    await nextTick()
    expect(on.value).toBe(true)
  })

  it("a CheckboxField ticks from its label, shows its slots and names its line", async () => {
    const on = ref(false)
    const root = await mount(() => h(CheckboxField, { modelValue: on.value, "onUpdate:modelValue": (v: boolean | "indeterminate") => (on.value = v === true), label: "Iron ore", description: "Shows the nodes." }, { leading: () => h("i", { id: "swatch" }), trailing: () => "124" }))
    const row = root.querySelector("[data-slot=checkbox-field]") as HTMLElement
    expect(row.querySelector("#swatch")).not.toBeNull()
    expect(row.querySelector("[data-slot=checkbox-field-trailing]")?.textContent).toBe("124")
    const box = row.querySelector("[data-slot=checkbox]") as HTMLElement
    expect(box.getAttribute("aria-describedby")).toBe(row.querySelector("[id$=description]")?.id)
    ;(row.querySelector("[data-slot=checkbox-field-label]") as HTMLElement).click()
    await nextTick()
    expect(on.value).toBe(true)
  })

  it("a CheckboxField can be half-ticked", async () => {
    const root = await mount(() => h(CheckboxField, { modelValue: "indeterminate", label: "All" }))
    expect(root.querySelector("[data-slot=checkbox]")?.getAttribute("data-state")).toBe("indeterminate")
  })

  it("a CheckboxField that is off says why and does not tick", async () => {
    const on = ref(true)
    const root = await mount(() => h(CheckboxField, { modelValue: on.value, "onUpdate:modelValue": (v: boolean | "indeterminate") => (on.value = v === true), label: "Locked", disabled: true, disabledReason: "Ask your admin." }))
    const row = root.querySelector("[data-slot=checkbox-field]") as HTMLElement
    expect(row.getAttribute("data-tavora-reason")).toContain("Ask your admin.")
    ;(root.querySelector("[data-slot=checkbox]") as HTMLElement).click()
    await nextTick()
    expect(on.value).toBe(true)
  })
})
