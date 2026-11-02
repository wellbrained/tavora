// The keys of a ComboboxInput in free mode (the text is the value, the list only suggests): Enter keeps what is typed unless the arrow keys
// moved to a suggestion since the text last changed or the list was last closed. Kept apart from the component so the rules can be tested.
export function freeKeys() {
  /** Whether the arrow keys moved to a suggestion that Enter would pick. */
  let arrowed = false
  return {
    /** What to do with a key press: "commit" (keep the typed text, and the list gets no Enter) or "pass" (the list handles it). */
    press(event: { key: string, isComposing?: boolean }): "commit" | "pass" {
      // Text still being composed (an input method): Enter confirms the composition, never the value.
      if (event.isComposing) return "pass"
      if (event.key === "ArrowDown" || event.key === "ArrowUp") arrowed = true
      else if (event.key === "Enter") {
        if (!arrowed) return "commit"
        arrowed = false
      }
      // The list closes (Escape, Tab) or the text changes: nothing is reached by the arrows any more.
      else if (event.key === "Escape" || event.key === "Tab" || event.key === "Backspace" || event.key === "Delete" || event.key.length === 1) arrowed = false
      return "pass"
    },
    /** The text changed, the list closed or a suggestion was picked. */
    reset() {
      arrowed = false
    },
  }
}
