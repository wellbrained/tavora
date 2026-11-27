import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

// Small chips use the 4 px radius from the style guide. The status variants
// tint with Tavora's extra tokens; gold stays for the one that matters. Near a full round the ends get pill padding
// (pill.css); the height is one line plus the padding and border (a caller without the border sets --pill-border to 0).
export const badgeVariants = cva(
  "tavora-pill px-(--pill-px) has-[>svg:first-child]:pl-(--pill-px-icon) [--pill-height:calc(1lh+--spacing(1)+2*var(--pill-border))] [--pill-pad:--spacing(1.5)] [--pill-pad-icon:--spacing(1.5)] [--pill-icon:--spacing(3)] [--pill-border:1px] inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3 [&>svg]:stroke-2",
  {
    variants: {
      variant: {
        default: "bg-primary-fill text-primary-fill-foreground border-transparent",
        secondary: "bg-secondary text-secondary-foreground border-transparent",
        outline: "text-foreground border-border",
        destructive: "bg-destructive/15 text-destructive border-transparent",
        success: "bg-success/15 text-success border-transparent",
        warning: "bg-warning/15 text-warning border-transparent",
        info: "bg-info/15 text-info border-transparent",
      },
      /** `sm`: tight padding, for a count beside a label or in a corner. */
      size: {
        default: "",
        sm: "py-0 leading-4 [--pill-height:calc(1lh+2*var(--pill-border))] [--pill-pad:--spacing(1)] [--pill-pad-icon:--spacing(1)]",
      },
      /** Digits of one width, so a changing number doesn't make the badge jump. */
      numeric: {
        true: "tabular-nums",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      numeric: false,
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
