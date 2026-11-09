import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

// Tailwind 4's `outline-none` sets `--tw-outline-style: none`, and `outline-2` draws with `outline-style:
// var(--tw-outline-style)`. So `outline-none focus-visible:outline-2` keeps the outline style at none: the ring never
// shows (it also beats the theme's own :focus-visible outline). A focus outline next to outline-none needs its style too:
// `focus-visible:outline-solid`.
const root = join(import.meta.dirname, "..")
const folders = ["modules", join("apps", "desktop", "src")]

function files(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return []
    const path = join(folder, name)
    return statSync(path).isDirectory() ? files(path) : /\.(vue|ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

/** Class strings that turn the outline off and give a focus outline a width but no style. */
export function ringsThatNeverShow(text: string): string[] {
  const found: string[] = []
  for (const [chunk] of text.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g)) {
    if (/(?<![\w:-])outline-none(?![\w-])/.test(chunk) && /focus-visible:-?outline-(?:\d|\[)/.test(chunk) && !/focus-visible:outline-(?:solid|dashed|dotted|double)(?![\w-])/.test(chunk)) found.push(chunk)
  }
  return found
}

describe("focus rings", () => {
  it("finds a ring that never shows, and leaves one with its style alone", () => {
    expect(ringsThatNeverShow(`class="outline-none focus-visible:outline-2 focus-visible:outline-ring"`)).toHaveLength(1)
    expect(ringsThatNeverShow(`class="outline-none focus-visible:outline-solid focus-visible:outline-2"`)).toEqual([])
    expect(ringsThatNeverShow(`class="focus-visible:outline-2"`)).toEqual([])
    // A class string inside a bound class (`:class="cn('…', props.class)"`).
    expect(ringsThatNeverShow(`:class="cn('flex-1 outline-none focus-visible:outline-2', props.class)"`)).toHaveLength(1)
  })

  it("every focus outline in the kit, the built-in modules and the app has a style", () => {
    const broken = folders.flatMap((folder) =>
      files(join(root, folder)).flatMap((path) => ringsThatNeverShow(readFileSync(path, "utf8")).map((chunk) => `${relative(root, path)}: ${chunk.slice(0, 80)}`)),
    )
    expect(broken).toEqual([])
  })
})
