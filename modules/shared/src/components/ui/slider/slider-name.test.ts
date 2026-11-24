// @vitest-environment jsdom
// A screen reader names a slider by its thumb (role="slider"): the label has to be on the thumb, not on the box around it.
import { afterEach, beforeAll, expect, it } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import { Slider, SliderField } from "."

let app: App | undefined
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

async function render(node: () => ReturnType<typeof h>) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp({ render: node })
  app.mount(host)
  await nextTick()
  return host
}

it("names a SliderField's thumb with its label", async () => {
  const host = await render(() => h(SliderField, { modelValue: 40, min: 0, max: 100, label: "Opacity" }))
  expect(host.querySelector("[role=slider]")!.getAttribute("aria-label")).toBe("Opacity")
})

it("names a Slider's thumb with the aria-label it gets, and keeps other attributes on the box", async () => {
  const host = await render(() => h(Slider, { modelValue: [3], min: 0, max: 10, "aria-label": "Volume", "data-testid": "volume" }))
  expect(host.querySelector("[role=slider]")!.getAttribute("aria-label")).toBe("Volume")
  expect(host.querySelector("[data-slot=slider]")!.getAttribute("data-testid")).toBe("volume")
  expect(host.querySelector("[data-slot=slider]")!.hasAttribute("aria-label")).toBe(false)
})
