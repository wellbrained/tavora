// @vitest-environment jsdom
// TabStrip's tabs that don't fit: a list button with their count, or ‹ › arrows on the sides that have hidden ones, by
// the user's "Too many tabs" setting (from the theme) or the strip's own `overflow`.
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { TabStrip } from "."
import { ariaProblems } from "../../../testing"
import { setUiLanguage } from "../text"
import { setTabOverflow } from "./tab-overflow"
import type { StripTab } from "./tab-strip"

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
const press = (element: Element, key: string) => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))

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
  setTabOverflow("list")
  setUiLanguage("en")
})

const TABS: StripTab[] = ["a", "b", "c", "d", "e"].map((id) => ({ id, label: `Plan ${id.toUpperCase()}`, closable: true }))
const ROW = 200
const TAB = 100

/**
 * Mounts a strip whose row is 200 px wide and whose five tabs are 100 px each, as jsdom has no layout. The row's scroll
 * position moves the tabs. `open` is the strip's v-model; `picked` lists what it asked for.
 */
async function mount(overflow?: "list" | "arrows", start = "a") {
  const open = ref(start)
  const picked: string[] = []
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(
    defineComponent({
      render: () =>
        h(TabStrip, {
          tabs: TABS,
          modelValue: open.value,
          overflow,
          ariaLabel: "Plans",
          "onUpdate:modelValue": (id: string) => {
            picked.push(id)
            open.value = id
          },
        }),
    }),
  )
  app.mount(root)
  const scroller = root.querySelector<HTMLElement>("[data-testid=tab-strip-scroller]")!
  let scroll = 0
  Object.defineProperty(scroller, "scrollLeft", { get: () => scroll, set: (value: number) => {
      scroll = Math.max(0, Math.min(value, TABS.length * TAB - ROW))
    } })
  Object.defineProperty(scroller, "clientWidth", { get: () => ROW })
  Object.defineProperty(scroller, "scrollWidth", { get: () => TABS.length * TAB })
  scroller.getBoundingClientRect = () => ({ left: 0, right: ROW, top: 0, bottom: 32, width: ROW, height: 32, x: 0, y: 0, toJSON: () => ({}) })
  for (const tab of root.querySelectorAll<HTMLElement>("[data-testid=strip-tab]")) {
    const index = TABS.findIndex((item) => item.id === tab.dataset.tabId)
    tab.getBoundingClientRect = () => {
      const left = index * TAB - scroll
      return { left, right: left + TAB, top: 0, bottom: 32, width: TAB, height: 32, x: left, y: 0, toJSON: () => ({}) }
    }
  }
  const scrollTo = async (to: number) => {
    scroller.scrollLeft = to
    scroller.dispatchEvent(new Event("scroll"))
    await nextTick()
  }
  await scrollTo(0)
  return { root, open, picked, scroller, scrollTo, at: () => scroll }
}

const byTestid = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid=${id}]`)

describe("TabStrip: the list", () => {
  it("counts the hidden tabs on a button in the Tab order, and its menu opens one", async () => {
    const { root, picked, at } = await mount("list")
    expect(root.querySelector("[data-slot=tab-strip]")!.getAttribute("data-tab-overflow")).toBe("list")
    const list = byTestid(root, "strip-hidden-tabs")!
    expect(list.textContent?.trim()).toBe("3")
    expect(list.getAttribute("aria-label")).toBe("3 more tabs")
    expect(list.tabIndex).toBe(0)
    expect(byTestid(root, "strip-previous-tab")).toBeNull()
    expect(byTestid(root, "strip-next-tab")).toBeNull()

    // By keyboard: Enter opens the menu next to the button with the hidden tabs, in order.
    list.focus()
    press(list, "Enter")
    await wait()
    const menu = byTestid(document, "strip-hidden-menu")!
    expect(menu.textContent).toContain("3 more tabs")
    const items = [...menu.querySelectorAll<HTMLElement>("[data-testid=strip-hidden-tab]")]
    expect(items.map((item) => item.textContent?.trim())).toEqual(["Plan C", "Plan D", "Plan E"])

    items[1]!.click()
    await wait()
    expect(picked).toEqual(["d"])
    // The row follows the tab it opened.
    expect(at()).toBe(200)
  })

  it("speaks German, and counts a tab cut in half as hidden", async () => {
    setUiLanguage("de")
    const { root, scrollTo } = await mount("list", "d")
    await scrollTo(300)
    // Row 300–500: d and e in view, a to c hidden.
    expect(byTestid(root, "strip-hidden-tabs")!.getAttribute("aria-label")).toBe("3 weitere Tabs")
    await scrollTo(250)
    // c and e cut in half, a and b out: four.
    expect(byTestid(root, "strip-hidden-tabs")!.textContent?.trim()).toBe("4")
  })
})

describe("TabStrip: the arrows", () => {
  it("shows an arrow only on a side with hidden tabs, out of the Tab order, and steps to the next or previous tab", async () => {
    const { root, picked, scrollTo, at } = await mount("arrows")
    expect(byTestid(root, "strip-hidden-tabs")).toBeNull()
    expect(byTestid(root, "strip-previous-tab")).toBeNull()
    const next = byTestid(root, "strip-next-tab")!
    expect(next.tabIndex).toBe(-1)
    expect(next.getAttribute("aria-label")).toBe("Next tab")

    next.click()
    await wait()
    next.click()
    await wait()
    expect(picked).toEqual(["b", "c"])
    // c is open and in view; a is out on the left now, d and e on the right.
    expect(at()).toBe(100)
    expect(byTestid(root, "strip-previous-tab")!.tabIndex).toBe(-1)
    expect(byTestid(root, "strip-next-tab")).not.toBeNull()

    byTestid(root, "strip-previous-tab")!.click()
    await wait()
    expect(picked.at(-1)).toBe("b")

    await scrollTo(300)
    expect(byTestid(root, "strip-next-tab")).toBeNull()
    expect(byTestid(root, "strip-previous-tab")).not.toBeNull()
  })

  it("brings the open first tab back when it was scrolled away", async () => {
    const { root, picked, scrollTo, at } = await mount("arrows")
    await scrollTo(150)
    byTestid(root, "strip-previous-tab")!.click()
    await wait()
    // There is no tab before a: the nearest hidden one on that side scrolls in, one per press.
    expect(picked).toEqual([])
    expect(at()).toBe(100)
    byTestid(root, "strip-previous-tab")!.click()
    await wait()
    expect(at()).toBe(0)
    expect(byTestid(root, "strip-previous-tab")).toBeNull()
  })

  it("keeps the focus on the tab when an arrow is pressed with the mouse", async () => {
    const { root } = await mount("arrows")
    const tab = root.querySelector<HTMLElement>("[data-tab-id=a]")!
    tab.focus()
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    byTestid(root, "strip-next-tab")!.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(tab)
  })
})

describe("TabStrip: keyboard and the user's setting", () => {
  it("is one Tab stop for the tabs, and the arrow keys bring a hidden tab into view", async () => {
    const { root, picked, at } = await mount("arrows", "b")
    expect(ariaProblems(root)).toEqual([])
    const tab = root.querySelector<HTMLElement>("[data-tab-id=b]")!
    tab.focus()
    press(tab, "ArrowRight")
    await wait()
    expect(picked).toEqual(["c"])
    expect(document.activeElement).toBe(root.querySelector("[data-tab-id=c]"))
    expect(at()).toBe(100)
  })

  it("follows Too many tabs from the theme unless the strip sets its own", async () => {
    const { root } = await mount()
    expect(byTestid(root, "strip-hidden-tabs")).not.toBeNull()
    setTabOverflow("arrows")
    await nextTick()
    expect(root.querySelector("[data-slot=tab-strip]")!.getAttribute("data-tab-overflow")).toBe("arrows")
    expect(byTestid(root, "strip-hidden-tabs")).toBeNull()
    expect(byTestid(root, "strip-next-tab")).not.toBeNull()
    app!.unmount()
    document.body.innerHTML = ""

    const own = await mount("list")
    expect(byTestid(own.root, "strip-hidden-tabs")).not.toBeNull()
    expect(byTestid(own.root, "strip-next-tab")).toBeNull()
  })
})
