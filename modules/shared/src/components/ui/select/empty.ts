// Reka's Select refuses an item with an empty value, so the kit swaps the empty choice for a stand-in
// while it talks to Reka. Callers only ever see "".
import type { ComputedRef, InjectionKey } from "vue"

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

/** Set on a `Select` that is off and says why: its trigger then stays hoverable and focusable. Holds the reason. */
export const offReasonKey: InjectionKey<ComputedRef<string | undefined>> = Symbol("select-off-reason")

/**
 * The live text of every choice, by its value. Reka reads an item's text once, when the item appears, so a renamed
 * choice or a new language would leave the closed select showing the old words. The items keep this up to date.
 */
export interface ChoiceLabels {
  set: (value: unknown, label: string) => void
  remove: (value: unknown) => void
  get: (value: unknown) => string | undefined
}

export const choiceLabelsKey: InjectionKey<ChoiceLabels> = Symbol("select-choice-labels")

/** The words the closed select shows for what is picked: the live label of each picked value, else Reka's own. */
export function pickedLabel(modelValue: unknown, labels: Pick<ChoiceLabels, "get">, fallback: string[]): string {
  const values = Array.isArray(modelValue) ? modelValue : [modelValue]
  const live = values.map((value) => labels.get(value) ?? "")
  return (live.some(Boolean) ? live : fallback).filter(Boolean).join(", ")
}
