import { describe, expect, it } from "vitest"
import { chipKey, cleanTag, freshTag, splitPaste, suggestionsFor, tagKey, tagsToAdd } from "./tags"

describe("tags", () => {
  it("compares tags without case and extra spaces", () => {
    expect(tagKey("  Boss   Rush ")).toBe(tagKey("boss rush"))
    expect(cleanTag("  boss   rush ")).toBe("boss rush")
    expect(cleanTag("speedrun", 5)).toBe("speed")
  })

  it("adds new tags once, in order, as many as max leaves room for", () => {
    expect(tagsToAdd(["Boss"], ["boss", " pvp ", "", "PvP", "coop"])).toEqual(["pvp", "coop"])
    expect(tagsToAdd(["a", "b"], ["c", "d", "e"], { max: 3 })).toEqual(["c"])
    expect(tagsToAdd(["a", "b", "c"], ["d"], { max: 3 })).toEqual([])
    expect(tagsToAdd([], ["abcdef"], { maxlength: 3 })).toEqual(["abc"])
  })

  it("splits a paste on commas and new lines only", () => {
    expect(splitPaste("pvp, boss,\ncoop")).toEqual(["pvp", " boss", "coop"])
    expect(splitPaste("boss rush")).toBeNull()
  })

  it("suggests what isn't picked, matching without case or accents, at most 12", () => {
    expect(suggestionsFor(["Boss", "Bösewicht", "PvP", "boss"], ["pvp"], "bos")).toEqual(["Boss", "Bösewicht"])
    expect(suggestionsFor(Array.from({ length: 20 }, (_, i) => `t${i}`), [], "")).toHaveLength(12)
  })

  it("offers typed text as a new tag only when it is neither picked nor suggested", () => {
    expect(freshTag(" bos ", [], ["Boss"])).toBe("bos")
    expect(freshTag("boss", [], ["Boss"])).toBe("")
    expect(freshTag("PVP", ["pvp"], [])).toBe("")
    expect(freshTag("   ", [], [])).toBe("")
  })
})

describe("chipKey", () => {
  const at = (mark: number | null, empty = true, count = 3) => ({ mark, count, empty })

  it("marks the last chip on Backspace at the start, and removes it on the second press", () => {
    expect(chipKey({ key: "Backspace" }, at(null))).toEqual({ handled: true, mark: 2 })
    expect(chipKey({ key: "Backspace" }, at(2))).toEqual({ handled: true, mark: null, remove: 2 })
  })

  it("leaves Backspace to the text when the field has text, or there are no chips", () => {
    expect(chipKey({ key: "Backspace" }, at(null, false))).toEqual({ handled: false, mark: null })
    expect(chipKey({ key: "Backspace" }, at(null, true, 0))).toEqual({ handled: false, mark: null })
  })

  it("moves the mark with the arrows, back to the caret past the last chip", () => {
    expect(chipKey({ key: "ArrowLeft" }, at(null))).toEqual({ handled: true, mark: 2 })
    expect(chipKey({ key: "ArrowLeft" }, at(1))).toEqual({ handled: true, mark: 0 })
    expect(chipKey({ key: "ArrowLeft" }, at(0))).toEqual({ handled: true, mark: 0 })
    expect(chipKey({ key: "ArrowRight" }, at(1))).toEqual({ handled: true, mark: 2 })
    expect(chipKey({ key: "ArrowRight" }, at(2))).toEqual({ handled: true, mark: null })
    expect(chipKey({ key: "ArrowRight" }, at(null))).toEqual({ handled: false, mark: null })
    expect(chipKey({ key: "ArrowLeft" }, at(null, false))).toEqual({ handled: false, mark: null })
  })

  it("removes the marked chip on Delete; Escape and typing drop the mark", () => {
    expect(chipKey({ key: "Delete" }, at(0))).toEqual({ handled: true, mark: null, remove: 0 })
    expect(chipKey({ key: "Delete" }, at(null))).toEqual({ handled: false, mark: null })
    expect(chipKey({ key: "Escape" }, at(1))).toEqual({ handled: true, mark: null })
    expect(chipKey({ key: "a" }, at(1))).toEqual({ handled: false, mark: null })
    expect(chipKey({ key: "Backspace", ctrlKey: true }, at(1))).toEqual({ handled: false, mark: null })
  })

  it("keeps the mark on a modifier alone and while an input method composes", () => {
    expect(chipKey({ key: "Shift", shiftKey: true }, at(1))).toEqual({ handled: false, mark: 1 })
    expect(chipKey({ key: "Backspace", isComposing: true }, at(1))).toEqual({ handled: false, mark: 1 })
  })

  it("forgets a mark past the chips that are left", () => {
    expect(chipKey({ key: "Backspace" }, { mark: 5, count: 2, empty: true })).toEqual({ handled: true, mark: 1 })
  })
})
