import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { clsx } from "clsx"

export { default as Button } from "./Button.vue"
export { ACTION_TIMING, type ButtonAction, type ButtonActionState } from "./action"

// A pressed button dips 1px and its shadows turn inward. `not-aria-disabled` keeps a soft (off but hoverable) button still.
// How the whole button moves when pressed. Small buttons shrink to 97% and dip 1px (`scale`). On a wide button 3% is
// several pixels on each side and the bar seems to jump, so wide ones only dip 1px (`dip`). A button the kit knows is wide
// (a picker, a list row) asks for `dip`; any other that a caller stretches (`w-full`, `block`, `flex`, `flex-1`, `grow`)
// gets it automatically, so nobody has to remember. Same guard as PRESS: fine pointer, no reduced motion.
// Written out in full: Tailwind only finds class names that appear in the source as plain strings.
export const SCALE_PRESS =
  "[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:scale-[0.97]" +
  " [&.w-full]:[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:scale-100 [&.w-full]:[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:translate-y-px" +
  " [&.block]:[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:scale-100 [&.block]:[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:translate-y-px" +
  " [&.flex]:[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:scale-100 [&.flex]:[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:translate-y-px" +
  " [&.flex-1]:[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:scale-100 [&.flex-1]:[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:translate-y-px" +
  " [&.grow]:[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:scale-100 [&.grow]:[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:translate-y-px"
export const DIP_PRESS = "[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:translate-y-px"

const PRESS =
  "[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-aria-disabled:active:translate-y-px not-aria-disabled:active:shadow-[inset_0_1px_3px_color-mix(in_srgb,black_25%,transparent)]"

// What every Button has, framed or not: the transition, the off look and its icons.
const COMMON =
  "transition-[color,background-color,border-color,box-shadow,opacity,scale,translate] duration-(--duration-press) ease-(--ease-out-strong) disabled:pointer-events-none disabled:opacity-(--disabled-opacity) aria-disabled:opacity-(--disabled-opacity) [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none"

// The box every variant but `bare` starts from.
const FRAMED =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium shrink-0 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive " + COMMON

// `bare` draws nothing of its own: no frame, fill, padding, size, corners or text style, so the caller draws its own tile
// with a few classes. What stays is what makes it a button: the keyboard outline, the press dip, the off look and icon
// sizing. A hover only comes from the caller. A design style may still round it, as it rounds every button (looks.css).
const BARE =
  "inline-flex items-center focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " + COMMON

const variants = cva(
  "",
  {
    variants: {
      variant: {
        // Hovers mix some of the text colour into the surface, so they show on dark and light themes alike.
        // A variant with a dark: background needs its own dark:hover: one, or the dark: one wins over the hover.
        // Primary has a top light and a hairline of contact shadow, secondary only a fainter top light; destructive just
        // the press. Everything is a mix of white or black, so a host theme (light or dark) gets it too.
        // The press (a 1px dip, the shadows turning inward) only moves on a fine pointer without reduced motion.
        default:
          "bg-primary-fill text-primary-fill-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,white_20%,transparent),0_1px_1px_color-mix(in_srgb,black_35%,transparent)] hover:bg-primary-fill-hover " + PRESS,
        destructive:
          "bg-destructive text-white hover:bg-[color-mix(in_srgb,black_15%,var(--destructive))] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 dark:hover:bg-destructive/85 " + PRESS,
        // Remove, delete and take-back buttons: always red, quieter than a confirm dialog's destructive one.
        danger:
          "bg-destructive/10 text-destructive hover:bg-destructive/25 hover:text-destructive dark:bg-destructive/15 dark:hover:bg-destructive/30",
        outline:
          "border bg-background shadow-xs hover:border-input hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] hover:text-accent-foreground dark:bg-input/10 dark:border-input dark:hover:bg-input/25",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,white_5%,transparent)] hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--secondary))] " + PRESS,
        ghost:
          "hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        bare: BARE,
      },
      // Heights follow the style's control height (32 px in Classic and without a host); a caller's own height wins.
      size: {
        "default": "h-[var(--style-control-height,32px)] px-3 py-1.5",
        "xs": "h-[calc(var(--style-control-height,32px)-8px)] gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3 [&_svg:not([class*='size-'])]:stroke-2",
        "sm": "h-[calc(var(--style-control-height,32px)-4px)] rounded-md gap-1.5 px-3",
        "lg": "h-[calc(var(--style-control-height,32px)+8px)] rounded-md px-6",
        "icon": "size-[var(--style-control-height,32px)]",
        "icon-xs": "size-[calc(var(--style-control-height,32px)-8px)] rounded-md [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='size-'])]:stroke-2",
        "icon-sm": "size-[calc(var(--style-control-height,32px)-4px)]",
        "icon-lg": "size-[calc(var(--style-control-height,32px)+8px)]",
      },
      press: {
        scale: SCALE_PRESS,
        dip: DIP_PRESS,
      },
      soft: {
        true: "",
        false: "",
      },
    },
    // A button that is off but still hoverable and focusable (so its tooltip can show) is `soft`: the hover look goes
    // back to the resting one. Restated here, before the caller's classes, so a caller's own hover still wins.
    compoundVariants: [
      // The smallest Primary buttons only get the light on top, no contact shadow (Secondary has none anywhere).
      { variant: "default", size: ["xs", "icon-xs"], class: "shadow-[inset_0_1px_0_color-mix(in_srgb,white_20%,transparent)]" },
      { variant: "default", soft: true, class: "hover:bg-primary-fill" },
      { variant: "destructive", soft: true, class: "hover:bg-destructive dark:hover:bg-destructive/60" },
      { variant: "danger", soft: true, class: "hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15" },
      { variant: "outline", soft: true, class: "hover:bg-background hover:text-inherit hover:border-border dark:hover:bg-input/10 dark:hover:border-input" },
      { variant: "secondary", soft: true, class: "hover:bg-secondary" },
      { variant: "ghost", soft: true, class: "hover:bg-transparent hover:text-inherit" },
      { variant: "link", soft: true, class: "hover:no-underline" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
      press: "scale",
    },
  },
)
export type ButtonVariants = VariantProps<typeof variants>

/** The Button's classes. Every variant but `bare` is a framed box with a size; `bare` takes neither. */
export function buttonVariants(props: ButtonVariants = {}): string {
  return props.variant === "bare" ? variants({ ...props, size: null }) : clsx(FRAMED, variants(props))
}

// A button with an icon and text has 2px less room on the icon side, so it looks balanced (on lg the sides are 16px
// and 18px). The icon is taken to lead; one after the text says so with `data-icon="end"`. Left out when the caller
// sets its own padding (`px-0`, `pl-2`…), so a narrow or icon-only button keeps the padding it asked for.
// Written out in full: Tailwind only finds class names that appear in the source as plain strings.
export const BUTTON_ICON_PADDING: Partial<Record<NonNullable<ButtonVariants["size"]>, string>> = {
  default: "has-[>svg:not([data-icon=end])]:pl-2.5 has-[>svg[data-icon=end]]:pr-2.5",
  xs: "has-[>svg:not([data-icon=end])]:pl-1.5 has-[>svg[data-icon=end]]:pr-1.5",
  sm: "has-[>svg:not([data-icon=end])]:pl-2.5 has-[>svg[data-icon=end]]:pr-2.5",
  lg: "has-[>svg:not([data-icon=end])]:pl-4 has-[>svg:not([data-icon=end])]:pr-4.5 has-[>svg[data-icon=end]]:pl-4.5 has-[>svg[data-icon=end]]:pr-4",
}

// The same lighter icon side for a button with an `action`, whose content sits one level down (it can't be found with
// `has-[>svg]`): the button checks itself whether its content starts with an icon.
export const ACTION_ICON_PADDING: Partial<Record<NonNullable<ButtonVariants["size"]>, string>> = {
  default: "pl-2.5",
  xs: "pl-1.5",
  sm: "pl-2.5",
  lg: "pl-4 pr-4.5",
}

/** A class split at the colons outside brackets: its variants (`max-[400px]`, `has-[>svg:not(.a)]`, `[&:hover]`…), then the utility. */
function variantsAndUtility(cls: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i]
    if (ch === "[" || ch === "(") depth++
    else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1)
    else if (ch === ":" && depth === 0) {
      parts.push(cls.slice(from, i))
      from = i + 1
    }
  }
  parts.push(cls.slice(from))
  return parts
}

/** A variant that styles something inside the button or a part of it, not the button's own box: `*:`, `**:`, `[&_svg]:`, `[&>span]:`, `before:`, `after:`. */
const forDescendants = (variant: string) => variant === "*" || variant === "**" || variant === "before" || variant === "after" || variant.startsWith("[&_") || variant.startsWith("[&>")

/**
 * True when a class list sets horizontal padding on the button itself (`p-*`, `px-*`, `pl-*`, `pr-*`, `ps-*`, `pe-*`),
 * with or without variants (`md:`, `max-[400px]:`, `has-[…]:`). Padding for what is inside it (`[&_svg]:px-1`) doesn't count.
 */
export function setsOwnPadding(classes: string): boolean {
  return classes.split(/\s+/).some((cls) => {
    const parts = variantsAndUtility(cls)
    const utility = parts.pop()!
    return /^!?p[xlrse]?-/.test(utility) && !parts.some(forDescendants)
  })
}
