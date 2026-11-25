/**
 * Whether a key press belongs to text that an input method (Japanese, Chinese, Korean, ...) is still composing.
 * Enter then confirms the composition and Escape cancels it, so neither may run the field's own action.
 * Some browsers end the composition before the keydown and only say so with key code 229 ("Process").
 */
export function isComposing(event: { key: string, isComposing?: boolean, keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229 || event.key === "Process"
}

/**
 * Whether an Escape press on the page should close what the page has open (its settings, a dialog): not when an input
 * method is composing (Escape then cancels the composition), not when something already handled it, and not when it
 * was pressed inside an open list, menu or dialog of its own (Escape closes only that).
 */
export function escapeCloses(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || isComposing(event)) return false
  const target = event.target as Element | null
  return !target?.closest?.("[role=listbox], [role=menu], [role=dialog]")
}
