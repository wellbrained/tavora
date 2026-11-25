// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, effectScope, ref } from "vue"
import { useLayer } from "./lib/layers"
import { isTypingTarget, usePaneKeys } from "./pane-keys"

const stops: (() => void)[] = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  document.body.innerHTML = ""
})

function pane(html = `<button data-testid="inside">x</button>`) {
  const el = document.createElement("section")
  el.innerHTML = html
  document.body.append(el)
  return el
}

function listen(root: HTMLElement, answer: boolean | void = true, options = {}) {
  const handler = vi.fn(() => answer)
  stops.push(usePaneKeys(ref(root), handler, options))
  return handler
}

const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe("usePaneKeys", () => {
  it("runs for keys pressed inside its pane and stops the browser's action when used", () => {
    const root = pane()
    const handler = listen(root)
    const event = press(root.querySelector("button")!, "5")
    expect(handler).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it("leaves the browser's action when the handler didn't use the key", () => {
    const root = pane()
    listen(root, false)
    expect(press(root.querySelector("button")!, "5").defaultPrevented).toBe(false)
  })

  it("ignores keys pressed in another pane", () => {
    const one = pane()
    const two = pane()
    const first = listen(one)
    const second = listen(two)
    press(two.querySelector("button")!, "a")
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it("gives keys pressed with nothing focused to the pane that listened first", () => {
    const first = listen(pane())
    const second = listen(pane())
    press(document.body, "a")
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  })

  it("passes unfocused keys on to the next pane once the first one is gone", () => {
    const one = pane()
    const first = listen(one)
    const second = listen(pane())
    one.remove()
    press(document.body, "a")
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it("stands down in a text field, a menu or a dialog", () => {
    const root = pane(`<input data-testid="field"><input type="checkbox" data-testid="box"><div role="menu"><button>m</button></div><div role="dialog"><button>d</button></div><div contenteditable="true">t</div>`)
    const handler = listen(root)
    press(root.querySelector("[data-testid=field]")!, "a")
    press(root.querySelector("[role=menu] button")!, "a")
    press(root.querySelector("[role=dialog] button")!, "a")
    press(root.querySelector("[contenteditable]")!, "a")
    expect(handler).not.toHaveBeenCalled()
    press(root.querySelector("[data-testid=box]")!, "a")
    expect(handler).toHaveBeenCalledOnce()
  })

  it("stands down for modifiers, handled keys and composing text", () => {
    const root = pane()
    const button = root.querySelector("button")!
    const handler = listen(root)
    press(button, "k", { ctrlKey: true })
    press(button, "k", { altKey: true })
    press(button, "a", { isComposing: true })
    const handled = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true })
    handled.preventDefault()
    button.dispatchEvent(handled)
    expect(handler).not.toHaveBeenCalled()
    press(button, "A", { shiftKey: true })
    expect(handler).toHaveBeenCalledOnce()
  })

  it("stands down while a kit dialog is open", () => {
    const root = pane()
    const handler = listen(root)
    const open = ref(true)
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp(defineComponent({ setup: () => (useLayer("dialog", open), () => null) }))
    app.mount(host)
    press(root.querySelector("button")!, "a")
    press(document.body, "a")
    expect(handler).not.toHaveBeenCalled()
    app.unmount()
    press(root.querySelector("button")!, "a")
    expect(handler).toHaveBeenCalledOnce()
  })

  it("lets modifiers through when asked", () => {
    const root = pane()
    const handler = listen(root, true, { modifiers: true })
    press(root.querySelector("button")!, "s", { ctrlKey: true })
    expect(handler).toHaveBeenCalledOnce()
  })

  it("stops with its scope", () => {
    const root = pane()
    const handler = vi.fn()
    const scope = effectScope()
    scope.run(() => usePaneKeys(ref(root), handler))
    scope.stop()
    press(root.querySelector("button")!, "a")
    expect(handler).not.toHaveBeenCalled()
  })

  it("knows where text is typed", () => {
    const root = pane(`<input id="t"><input id="c" type="radio"><textarea id="x"></textarea><div role="combobox" id="b"></div>`)
    expect(["t", "x", "b"].map((id) => isTypingTarget(root.querySelector(`#${id}`)))).toEqual([true, true, true])
    expect(isTypingTarget(root.querySelector("#c"))).toBe(false)
  })
})
