import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

// Small chips use the 4 px radius from the style guide. The status variants
// tint with Tavora's extra tokens; gold stays for the one that matters.
export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground border-transparent",
        secondary: "bg-secondary text-secondary-foreground border-transparent",
        outline: "text-foreground border-border",
        destructive: "bg-destructive/15 text-destructive border-transparent",
        success: "bg-success/15 text-success border-transparent",
        warning: "bg-warning/15 text-warning border-transparent",
        info: "bg-info/15 text-info border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
