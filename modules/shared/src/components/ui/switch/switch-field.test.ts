// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { SwitchField } from "."

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

function mount(props: Record<string, unknown>) {
  const on = ref(false)
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp(defineComponent({ render: () => h(SwitchField, { ...props, modelValue: on.value, "onUpdate:modelValue": (value: boolean) => (on.value = value) } as never) }))
  app.mount(host)
  return { host, on }
}

describe("SwitchField placement end", () => {
  it("puts the switch after the label, in one row as tall as a control", async () => {
    const { host } = mount({ label: "Keep finished", placement: "end", "data-testid": "field" })
    await nextTick()
    const field = host.querySelector<HTMLElement>("[data-testid=field]")!
    expect(field.dataset.placement).toBe("end")
    expect(field.className).toContain("min-h-[var(--style-control-height,32px)]")
    expect(field.firstElementChild!.textContent).toBe("Keep finished")
    expect(field.lastElementChild!.getAttribute("data-slot")).toBe("switch")
  })

  it("toggles from the label and the switch once each, and the switch keeps its own attributes and name", async () => {
    const { host, on } = mount({ label: "Keep finished", placement: "end", switchAttrs: { "data-testid": "the-switch", "data-mode": "x" } })
    await nextTick()
    const control = host.querySelector<HTMLElement>("[data-testid=the-switch]")!
    expect(control.dataset.mode).toBe("x")
    expect(control.getAttribute("aria-labelledby")).toBeTruthy()
    host.querySelector<HTMLElement>("[data-slot=switch-field-label]")!.click()
    await nextTick()
    expect(on.value).toBe(true)
    control.click()
    await nextTick()
    expect(on.value).toBe(false)
  })

  it("leaves the default placement as it was: switch first", async () => {
    const { host } = mount({ label: "Start on Home" })
    await nextTick()
    expect(host.querySelector("[data-slot=switch-field]")!.firstElementChild!.getAttribute("data-slot")).toBe("switch")
  })
})
