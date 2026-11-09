// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, type App } from "vue"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "."
import { buttonVariants } from "../button"

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

function mount(panelClass?: string) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({
    render: () =>
      h(Tabs, { defaultValue: "a" }, () => [
        h(TabsList, () => h(TabsTrigger, { value: "a" }, () => "A")),
        h(TabsContent, { value: "a", class: panelClass }, () => "Panel"),
      ]),
  })
  app.mount(root)
  return root.querySelector("[data-slot=tabs-content]") as HTMLElement
}

describe("tab panel focus", () => {
  it("can be reached with the keyboard", () => {
    expect(mount().tabIndex).toBe(0)
  })

  // The panel is focusable, so it must show where the keyboard is: the theme's ring, drawn as an outline
  // (a box-shadow ring would be cut off by a scrolling panel). No transition, so it is there from the first frame.
  it("draws the theme's ring when focused with the keyboard", () => {
    const classes = mount().className.split(/\s+/)
    // outline-none sets the outline style to none, so the ring needs its style back (Tailwind 4).
    expect(classes).toContain("focus-visible:outline-solid")
    expect(classes).toContain("focus-visible:outline-2")
    expect(classes).toContain("focus-visible:outline-offset-2")
    expect(classes).toContain("focus-visible:outline-ring")
    expect(classes.some((c) => c.startsWith("transition"))).toBe(false)
  })

  it("keeps the ring when a module adds its own classes", () => {
    const classes = mount("p-4 text-sm").className.split(/\s+/)
    expect(classes).toContain("p-4")
    expect(classes).toContain("focus-visible:outline-ring")
  })
})

describe("focus ring timing", () => {
  // The button's ring is a box-shadow that grows in with the press duration (140 ms, eased out): a test that
  // measures it should wait a little longer than that.
  it("fades a button's ring in with the press duration", () => {
    const classes = buttonVariants()
    expect(classes).toContain("focus-visible:ring-ring/50")
    expect(classes).toContain("box-shadow")
    expect(classes).toContain("duration-(--duration-press)")
  })
})
