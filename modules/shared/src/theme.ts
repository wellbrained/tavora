import type { TavoraTheme } from "@tavora/sdk";
import { TOOLTIP_TYPE } from "./components/tooltip/typography";
import { setToastPosition } from "./components/ui/toast/toast";

/** What the kit's components need on top of the host theme: tooltip type sizes, and where toasts show. */
export function applyKitTheme(theme: TavoraTheme, root: HTMLElement = document.documentElement): void {
  for (const [name, size] of Object.entries(TOOLTIP_TYPE)) root.style.setProperty(`--tavora-tooltip-${name}-size`, `${size}px`);
  // Where the user wants toasts goes out with the theme; older Tavora leaves it out.
  setToastPosition(theme.toasts);
}
