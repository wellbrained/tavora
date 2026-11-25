// Which options a search keeps and how the shown ones fall into groups: the same in the Picker and the Listbox.
import type { PickerOption } from "./types"

/** The options whose label or keywords hold the search, in their order; every option for an empty search. */
export function filterOptions<O extends PickerOption>(options: O[], query: string): O[] {
  const text = query.trim().toLowerCase()
  if (!text) return options
  return options.filter((option) => `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(text))
}

export interface Section<O> {
  /** The group's heading; "" for the options without a group, which come first. */
  group: string
  options: O[]
}

/** The options by group, in the order each group's first option comes; ungrouped ones first, under no heading. */
export function sectionsOf<O extends PickerOption>(options: O[]): Section<O>[] {
  const groups = new Map<string, O[]>()
  const loose = options.filter((option) => !option.group)
  for (const option of options) {
    if (!option.group) continue
    const list = groups.get(option.group)
    if (list) list.push(option)
    else groups.set(option.group, [option])
  }
  return [...(loose.length ? [{ group: "", options: loose }] : []), ...[...groups].map(([group, list]) => ({ group, options: list }))]
}
