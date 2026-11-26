// The kit's text field look, for a field the kit can't draw with Input itself (a list's own filter field, as in Picker).
// With `data-slot="input"` on the element, the style's looks (inset, capsule) restyle it like any Input.
export const inputLook = [
  "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/10 border-input h-[var(--style-control-height,32px)] w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-(--disabled-opacity) aria-disabled:cursor-not-allowed aria-disabled:opacity-(--disabled-opacity)",
  "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
  "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
] as const

/** The field on the kit's size scale (`inputLook` is `default`): sm H − 4 with 13px text, lg H + 8 with more room inside. */
export const INPUT_SIZE = {
  sm: "h-[calc(var(--style-control-height,32px)-4px)] px-2.5 text-sm",
  default: "",
  lg: "h-[calc(var(--style-control-height,32px)+8px)] px-4",
} as const
