import { describe, expect, it } from "vitest"
import { EMPTY_CHOICE, fromInner, toInner } from "./empty"

describe("empty choice", () => {
  it("swaps '' for the stand-in only when the list has an empty choice", () => {
    expect(toInner("", true)).toBe(EMPTY_CHOICE)
    expect(toInner("", false)).toBe("")
  })
  it("leaves other values alone", () => {
    expect(toInner("poe2", true)).toBe("poe2")
    expect(toInner(undefined, true)).toBeUndefined()
  })
  it("gives the caller '' back", () => {
    expect(fromInner(EMPTY_CHOICE)).toBe("")
    expect(fromInner("poe2")).toBe("poe2")
  })
})
