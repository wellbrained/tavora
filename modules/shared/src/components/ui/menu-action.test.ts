// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App, type Component } from "vue"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./dropdown-menu"
import { toasts } from "./toast/toast"

// A menu row with an `action` that returns a Promise: the menu stays open with the row busy until it settles, the row
// can't be chosen again meanwhile, then the menu closes; a failure shows the kit's error toast.

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
})

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  toasts.value = []
})

function mount(component: Component) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(component)
  app.mount(root)
}

/** A promise the test settles by hand. */
function later() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const row = (name: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((el) => el.textContent?.trim() === name)
const press = (element: Element, key: string) => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))

function dropdown(open: ReturnType<typeof ref<boolean>>, action: () => unknown, other = vi.fn()) {
  return defineComponent({
    render: () =>
      h(DropdownMenu, { open: open.value, "onUpdate:open": (value: boolean) => (open.value = value), modal: false }, () => [
        h(DropdownMenuTrigger, null, () => "Menu"),
        h(DropdownMenuContent, null, () => [
          h(DropdownMenuItem, { action }, () => "Reload"),
          h(DropdownMenuItem, { onSelect: other }, () => "Other"),
        ]),
      ]),
  })
}

describe("menu row action", () => {
  it("keeps the menu open with the row busy until the Promise settles, then closes it", async () => {
    const work = later()
    const action = vi.fn(() => work.promise)
    const open = ref(true)
    mount(dropdown(open, action))
    await wait()

    row("Reload")!.click()
    await wait()
    expect(action).toHaveBeenCalledTimes(1)
    expect(open.value).toBe(true)
    expect(row("Reload")!.getAttribute("aria-busy")).toBe("true")

    // Chosen again while busy, by click and by key: nothing runs and the menu stays.
    row("Reload")!.click()
    row("Reload")!.focus()
    press(row("Reload")!, "Enter")
    await wait()
    expect(action).toHaveBeenCalledTimes(1)
    expect(open.value).toBe(true)

    work.resolve()
    await wait()
    expect(open.value).toBe(false)
    expect(toasts.value).toHaveLength(0)
  })

  it("an action that answers at once closes the menu like @select", async () => {
    const action = vi.fn(() => "done")
    const open = ref(true)
    mount(dropdown(open, action))
    await wait()

    row("Reload")!.click()
    await wait()
    expect(action).toHaveBeenCalledTimes(1)
    expect(open.value).toBe(false)
  })

  it("a failure closes the menu and shows the error toast with the error's words", async () => {
    const work = later()
    const open = ref(true)
    mount(dropdown(open, () => work.promise))
    await wait()

    row("Reload")!.click()
    await wait()
    work.reject(new Error("The folder is gone."))
    await wait()
    expect(open.value).toBe(false)
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0]).toMatchObject({ variant: "error", title: "Something went wrong. Please try again.", description: "The folder is gone." })
  })

  it("an action that throws at once shows the toast too", async () => {
    const open = ref(true)
    mount(
      dropdown(open, () => {
        throw new Error("Nope.")
      }),
    )
    await wait()

    row("Reload")!.click()
    await wait()
    expect(open.value).toBe(false)
    expect(toasts.value[0]).toMatchObject({ variant: "error", description: "Nope." })
  })

  it("a menu closed and opened again meanwhile is not closed when the old work ends", async () => {
    const work = later()
    const open = ref(true)
    mount(dropdown(open, () => work.promise))
    await wait()

    row("Reload")!.click()
    await wait()
    open.value = false
    await wait()
    open.value = true
    await wait()
    // A new row: it was not chosen, so it is not busy.
    expect(row("Reload")!.hasAttribute("aria-busy")).toBe(false)

    work.resolve()
    await wait()
    expect(open.value).toBe(true)
  })

  it("other rows still work while one is busy", async () => {
    const work = later()
    const other = vi.fn()
    const open = ref(true)
    mount(dropdown(open, () => work.promise, other))
    await wait()

    row("Reload")!.click()
    await wait()
    row("Other")!.click()
    await wait()
    expect(other).toHaveBeenCalledTimes(1)
    expect(open.value).toBe(false)
    work.resolve()
  })

  it("a row in a submenu that closed meanwhile still closes the menu when it is done", async () => {
    const work = later()
    const open = ref(true)
    const sub = ref(false)
    mount(
      defineComponent({
        render: () =>
          h(DropdownMenu, { open: open.value, "onUpdate:open": (value: boolean) => (open.value = value), modal: false }, () => [
            h(DropdownMenuTrigger, null, () => "Menu"),
            h(DropdownMenuContent, null, () => [
              h(DropdownMenuSub, { open: sub.value, "onUpdate:open": (value: boolean) => (sub.value = value) }, () => [
                h(DropdownMenuSubTrigger, null, () => "More"),
                h(DropdownMenuSubContent, null, () => [h(DropdownMenuItem, { action: () => work.promise }, () => "Reload")]),
              ]),
            ]),
          ]),
      }),
    )
    await wait()
    sub.value = true
    await wait(50)
    row("Reload")!.click()
    await wait()
    expect(open.value).toBe(true)

    sub.value = false
    await wait()
    expect(row("Reload")).toBeUndefined()
    work.resolve()
    await wait()
    expect(open.value).toBe(false)
  })

  it("works the same in a context menu", async () => {
    const work = later()
    const action = vi.fn(() => work.promise)
    const open = ref(false)
    mount(
      defineComponent({
        render: () =>
          h(ContextMenu, { modal: false, "onUpdate:open": (value: boolean) => (open.value = value) }, () => [
            h(ContextMenuTrigger, null, () => "Area"),
            h(ContextMenuContent, null, () => [h(ContextMenuItem, { action }, () => "Reload")]),
          ]),
      }),
    )
    document.querySelector("[data-slot=context-menu-trigger]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    await wait()
    expect(open.value).toBe(true)

    row("Reload")!.click()
    await wait()
    expect(row("Reload")!.getAttribute("aria-busy")).toBe("true")
    row("Reload")!.click()
    await nextTick()
    expect(action).toHaveBeenCalledTimes(1)

    work.resolve()
    await wait()
    expect(open.value).toBe(false)
  })
})
