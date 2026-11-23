import { webContents } from "electron";
import type { PanelOverflow } from "../shared/host-api";

export type { PanelOverflow };

/** The most a panel is told it needs, in px: a page that scrolls more (a long list) gets this much and keeps scrolling. */
export const MAX_OVERFLOW_PX = 4000;
/** Elements looked at in one page, so a huge page can't hold the double-click up. */
const MAX_ELEMENTS = 20000;
/**
 * Marks a scrolling part the fit leaves out, with all it holds: a list beside the content, so the panel fits the content
 * and the list keeps scrolling (e.g. a run list left of the run it opens).
 */
export const FIT_IGNORE = '[data-tavora-fit="ignore"]';
/** A world of its own, so the page's scripts can't change what it reads (0 is the page's, 999 Electron's preload world). */
const MEASURE_WORLD = 1078;
/** How long a page waits to get its new size before it measures anyway ("since"). */
const RESIZE_WAIT_MS = 400;
/** How long a page has to answer. */
const MEASURE_TIMEOUT_MS = 800;

/**
 * What a measurement asks: "now" how much the page scrolls (and remembers which parts scroll), or "since" how much the
 * parts that did not scroll at the last "now" scroll now, once the page has a new size.
 */
export type OverflowMode = "now" | "since";

/**
 * Finds the page's scrolling parts (the page itself and every element that scrolls) and returns the most any of them
 * scrolls, across and down. An element only counts when it shows a scrollbar for it (overflow auto or scroll; for the
 * page, neither html nor body hiding it). "since" first waits (up to RESIZE_WAIT_MS) for the page to get a size other
 * than the one it last measured at, then counts only parts that did not scroll that way at "now": a list that always
 * scrolled is no part that "starts" to scroll. What "now" saw stays in this world's own globals. A part inside
 * marked with FIT_IGNORE, or inside one, never counts.
 */
const measure = (mode: OverflowMode) => `(async () => {
  const since = ${mode === "since"};
  const last = globalThis.__tavoraFitSize;
  if (since && last) {
    const until = Date.now() + ${RESIZE_WAIT_MS};
    while (innerWidth === last.w && innerHeight === last.h && Date.now() < until) await new Promise((done) => setTimeout(done, 16));
  }
  globalThis.__tavoraFitSize = { w: innerWidth, h: innerHeight };
  const seen = since && globalThis.__tavoraFit instanceof WeakMap ? globalThis.__tavoraFit : new WeakMap();
  const scrolled = (el, axis) => since && (seen.get(el) || { x: 0, y: 0 })[axis] > 0;
  let x = 0, y = 0;
  const note = (el, down, across) => {
    if (!since) seen.set(el, { x: across, y: down });
    if (!scrolled(el, "y")) y = Math.max(y, down);
    if (!scrolled(el, "x")) x = Math.max(x, across);
  };
  const shows = (value) => !/hidden|clip/.test(value);
  const root = document.scrollingElement || document.documentElement;
  if (root) {
    const page = [document.documentElement, document.body].filter(Boolean).map((el) => getComputedStyle(el));
    const down = page.every((style) => shows(style.overflowY)) ? root.scrollHeight - root.clientHeight : 0;
    const across = page.every((style) => shows(style.overflowX)) ? root.scrollWidth - root.clientWidth : 0;
    note(root, Math.max(0, down), Math.max(0, across));
  }
  const all = document.body ? document.body.getElementsByTagName("*") : [];
  const count = Math.min(all.length, ${MAX_ELEMENTS});
  for (let i = 0; i < count; i++) {
    const el = all[i];
    if (el === root) continue;
    const down = el.scrollHeight - el.clientHeight;
    const across = el.scrollWidth - el.clientWidth;
    if ((down <= 1 && across <= 1) || el.clientHeight === 0 || el.clientWidth === 0 || el.closest(${JSON.stringify(FIT_IGNORE)})) continue;
    const style = getComputedStyle(el);
    note(el, down > 1 && /auto|scroll/.test(style.overflowY) ? down : 0, across > 1 && /auto|scroll/.test(style.overflowX) ? across : 0);
  }
  if (!since) globalThis.__tavoraFit = seen;
  return { x, y };
})()`;

/** The measurement as the host passes it on: two whole numbers from 0 to MAX_OVERFLOW_PX, or null when it is not one. */
export function checkOverflow(value: unknown): PanelOverflow | null {
  const item = value && typeof value === "object" ? (value as { x?: unknown; y?: unknown }) : null;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (!item || !ok(item.x) || !ok(item.y)) return null;
  const read = (n: number) => Math.min(MAX_OVERFLOW_PX, Math.max(0, Math.ceil(n)));
  return { x: read(item.x), y: read(item.y) };
}

/** How much the page in `contentsId` scrolls (see OverflowMode), or null when it is gone or does not answer in time. */
export async function panelOverflow(contentsId: number, mode: OverflowMode = "now"): Promise<PanelOverflow | null> {
  const contents = webContents.fromId(contentsId);
  if (!contents || contents.isDestroyed()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), MEASURE_TIMEOUT_MS)));
  const measured = contents.executeJavaScriptInIsolatedWorld(MEASURE_WORLD, [{ code: measure(mode) }]).catch(() => null);
  const result = await Promise.race([measured, late]);
  clearTimeout(timer);
  return checkOverflow(result);
}
