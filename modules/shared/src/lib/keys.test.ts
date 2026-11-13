import { describe, expect, it } from "vitest"
import { isComposing } from "./keys"

describe("isComposing", () => {
  it("is true while an input method composes, also when only key code 229 tells", () => {
    expect(isComposing({ key: "Enter", isComposing: true })).toBe(true)
    expect(isComposing({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(true)
    expect(isComposing({ key: "Process", isComposing: false })).toBe(true)
  })

  it("is false for a plain key", () => {
    expect(isComposing({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(false)
    expect(isComposing({ key: "Escape", isComposing: false })).toBe(false)
  })
})
