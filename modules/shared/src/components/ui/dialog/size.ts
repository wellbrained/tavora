// How wide a dialog is and where it sits. Four widths, so a dialog is never "a bit wider than the others".
// M is the default and is what every dialog was before (420). Never wider than the window minus a margin.

export type DialogSize = "sm" | "md" | "lg" | "xl"
export type DialogAnchor = "center" | "top"

export const DIALOG_WIDTHS: Record<DialogSize, number> = { sm: 360, md: 420, lg: 560, xl: 760 }

export const dialogSizeClass: Record<DialogSize, string> = {
  sm: "max-w-[min(360px,calc(100%-2rem))]",
  md: "max-w-[min(420px,calc(100%-2rem))]",
  lg: "max-w-[min(560px,calc(100%-2rem))]",
  xl: "max-w-[min(760px,calc(100%-2rem))]",
}

/** `top` sits near the top of the window and grows downwards, so a list that changes height does not move the title. */
export const dialogAnchorClass: Record<DialogAnchor, string> = {
  center: "",
  top: "top-[12vh] translate-y-0 max-h-[calc(100%-12vh-1rem)]",
}
