// @vitest-environment jsdom
// A popover that never takes the focus (`focus="none"`) and the places a click may land without closing it (`dismissIgnore`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, ref, type App } from "vue"
import { Popover, PopoverAnchor, PopoverContent, type DismissIgnore } from "."

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
beforeEach(() => {
  for (const name of ["ResizeObserver", "IntersectionObserver"]) vi.stubGlobal(name, class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

/** A field with a popover next to it, plus a board and an outside place; `ignore` is read when a press lands outside. */
async function mount(options: { focus?: "content" | "none"; ignore?: (box: HTMLElement | null) => DismissIgnore | undefined; onInteractOutside?: (event: Event) => void; closed?: boolean } = {}) {
  const open = ref(!options.closed)
  const box = ref<HTMLElement | null>(null)
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({
    render: () =>
      h("div", [
        h(Popover, { open: open.value, "onUpdate:open": (next: boolean) => (open.value = next) }, () => [
          h(PopoverAnchor, { asChild: true }, () => h("input", { "data-testid": "field" })),
          h(PopoverContent, { focus: options.focus, dismissIgnore: options.ignore?.(box.value), onInteractOutside: options.onInteractOutside }, () => [h("button", { "data-testid": "inside" }, "Inside")]),
        ]),
        h("div", { ref: box, "data-testid": "board", class: "board" }, [h("span", { "data-testid": "slot" }, "slot")]),
        h("div", { "data-testid": "elsewhere" }, "elsewhere"),
      ]),
  })
  app.mount(root)
  await nextTick()
  await wait()
  const get = (id: string) => document.querySelector(`[data-testid=${id}]`) as HTMLElement
  const content = () => document.querySelector("[data-slot=popover-content]") as HTMLElement | null
  const press = async (id: string) => {
    get(id).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }))
    await wait()
  }
  return { get, content, press, open }
}

describe("PopoverContent focus='none'", () => {
  it("leaves the focus in the field when it opens and is not announced as a dialog", async () => {
    const { get, content, open } = await mount({ focus: "none", closed: true })
    get("field").focus()
    open.value = true
    await wait()
    expect(content()).not.toBeNull()
    expect(document.activeElement).toBe(get("field"))
    expect(content()!.contains(document.activeElement)).toBe(false)
    expect(content()!.getAttribute("role")).toBe("presentation")
  })

  it("keeps the press on the panel from taking the focus", async () => {
    const { get } = await mount({ focus: "none" })
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    get("inside").dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
  })

  it("is a dialog that takes its focus by default", async () => {
    const { get, content } = await mount()
    expect(content()!.getAttribute("role")).toBe("dialog")
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    get("inside").dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
  })
})

describe("PopoverContent dismissIgnore", () => {
  it("closes on a press outside when nothing is ignored", async () => {
    const { press, content } = await mount({ focus: "none" })
    await press("slot")
    expect(content()).toBeNull()
  })

  it("stays open for a press inside an ignored element and closes for one elsewhere", async () => {
    const { press, content } = await mount({ focus: "none", ignore: (box) => box })
    await press("slot")
    expect(content()).not.toBeNull()
    await press("elsewhere")
    expect(content()).toBeNull()
  })

  it("takes a selector, a list and a component's element", async () => {
    for (const ignore of [() => ".board", () => ["[data-nothing]", ".board"], () => ({ $el: document.querySelector(".board") }) as never]) {
      const { press, content } = await mount({ focus: "none", ignore })
      await press("slot")
      expect(content()).not.toBeNull()
      await press("elsewhere")
      expect(content()).toBeNull()
      app?.unmount()
      document.body.innerHTML = ""
    }
  })

  it("still tells the caller's own interact-outside handler, ignored or not", async () => {
    const seen: boolean[] = []
    const { press } = await mount({ focus: "none", ignore: (box) => box, onInteractOutside: (event) => seen.push(event.defaultPrevented) })
    await press("slot")
    // Reka tells a handler twice for one press; what matters is that the caller sees it already kept open.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(Boolean)).toBe(true)
  })
})
