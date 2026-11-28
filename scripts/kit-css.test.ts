// @vitest-environment jsdom
// The kit's plain stylesheets (looks.css, tooltip.css): the rules that keep text and tiles readable in them.
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

describe("pressed buttons", () => {
  // Hardware and Glass paint a Button with aria-pressed like a pressed toggle. A bare Button is a tile the caller draws,
  // so the paint would cover it.
  it("leave a bare Button to its caller", () => {
    const found = [...looks.matchAll(/\.tavora-button\[aria-pressed="true"\](?::not\(:where\(\[data-variant="bare"\]\)\))?/g)].map(([selector]) => selector)
    expect(found).toHaveLength(2)
    const button = (variant: string) => {
      const element = document.createElement("button")
      element.className = "tavora-button"
      element.setAttribute("aria-pressed", "true")
      element.dataset.variant = variant
      return element
    }
    for (const selector of found) {
      expect(button("ghost").matches(selector), selector).toBe(true)
      expect(button("bare").matches(selector), selector).toBe(false)
    }
  })
})

describe("tooltip key caps", () => {
  it("are 12 px at least, the smallest text size", () => {
    expect(Number(/\.tavora-tooltip kbd\{font:(\d+)px/.exec(tooltip)?.[1])).toBeGreaterThanOrEqual(12)
  })
})

describe("elevation and layers", () => {
  const elevation = readFileSync(join(kit, "elevation.css"), "utf8")
  const rootVars = (css: string) => Object.fromEntries([...(/:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "").matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value!.trim()]))

  // Classic must look exactly as before the tokens: Tailwind v4's shadow-sm, shadow-md and shadow-lg.
  it("keep Classic's shadows equal to Tailwind's sm, md and lg", () => {
    const vars = rootVars(elevation)
    expect(vars["--elevation-1"]).toBe("0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)")
    expect(vars["--elevation-2"]).toBe("0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)")
    expect(vars["--elevation-3"]).toBe("0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)")
  })

  // The rules checker (scripts/check-modules.mjs) allows exactly these names.
  it("have the four layers in order", () => {
    const vars = rootVars(elevation)
    expect(["--layer-lift", "--layer-sticky", "--layer-overlay", "--layer-floating"].map((name) => Number(vars[name]))).toEqual([1, 10, 20, 50])
  })

  it("give Hardware and Glass their own steps", () => {
    for (const surface of ["raised", "glass"]) {
      const body = rulesFor(elevation, `[data-look-surface="${surface}"]`)
      for (const step of [1, 2, 3]) expect(body, `${surface} ${step}`).toMatch(new RegExp(`--elevation-${step}:`))
    }
  })

  // A popover or select is step 2 and menus and dialogs step 3, in the raised and glass looks too.
  it("draw popovers one step below menus in the raised and glass looks", () => {
    for (const surface of ["raised", "glass"]) {
      expect(rulesFor(looks, `[data-look-surface="${surface}"]`, '[data-slot="popover-content"], [data-slot="select-content"]')).toContain("var(--elevation-2)")
      expect(rulesFor(looks, `[data-look-surface="${surface}"]`, '[data-slot="dropdown-menu-content"]')).toContain("var(--elevation-3)")
    }
  })
})

describe("pill tabs that wrap", () => {
  // A share of the list's height made every tab as tall as the whole list, so a second row ran over what follows.
  it("stretch each tab to its row, never to a share of the list", () => {
    // The nested rule for the tabs in the "Pill tabs outside Classic" section.
    const body = looks.split("Pill tabs outside Classic")[1]!.split('& [data-slot="tabs-trigger"] {')[1]!.split("&[data-state")[0]
    expect(body).toMatch(/align-self:\s*stretch/)
    expect(body).toMatch(/min-height:\s*calc\(var\(--style-control-height, 32px\) - 6px\)/)
    expect(body).not.toMatch(/(^|[;\s])height:\s*calc\(100%/)
  })

  it("leave a TabStrip's tabs to the strip's own height, and a keycap tab to its text", () => {
    expect(rulesFor(looks, '[data-slot="tab-strip"] [data-slot="tabs-trigger"]')).toMatch(/min-height:\s*0/)
    expect(rulesFor(looks, '[data-slot="tabs-list"].flex-wrap [data-slot="tabs-trigger"]')).toMatch(/min-height:\s*0/)
  })
})
