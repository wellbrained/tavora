// How a pick-one list shows its chosen row: Picker, Select, Combobox and the radio items of menus all use these, so
// they look the same. The chosen row gets a soft primary fill, a thin primary edge and bold text; no tick or dot.
// While it is also highlighted (how every list opens, and under the pointer or the arrow keys) the fill is stronger
// and the edge solid, so it never looks like a hovered row. The edge is an inset ring: picking moves nothing.
// The text keeps the normal colour: primary text on the fill is too faint in some themes.

/** The chosen row, for an item that sets `data-state="checked"`. Add `choiceHighlighted` or `choiceFocused` too. */
export const choiceRow =
  "data-[state=checked]:bg-primary/15 data-[state=checked]:inset-ring data-[state=checked]:inset-ring-primary/50 data-[state=checked]:font-semibold"

/** The chosen row while highlighted, for a list that marks its highlight with `data-highlighted` (Picker, Combobox). */
export const choiceHighlighted = "data-[state=checked]:data-[highlighted]:bg-primary/24 data-[state=checked]:data-[highlighted]:inset-ring-primary"

/** The chosen row while highlighted, for a list that moves the focus to its highlight (Select, menus). */
export const choiceFocused = "data-[state=checked]:focus:bg-primary/24 data-[state=checked]:focus:inset-ring-primary"
