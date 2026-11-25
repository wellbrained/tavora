// The rules of a TagInput, kept apart from the component so they can be tested: what a typed or pasted text adds, what
// the list suggests, and what the keys do to the chips.
import { isComposing } from "../../../lib/keys"

/** How a tag is compared: "Boss", " boss " and "BOSS" are the same tag. */
export function tagKey(tag: string): string {
  return tag.trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

/** A tag as it is kept: spaces trimmed and squeezed, cut to `maxlength`. */
export function cleanTag(text: string, maxlength?: number): string {
  const tag = text.trim().replace(/\s+/g, " ")
  return maxlength && maxlength > 0 ? tag.slice(0, maxlength).trim() : tag
}

/** Pasted text with commas or new lines is several tags; anything else is plain text for the field. */
export function splitPaste(text: string): string[] | null {
  return /[,\n\r]/.test(text) ? text.split(/[,\n\r]+/) : null
}

/**
 * What adding these texts does to `tags`: the tags to add, in order, cleaned, without empty ones, without the ones
 * already there or given twice (in any case), and only as many as `max` leaves room for.
 */
export function tagsToAdd(tags: readonly string[], texts: readonly string[], options: { max?: number, maxlength?: number } = {}): string[] {
  const seen = new Set(tags.map(tagKey))
  const room = options.max === undefined ? Number.POSITIVE_INFINITY : Math.max(0, options.max - tags.length)
  const added: string[] = []
  for (const text of texts) {
    if (added.length >= room) break
    const tag = cleanTag(text, options.maxlength)
    if (!tag || seen.has(tagKey(tag))) continue
    seen.add(tagKey(tag))
    added.push(tag)
  }
  return added
}

/** For matching typed text: no case, no accents ("Ä" finds "a"). */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim()
}

/** The suggestions the list shows: not the ones picked already, matching the typed text, at most `limit`. */
export function suggestionsFor(suggestions: readonly string[], tags: readonly string[], typed: string, limit = 12): string[] {
  const picked = new Set(tags.map(tagKey))
  const wanted = fold(typed)
  const shown: string[] = []
  const seen = new Set<string>()
  for (const suggestion of suggestions) {
    const key = tagKey(suggestion)
    if (!key || picked.has(key) || seen.has(key) || (wanted && !fold(suggestion).includes(wanted))) continue
    seen.add(key)
    shown.push(suggestion)
    if (shown.length >= limit) break
  }
  return shown
}

/** The typed text as a new tag for the list's "Add …" row, or "" when it is empty, picked or one of the suggestions. */
export function freshTag(typed: string, tags: readonly string[], suggestions: readonly string[], maxlength?: number): string {
  const tag = cleanTag(typed, maxlength)
  if (!tag) return ""
  const key = tagKey(tag)
  return tags.some((known) => tagKey(known) === key) || suggestions.some((known) => tagKey(known) === key) ? "" : tag
}

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"])

/** What a key press does to the chips. `mark` is the chip Backspace or Delete would remove (or null: the caret is in the field). */
export type ChipKeyResult =
  | { handled: false, mark: number | null }
  | { handled: true, mark: number | null, remove?: number }

/**
 * The chip keys, in a field whose caret is `atStart` (at the start with nothing selected) next to `count` chips:
 * Backspace marks the last chip and, pressed again, removes it; Delete removes the marked one; ←/→ move the mark (→ past
 * the last chip goes back to the caret); Escape drops the mark. Any other key drops the mark and goes to the field.
 */
export function chipKey(event: { key: string, isComposing?: boolean, keyCode?: number, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }, state: { mark: number | null, count: number, atStart: boolean }): ChipKeyResult {
  const { count, atStart } = state
  const mark = state.mark !== null && state.mark < count ? state.mark : null
  if (isComposing(event) || MODIFIERS.has(event.key)) return { handled: false, mark }
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
  if (!plain || count === 0) return { handled: false, mark: null }
  switch (event.key) {
    case "Backspace":
      if (mark !== null) return { handled: true, mark: null, remove: mark }
      return atStart ? { handled: true, mark: count - 1 } : { handled: false, mark: null }
    case "Delete":
      return mark !== null ? { handled: true, mark: null, remove: mark } : { handled: false, mark: null }
    case "ArrowLeft":
      if (mark !== null) return { handled: true, mark: Math.max(0, mark - 1) }
      return atStart ? { handled: true, mark: count - 1 } : { handled: false, mark: null }
    case "ArrowRight":
      return mark !== null ? { handled: true, mark: mark + 1 < count ? mark + 1 : null } : { handled: false, mark: null }
    case "Escape":
      return mark !== null ? { handled: true, mark: null } : { handled: false, mark: null }
    default:
      return { handled: false, mark: null }
  }
}
