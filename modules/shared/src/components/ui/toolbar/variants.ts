import type { ToolbarOrientation } from "./context"

/** A Toolbar's look: `plain` has none, `bar` is the panel's tinted tool strip, `floating` sits over a map or canvas. */
export type ToolbarVariant = "plain" | "bar" | "floating"

// Whole class names only (Tailwind finds them in this file). A bar is as tall (a column: as wide) as a control plus 8px,
// so a control in it has 4px above and below.
const ROW = "flex min-w-0 items-center gap-1"
const COLUMN = "flex min-w-0 flex-col items-center gap-1"
const STACK = "flex min-w-0 flex-col items-stretch gap-2"
const STRIP = "border-primary/25 bg-primary/5 flex-none"

export interface ToolbarLook {
  variant: ToolbarVariant
  orientation: ToolbarOrientation
  wrap: boolean
  /** It has rows under its tools (the `below` slot). */
  stacked: boolean
}

/** The toolbar element's classes. */
export function toolbarClasses({ variant, orientation, wrap, stacked }: ToolbarLook): string {
  const vertical = orientation === "vertical"
  const layout = stacked ? STACK : vertical ? COLUMN : ROW
  const wraps = wrap && !stacked
  if (variant === "floating") return `${layout} tavora-floating p-1${stacked ? "" : " gap-0.5"}${wraps ? " flex-wrap" : ""}`
  if (variant !== "bar") return `${layout}${wraps ? " flex-wrap" : ""}`
  if (stacked) return `${layout} ${STRIP} p-2 ${vertical ? "border-r" : "border-b"}`
  if (vertical) return `${layout} ${STRIP} min-w-[calc(var(--style-control-height,32px)+8px)] border-r px-1 py-2${wraps ? " flex-wrap" : ""}`
  return `${layout} ${STRIP} min-h-[calc(var(--style-control-height,32px)+8px)] border-b px-2${wraps ? " flex-wrap py-1" : ""}`
}

/** With rows under the tools, the row of tools itself. */
export function toolbarRowClasses({ orientation, wrap }: Pick<ToolbarLook, "orientation" | "wrap">): string {
  return `${orientation === "vertical" ? COLUMN : ROW}${wrap ? " flex-wrap" : ""}`
}
