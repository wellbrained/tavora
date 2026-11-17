import { describe, expect, it } from "vitest"
import { setsOwnPadding } from "."

describe("setsOwnPadding", () => {
  it("sees a caller's own horizontal padding", () => {
    for (const cls of ["px-2", "h-9 px-0 py-3", "pl-1", "pr-4", "p-0", "ps-2", "pe-2", "!px-2", "px-2!", "md:px-4", "w-7 flex-none px-1.5"])
      expect(setsOwnPadding(cls), cls).toBe(true)
  })
  it("ignores other classes", () => {
    for (const cls of ["", "py-1", "pt-2", "pb-2", "h-9 [&_svg]:size-5", "pointer-events-none", "max-w-56 min-w-0 font-medium"])
      expect(setsOwnPadding(cls), cls).toBe(false)
  })
})
