export interface PickerOption<V extends string = string> {
  value: V
  label: string
  /** Other words that find the option when searching, besides its label. */
  keywords?: string
}
