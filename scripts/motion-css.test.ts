import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const kit = join(import.meta.dirname, "..", "modules", "shared", "src")
const css = readFileSync(join(kit, "motion.css"), "utf8")
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"))

function files(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    return statSync(path).isDirectory() ? files(path) : /\.(vue|ts)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

describe("motion.css", () => {
  it("has the spring curve and the pop durations", () => {
    expect(css).toMatch(/--ease-spring:\s*cubic-bezier\(/)
    expect(css).toMatch(/--duration-pop:\s*240ms/)
    expect(css).toMatch(/--duration-pop-out:\s*100ms/)
  })

  it("defines every tavora- motion class the kit uses", () => {
    const used = new Set<string>()
    for (const path of files(join(kit, "components"))) for (const [, name] of readFileSync(path, "utf8").matchAll(/\btavora-([a-z][a-z-]*)/g)) used.add(`tavora-${name}`)
    // tooltip.css and the kit's own files define the rest of the tavora- names (popup is in motion.css)
    const motion = [...used].filter((name) => /^tavora-(check|check-mark|tick|dot|quiet-travel|clear-in|clear-out|strike|collapse|popup)$/.test(name))
    expect(motion.length).toBeGreaterThan(6)
    for (const name of motion) expect(css, name).toContain(`.${name}`)
  })

  it("takes the movement out of each control under reduced motion and keeps a short fade", () => {
    for (const name of ["tavora-check", "tavora-check-mark", "tavora-tick", "tavora-dot", "tavora-clear-in", "tavora-clear-out", "tavora-strike", "tavora-collapse"]) {
      expect(reduced, name).toContain(`.${name}`)
    }
    // no height or scale animation survives in the reduced block, apart from the snap at the end of the section's fade
    expect(reduced).not.toMatch(/animation:\s*tavora-(collapse-in|collapse-out|clear-in|clear-out|check-dip)/)
  })

  it("does not play a section that starts closed, and takes a shut one out of the layout", () => {
    expect(css).toMatch(/\.tavora-collapse\[data-state="closed"\]:not\(\[data-armed\]\)[^{]*\{\s*display:\s*none/)
    expect(css).toContain(".tavora-collapse[data-shut]")
    expect(css).toMatch(/\.tavora-collapse\[data-armed\]\[data-state="open"\]\s*\{\s*animation:\s*tavora-collapse-in/)
  })

  it("draws the strike line only while data-struck is set, and draws it after the tick", () => {
    expect(css).toMatch(/\.tavora-strike\[data-struck\]\s*\{[^}]*background-size:\s*100%/)
    expect(css).toMatch(/\.tavora-strike\[data-struck\][^}]*var\(--duration-pop\) var\(--ease-out-strong\) 80ms/)
  })

  it("holds the radio dot and the tiles while travelling with the keys", () => {
    expect(css).toMatch(/\[data-travel\] :is\(\.tavora-dot, \.tavora-quiet-travel\)\s*\{\s*transition:\s*none !important/)
  })
})
