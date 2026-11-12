// The fonts of item-card skins on a page: one FontFace per font URL, shared by every ItemCard that uses it, and let go
// when the last of them is gone.

type FontSet = Set<FontFace>
const fonts = new Map<string, { family: string; face: FontFace; users: number }>()
let next = 0

/** A URL for CSS `url("…")`: quotes, backslashes and line breaks can't end it early. */
export const cssUrl = (url: string) => `url("${url.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`

/** Takes the font at `url` into use and answers its family name, or nothing where fonts can't be loaded. */
export function holdSkinFont(url: string): string | undefined {
  const held = fonts.get(url)
  if (held) {
    held.users++
    return held.family
  }
  if (typeof FontFace !== "function") return undefined
  const family = `tavora-item-card-${++next}`
  const face = new FontFace(family, cssUrl(url))
  ;(document.fonts as unknown as FontSet).add(face)
  face.load().catch(() => {})
  fonts.set(url, { family, face, users: 1 })
  return family
}

/** One user less of the font at `url`; the last one removes it from the page. */
export function releaseSkinFont(url: string): void {
  const held = fonts.get(url)
  if (!held || --held.users > 0) return
  ;(document.fonts as unknown as FontSet).delete(held.face)
  fonts.delete(url)
}

/** How many fonts are held now (for tests). */
export const heldSkinFonts = () => fonts.size
