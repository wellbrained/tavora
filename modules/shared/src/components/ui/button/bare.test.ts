import { describe, expect, it } from "vitest"
import { buttonVariants } from "."

describe("bare button", () => {
  const classes = buttonVariants({ variant: "bare" }).split(" ")

  it("draws no frame, fill, padding, size, corners or text style", () => {
    expect(classes.filter((c) => /^(h|size|p[xytblr]?|gap|rounded|bg|border|shadow|text|font|whitespace|justify|shrink)(-|$)/.test(c))).toEqual([])
    expect(classes.filter((c) => c.startsWith("hover:"))).toEqual([])
  })

  it("keeps the keyboard outline and the press dip", () => {
    expect(classes).toContain("focus-visible:outline-2")
    expect(classes.some((c) => c.endsWith("active:translate-y-px"))).toBe(true)
  })

  it("leaves the framed variants as they were", () => {
    expect(buttonVariants({ variant: "ghost" })).toContain("rounded-md")
    expect(buttonVariants()).toContain("h-[var(--style-control-height,32px)]")
  })
})
