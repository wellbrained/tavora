/** The cell being edited and its text so far. `enter`: typing replaced the cell, so the arrows keep it and move on; `edit`: F2 or a double-click, so the arrows move the caret. */
export interface GridEdit {
  row: number
  col: number
  text: string
  mode: "enter" | "edit"
}

/** How far the grid is scrolled, in pixels. */
export interface GridScroll {
  top: number
  left: number
}

/** What a right-click or a header press landed on. */
export type HeaderKind = "column" | "row" | "corner"
