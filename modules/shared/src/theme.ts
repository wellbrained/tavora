import { tabOverflowOf, type TavoraTheme } from "@tavora/sdk";
import { TOOLTIP_TYPE } from "./components/tooltip/typography";
import { setTabOverflow } from "./components/ui/tabs/tab-overflow";
import { setToastPosition } from "./components/ui/toast/toast";

/** The interface font the page has now (theme.font.id; "" for a Tavora that sends none), once a theme came. */
let fontId: string | undefined;
const fontListeners = new Set<() => void>();

/** What the kit's components need on top of the host theme: tooltip type sizes, where toasts show and how tabs that don't fit are reached. */
export function applyKitTheme(theme: TavoraTheme, root: HTMLElement = document.documentElement): void {
  for (const [name, size] of Object.entries(TOOLTIP_TYPE)) root.style.setProperty(`--tavora-tooltip-${name}-size`, `${size}px`);
  // Where the user wants toasts goes out with the theme; older Tavora leaves it out.
  setToastPosition(theme.toasts);
  // So does how the user reaches tabs that don't fit (TabStrip); older Tavora leaves it out, which means the list.
  setTabOverflow(tabOverflowOf(theme));
  const next = theme.font?.id ?? "";
  if (fontId !== undefined && next !== fontId) fontChanged();
  fontId = next;
}

/**
 * Calls `fn` after the user picked another interface font, so text that was measured can measure again: once the page
 * has drawn in it, and again when its files are in. A box that keeps its size doesn't resize, so a ResizeObserver alone
 * misses it. Returns a function that stops it.
 */
export function onFontChange(fn: () => void): () => void {
  fontListeners.add(fn);
  return () => void fontListeners.delete(fn);
}

function fontChanged(): void {
  const notify = () => {
    for (const listener of [...fontListeners]) listener();
  };
  const later = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 0);
  later(() => {
    notify();
    void (typeof document !== "undefined" ? document.fonts?.ready : undefined)?.then(notify, () => {});
  });
}
