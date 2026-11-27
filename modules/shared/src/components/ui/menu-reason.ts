// Why a menu row is off, shown in the row where its hint sits (DropdownMenuItem, DropdownMenuRadioItem, ContextMenuItem).
// Screen readers get it as the row's description, so the text itself is hidden from them. A long one is cut with "…" and gives
// way before the label does.

/** The reason's text, at the row's end. */
export const menuReason = "text-muted-foreground ml-auto min-w-0 max-w-[45%] shrink-[8] truncate pl-2 text-xs"

/** On the row while it shows a reason: its hint (a `…MenuShortcut`) gives way. */
export const menuReasonRow = "[&[data-reason]_[data-slot$=menu-shortcut]]:hidden"
