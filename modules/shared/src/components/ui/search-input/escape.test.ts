import { describe, expect, it } from "vitest"
import { clearsOnEscape } from "./escape"

describe("search field Escape", () => {
  it("clears a field with text", () => {
    expect(clearsOnEscape("lamb")).toBe(true)
    expect(clearsOnEscape(0)).toBe(true)
  })
  it("leaves an empty field alone, so Escape can close what is around it", () => {
    expect(clearsOnEscape("")).toBe(false)
    expect(clearsOnEscape(undefined)).toBe(false)
    expect(clearsOnEscape(null)).toBe(false)
  })
})
