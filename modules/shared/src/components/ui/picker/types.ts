export interface PickerOption<V extends string = string> {
  value: V
  label: string
  /** Other words that find the option when searching, besides its label. */
  keywords?: string
  /**
   * The heading it is listed under. Options with the same group are listed together under it, the groups in the order
   * their first option comes; options without one come first, under no heading.
   */
  group?: string
}
