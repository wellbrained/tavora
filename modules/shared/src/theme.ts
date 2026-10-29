import type { TavoraTheme } from "@tavora/sdk";
import { applyHostTheme } from "@tavora/sdk/bootstrap";
import { TOOLTIP_TYPE } from "./components/tooltip/typography";
import { setToastPosition } from "./components/ui/toast/toast";

/** What the kit's components need on top of the host theme: tooltip type sizes, and where toasts show. */
export function applyKitTheme(theme: TavoraTheme, root: HTMLElement = document.documentElement): void {
  for (const [name, size] of Object.entries(TOOLTIP_TYPE)) root.style.setProperty(`--tavora-tooltip-${name}-size`, `${size}px`);
  // Where the user wants toasts goes out with the theme; older Tavora leaves it out.
  setToastPosition(theme.toasts);
}

/**
 * Sets the host's tokens as CSS variables, which theme.css maps into Tailwind.
 * @deprecated For a module, `connectModule` does this and keeps it up to date. This stays for the starters until they move.
 */
export function applyTheme(theme: TavoraTheme, root: HTMLElement = document.documentElement): void {
  applyHostTheme(theme, root);
  applyKitTheme(theme, root);
}
