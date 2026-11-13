/**
 * Whether a key press belongs to text that an input method (Japanese, Chinese, Korean, ...) is still composing.
 * Enter then confirms the composition and Escape cancels it, so neither may run the field's own action.
 * Some browsers end the composition before the keydown and only say so with key code 229 ("Process").
 */
export function isComposing(event: { key: string, isComposing?: boolean, keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229 || event.key === "Process"
}
