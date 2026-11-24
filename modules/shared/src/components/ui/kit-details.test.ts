// @vitest-environment jsdom
// Small kit details from the 2026-11-24 bug hunt: a code field that takes too many digits, a switched-off button that
// eats the arrow keys, a number field that loses its id, and tooltips that listen while closed.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, ref, type App } from "vue"
import Tooltip from "../tooltip/Tooltip"
import { Button } from "./button"
import { CodeInput } from "./code-input"
import { NumberField } from "./number-field"

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
  vi.restoreAllMocks()
})

async function render(node: () => ReturnType<typeof h>) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp({ render: node })
  app.mount(host)
  await nextTick()
  return host
}

describe("CodeInput", () => {
  it("keeps a code to its length, with room for one separator", async () => {
    const code = ref("")
    const host = await render(() => h(CodeInput, { modelValue: code.value, "onUpdate:modelValue": (next: string) => (code.value = next) }))
    const input = host.querySelector("input")!
    input.value = "1234567"
    input.dispatchEvent(new Event("input"))
    await nextTick()
    expect(code.value).toBe("123456")
    input.value = "123 456"
    input.dispatchEvent(new Event("input"))
    await nextTick()
    expect(code.value).toBe("123 456")
  })
})

describe("a switched-off button with a reason", () => {
  const arrow = (button: HTMLElement) => {
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
    button.dispatchEvent(event)
    return event.defaultPrevented
  }

  it("lets the arrow keys through, so the page scrolls and the focus moves on", async () => {
    const host = await render(() => h(Button, { disabled: true, disabledReason: "Sign in first." }, () => "Send"))
    expect(arrow(host.querySelector("button")!)).toBe(false)
  })

  it("still keeps a menu it would open shut", async () => {
    const host = await render(() => h(Button, { disabled: true, disabledReason: "Sign in first.", "aria-haspopup": "menu" }, () => "More"))
    expect(arrow(host.querySelector("button")!)).toBe(true)
  })
})

describe("NumberField", () => {
  it("keeps the id it is given outside a Field", async () => {
    const host = await render(() => h(NumberField, { modelValue: 3, id: "amount" }))
    expect(host.querySelector("#amount")).not.toBeNull()
  })
})

describe("Tooltip", () => {
  it("listens to the window only while it is open", async () => {
    const add = vi.spyOn(window, "addEventListener")
    const open = ref(false)
    await render(() => h(Tooltip, { open: open.value, anchor: { left: 10, top: 10, right: 20, bottom: 20 }, title: "Hi" }))
    expect(add.mock.calls.filter(([type]) => type === "scroll" || type === "keydown")).toHaveLength(0)
    open.value = true
    await nextTick()
    expect(add.mock.calls.filter(([type]) => type === "scroll" || type === "keydown")).toHaveLength(2)
  })
})
