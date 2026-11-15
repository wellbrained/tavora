// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu"
import { inertCount } from "./inert-behind"
import { inertHolder, isModalOpen, layers, topLayer, type Layer } from "./layers"

// One list of what is on top of the page: page keys ask it whether a dialog is open, and only its top layer that shuts
// the page holds the page inert.

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.getAnimations ??= () => []
})

describe("reading the list", () => {
  const layer = (id: number, change: Partial<Layer> = {}): Layer => ({ id, kind: "dialog", modal: true, state: "open", element: null, name: undefined, ...change })
  const element = () => document.createElement("div")

  it("the top layer is the newest open one; a leaving one is not on top", () => {
    expect(topLayer([layer(1), layer(2)])?.id).toBe(2)
    expect(topLayer([layer(1), layer(2, { state: "closing" })])?.id).toBe(1)
    expect(topLayer([])).toBeUndefined()
  })

  it("a dialog counts as modal while open, a menu never", () => {
    expect(isModalOpen([layer(1, { kind: "menu" })])).toBe(false)
    expect(isModalOpen([layer(1, { state: "closing" })])).toBe(false)
    expect(isModalOpen([layer(1, { kind: "menu" }), layer(2)])).toBe(true)
  })

  it("the page stays shut by the top modal layer on the page, a leaving one too", () => {
    const one = element()
    const two = element()
    expect(inertHolder([layer(1, { element: one }), layer(2, { element: two, state: "closing" })])?.id).toBe(2)
    expect(inertHolder([layer(1, { element: one }), layer(2, { element: two, modal: false, kind: "menu" })])?.id).toBe(1)
    expect(inertHolder([layer(1, { element: one }), layer(2)])?.id).toBe(1)
  })
})

describe("the kit's dialogs and menus in the list", () => {
  let app: App | undefined
  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ""
  })
  const tick = async () => {
    for (let i = 0; i < 4; i++) await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  function mountDialogs() {
    const first = ref(false)
    const second = ref(false)
    const page = document.createElement("button")
    page.id = "page"
    const root = document.createElement("div")
    document.body.append(page, root)
    const dialog = (open: typeof first, name: string, inner?: () => unknown) =>
      h(Dialog, { open: open.value, "onUpdate:open": (value: boolean) => (open.value = value) }, () =>
        h(DialogContent, { "data-testid": name }, () => [h(DialogTitle, () => name), h(DialogDescription, () => name), h("input", { id: `${name}-field` }), inner?.()]),
      )
    app = createApp(defineComponent({ render: () => dialog(first, "first", () => dialog(second, "second")) }))
    app.mount(root)
    const part = (name: string) => document.querySelector<HTMLElement>(`[data-testid="${name}"]`)
    return { first, second, part }
  }

  it("counts a dialog as open the moment it is told to open, and not after it starts to close", async () => {
    const dialogs = mountDialogs()
    expect(isModalOpen()).toBe(false)
    dialogs.first.value = true
    await nextTick()
    expect(isModalOpen()).toBe(true)
    await tick()
    expect(layers.value.map((layer) => [layer.kind, layer.state, layer.element === dialogs.part("first")])).toEqual([["dialog", "open", true]])
    dialogs.first.value = false
    await nextTick()
    expect(isModalOpen()).toBe(false)
    await tick()
    expect(layers.value).toEqual([])
    expect(inertCount()).toBe(0)
  })

  it("a dialog on top of another is the top layer; it holds the page, and closing it hands the page back", async () => {
    const dialogs = mountDialogs()
    dialogs.first.value = true
    await tick()
    dialogs.second.value = true
    await tick()
    expect(topLayer()?.element).toBe(dialogs.part("second"))
    expect(inertHolder()?.element).toBe(dialogs.part("second"))
    const shut = (element: Element | null) => element?.closest("[inert]") !== null
    expect(shut(document.getElementById("page"))).toBe(true)
    expect(shut(dialogs.part("first"))).toBe(true)
    expect(shut(dialogs.part("second"))).toBe(false)

    dialogs.second.value = false
    await tick()
    expect(topLayer()?.element).toBe(dialogs.part("first"))
    expect(shut(document.getElementById("page"))).toBe(true)
    expect(shut(dialogs.part("first"))).toBe(false)

    dialogs.first.value = false
    await tick()
    expect(shut(document.getElementById("page"))).toBe(false)
    expect(inertCount()).toBe(0)
  })

  it("Escape closes only the top dialog", async () => {
    const dialogs = mountDialogs()
    dialogs.first.value = true
    await tick()
    dialogs.second.value = true
    await tick()
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    await tick()
    expect(dialogs.second.value).toBe(false)
    expect(dialogs.first.value).toBe(true)
    expect(isModalOpen()).toBe(true)
  })

  it("a menu is a layer too: on top of the dialog, it doesn't count as a dialog, and a modal one holds the page", async () => {
    const menu = ref(false)
    const root = document.createElement("div")
    document.body.append(root)
    app = createApp(
      defineComponent({
        render: () =>
          h(DropdownMenu, { open: menu.value, "onUpdate:open": (value: boolean) => (menu.value = value) }, () => [
            h(DropdownMenuTrigger, () => "Menu"),
            h(DropdownMenuContent, { "data-testid": "menu" }, () => h(DropdownMenuItem, () => "Item")),
          ]),
      }),
    )
    app.mount(root)
    menu.value = true
    await tick()
    expect(topLayer()?.kind).toBe("menu")
    expect(isModalOpen()).toBe(false)
    expect(inertHolder()?.element).toBe(document.querySelector('[data-testid="menu"]'))
    menu.value = false
    await tick()
    expect(layers.value).toEqual([])
    expect(inertCount()).toBe(0)
  })
})
