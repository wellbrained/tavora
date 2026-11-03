// How the active row looks: the accent tint and edge the kit uses for a selected item (StyleTiles, NavList).
// A row is active while the keyboard is in it (focus-visible on it or inside it) or while its ··· / right-click menu is open
// (ItemCard sets data-menu-open then, as the menu's focus is in a popup). Hovering never marks a row.
// Tailwind reads these class names from this file's text, so they are written out in full.

/** A short fade in and out, like the kit's other state changes; off with reduced motion. */
export const ROW_FADE = "transition-[background-color,border-color] duration-(--duration-press) ease-(--ease-out-strong) motion-reduce:transition-none";

/** A single row. */
export const ACTIVE_ROW =
  "focus-visible:border-ring focus-visible:bg-primary/10 has-[:focus-visible]:border-ring has-[:focus-visible]:bg-primary/10 data-[menu-open]:border-ring data-[menu-open]:bg-primary/10";

/** A linked group: the whole block is active while any of its rows is. */
export const ACTIVE_GROUP =
  "has-[:focus-visible]:border-ring has-[:focus-visible]:bg-primary/10 has-[[data-menu-open]]:border-ring has-[[data-menu-open]]:bg-primary/10";
