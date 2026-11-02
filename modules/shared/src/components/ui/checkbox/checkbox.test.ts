// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, ref, type App } from "vue"
import { Checkbox } from "."

// The tick, the fill and the dip are CSS (motion.css). The component has to keep the indicator in the page, so the
// tick can draw and undraw, and has to wait with the dip until the box is changed once (a box that is ticked when it
// appears does not play).

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

function mount(start: boolean) {
  const checked = ref(start)
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(defineComponent({ render: () => h(Checkbox, { modelValue: checked.value, "onUpdate:modelValue": (v: boolean | "indeterminate") => (checked.value = v === true) }) }))
  app.mount(root)
  return { checked, box: () => root.querySelector("[data-slot=checkbox]") as HTMLElement, mark: () => root.querySelector("[data-slot=checkbox-indicator]") as HTMLElement }
}

describe("Checkbox", () => {
  it("keeps its tick mounted when unchecked, and draws it from a path measured as 1", async () => {
    const { mark } = mount(false)
    await wait()
    expect(mark().getAttribute("data-state")).toBe("unchecked")
    expect(mark().classList.contains("tavora-check-mark")).toBe(true)
    expect(mark().querySelector(".tavora-tick path")?.getAttribute("pathLength")).toBe("1")
  })

  it("does not play for a box that is already ticked, and does after the first change", async () => {
    const { box, checked } = mount(true)
    await wait()
    expect(box().getAttribute("data-state")).toBe("checked")
    expect(box().hasAttribute("data-armed")).toBe(false)
    box().click()
    await wait()
    expect(checked.value).toBe(false)
    expect(box().hasAttribute("data-armed")).toBe(true)
  })

  it("is a plain click or Space that changes it: both reach the same state", async () => {
    const { box, checked } = mount(false)
    await wait()
    box().dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    box().dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }))
    box().click()
    await wait()
    expect(checked.value).toBe(true)
    expect(box().hasAttribute("data-armed")).toBe(true)
  })
})
