import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // Hovers mix some of the text colour into the surface, so they show on dark and light themes alike.
        // A variant with a dark: background needs its own dark:hover: one, or the dark: one wins over the hover.
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover",
        destructive:
          "bg-destructive text-white hover:bg-[color-mix(in_srgb,black_15%,var(--destructive))] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 dark:hover:bg-destructive/85",
        // Remove, delete and take-back buttons: always red, quieter than a confirm dialog's destructive one.
        danger:
          "bg-destructive/10 text-destructive hover:bg-destructive/25 hover:text-destructive dark:bg-destructive/15 dark:hover:bg-destructive/30",
        outline:
          "border bg-background shadow-xs hover:border-input hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] hover:text-accent-foreground dark:bg-input/10 dark:border-input dark:hover:bg-input/25",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--secondary))]",
        ghost:
          "hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        "default": "h-8 px-3 py-1.5 has-[>svg]:px-2.5",
        "xs": "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        "sm": "h-7 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        "lg": "h-10 rounded-md px-6 has-[>svg]:px-4",
        "icon": "size-8",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
      soft: {
        true: "",
        false: "",
      },
    },
    // A button that is off but still hoverable and focusable (so its tooltip can show) is `soft`: the hover look goes
    // back to the resting one. Restated here, before the caller's classes, so a caller's own hover still wins.
    compoundVariants: [
      { variant: "default", soft: true, class: "hover:bg-primary" },
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
    },
  },
)
export type ButtonVariants = VariantProps<typeof buttonVariants>
