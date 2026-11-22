import { webContents } from "electron";

/** How much a panel's page scrolls, in px: what its panel would need on top of its size for the scrollbars to go. */
export interface PanelOverflow {
  x: number;
  y: number;
}

/** The most a panel is told it needs, in px; more is a page that scrolls without end (a long list), not one that fits. */
export const MAX_OVERFLOW_PX = 4000;
/** Elements looked at in one page, so a huge page can't hold the double-click up. */
const MAX_ELEMENTS = 20000;
/** A world of its own, so the page's scripts can't change what it reads (0 is the page's, 999 Electron's preload world). */
const MEASURE_WORLD = 1078;
/** How long a page has to answer. */
const MEASURE_TIMEOUT_MS = 500;

/**
 * What a measurement asks: "now" how much the page scrolls (and remembers it), or how much more it scrolls "since"
 * the last "now" (a part that scrolled before and still scrolls as much counts as 0).
 */
export type OverflowMode = "now" | "since";

/**
 * Finds the page's scrolling parts (the page itself and every element that scrolls) and returns the most any of them
 * scrolls, across and down, or the most any of them scrolls more than it did at the last "now". An element only counts
 * when it shows a scrollbar for it (overflow auto or scroll). What "now" saw stays in this world's own globals.
 */
const measure = (mode: OverflowMode) => `(() => {
  const since = ${mode === "since"};
  const seen = since && globalThis.__tavoraFit instanceof WeakMap ? globalThis.__tavoraFit : new WeakMap();
  const before = (el, axis) => (since ? (seen.get(el) || { x: 0, y: 0 })[axis] : 0);
  let x = 0, y = 0;
  const note = (el, down, across) => {
    if (!since) seen.set(el, { x: across, y: down });
    y = Math.max(y, down - before(el, "y"));
    x = Math.max(x, across - before(el, "x"));
  };
  const root = document.scrollingElement || document.documentElement;
  if (root) note(root, Math.max(0, root.scrollHeight - root.clientHeight), Math.max(0, root.scrollWidth - root.clientWidth));
  const all = document.body ? document.body.getElementsByTagName("*") : [];
  const count = Math.min(all.length, ${MAX_ELEMENTS});
  for (let i = 0; i < count; i++) {
    const el = all[i];
    if (el === root) continue;
    const down = el.scrollHeight - el.clientHeight;
    const across = el.scrollWidth - el.clientWidth;
    if ((down <= 1 && across <= 1) || el.clientHeight === 0 || el.clientWidth === 0) continue;
    const style = getComputedStyle(el);
    note(el, down > 1 && /auto|scroll/.test(style.overflowY) ? down : 0, across > 1 && /auto|scroll/.test(style.overflowX) ? across : 0);
  }
  if (!since) globalThis.__tavoraFit = seen;
  return { x, y };
})()`;

/** The measurement as the host passes it on: two whole numbers from 0 to MAX_OVERFLOW_PX, nothing else. */
export function checkOverflow(value: unknown): PanelOverflow {
  const read = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(MAX_OVERFLOW_PX, Math.max(0, Math.ceil(n))) : 0);
  const item = value && typeof value === "object" ? (value as { x?: unknown; y?: unknown }) : {};
  return { x: read(item.x), y: read(item.y) };
}

/** How much the page in `contentsId` scrolls (or more since the last "now"); nothing when it is gone or does not answer. */
export async function panelOverflow(contentsId: number, mode: OverflowMode = "now"): Promise<PanelOverflow> {
  const contents = webContents.fromId(contentsId);
  if (!contents || contents.isDestroyed()) return { x: 0, y: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A paused or busy page answers late or never: the double-click then does nothing.
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), MEASURE_TIMEOUT_MS)));
  const measured = contents.executeJavaScriptInIsolatedWorld(MEASURE_WORLD, [{ code: measure(mode) }]).catch(() => null);
  const result = await Promise.race([measured, late]);
  clearTimeout(timer);
  return checkOverflow(result);
}
