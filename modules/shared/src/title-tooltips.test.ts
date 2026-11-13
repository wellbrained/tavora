// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { installTitleTooltips } from "./title-tooltips"

// The hint layer moves a `title` into `data-tavora-tooltip`. What a screen reader got from the title must stay.

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.innerHTML = ""
})

/** Adds an element and lets the layer see it (it watches `title` changes through a MutationObserver). */
async function add(html: string) {
  dispose = installTitleTooltips(document)
  const holder = document.createElement("div")
  holder.innerHTML = html
  document.body.append(holder)
  const element = holder.firstElementChild as HTMLElement
  // Elements are only seen once the title is set while the layer watches, as a framework does.
  const title = element.getAttribute("title")!
  element.removeAttribute("title")
  await Promise.resolve()
  element.setAttribute("title", title)
  await Promise.resolve()
  return element
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("title hints and screen readers", () => {
  it("keeps the full hint as the description of an element with its own text", async () => {
    const element = await add(`<span title="C:\\Users\\me\\projects\\modules">…\\projects\\modules</span>`)
    await settle()
    expect(element.getAttribute("title")).toBe("")
    expect(element.getAttribute("data-tavora-tooltip")).toBe("C:\\Users\\me\\projects\\modules")
    expect(element.getAttribute("aria-description")).toBe("C:\\Users\\me\\projects\\modules")
    expect(element.hasAttribute("aria-label")).toBe(false)
  })

  it("keeps it for an element named by its aria-label", async () => {
    const element = await add(`<button aria-label="Move" title="Move this folder"></button>`)
    await settle()
    expect(element.getAttribute("aria-label")).toBe("Move")
    expect(element.getAttribute("aria-description")).toBe("Move this folder")
  })

  it("adds nothing when the hint only repeats the name", async () => {
    const element = await add(`<button title="Save">  Save </button>`)
    await settle()
    expect(element.hasAttribute("aria-description")).toBe(false)
  })

  it("names an element without text by the hint, and leaves out the description", async () => {
    const element = await add(`<button title="Close"></button>`)
    await settle()
    expect(element.getAttribute("aria-label")).toBe("Close")
    expect(element.hasAttribute("aria-description")).toBe(false)
  })

  it("follows a title that changes, and goes away with it", async () => {
    const element = await add(`<span title="One">Short</span>`)
    await settle()
    element.setAttribute("title", "Two")
    await settle()
    expect(element.getAttribute("aria-description")).toBe("Two")
    element.setAttribute("title", "Short")
    await settle()
    expect(element.hasAttribute("aria-description")).toBe(false)
    element.setAttribute("title", "Three")
    await settle()
    expect(element.getAttribute("aria-description")).toBe("Three")
    element.removeAttribute("title")
    await settle()
    expect(element.hasAttribute("aria-description")).toBe(false)
  })

  it("leaves an aria-description the author wrote alone", async () => {
    const element = await add(`<span aria-description="Mine" title="Hint">Text</span>`)
    await settle()
    expect(element.getAttribute("aria-description")).toBe("Mine")
    element.removeAttribute("title")
    await settle()
    expect(element.getAttribute("aria-description")).toBe("Mine")
  })

  it("leaves a control's own reason alone, also when it comes and goes", async () => {
    const element = await add(`<button data-tavora-reason="Ask your admin." aria-description="Ask your admin." title="Save as">Save</button>`)
    await settle()
    expect(element.getAttribute("aria-description")).toBe("Ask your admin.")
    element.removeAttribute("aria-description")
    element.setAttribute("title", "Save as new")
    await settle()
    expect(element.hasAttribute("aria-description")).toBe(false)
  })

  it("does not take away a description set after its own", async () => {
    const element = await add(`<span title="Full text here">Short</span>`)
    await settle()
    element.setAttribute("aria-description", "Later")
    element.setAttribute("title", "Another")
    await settle()
    expect(element.getAttribute("aria-description")).toBe("Later")
    element.removeAttribute("title")
    await settle()
    expect(element.getAttribute("aria-description")).toBe("Later")
  })

  it("adds nothing when the name already holds the hint", async () => {
    const element = await add(`<button aria-label="Move C:\a\b" title="C:\a\b"></button>`)
    await settle()
    expect(element.hasAttribute("aria-description")).toBe(false)
  })

  it("still points aria-describedby at the open hint and takes it away again", async () => {
    const element = await add(`<span title="Full text here">Short</span>`)
    await settle()
    element.dispatchEvent(new Event("pointerover", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(element.getAttribute("aria-describedby")).toBe("tavora-title-tooltip")
    expect(element.getAttribute("aria-description")).toBe("Full text here")
    element.dispatchEvent(new Event("pointerout", { bubbles: true }))
    expect(element.hasAttribute("aria-describedby")).toBe(false)
    expect(element.getAttribute("aria-description")).toBe("Full text here")
  })

  it("gives the title back when the layer is removed", async () => {
    const element = await add(`<span title="Full text here">Short</span>`)
    await settle()
    dispose?.()
    dispose = undefined
    expect(element.getAttribute("title")).toBe("Full text here")
    expect(element.hasAttribute("aria-description")).toBe(false)
  })
})
