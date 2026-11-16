import type { TavoraTheme } from "@tavora/sdk";
import { TOOLTIP_TYPE } from "./components/tooltip/typography";
import { setToastPosition } from "./components/ui/toast/toast";

/** The interface font the page has now (theme.font.id; "" for a Tavora that sends none), once a theme came. */
let fontId: string | undefined;
const fontListeners = new Set<() => void>();

/** What the kit's components need on top of the host theme: tooltip type sizes, and where toasts show. */
export function applyKitTheme(theme: TavoraTheme, root: HTMLElement = document.documentElement): void {
  for (const [name, size] of Object.entries(TOOLTIP_TYPE)) root.style.setProperty(`--tavora-tooltip-${name}-size`, `${size}px`);
  // Where the user wants toasts goes out with the theme; older Tavora leaves it out.
  setToastPosition(theme.toasts);
  const next = theme.font?.id ?? "";
  if (fontId !== undefined && next !== fontId) fontChanged();
  fontId = next;
}

/**
 * Calls `fn` after the user picked another interface font, so text that was measured can measure again: once the page
 * has drawn in it, and again when its files are in. A box that keeps its size doesn't resize, so a ResizeObserver alone
 * misses it. Also when any font's files finish loading, which is how an overlay page (no theme, see watchOverlay)
 * hears of a new font. Returns a function that stops it.
 */
export function onFontChange(fn: () => void): () => void {
  if (!watchingLoads && typeof document !== "undefined" && document.fonts) {
    watchingLoads = true;
    document.fonts.addEventListener("loadingdone", notify);
  }
  fontListeners.add(fn);
  return () => void fontListeners.delete(fn);
}

let watchingLoads = false;

function notify(): void {
  for (const listener of [...fontListeners]) listener();
}

function fontChanged(): void {
  const later = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 0);
  later(() => {
    notify();
    void (typeof document !== "undefined" ? document.fonts?.ready : undefined)?.then(notify, () => {});
  });
}
