// The look of a card, shared by `Card`, `ChoiceCard` and `CheckCard` so a surface that is only a box and one you can pick
// stay the same box. Written out in full: Tailwind only finds class names that appear in the source as plain strings.
import type { ControlSize } from "../../../lib/control-size"

export type CardSize = ControlSize

/** Border, corner and fill. Solid in every style, also over a picture. */
export const CARD_BASE = "bg-card text-card-foreground flex min-w-0 flex-col rounded-lg border text-left"

/** Padding and the gap between parts, from the kit's size scale. */
export const CARD_PADDING: Record<CardSize, string> = {
  sm: "gap-1.5 p-2.5",
  default: "gap-2 p-4",
  lg: "gap-3 p-5",
}

/** A card you press: the keyboard ring and the soft fade of its edge and fill (the dip names `translate`). */
export const CARD_INTERACTIVE =
  "cursor-pointer outline-none transition-[background-color,border-color,translate] duration-(--duration-press) ease-(--ease-out-strong) focus-visible:ring-ring/50 focus-visible:border-ring focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-(--disabled-opacity) aria-disabled:cursor-not-allowed aria-disabled:opacity-(--disabled-opacity)"

/** Hover on a card that works: the edge and fill answer the pointer. Left off while it is off. */
export const CARD_HOVER = "hover:border-input hover:bg-[color-mix(in_srgb,var(--foreground)_6%,var(--card))]"

/** A card that is picked: the primary edge and a soft tint. */
export const CARD_SELECTED = "border-primary bg-primary/10 hover:border-primary hover:bg-primary/15"

/** The same for a radio card, which says it with `data-state` (kept next to `CARD_SELECTED` so the two stay alike). */
export const CARD_CHECKED = "data-[state=checked]:border-primary data-[state=checked]:bg-primary/10 data-[state=checked]:hover:border-primary data-[state=checked]:hover:bg-primary/15"
