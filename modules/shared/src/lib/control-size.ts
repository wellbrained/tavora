// The kit's one size scale. Every control with a height takes `size: "sm" | "default" | "lg"`, worked out from the
// style's control height H (`--style-control-height`: 32 px in Classic and Liquid Glass, 30 px in Hardware):
// sm = H − 4, default = H (M, the default everywhere), lg = H + 8. A caller's own height class still wins.
// Written out in full: Tailwind only finds class names that appear in the source as plain strings.

export type ControlSize = "sm" | "default" | "lg"

/** The names a control used before the scale, still read for one round: StarRating's `md` is `default`. */
export type ControlSizeAlias = "md"

/** The scale's name for a size, also for an old one (`md`); anything unknown is `default`. */
export function controlSize(size: ControlSize | ControlSizeAlias | null | undefined): ControlSize {
  return size === "sm" || size === "lg" ? size : "default"
}

/** A fixed height. */
export const CONTROL_HEIGHT: Record<ControlSize, string> = {
  sm: "h-[calc(var(--style-control-height,32px)-4px)]",
  default: "h-[var(--style-control-height,32px)]",
  lg: "h-[calc(var(--style-control-height,32px)+8px)]",
}

/** A least height, for a row or a field that grows with its content. */
export const CONTROL_MIN_HEIGHT: Record<ControlSize, string> = {
  sm: "min-h-[calc(var(--style-control-height,32px)-4px)]",
  default: "min-h-[var(--style-control-height,32px)]",
  lg: "min-h-[calc(var(--style-control-height,32px)+8px)]",
}

/** A square as tall as the control: an icon-only button, a field's step buttons. */
export const CONTROL_SQUARE: Record<ControlSize, string> = {
  sm: "size-[calc(var(--style-control-height,32px)-4px)]",
  default: "size-[var(--style-control-height,32px)]",
  lg: "size-[calc(var(--style-control-height,32px)+8px)]",
}

/** At least as wide as it is tall, so a short label ("B") never makes it narrower than an icon-only one. */
export const CONTROL_MIN_WIDTH: Record<ControlSize, string> = {
  sm: "min-w-[calc(var(--style-control-height,32px)-4px)]",
  default: "min-w-[var(--style-control-height,32px)]",
  lg: "min-w-[calc(var(--style-control-height,32px)+8px)]",
}
