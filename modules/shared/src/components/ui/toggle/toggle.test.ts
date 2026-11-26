// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, nextTick, ref, type App, type VNodeChild } from "vue"
import { Bold, Pin } from "@lucide/vue"
import { Toggle, ToggleGroup } from "."
import { slotText } from "./slot-text"
import { Toolbar } from "../toolbar"
import { Button } from "../button"
import { ariaProblems } from "../../../testing"

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

async function mount(render: () => VNodeChild) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({ render })
  app.mount(root)
  await nextTick()
  await wait()
  return root
}
const classes = (element: Element) => [...element.classList]

describe("Toggle", () => {
  it("is square with an icon alone, named and hinted by its label", async () => {
    const root = await mount(() => h(Toggle, { label: "Bold" }, () => h(Bold)))
    const button = root.querySelector("button")!
    expect(button.getAttribute("aria-label")).toBe("Bold")
    expect(button.getAttribute("title")).toBe("Bold")
    expect(classes(button)).toContain("w-[var(--style-control-height,32px)]")
    expect(classes(button)).toContain("px-0")
    expect(ariaProblems(root)).toEqual([])
  })

  it("grows with its words, and needs no tooltip when they say its label", async () => {
    const root = await mount(() => h(Toggle, { label: "Pin" }, () => [h(Pin), "Pin"]))
    const button = root.querySelector("button")!
    expect(button.hasAttribute("title")).toBe(false)
    expect(button.getAttribute("aria-label")).toBe("Pin")
    expect(button.textContent).toBe("Pin")
    expect(classes(button)).not.toContain("w-[var(--style-control-height,32px)]")
    expect(classes(button)).toContain("min-w-[var(--style-control-height,32px)]")
    expect(classes(button)).toContain("px-3")
  })

  it("keeps its label as name and tooltip when the words are short for it", async () => {
    const root = await mount(() => h(Toggle, { label: "Bold" }, () => "B"))
    const button = root.querySelector("button")!
    expect(button.getAttribute("aria-label")).toBe("Bold")
    expect(button.getAttribute("title")).toBe("Bold")
  })

  it("takes the outline or ghost look and the kit's sizes", async () => {
    const root = await mount(() => [
      h(Toggle, { label: "a", "data-testid": "a" }, () => h(Bold)),
      h(Toggle, { label: "b", variant: "ghost", size: "sm", "data-testid": "b" }, () => h(Bold)),
      h(Toggle, { label: "c", size: "lg", "data-testid": "c" }, () => "Pin"),
    ])
    const [a, b, c] = ["a", "b", "c"].map((id) => root.querySelector(`[data-testid=${id}]`)!)
    expect(a!.getAttribute("data-variant")).toBe("outline")
    expect(classes(a!)).toContain("border-input")
    expect(b!.getAttribute("data-variant")).toBe("ghost")
    expect(classes(b!)).toContain("border-transparent")
    expect(classes(b!)).toContain("h-[calc(var(--style-control-height,32px)-4px)]")
    expect(classes(b!)).toContain("w-[calc(var(--style-control-height,32px)-4px)]")
    expect(c!.getAttribute("data-size")).toBe("lg")
    expect(classes(c!)).toContain("h-[calc(var(--style-control-height,32px)+8px)]")
  })

  it("presses and lets go", async () => {
    const on = ref(false)
    const root = await mount(() => h(Toggle, { label: "Pin", modelValue: on.value, "onUpdate:modelValue": (next: boolean) => (on.value = next) }, () => h(Pin)))
    const button = root.querySelector("button")!
    button.click()
    await nextTick()
    expect(on.value).toBe(true)
    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(button.getAttribute("data-state")).toBe("on")
    button.click()
    await nextTick()
    expect(on.value).toBe(false)
  })

  it("stays an arrow-key stop of a Toolbar while off, like a Button, and can't be pressed there", async () => {
    const on = ref(false)
    const root = await mount(() =>
      h(Toolbar, { label: "Tools" }, () => [
        h(Button, { "data-testid": "first" }, () => "first"),
        h(Toggle, { label: "Pin", disabled: true, "data-testid": "pin", modelValue: on.value, "onUpdate:modelValue": (next: boolean) => (on.value = next) }, () => h(Pin)),
        h(Button, { "data-testid": "last" }, () => "last"),
      ]),
    )
    const get = (id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement
    const pin = get("pin")
    expect(pin.hasAttribute("disabled")).toBe(false)
    expect(pin.getAttribute("aria-disabled")).toBe("true")
    get("first").focus()
    ;(document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }))
    await nextTick()
    await wait()
    expect(document.activeElement).toBe(pin)
    pin.click()
    await nextTick()
    expect(on.value).toBe(false)
  })
})

describe("ToggleGroup", () => {
  it("joins outline buttons and keeps ghost ones apart", async () => {
    const root = await mount(() => [
      h(ToggleGroup, { label: "Style", modelValue: [], options: [{ value: "a", label: "A", icon: Bold }, { value: "b", label: "B", icon: Pin }], "data-testid": "outline" }),
      h(ToggleGroup, { label: "Style", variant: "ghost", modelValue: [], options: [{ value: "a", label: "A", icon: Bold }, { value: "b", label: "B", icon: Pin }], "data-testid": "ghost" }),
    ])
    const outline = root.querySelector("[data-testid=outline]")!
    const ghost = root.querySelector("[data-testid=ghost]")!
    expect(classes(outline.children[1]!)).toContain("not-first:-ml-px")
    expect(classes(ghost)).toContain("gap-0.5")
    expect(classes(ghost.children[1]!)).not.toContain("not-first:-ml-px")
    expect(classes(ghost.children[1]!)).toContain("border-transparent")
  })

  it("shows an icon and words together, with a tooltip only when the words don't say the label", async () => {
    const root = await mount(() =>
      h(ToggleGroup, { label: "View", modelValue: [], options: [{ value: "pin", label: "Pin", icon: Pin, text: "Pin", testid: "pin" }, { value: "bold", label: "Bold", icon: Bold, testid: "bold" }] }),
    )
    const pin = root.querySelector("[data-testid=pin]")!
    const bold = root.querySelector("[data-testid=bold]")!
    expect(pin.textContent).toBe("Pin")
    expect(pin.querySelector("svg")).not.toBeNull()
    expect(pin.getAttribute("aria-label")).toBe("Pin")
    expect(pin.hasAttribute("title")).toBe(false)
    expect(classes(pin)).not.toContain("px-0")
    expect(bold.getAttribute("aria-label")).toBe("Bold")
    expect(bold.getAttribute("title")).toBe("Bold")
    expect(classes(bold)).toContain("px-0")
    expect(ariaProblems(root)).toEqual([])
  })
})

describe("slotText", () => {
  it("reads text and plain elements, not icons or comments", async () => {
    let seen = ""
    await mount(() =>
      h({
        setup: (_, { slots }) => () => {
          seen = slotText(slots.default?.())
          return h("span", slots.default?.())
        },
      }, () => [h(Pin), " ", h("span", ["Pi", "n"])]),
    )
    expect(seen.trim()).toBe("Pin")
    expect(slotText([h(Pin), h("svg")])).toBe("")
  })
})
