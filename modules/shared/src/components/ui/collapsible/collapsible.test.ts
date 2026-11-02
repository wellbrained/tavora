// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, type App } from "vue"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "."

// The motion lives in CSS (motion.css); these tests cover what the component hands it: nothing plays before the first
// open or close (data-armed), and a section that has shut leaves the layout (data-shut), force-mounted or not.

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  document.head.innerHTML = ""
})

function mount(options: { open?: boolean; forceMount?: boolean; animated?: boolean }) {
  // jsdom has no motion.css: say that a closed section has an animation (the default, as in the app)
  const style = document.createElement("style")
  style.textContent = options.animated === false ? "" : ".tavora-collapse[data-state=closed] { animation-name: tavora-collapse-out; }"
  document.head.append(style)
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(
    defineComponent({
      render: () =>
        h(Collapsible, { defaultOpen: options.open }, () => [
          h(CollapsibleTrigger, { "data-testid": "trigger" }, () => "Notes"),
          h(CollapsibleContent, { forceMount: options.forceMount, "data-testid": "content" }, () => "Hello"),
        ]),
    }),
  )
  app.mount(root)
  const content = () => root.querySelector("[data-testid=content]") as HTMLElement
  const toggle = async () => {
    ;(root.querySelector("[data-testid=trigger]") as HTMLElement).click()
    await wait()
  }
  const endAnimation = async (name: string) => {
    // jsdom has no AnimationEvent: give the event the one field the handler reads
    const event = Object.assign(new Event("animationend", { bubbles: true }), { animationName: name })
    content().dispatchEvent(event)
    await wait()
  }
  return { content, toggle, endAnimation }
}

describe("CollapsibleContent", () => {
  it("does not play before the first open or close, whether it starts open or closed", async () => {
    const closed = mount({ forceMount: true })
    await wait()
    expect(closed.content().hasAttribute("data-armed")).toBe(false)
    expect(closed.content().getAttribute("data-state")).toBe("closed")
    app?.unmount()
    document.body.innerHTML = ""
    const open = mount({ open: true })
    await wait()
    expect(open.content().hasAttribute("data-armed")).toBe(false)
  })

  it("is armed from the first toggle on", async () => {
    const { content, toggle } = mount({ forceMount: true })
    await toggle()
    expect(content().hasAttribute("data-armed")).toBe(true)
    expect(content().getAttribute("data-state")).toBe("open")
    expect(content().hasAttribute("data-shut")).toBe(false)
  })

  it("keeps a force-mounted section in the page and takes it out of the layout when its close has played", async () => {
    const { content, toggle, endAnimation } = mount({ open: true, forceMount: true })
    await wait()
    await toggle()
    expect(content().getAttribute("data-state")).toBe("closed")
    // still shutting: in the layout, so the height can run
    expect(content().hasAttribute("data-shut")).toBe(false)
    await endAnimation("tavora-collapse-out")
    expect(content().isConnected).toBe(true)
    expect(content().hasAttribute("data-shut")).toBe(true)
    // opening again brings it back
    await toggle()
    expect(content().hasAttribute("data-shut")).toBe(false)
  })

  it("takes a section out of the layout at once when nothing animates its close (no motion to wait for)", async () => {
    const { content, toggle } = mount({ open: true, forceMount: true, animated: false })
    await wait()
    await toggle()
    await wait(60)
    expect(content().hasAttribute("data-shut")).toBe(true)
  })

  it("ignores other animations ending on the element", async () => {
    const { content, toggle, endAnimation } = mount({ open: true, forceMount: true })
    await wait()
    await toggle()
    await endAnimation("something-else")
    expect(content().hasAttribute("data-shut")).toBe(false)
  })
})
