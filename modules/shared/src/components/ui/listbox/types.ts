import type { PickerOption } from "../picker/types"

export interface ListboxOption<V extends string = string> extends PickerOption<V> {
  /** A second, muted line under the label (a country under a city). */
  description?: string
  /** Muted text at the row's end (a category, "+2 h"); it keeps its full width, the label gets cut off first. */
  meta?: string
  /**
   * The row can't be picked: it stays in the list, dimmed, and the arrow keys skip it. A text says why and is shown at
   * the row's end in place of `meta` ("Already added").
   */
  disabled?: boolean | string
}
