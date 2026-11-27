// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import { StyleTiles, type StyleTileOption } from "."
import { ariaProblems } from "../../../testing"

// The tile's picture is hidden from screen readers, so a state it draws (locked, 3 of 5 made) reaches them only through
// the option's description: the radio keeps the visible name as its name and gets the description read after it.
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

async function mountTiles(options: StyleTileOption[]) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({
    render: () => h(StyleTiles, { modelValue: "card", "onUpdate:modelValue": () => {}, label: "Style", options }, { tile: ({ option }: { option: StyleTileOption }) => h("span", `${option.value} picture`) }),
  })
  app.mount(root)
  await nextTick()
  const radio = (testid: string) => root.querySelector(`[data-testid=${testid}]`) as HTMLElement
  const text = (ids: string | null) => (ids ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ")
  return { root, radio, text }
}

describe("StyleTiles", () => {
  it("names a tile by its label and reads its description after it", async () => {
    const { root, radio, text } = await mountTiles([
      { value: "card", label: "Card", testid: "card" },
      { value: "bar", label: "Bar", description: "Locked", testid: "bar" },
    ])
    const bar = radio("bar")
    expect(bar.getAttribute("role")).toBe("radio")
    expect(text(bar.getAttribute("aria-labelledby"))).toBe("Bar")
    expect(text(bar.getAttribute("aria-describedby"))).toBe("Locked")
    // The description is for screen readers only; the visible name under the picture stays the label.
    const description = bar.querySelector("[data-slot=style-tile-description]")!
    expect(description.classList.contains("sr-only")).toBe(true)
    expect(bar.querySelector("[aria-hidden=true]")?.textContent).toBe("bar picture")
    expect([...bar.querySelectorAll(":scope > span:not([aria-hidden]):not(.sr-only)")].map((span) => span.textContent)).toEqual(["Bar"])
    expect(ariaProblems(root)).toEqual([])
  })

  it("leaves a tile without a description as it was: named by its content, nothing to read after", async () => {
    const { radio } = await mountTiles([{ value: "card", label: "Card", testid: "card" }])
    const card = radio("card")
    expect(card.hasAttribute("aria-labelledby")).toBe(false)
    expect(card.hasAttribute("aria-describedby")).toBe(false)
    expect(card.querySelector("[data-slot=style-tile-description]")).toBeNull()
    expect(card.textContent).toBe("card pictureCard")
  })

  it("gives every tile its own description, also with two groups on the page", async () => {
    const options = [
      { value: "card", label: "Card", description: "3 of 5 made", testid: "card" },
      { value: "bar", label: "Bar", description: "Locked", testid: "bar" },
    ]
    const root = document.createElement("div")
    document.body.append(root)
    const group = (label: string, prefix: string, mark: string) =>
      h(StyleTiles, { modelValue: "card", label, options: options.map((option) => ({ ...option, description: option.description + mark, testid: prefix + option.testid })) })
    app = createApp({ render: () => h("div", [group("Style", "", ""), group("Other", "other-", "!")]) })
    app.mount(root)
    await nextTick()
    const said = (testid: string) =>
      (root.querySelector(`[data-testid=${testid}]`)!.getAttribute("aria-describedby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(" ")
    expect([said("card"), said("bar"), said("other-card"), said("other-bar")]).toEqual(["3 of 5 made", "Locked", "3 of 5 made!", "Locked!"])
    expect(ariaProblems(root)).toEqual([])
  })
})
