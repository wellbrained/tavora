// Reka's Select refuses an item with an empty value, so the kit swaps the empty choice for a stand-in
// while it talks to Reka. Callers only ever see "".
import type { InjectionKey } from "vue"

export const EMPTY_CHOICE = "__tavora-empty-choice__"

/** What the Select registers with, so it knows whether "" is a choice in this list or just "nothing picked". */
export interface EmptyChoices {
  add: () => void
  remove: () => void
}

export const emptyChoicesKey: InjectionKey<EmptyChoices> = Symbol("select-empty-choices")

/** The value Reka gets. "" only becomes the stand-in when the list has an empty choice; otherwise it stays "" and shows the placeholder. */
export function toInner(value: unknown, hasEmptyChoice: boolean): unknown {
  return value === "" && hasEmptyChoice ? EMPTY_CHOICE : value
}

/** The value the caller gets back. */
export function fromInner<T>(value: T): T | "" {
  return value === EMPTY_CHOICE ? "" : value
}
