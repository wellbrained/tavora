import { cva, type VariantProps } from "class-variance-authority"
import { SCALE_PRESS } from "../button"

/**
 * The look of one toggle button, alone or in a group. `outline` (the default) has an edge, `ghost` has none until hovered.
 * Pressed it takes the style's pick: a primary tint in Classic (with a primary edge on `outline`), a solid key in Hardware
 * and a light capsule in Liquid Glass (looks.css). Sizes are the kit's scale from the control height: sm H − 4, default H,
 * lg H + 8. An icon alone makes it square (`iconOnly`); with text it is as wide as the text and never narrower than square.
 * It presses like a Button (97 %, fine pointer, motion allowed) and shows Button's focus ring. A toggle that is off with a
 * reason (`aria-disabled`) keeps its resting look under the pointer.
 */
export const toggleVariants = cva(
  [
    "tavora-pill relative inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-sm font-medium outline-none",
    // Near a full round the ends get pill padding (pill.css): --pill-px on a text end, --pill-px-icon beside a leading icon.
    "px-(--pill-px) has-[>svg:first-child]:pl-(--pill-px-icon) [--pill-border:1px] [--pill-icon:--spacing(4)]",
    "text-muted-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] hover:text-foreground",
    "data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:hover:bg-primary/20 data-[state=on]:hover:text-primary",
    "aria-disabled:cursor-default aria-disabled:data-[state=off]:hover:bg-transparent aria-disabled:data-[state=off]:hover:text-muted-foreground aria-disabled:data-[state=on]:hover:bg-primary/15",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    "transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-(--duration-press) ease-(--ease-out-strong)",
    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
    "disabled:pointer-events-none disabled:opacity-(--disabled-opacity) aria-disabled:opacity-(--disabled-opacity)",
    SCALE_PRESS,
  ],
  {
    variants: {
      variant: {
        outline: "border-input data-[state=on]:border-primary/50",
        ghost: "border-transparent",
      },
      size: {
        sm: "h-[calc(var(--style-control-height,32px)-4px)] min-w-[calc(var(--style-control-height,32px)-4px)] [--pill-height:calc(var(--style-control-height,32px)-4px)] [--pill-pad:--spacing(2.5)] [--pill-pad-icon:--spacing(2)]",
        default: "h-[var(--style-control-height,32px)] min-w-[var(--style-control-height,32px)] [--pill-height:var(--style-control-height,32px)] [--pill-pad:--spacing(3)] [--pill-pad-icon:--spacing(2.5)]",
        lg: "h-[calc(var(--style-control-height,32px)+8px)] min-w-[calc(var(--style-control-height,32px)+8px)] gap-2 [--pill-height:calc(var(--style-control-height,32px)+8px)] [--pill-pad:--spacing(4)] [--pill-pad-icon:--spacing(3.5)]",
      },
      iconOnly: {
        true: "px-0 has-[>svg:first-child]:pl-0",
        false: "",
      },
    },
    compoundVariants: [
      { size: "sm", iconOnly: true, class: "w-[calc(var(--style-control-height,32px)-4px)]" },
      { size: "default", iconOnly: true, class: "w-[var(--style-control-height,32px)]" },
      { size: "lg", iconOnly: true, class: "w-[calc(var(--style-control-height,32px)+8px)]" },
    ],
    defaultVariants: { variant: "outline", size: "default", iconOnly: false },
  },
)

export type ToggleVariants = VariantProps<typeof toggleVariants>
