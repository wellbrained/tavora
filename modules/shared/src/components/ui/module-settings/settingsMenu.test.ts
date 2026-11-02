import { describe, expect, it } from "vitest"
import { setUiLanguage } from "../text"
import { settingsMenu } from "./settingsMenu"

const page = (id: string) => ({ id, label: id })

describe("settingsMenu", () => {
  it("puts the module's own pages first without a heading, then Overlays under a divider: looks, In game, On stream", () => {
    setUiLanguage("en")
    const [own, overlays] = settingsMenu({ pages: [page("clock"), page("hotkeys")], look: [page("text"), page("look")], inGame: { id: "game", on: true }, onStream: { id: "stream", on: false } })
    expect(own).toEqual({ items: [page("clock"), page("hotkeys")] })
    expect(overlays).toMatchObject({ heading: "Overlays", divider: true })
    expect(overlays!.items.map((item) => [item.id, item.label, item.status ?? null])).toEqual([
      ["text", "text", null],
      ["look", "look", null],
      ["game", "In game", "on"],
      ["stream", "On stream", "off"],
    ])
    expect(overlays!.items.slice(2).every((item) => item.icon && item.statusLabel)).toBe(true)
  })

  it("follows the language, and leaves out the places a module has no page for", () => {
    setUiLanguage("de")
    const groups = settingsMenu({ pages: [page("a")], look: [page("text")], onStream: { id: "stream", on: true } })
    expect(groups[1]).toMatchObject({ heading: "Overlays" })
    expect(groups[1]!.items.map((item) => item.label)).toEqual(["text", "Im Stream"])
    expect(groups[1]!.items[1]!.statusLabel).toBe("An")
    expect(settingsMenu({ pages: [page("a")] })).toHaveLength(1)
    setUiLanguage("en")
  })
})
