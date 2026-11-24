// The kit's plain stylesheets (looks.css, tooltip.css): the rules that keep text readable in them.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const kit = join(import.meta.dirname, "..", "modules", "shared", "src")
const looks = readFileSync(join(kit, "looks.css"), "utf8")
const tooltip = readFileSync(join(kit, "components", "tooltip", "tooltip.css"), "utf8")

/** The declarations of every rule whose selector mentions all of `parts`. */
function rulesFor(css: string, ...parts: string[]): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => parts.every((part) => selector!.includes(part))).map(([, , body]) => body).join("\n")
}

describe("glass toasts", () => {
  // A toast is an inverted pill (--toast, --toast-foreground). Glass draws it in the popover's colour, so its text,
  // buttons and icon glyphs must take the popover's text colour too, or dark text sits on a dark pane (and light on light).
  it("swap the toast's colours for the popover's", () => {
    const body = rulesFor(looks, '[data-look-surface="glass"]', '[data-slot="toast"]')
    expect(body).toMatch(/--toast:\s*var\(--popover\)/)
    expect(body).toMatch(/--toast-foreground:\s*var\(--popover-foreground\)/)
  })
})

describe("tooltip key caps", () => {
  it("are 12 px at least, the smallest text size", () => {
    expect(Number(/\.tavora-tooltip kbd\{font:(\d+)px/.exec(tooltip)?.[1])).toBeGreaterThanOrEqual(12)
  })
})
