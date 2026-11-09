// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, ref, type App, type Component } from "vue"
import { installTitleTooltips } from "../../title-tooltips"
import { Button } from "./button"
import { Checkbox } from "./checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu"
import { Input } from "./input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { Switch, SwitchField } from "./switch"

// A switched-off control that is given a `disabledReason` stays hoverable and focusable, shows the reason in the kit
// tooltip (which is also its aria-describedby) and takes no click, press or key that would use it.

const REASON = "Ask your admin first."
const wait = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
})

let app: App | undefined
let dispose: (() => void) | undefined
afterEach(() => {
  app?.unmount()
  dispose?.()
  app = dispose = undefined
  document.body.innerHTML = ""
})

let current: HTMLElement
function mount(component: Component) {
  dispose = installTitleTooltips(document)
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(component)
  app.mount(root)
  current = root
  return root
}

const tooltip = () => document.querySelector("[role=tooltip]")
function hover(element: Element) {
  element.dispatchEvent(new Event("pointerover", { bubbles: true }))
}
/** Tab onto it: the hint follows a focus the keyboard moved. */
function tabTo(element: HTMLElement) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
  element.focus()
}

/** What every switched-off control with a reason does, whatever it is. */
async function behavesLikeSoftDisabled(find: (root: HTMLElement) => HTMLElement) {
  const control = find(current)
  expect(control.hasAttribute("disabled")).toBe(false)
  expect(control.getAttribute("aria-disabled")).toBe("true")

  hover(control)
  await wait()
  expect(tooltip()?.textContent).toContain(REASON)
  expect(control.getAttribute("aria-describedby")).toBe(tooltip()?.id)

  control.dispatchEvent(new Event("pointerout", { bubbles: true, relatedTarget: null } as EventInit))
  await wait(20)
  expect(tooltip()).toBeNull()

  tabTo(control)
  expect(document.activeElement).toBe(control)
  await wait()
  expect(tooltip()?.textContent).toContain(REASON)
  expect(control.getAttribute("aria-describedby")).toBe(tooltip()?.id)
}

describe("disabledReason", () => {
  it("Button", async () => {
    const clicked = vi.fn()
    mount(defineComponent({ render: () => h(Button, { disabled: true, disabledReason: REASON, onClick: clicked }, () => "Pin") }))
    await behavesLikeSoftDisabled((root) => root.querySelector("button")!)
    const button = document.querySelector("button")!
    button.click()
    expect(clicked).not.toHaveBeenCalled()
  })

  it("Button with only a title stays focusable and announced as off, shows its title in the tooltip and does nothing", async () => {
    const clicked = vi.fn()
    mount(defineComponent({ render: () => h(Button, { disabled: true, title: REASON, onClick: clicked }, () => "Pin") }))
    await wait(20)
    const button = document.querySelector("button")!
    // Announced as off, not natively disabled: it can be reached with Tab, so the reason can be read and heard.
    expect(button.hasAttribute("disabled")).toBe(false)
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.tabIndex).toBe(0)
    tabTo(button)
    expect(document.activeElement).toBe(button)
    hover(button)
    await wait()
    expect(tooltip()?.textContent).toContain(REASON)
    button.click()
    for (const key of ["Enter", " "]) button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
    expect(clicked).not.toHaveBeenCalled()
  })

  it("Button without a reason, a title or hinted is still a plain disabled button", async () => {
    const root = mount(defineComponent({ render: () => h(Button, { disabled: true }, () => "Pin") }))
    await wait(20)
    expect(root.querySelector("button")!.hasAttribute("disabled")).toBe(true)
    expect(root.querySelector("button")!.hasAttribute("aria-disabled")).toBe(false)
  })

  it("Switch can't be switched", async () => {
    const on = ref(false)
    mount(defineComponent({ render: () => h(Switch, { modelValue: on.value, "onUpdate:modelValue": (v: boolean) => (on.value = v), disabled: true, disabledReason: REASON }) }))
    await behavesLikeSoftDisabled((root) => root.querySelector("[data-slot=switch]")!)
    const control = document.querySelector<HTMLElement>("[data-slot=switch]")!
    control.click()
    control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    control.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true }))
    await wait(20)
    expect(on.value).toBe(false)
  })

  it("Switch without a reason is a plain disabled switch", async () => {
    const root = mount(defineComponent({ render: () => h(Switch, { disabled: true }) }))
    await wait(20)
    expect(root.querySelector("[data-slot=switch]")!.hasAttribute("disabled")).toBe(true)
  })

  it("SwitchField says it on the switch and on its label, and keeps the label as the switch's name", async () => {
    const on = ref(true)
    mount(defineComponent({ render: () => h(SwitchField, { modelValue: on.value, "onUpdate:modelValue": (v: boolean) => (on.value = v), label: "Share my status", disabled: true, disabledReason: REASON }) }))
    await behavesLikeSoftDisabled((root) => root.querySelector("[data-slot=switch]")!)
    const control = document.querySelector<HTMLButtonElement>("[data-slot=switch]")!
    expect(control.hasAttribute("aria-label")).toBe(false)
    expect(control.labels?.[0]?.textContent).toBe("Share my status")

    document.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    hover(document.querySelector("[data-slot=label]")!)
    await wait()
    expect(tooltip()?.textContent).toContain(REASON)

    document.querySelector<HTMLElement>("[data-slot=label]")!.click()
    await wait(20)
    expect(on.value).toBe(true)
  })

  it("Checkbox can't be ticked", async () => {
    const checked = ref(false)
    mount(defineComponent({ render: () => h(Checkbox, { modelValue: checked.value, "onUpdate:modelValue": (v: boolean | "indeterminate") => (checked.value = v === true), disabled: true, disabledReason: REASON }) }))
    await behavesLikeSoftDisabled((root) => root.querySelector("[data-slot=checkbox]")!)
    const box = document.querySelector<HTMLElement>("[data-slot=checkbox]")!
    box.click()
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await wait(20)
    expect(checked.value).toBe(false)
  })

  it("Input is read-only, can be focused, keeps its own name and can't be typed in or submit its form", async () => {
    const text = ref("anna")
    const submitted = vi.fn()
    mount(defineComponent({
      render: () => h("form", { onSubmit: (e: Event) => { e.preventDefault(); submitted() } }, [
        h(Input, { modelValue: text.value, "onUpdate:modelValue": (v: string | number) => (text.value = String(v)), disabled: true, disabledReason: REASON, "aria-label": "Name" }),
      ]),
    }))
    await behavesLikeSoftDisabled((root) => root.querySelector("input")!)
    const input = document.querySelector("input")!
    expect(input.readOnly).toBe(true)
    expect(input.getAttribute("aria-label")).toBe("Name")
    input.value = "bob"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    // A read-only field gets no typing from the browser; the model only changes when the browser says so.
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    input.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
    expect(submitted).not.toHaveBeenCalled()
  })

  it("Input without a reason is a plain disabled input", async () => {
    const root = mount(defineComponent({ render: () => h(Input, { disabled: true }) }))
    await wait(20)
    expect(root.querySelector("input")!.disabled).toBe(true)
  })

  it("Select trigger can't be opened by a click, a key or typing, whether the reason sits on the Select or the trigger", async () => {
    for (const onRoot of [true, false]) {
      const picked = ref("a")
      const root = mount(defineComponent({
        render: () => h(Select, { modelValue: picked.value, "onUpdate:modelValue": (v: unknown) => (picked.value = String(v)), ...(onRoot ? { disabled: true, disabledReason: REASON } : {}) }, () => [
          h(SelectTrigger, onRoot ? {} : { disabled: true, disabledReason: REASON }, () => h(SelectValue)),
          h(SelectContent, null, () => [h(SelectItem, { value: "a" }, () => "Alpha"), h(SelectItem, { value: "b" }, () => "Beta")]),
        ]),
      }))
      await behavesLikeSoftDisabled((r) => r.querySelector("[data-slot=select-trigger]")!)
      const trigger = root.querySelector<HTMLElement>("[data-slot=select-trigger]")!
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }))
      trigger.click()
      for (const key of ["Enter", " ", "ArrowDown", "b"]) trigger.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
      await wait(20)
      expect(trigger.getAttribute("aria-expanded")).toBe("false")
      expect(document.querySelector("[role=listbox]")).toBeNull()
      expect(picked.value).toBe("a")
      app?.unmount()
      dispose?.()
      document.body.innerHTML = ""
    }
  })

  it("Select without a reason is a plain disabled trigger", async () => {
    const root = mount(defineComponent({
      render: () => h(Select, { disabled: true }, () => [h(SelectTrigger, null, () => h(SelectValue)), h(SelectContent, null, () => h(SelectItem, { value: "a" }, () => "Alpha"))]),
    }))
    await wait(20)
    expect(root.querySelector("[data-slot=select-trigger]")!.hasAttribute("disabled")).toBe(true)
  })
})

describe("menu items with a reason", () => {
  /** The rows of an open menu: one on, one off with a reason, one off without, one on. */
  function dropdown(selected: (name: string) => void) {
    return defineComponent({
      render: () => h(DropdownMenu, { open: true, modal: false }, () => [
        h(DropdownMenuTrigger, null, () => "Menu"),
        h(DropdownMenuContent, null, () => [
          h(DropdownMenuItem, { onSelect: () => selected("first") }, () => "First"),
          h(DropdownMenuItem, { disabled: true, disabledReason: REASON, onSelect: () => selected("pin") }, () => "Pin"),
          h(DropdownMenuItem, { disabled: true, onSelect: () => selected("plain") }, () => "Plain"),
          h(DropdownMenuItem, { onSelect: () => selected("last") }, () => "Last"),
        ]),
      ]),
    })
  }
  const row = (name: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((el) => el.textContent?.trim() === name)!
  const press = (element: Element, key: string) => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))

  it("a dropdown row is reached with the arrow keys, shows the reason beside it and can't be chosen", async () => {
    const selected = vi.fn()
    mount(dropdown(selected))
    await wait(20)
    const pin = row("Pin")
    expect(pin.hasAttribute("data-disabled")).toBe(false)
    expect(pin.getAttribute("aria-disabled")).toBe("true")
    // A disabled row with no reason is still skipped.
    expect(row("Plain").getAttribute("data-disabled")).toBe("")

    row("First").focus()
    press(row("First"), "ArrowDown")
    await wait()
    expect(document.activeElement).toBe(pin)
    expect(tooltip()?.textContent).toContain(REASON)
    expect(tooltip()?.getAttribute("data-side")).not.toBe("bottom")
    expect(pin.getAttribute("aria-describedby")).toBe(tooltip()?.id)

    press(pin, "Enter")
    press(pin, " ")
    pin.click()
    await wait(20)
    expect(selected).not.toHaveBeenCalled()
    expect(document.querySelector("[role=menu]")).not.toBeNull()

    press(pin, "ArrowDown")
    expect(document.activeElement).toBe(row("Last"))
    press(row("Last"), "Enter")
    expect(selected).toHaveBeenCalledWith("last")
  })

  it("a dropdown row shows the reason on hover", async () => {
    mount(dropdown(() => {}))
    await wait(20)
    hover(row("Pin"))
    await wait()
    expect(tooltip()?.textContent).toContain(REASON)
  })

  it("a row's reason stays when the menu moves its focus to the row under the pointer", async () => {
    mount(dropdown(() => {}))
    await wait(20)
    row("First").focus()
    hover(row("Pin"))
    // What Reka does on a pointer move: focus goes to the row, so it leaves the one that had it.
    row("Pin").focus()
    await wait()
    expect(tooltip()?.textContent).toContain(REASON)
  })

  it("a context menu row works the same", async () => {
    const selected = vi.fn()
    mount(defineComponent({
      render: () => h(ContextMenu, { modal: false }, () => [
        h(ContextMenuTrigger, null, () => "Area"),
        h(ContextMenuContent, null, () => [
          h(ContextMenuItem, { onSelect: () => selected("first") }, () => "First"),
          h(ContextMenuItem, { disabled: true, disabledReason: REASON, onSelect: () => selected("pin") }, () => "Pin"),
        ]),
      ]),
    }))
    document.querySelector("[data-slot=context-menu-trigger]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    await wait(20)
    const pin = row("Pin")
    expect(pin.hasAttribute("data-disabled")).toBe(false)
    expect(pin.getAttribute("aria-disabled")).toBe("true")
    row("First").focus()
    press(row("First"), "ArrowDown")
    await wait()
    expect(document.activeElement).toBe(pin)
    expect(tooltip()?.textContent).toContain(REASON)
    press(pin, "Enter")
    pin.click()
    expect(selected).not.toHaveBeenCalled()
  })
})
