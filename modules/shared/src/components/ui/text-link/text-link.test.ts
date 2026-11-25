// @vitest-environment jsdom
// TextLink: what it renders, and that a switched-off one takes no click and is not followed.
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h, type App } from "vue"
import { TextLink } from "."

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

function render(node: () => ReturnType<typeof h>) {
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp({ render: node })
  app.mount(host)
  return host
}

const root = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot=${slot}]`)!

describe("TextLink", () => {
  it("is a plain button that takes the text's size and cuts its label off", () => {
    const go = vi.fn()
    const host = render(() => h(TextLink, { onClick: go }, { icon: () => h("svg"), default: () => "Iron Plate" }))
    const link = root(host, "text-link")
    expect(link.tagName).toBe("BUTTON")
    expect(link.getAttribute("type")).toBe("button")
    expect(link.className).toContain("hover:text-primary")
    expect(link.className).not.toMatch(/\bh-\d|text-(sm|xs|base)\b/)
    expect(root(host, "text-link-label").className).toContain("truncate")
    expect(root(host, "text-link-label").className).toContain("group-hover/text-link:underline")
    expect(root(host, "text-link-icon").getAttribute("aria-hidden")).toBe("true")
    link.click()
    expect(go).toHaveBeenCalledOnce()
  })

  it("wraps inside a sentence when asked", () => {
    const host = render(() => h(TextLink, { wrap: true }, () => "a long station name"))
    expect(root(host, "text-link").className).toMatch(/(^|\s)inline(\s|$)/)
    expect(root(host, "text-link-label").className).not.toContain("truncate")
  })

  it("is a page link with as=a", () => {
    const host = render(() => h(TextLink, { as: "a", href: "https://example.com" }, () => "Wiki"))
    const link = root(host, "text-link")
    expect(link.tagName).toBe("A")
    expect(link.getAttribute("href")).toBe("https://example.com")
    expect(link.hasAttribute("type")).toBe(false)
  })

  it("takes no click while off, and loses its hover look", () => {
    const go = vi.fn()
    const host = render(() => h(TextLink, { disabled: true, disabledReason: "Not in this version.", onClick: go }, () => "Iron Plate"))
    const link = root(host, "text-link")
    expect(link.getAttribute("aria-disabled")).toBe("true")
    expect(link.hasAttribute("disabled")).toBe(false)
    expect(link.className).not.toContain("hover:text-primary")
    link.click()
    expect(go).not.toHaveBeenCalled()
  })

  it("an off page link is announced as off and is not followed", () => {
    const go = vi.fn()
    const host = render(() => h(TextLink, { as: "a", href: "#x", disabled: true, onClick: go }, () => "Wiki"))
    const link = root(host, "text-link")
    expect(link.getAttribute("aria-disabled")).toBe("true")
    expect(link.hasAttribute("href")).toBe(false)
    const click = new MouseEvent("click", { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(go).not.toHaveBeenCalled()
  })
})
