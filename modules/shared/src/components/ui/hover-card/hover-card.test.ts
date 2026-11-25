// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, watch, type App } from "vue"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../dropdown-menu"
import { ariaProblems } from "../../../aria-patterns"
import { HoverCard, HoverCardClose, HoverCardContent, HoverCardTrigger, useHoverCard, type UseHoverCard } from "."

// The kit's HoverCard: a card you can move into, Tab through and pin, for one trigger or shared by many targets.

let app: App | undefined
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
})
// Only the timers: Vue ignores an event as old as its handler, and a frozen Date.now makes every event that old.
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }))
afterEach(async () => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  // Let the last card's closing count as long ago, so the next test waits for its own delay.
  if (vi.isFakeTimers()) vi.advanceTimersByTime(1000)
  vi.useRealTimers()
})

interface Spell { name: string }
const pointer = (type: string, pointerType = "mouse") => Object.assign(new Event(type, { bubbles: type !== "pointerenter" && type !== "pointerleave" }), { pointerType })
const enter = (element: Element, pointerType = "mouse") => element.dispatchEvent(pointer("pointerenter", pointerType))
const leave = (element: Element) => element.dispatchEvent(pointer("pointerleave"))
const tab = (element: Element, shiftKey = false) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }))
async function settle() {
  for (let i = 0; i < 4; i++) await nextTick()
}
const card = () => document.querySelector<HTMLElement>("[data-slot=hover-card]")

/** Targets bound with `card.on(spell)` and one HoverCard for them, with a link and a button in the card. */
async function mountMany(options: Parameters<typeof useHoverCard>[0] = {}, spells: Spell[] = [{ name: "Frost Ward" }, { name: "Fireball" }], content: Record<string, unknown> = {}) {
  let hc!: UseHoverCard<Spell>
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp(defineComponent({
    setup() {
      hc = useHoverCard<Spell>(options)
      return () => h("div", [
        ...spells.map((spell, index) => h("span", { key: index, "data-index": index, ...hc.on(spell, { focusable: true }) }, spell.name)),
        h("button", { id: "after" }, "After"),
        h(HoverCard, hc.props, () => h(HoverCardContent, { title: hc.content?.name, ...content }, () => [
          h("a", { href: "#wiki", id: "wiki" }, "Open in the wiki"),
          h("button", { id: "add" }, "Add to build"),
        ])),
      ])
    },
  }))
  app.mount(host)
  await settle()
  return { hc, targets: [...host.querySelectorAll<HTMLElement>("[data-index]")] }
}

describe("useHoverCard", () => {
  it("opens after the hover delay and stays while the pointer moves onto the card", async () => {
    const { hc, targets } = await mountMany()
    enter(targets[0]!)
    vi.advanceTimersByTime(399)
    expect(hc.open).toBe(false)
    vi.advanceTimersByTime(1)
    await settle()
    expect(hc.open).toBe(true)
    expect(card()?.textContent).toContain("Frost Ward")
    leave(targets[0]!)
    vi.advanceTimersByTime(100)
    enter(card()!)
    vi.advanceTimersByTime(500)
    expect(hc.status).toBe("open")
    leave(card()!)
    vi.advanceTimersByTime(200)
    expect(hc.open).toBe(false)
  })

  it("doesn't open when the pointer only passes over", async () => {
    const { hc, targets } = await mountMany()
    enter(targets[0]!)
    vi.advanceTimersByTime(200)
    leave(targets[0]!)
    vi.advanceTimersByTime(1000)
    expect(hc.open).toBe(false)
  })

  it("moves at once to the next target, and comes without waiting right after one closed", async () => {
    const { hc, targets } = await mountMany()
    enter(targets[0]!)
    vi.advanceTimersByTime(400)
    enter(targets[1]!)
    expect(hc.content).toEqual({ name: "Fireball" })
    expect(hc.target).toBe(targets[1])
    leave(targets[1]!)
    vi.advanceTimersByTime(200)
    expect(hc.open).toBe(false)
    enter(targets[0]!)
    expect(hc.open).toBe(true)
  })

  it("points the target at the open card", async () => {
    const { hc, targets } = await mountMany()
    hc.show(targets[0]!, { name: "Frost Ward" })
    await settle()
    expect(targets[0]!.getAttribute("aria-controls")).toBe(hc.id)
    expect(card()?.id).toBe(hc.id)
    hc.close()
    expect(targets[0]!.hasAttribute("aria-controls")).toBe(false)
  })

  it("opens at once from the keyboard, Tab goes into the card and past it on after the target", async () => {
    const { hc, targets } = await mountMany()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }))
    targets[0]!.focus()
    await settle()
    expect(hc.open).toBe(true)
    tab(targets[0]!)
    expect(document.activeElement?.id).toBe("wiki")
    // Shift+Tab from its first stop goes back to the target, and the card stays.
    tab(document.activeElement!, true)
    expect(document.activeElement).toBe(targets[0])
    expect(hc.open).toBe(true)
    tab(targets[0]!)
    document.querySelector<HTMLElement>("#add")!.focus()
    tab(document.activeElement!)
    // On to the next target, which shows its own card.
    expect(document.activeElement).toBe(targets[1])
    expect(hc.target).toBe(targets[1])
    expect(hc.content).toEqual({ name: "Fireball" })
  })

  it("closes on Escape and gives the focus back to the target", async () => {
    const { hc, targets } = await mountMany()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }))
    targets[0]!.focus()
    await settle()
    tab(targets[0]!)
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    await settle()
    expect(hc.open).toBe(false)
    expect(document.activeElement).toBe(targets[0])
  })

  it("a pinnable card pins on a click on the target, with a close button that gives the focus back", async () => {
    const { hc, targets } = await mountMany({ pinnable: true })
    targets[0]!.click()
    await settle()
    expect(hc.pinned).toBe(true)
    expect(card()?.getAttribute("role")).toBe("dialog")
    expect(card()?.getAttribute("aria-modal")).toBe("false")
    expect(document.getElementById(card()!.getAttribute("aria-labelledby")!)?.textContent).toBe("Frost Ward")
    // Every id the card and its target point at is there, and nothing hidden takes a Tab stop.
    expect(ariaProblems()).toEqual([])
    // Leaving and hovering other targets doesn't touch a pinned card.
    leave(targets[0]!)
    enter(targets[1]!)
    vi.advanceTimersByTime(1000)
    expect(hc.content).toEqual({ name: "Frost Ward" })
    expect(hc.pinned).toBe(true)
    // Clicking another target moves the pin there.
    targets[1]!.click()
    expect(hc.content).toEqual({ name: "Fireball" })
    await settle()
    const close = card()!.querySelector<HTMLButtonElement>("[data-slot=hover-card-x]")!
    expect(close.getAttribute("aria-label")).toBe("Close")
    close.focus()
    close.click()
    await settle()
    expect(hc.open).toBe(false)
    expect(document.activeElement).toBe(targets[1])
  })

  it("clicking the pinned target again closes its card", async () => {
    const { hc, targets } = await mountMany({ pinnable: true })
    targets[0]!.click()
    targets[0]!.click()
    expect(hc.open).toBe(false)
  })

  it("a click doesn't pin a card that isn't pinnable, nor on a button", async () => {
    const { hc, targets } = await mountMany()
    targets[0]!.click()
    expect(hc.open).toBe(false)
    const pinnable = useHoverCard<Spell>({ pinnable: true })
    const button = document.createElement("button")
    document.body.append(button)
    const bound = pinnable.on({ name: "Fireball" }) as { onClick: (event: Event) => void }
    button.addEventListener("click", event => bound.onClick(event))
    button.click()
    expect(pinnable.open).toBe(false)
  })

  it("on touch, a tap pins the card of a target that isn't a control, and hover never opens it", async () => {
    const { hc, targets } = await mountMany()
    enter(targets[0]!, "touch")
    vi.advanceTimersByTime(1000)
    expect(hc.open).toBe(false)
    targets[0]!.dispatchEvent(pointer("pointerdown", "touch"))
    targets[0]!.click()
    expect(hc.pinned).toBe(true)
  })

  it("stays while the focus is in it, and goes once the focus leaves", async () => {
    const { hc, targets } = await mountMany()
    hc.show(targets[0]!, { name: "Frost Ward" })
    await settle()
    document.querySelector<HTMLElement>("#add")!.focus()
    leave(card()!)
    vi.advanceTimersByTime(1000)
    expect(hc.status).toBe("open")
    expect(card()?.querySelector("[data-slot=hover-card-x]")).toBeNull()
    // A click on a button inside doesn't make it sticky: with the focus gone, leaving closes it.
    document.querySelector<HTMLElement>("#add")!.blur()
    leave(card()!)
    vi.advanceTimersByTime(200)
    expect(hc.open).toBe(false)
  })

  it("moves the pin to another target without closing in between, and leaves Escape to the page", async () => {
    const { hc, targets } = await mountMany({ pinnable: true })
    targets[0]!.click()
    await settle()
    vi.advanceTimersByTime(10)
    const statuses: string[] = []
    const stop = watch(() => hc.status, status => statuses.push(status), { flush: "sync" })
    targets[1]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    await settle()
    targets[1]!.click()
    stop()
    expect(hc.pinned).toBe(true)
    expect(hc.content).toEqual({ name: "Fireball" })
    expect(statuses).toEqual([])
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    document.body.dispatchEvent(escape)
    await settle()
    expect(hc.open).toBe(false)
    expect(escape.defaultPrevented).toBe(false)
  })

  it("gives the focus back to a target that can't take it by itself", async () => {
    let hc!: UseHoverCard<Spell>
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp(defineComponent({
      setup() {
        hc = useHoverCard<Spell>({ pinnable: true })
        return () => h("div", [
          h("span", { id: "name", ...hc.on({ name: "Frost Ward" }) }, "Frost Ward"),
          h(HoverCard, hc.props, () => h(HoverCardContent, { title: "Frost Ward" }, () => h("button", { id: "inside" }, "Add"))),
        ])
      },
    }))
    app.mount(host)
    await settle()
    const name = document.getElementById("name")!
    name.click()
    await settle()
    document.getElementById("inside")!.focus()
    card()!.querySelector<HTMLElement>("[data-slot=hover-card-x]")!.click()
    await settle()
    expect(document.activeElement).toBe(name)
    expect(name.getAttribute("tabindex")).toBe("-1")
  })

  it("an open card closes when the page scrolls; a pinned one stays", async () => {
    const { hc, targets } = await mountMany({ pinnable: true })
    hc.show(targets[0]!, { name: "Frost Ward" })
    window.dispatchEvent(new Event("scroll"))
    expect(hc.open).toBe(false)
    hc.show(targets[0]!, { name: "Frost Ward" }, { pinned: true })
    window.dispatchEvent(new Event("scroll"))
    window.dispatchEvent(new Event("blur"))
    expect(hc.pinned).toBe(true)
  })

  it("the card goes with its target", async () => {
    let hc!: UseHoverCard<Spell>
    let spells = [{ name: "Frost Ward" }]
    const host = document.createElement("div")
    document.body.append(host)
    const root = defineComponent({
      setup() {
        hc = useHoverCard<Spell>()
        return () => h("div", spells.map((spell, index) => h("span", { key: spell.name, "data-index": index, ...hc.on(spell) })))
      },
    })
    app = createApp(root)
    const vm = app.mount(host)
    hc.show(host.querySelector("[data-index]")!, spells[0]!)
    spells = []
    vm.$forceUpdate()
    await settle()
    expect(hc.open).toBe(false)
  })
})

describe("HoverCard parts", () => {
  it("a trigger opens its own card, and HoverCardClose closes it", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp({
      render: () => h(HoverCard, { pinnable: true }, () => [
        h(HoverCardTrigger, { focusable: true }, () => "Frost Ward"),
        h(HoverCardContent, { title: "Frost Ward", description: "Covers you in ice." }, () => h(HoverCardClose, () => "Done")),
      ]),
    })
    app.mount(host)
    await settle()
    const trigger = host.querySelector<HTMLElement>("[data-slot=hover-card-trigger]")!
    expect(trigger.tabIndex).toBe(0)
    enter(trigger)
    vi.advanceTimersByTime(400)
    await settle()
    expect(card()?.getAttribute("role")).toBe("group")
    expect(card()?.querySelector("p")?.textContent).toBe("Covers you in ice.")
    expect(card()?.querySelector("[data-slot=hover-card-x]")).toBeNull()
    trigger.click()
    await settle()
    expect(card()?.getAttribute("data-pinned")).toBe("true")
    card()!.querySelector<HTMLElement>("[data-slot=hover-card-close]")!.click()
    await settle()
    expect(card()).toBeNull()
  })

  it("a press outside closes a pinned card", async () => {
    const { hc, targets } = await mountMany({ pinnable: true })
    targets[0]!.click()
    await settle()
    vi.advanceTimersByTime(10)
    document.querySelector<HTMLElement>("#after")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    await settle()
    expect(hc.open).toBe(false)
  })

  it("Tab past the card of the last target goes on to what follows, and the card closes", async () => {
    const { hc, targets } = await mountMany()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }))
    targets[1]!.focus()
    await settle()
    tab(targets[1]!)
    document.querySelector<HTMLElement>("#add")!.focus()
    tab(document.activeElement!)
    expect(hc.open).toBe(false)
    expect(document.activeElement?.id).toBe("after")
  })

  it("a menu in the card keeps it open, and Escape closes the menu first", async () => {
    vi.useRealTimers()
    const wait = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))
    const menu = ref(false)
    let hc!: UseHoverCard<Spell>
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp(defineComponent({
      setup() {
        hc = useHoverCard<Spell>()
        return () => h("div", [
          h("span", { id: "target", ...hc.on({ name: "Frost Ward" }) }, "Frost Ward"),
          h(HoverCard, hc.props, () => h(HoverCardContent, { title: "Frost Ward" }, () =>
            h(DropdownMenu, { open: menu.value, "onUpdate:open": (value: boolean) => (menu.value = value), modal: false }, () => [
              h(DropdownMenuTrigger, null, () => "Level"),
              h(DropdownMenuContent, null, () => [h(DropdownMenuItem, null, () => "Level 3")]),
            ]))),
        ])
      },
    }))
    app.mount(host)
    await wait()
    hc.show(document.getElementById("target")!, { name: "Frost Ward" })
    await wait()
    menu.value = true
    await wait()
    expect(hc.status).toBe("open")
    leave(card()!)
    const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(el => el.textContent?.trim() === "Level 3")!
    item.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    await wait(300)
    expect(hc.open).toBe(true)
    item.focus()
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    await wait()
    expect(menu.value).toBe(false)
    expect(hc.open).toBe(true)
  })
})

describe("HoverCardContent attributes", () => {
  it("puts a class and a test id on the card, where the class wins over the card's own", async () => {
    const { targets } = await mountMany({}, undefined, { class: "w-96 spell-card", "data-testid": "spell-card" })
    enter(targets[0]!)
    vi.advanceTimersByTime(400)
    await settle()
    expect(card()?.dataset.testid).toBe("spell-card")
    expect(card()?.classList.contains("spell-card")).toBe(true)
    expect(card()?.classList.contains("tavora-hover-card")).toBe(true)
  })
})
