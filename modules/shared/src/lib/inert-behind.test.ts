// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu"
import { inertBehind, inertCount } from "./inert-behind"

// While a modal dialog or menu is open, everything around it is inert (no Tab, no cursor), and it is all put back after.

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
})
const tick = async () => { for (let i = 0; i < 4; i++) await nextTick(); await new Promise((resolve) => setTimeout(resolve, 20)) }

describe("inertBehind", () => {
  it("shuts every branch except the way to the content, and puts it back", () => {
    document.body.innerHTML = '<div id="page"><button>a</button></div><div id="layer"><div id="box"><i id="inside"></i><b id="beside"></b></div><u id="near"></u></div><div data-tooltip-layer="titles" id="tips"></div><div data-slot="toaster-host" id="toasts"></div><div id="was" inert></div>'
    const undo = inertBehind(document.getElementById("inside")!)
    const inert = (id: string) => document.getElementById(id)!.hasAttribute("inert")
    expect(inert("page")).toBe(true)
    expect(inert("beside")).toBe(true)
    expect(inert("near")).toBe(true)
    expect(inert("layer")).toBe(false)
    expect(inert("box")).toBe(false)
    expect(inert("inside")).toBe(false)
    expect(inert("tips")).toBe(false)
    expect(inert("toasts")).toBe(false)
    undo()
    undo()
    expect(inert("page")).toBe(false)
    expect(inert("beside")).toBe(false)
    expect(inert("was")).toBe(true)
    expect(inertCount()).toBe(0)
  })

  it("lets a second one on top leave the first one's work in place when it closes", () => {
    document.body.innerHTML = '<div id="page"></div><div id="one"><i id="a"></i></div><div id="two"><i id="b"></i></div>'
    const first = inertBehind(document.getElementById("a")!)
    const second = inertBehind(document.getElementById("b")!)
    expect(document.getElementById("one")!.hasAttribute("inert")).toBe(true)
    second()
    expect(document.getElementById("one")!.hasAttribute("inert")).toBe(false)
    expect(document.getElementById("page")!.hasAttribute("inert")).toBe(true)
    first()
    expect(document.getElementById("page")!.hasAttribute("inert")).toBe(false)
  })
})

describe("modal dialogs and menus", () => {
  it("make the page inert while a dialog is open, and not after", async () => {
    const root = document.createElement("div")
    root.innerHTML = '<button id="behind">Behind</button>'
    document.body.append(root)
    const open = ref(true)
    const host = document.createElement("div")
    root.append(host)
    app = createApp(defineComponent({
      render: () => h(Dialog, { open: open.value, "onUpdate:open": (value: boolean) => (open.value = value) }, () =>
        h(DialogContent, null, () => [h(DialogTitle, null, () => "Title"), h(DialogDescription, null, () => "Text"), h("button", { id: "inside" }, "Inside")])),
    }))
    app.mount(host)
    await tick()
    expect(root.hasAttribute("inert")).toBe(true)
    expect(document.getElementById("inside")!.closest("[inert]")).toBeNull()
    open.value = false
    await tick()
    expect(root.hasAttribute("inert")).toBe(false)
  })

  it("make the page inert while a modal menu is open, but not a menu that isn't modal", async () => {
    for (const modal of [true, false]) {
      document.body.innerHTML = '<div id="page"><button>Behind</button></div><div id="mount"></div>'
      app = createApp(defineComponent({
        render: () => h(DropdownMenu, { open: true, modal }, () => [
          h(DropdownMenuTrigger, null, () => "Menu"),
          h(DropdownMenuContent, null, () => h(DropdownMenuItem, null, () => "Item")),
        ]),
      }))
      app.mount(document.getElementById("mount")!)
      await tick()
      expect(document.getElementById("page")!.hasAttribute("inert")).toBe(modal)
      app.unmount()
      app = undefined
      expect(document.getElementById("page")!.hasAttribute("inert")).toBe(false)
    }
  })
})
