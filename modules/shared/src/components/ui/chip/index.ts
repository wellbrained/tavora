import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Chip } from "./Chip.vue"

// A chip is a Badge the user can act on: remove it (×), or switch it on and off (a filter pill). Same 4 px corners and
// tints as Badge; secondary is the default because a chip is the user's own word, not a status. Nothing is below the
// guide's 12 px, so sm is only shorter. A chip with a × keeps less room on its right, where the × brings its own.
export const chipVariants = cva(
  "inline-flex w-fit max-w-full shrink-0 items-center overflow-hidden rounded-sm border border-transparent font-medium whitespace-nowrap transition-colors [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        secondary: "bg-secondary text-secondary-foreground",
        outline: "text-foreground border-border",
        destructive: "bg-destructive/15 text-destructive",
        success: "bg-success/15 text-success",
        warning: "bg-warning/15 text-warning",
        info: "bg-info/15 text-info",
      },
      size: {
        sm: "h-4 gap-0.5 px-1 text-xs leading-none [&_svg]:size-2.5",
        default: "h-5 gap-1 px-1.5 text-xs leading-none [&_svg]:size-3",
        lg: "h-6 gap-1 px-2 text-sm leading-none [&_svg]:size-3.5",
      },
      removable: { true: "", false: "" },
    },
    compoundVariants: [
      { removable: true, size: "sm", class: "pr-px" },
      { removable: true, size: "default", class: "pr-0.5" },
      { removable: true, size: "lg", class: "pr-0.5" },
    ],
    defaultVariants: { variant: "secondary", size: "default", removable: false },
  },
)
export type ChipVariants = VariantProps<typeof chipVariants>

/** A toggle chip (a filter pill): on is the primary fill with a check, off an outline with muted text. */
export const chipToggle = {
  on: "bg-primary-fill text-primary-fill-foreground",
  off: "border-border text-muted-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] hover:text-foreground",
}

/** The × of each size: a square that fits inside the chip with a hair to spare. */
export const chipRemoveSize = {
  sm: "size-3.5 [&_svg]:size-2.5",
  default: "size-4 [&_svg]:size-3",
  lg: "size-5 [&_svg]:size-3.5",
} as const
