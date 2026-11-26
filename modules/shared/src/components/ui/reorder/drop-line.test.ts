import { describe, expect, it } from "vitest"
import { dropLine } from "./drop-line"

describe("dropLine", () => {
  it("marks only the row the place names, before or after it", () => {
    expect(dropLine({ id: "a", after: false }, "a")).toBe("tavora-drop-before")
    expect(dropLine({ id: "a", after: true }, "a")).toBe("tavora-drop-after")
    expect(dropLine({ id: "a", after: true }, "b")).toBe(false)
    expect(dropLine(null, "a")).toBe(false)
  })
})
