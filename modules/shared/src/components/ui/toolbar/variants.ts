import { cva, type VariantProps } from "class-variance-authority"

/**
 * A Toolbar's look. `plain` has none. `bar` is the panel's tool strip: tinted, a line below (a column: at its right), as
 * tall (a column: as wide) as a control plus 8px, so a control in it has 4px above and below. `floating` sits over a map,
 * canvas or text on `tavora-floating`. `stacked` is a toolbar with rows under its tools (the `below` slot): the rows
 * stack, the bar gets 8px all round, and `wrap` goes to the row of tools instead.
 */
export const toolbarVariants = cva("flex min-w-0 items-center gap-1", {
  variants: {
    variant: {
      plain: "",
      bar: "border-primary/25 bg-primary/5 flex-none",
      floating: "tavora-floating gap-0.5 p-1",
    },
    orientation: { horizontal: "", vertical: "flex-col" },
    stacked: { true: "flex-col items-stretch gap-2", false: "" },
    wrap: { true: "flex-wrap", false: "" },
  },
  compoundVariants: [
    { variant: "bar", stacked: false, orientation: "horizontal", class: "min-h-[calc(var(--style-control-height,32px)+8px)] border-b px-2" },
    { variant: "bar", stacked: false, orientation: "horizontal", wrap: true, class: "py-1" },
    { variant: "bar", stacked: false, orientation: "vertical", class: "min-w-[calc(var(--style-control-height,32px)+8px)] border-r px-1 py-2" },
    { variant: "bar", stacked: true, orientation: "horizontal", class: "border-b p-2" },
    { variant: "bar", stacked: true, orientation: "vertical", class: "border-r p-2" },
    { stacked: true, wrap: true, class: "flex-nowrap" },
  ],
  defaultVariants: { variant: "plain", orientation: "horizontal", stacked: false, wrap: false },
})

export type ToolbarVariant = NonNullable<VariantProps<typeof toolbarVariants>["variant"]>
