// @vitest-environment jsdom
// A submenu entry whose submenu holds the chosen choice (`chosen` on the sub triggers) looks like the chosen row.
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import { choiceSubmenu } from "./choice-row"
import { ContextMenu, ContextMenuContent, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "./context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./dropdown-menu"

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

async function mount(render: () => ReturnType<typeof h>) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(defineComponent({ render }))
  app.mount(root)
  await nextTick()
  await nextTick()
}

const entry = (name: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((el) => el.textContent?.trim() === name)!

describe("chosen submenu entries", () => {
  it("DropdownMenuSubTrigger marks a chosen one and leaves the others", async () => {
    await mount(() =>
      h(DropdownMenu, { open: true, modal: false }, () => [
        h(DropdownMenuTrigger, null, () => "Format"),
        h(DropdownMenuContent, null, () =>
          ["Number", "Percent"].map((name) =>
            h(DropdownMenuSub, null, () => [h(DropdownMenuSubTrigger, { chosen: name === "Number" }, () => name), h(DropdownMenuSubContent, null, () => "x")]),
          ),
        ),
      ]),
    )
    expect(entry("Number").hasAttribute("data-chosen")).toBe(true)
    expect(entry("Percent").hasAttribute("data-chosen")).toBe(false)
    expect(entry("Number").className).toContain(choiceSubmenu.split(" ")[0])
    expect(entry("Number").getAttribute("chosen")).toBeNull()
  })

  it("ContextMenuSubTrigger does the same", async () => {
    await mount(() =>
      h(ContextMenu, { modal: false }, () => [
        h(ContextMenuTrigger, null, () => h("div", { "data-testid": "area" }, "Area")),
        h(ContextMenuContent, null, () => [h(ContextMenuSub, null, () => [h(ContextMenuSubTrigger, { chosen: true }, () => "Number"), h(ContextMenuSubContent, null, () => "x")])]),
      ]),
    )
    document.querySelector("[data-testid=area]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
    await nextTick()
    await nextTick()
    expect(entry("Number").hasAttribute("data-chosen")).toBe(true)
  })
})
