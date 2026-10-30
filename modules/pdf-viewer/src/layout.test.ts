import { describe, expect, it } from "vitest";
import { fitZoom, fitZoomAll, layoutPages, pageAtOffset, PAGE_GAP, pagesInBand, parsePageInput, stepZoom } from "./layout";

const sizes = [
  { width: 600, height: 800 },
  { width: 600, height: 800 },
  { width: 300, height: 400 },
];

describe("layoutPages", () => {
  it("stacks the pages with a gap and scales them", () => {
    const layout = layoutPages(sizes, 2);
    expect(layout.tops).toEqual([PAGE_GAP, PAGE_GAP * 2 + 1600, PAGE_GAP * 3 + 3200]);
    expect(layout.height).toBe(PAGE_GAP * 4 + 3200 + 800);
  });
});

describe("pageAtOffset", () => {
  const { tops } = layoutPages(sizes, 1);
  it("gives the page that starts at or above the offset", () => {
    expect(pageAtOffset(tops, 0)).toBe(1);
    expect(pageAtOffset(tops, tops[1]!)).toBe(2);
    expect(pageAtOffset(tops, tops[1]! - 1)).toBe(1);
    expect(pageAtOffset(tops, 99999)).toBe(3);
    expect(pageAtOffset([], 10)).toBe(1);
  });
});

describe("parsePageInput", () => {
  it("keeps the number inside the document", () => {
    expect(parsePageInput("5", 10)).toBe(5);
    expect(parsePageInput(" 99 ", 10)).toBe(10);
    expect(parsePageInput("-4", 10)).toBe(1);
    expect(parsePageInput("abc", 10)).toBeNull();
    expect(parsePageInput("3", 0)).toBeNull();
  });
});

describe("zoom", () => {
  it("steps by a quarter and stays within the limits", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.8);
    expect(stepZoom(5, 1)).toBe(5);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });

  it("fits the width, or the whole page when it is taller than the area", () => {
    const area = { width: 624, height: 424 };
    expect(fitZoom("width", sizes[0]!, area)).toBe(1);
    expect(fitZoom("page", sizes[0]!, area)).toBe(0.5);
    expect(fitZoom("page", { width: 0, height: 0 }, area)).toBe(1);
  });

  it("fits a document of mixed page sizes so every page fits, whichever page the reader is on", () => {
    const mixed = [
      { width: 600, height: 800 },
      { width: 1200, height: 400 },
      { width: 300, height: 1600 },
    ];
    const area = { width: 624, height: 424 };
    // Width: the widest page fills the area, the others are narrower.
    expect(fitZoomAll("width", mixed, area)).toBe(0.5);
    // Page: the zoom at which the tallest and the widest both fit whole.
    expect(fitZoomAll("page", mixed, area)).toBe(0.25);
    expect(fitZoomAll("width", sizes, area)).toBe(fitZoom("width", sizes[0]!, area));
    expect(fitZoomAll("page", [], area)).toBe(1);
  });
});

describe("pagesInBand", () => {
  it("lists the pages that touch the band", () => {
    const layout = layoutPages(sizes, 1);
    expect(pagesInBand(layout.tops, sizes, 1, 0, 100)).toEqual([1]);
    expect(pagesInBand(layout.tops, sizes, 1, 700, 900)).toEqual([1, 2]);
    expect(pagesInBand(layout.tops, sizes, 1, 5000, 6000)).toEqual([]);
  });
});
