// @vitest-environment jsdom
// What a toolbar's button opens sits next to the button: the trigger around it keeps pointing at the element on screen.
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, ref, type App, type VNodeChild } from "vue"
import { Toolbar } from "."
import AnchorFixture from "./AnchorFixture.vue"

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

/** Only the button that is on screen has a box, at the right of a 1000px window; a removed one measures all zeros. */
function layout() {
  for (const name of ["ResizeObserver", "IntersectionObserver"]) vi.stubGlobal(name, class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000)
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800)
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.isConnected && this.getAttribute("data-testid") === "open" ? new DOMRect(900, 40, 32, 32) : new DOMRect()
  })
}

async function mount(content: () => VNodeChild, later = false) {
  layout()
  const shown = ref(!later)
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({ render: () => h(Toolbar, { label: "Tools" }, { default: () => (shown.value ? content() : []) }) })
  app.mount(root)
  await nextTick()
  await wait()
  if (later) {
    shown.value = true
    await nextTick()
    await wait()
  }
  return root.querySelector("[data-testid=open]") as HTMLElement
}

const placed = () => (document.querySelector("[data-reka-popper-content-wrapper]") as HTMLElement).style.transform

const popups = {
  popover: () => h(AnchorFixture, { kind: "popover" }),
  menu: () => h(AnchorFixture, { kind: "menu" }),
}

describe("what a Toolbar button opens", () => {
  const cases = Object.entries(popups).flatMap(([name, popup]) => [false, true].map((later) => [name, popup, later] as const))
  for (const [name, popup, later] of cases)
    it(`puts the ${name} next to its button and gives the focus back to it${later ? ", also for a button that comes later" : ""}`, async () => {
      const button = await mount(popup, later)
      button.focus()
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
      if (name === "popover") button.click()
      await wait()
      // Under the button (40 + 32 + 4), not at the window's top left.
      expect(placed()).toMatch(/translate\(\d+(\.\d+)?px, 76px\)/)
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
      await wait()
      expect(document.activeElement).toBe(button)
      expect(button.isConnected).toBe(true)
    })
})

describe("a Toolbar whose rows under the tools come and go", () => {
  it("keeps its tools as they are: the field keeps the focus, an open popover stays open and in place", async () => {
    layout()
    const root = document.createElement("div")
    document.body.append(root)
    const below = ref(false)
    app = createApp({
      render: () =>
        h(Toolbar, { label: "Tools" }, { default: () => [h("input", { "aria-label": "Find" }), h(AnchorFixture, { kind: "popover" })], ...(below.value ? { below: () => h("div", "3 shown") } : {}) }),
    })
    app.mount(root)
    await wait()
    const field = root.querySelector("input") as HTMLInputElement
    const button = root.querySelector("[data-testid=open]") as HTMLElement
    field.focus()
    below.value = true
    await wait()
    expect(document.activeElement).toBe(field)
    expect(root.querySelector("[data-testid=open]")).toBe(button)
    button.click()
    await wait()
    below.value = false
    await wait()
    expect(button.getAttribute("aria-expanded")).toBe("true")
    expect(placed()).toMatch(/translate\(\d+(\.\d+)?px, 76px\)/)
  })
})
