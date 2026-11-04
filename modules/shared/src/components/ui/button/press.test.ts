import { describe, expect, it } from "vitest"
import { buttonVariants } from "."

describe("button press", () => {
  it("shrinks small buttons to 97% by default", () => {
    expect(buttonVariants()).toContain("active:scale-[0.97]")
  })

  it("lets a stretched button cancel the shrink and keep the dip", () => {
    const classes = buttonVariants()
    for (const c of ["w-full", "block", "flex", "flex-1", "grow"]) {
      expect(classes).toContain(`[&.${c}]:`)
    }
    expect(classes).toMatch(/\[&\.w-full\]:\S+:active:scale-100/)
    expect(classes).toMatch(/\[&\.w-full\]:\S+:active:translate-y-px/)
  })

  it("press=dip only dips, keeping the fine-pointer and reduced-motion guard", () => {
    const classes = buttonVariants({ press: "dip" })
    expect(classes).not.toContain("scale-[0.97]")
    expect(classes).toContain("active:translate-y-px")
    expect(classes).toContain("prefers-reduced-motion:no-preference")
    expect(classes).toContain("not-aria-disabled")
  })
})
