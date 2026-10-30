// The numbers behind the page column: how big a page is at a zoom, where each page starts, and how a fit is worked out.

import { clampZoom } from "./files";

export interface PageSize {
  width: number;
  height: number;
}

/** Space between pages and around the column, in pixels. */
export const PAGE_GAP = 12;
/** One press of zoom in or out. */
export const ZOOM_STEP = 1.25;

/** The next zoom a press of + (1) or − (-1) gives, rounded so it does not drift. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  return clampZoom(Math.round(zoom * (direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP) * 1000) / 1000);
}

/** The zoom that makes a page fill the width of the area (`width`) or fit whole inside it (`page`). */
export function fitZoom(mode: "width" | "page", page: PageSize, area: PageSize): number {
  if (page.width <= 0 || page.height <= 0) return 1;
  const width = Math.max(1, area.width - PAGE_GAP * 2);
  const height = Math.max(1, area.height - PAGE_GAP * 2);
  return clampZoom(mode === "width" ? width / page.width : Math.min(width / page.width, height / page.height));
}

/**
 * The fit for a whole document: the zoom at which every page fits, so it stays the same while the reader scrolls
 * through pages of different sizes. Width follows the widest page; page makes the largest one fit whole.
 */
export function fitZoomAll(mode: "width" | "page", pages: readonly PageSize[], area: PageSize): number {
  if (pages.length === 0) return 1;
  return Math.min(...pages.map((page) => fitZoom(mode, page, area)));
}

export interface PageLayout {
  /** Top of each page in the column, in pixels. */
  tops: number[];
  height: number;
}

export function layoutPages(sizes: readonly PageSize[], zoom: number): PageLayout {
  const tops: number[] = [];
  let y = PAGE_GAP;
  for (const size of sizes) {
    tops.push(y);
    y += size.height * zoom + PAGE_GAP;
  }
  return { tops, height: y };
}

/** The page (1-based) the reader is on: the last one that starts at or above `offset`. */
export function pageAtOffset(tops: readonly number[], offset: number): number {
  if (tops.length === 0) return 1;
  let low = 0;
  let high = tops.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (tops[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/** A page number typed by the reader, kept inside the document; null when it is not a number. */
export function parsePageInput(text: string, count: number): number | null {
  const value = Number.parseInt(text.trim(), 10);
  return Number.isFinite(value) && count > 0 ? Math.min(count, Math.max(1, value)) : null;
}

/** The pages (1-based) that touch the band from `from` to `to` pixels down the column. */
export function pagesInBand(tops: readonly number[], sizes: readonly PageSize[], zoom: number, from: number, to: number): number[] {
  const pages: number[] = [];
  for (let index = 0; index < tops.length; index++) {
    const top = tops[index]!;
    if (top > to) break;
    if (top + sizes[index]!.height * zoom >= from) pages.push(index + 1);
  }
  return pages;
}
