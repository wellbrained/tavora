import { describe, expect, it } from "vitest";
import { linkBox, linkTarget, namedPage, webAddress } from "./links";

describe("webAddress", () => {
  it("keeps only http and https addresses", () => {
    expect(webAddress("https://example.com/guide")).toBe("https://example.com/guide");
    expect(webAddress("http://example.com")).toBe("http://example.com/");
    expect(webAddress("mailto:me@example.com")).toBeNull();
    expect(webAddress("javascript:alert(1)")).toBeNull();
    expect(webAddress("file:///C:/secret.txt")).toBeNull();
    expect(webAddress("other.pdf#page=2")).toBeNull();
    expect(webAddress(undefined)).toBeNull();
  });
});

describe("linkTarget", () => {
  it("reads where a link annotation leads", () => {
    expect(linkTarget({ subtype: "Link", url: "https://example.com" })).toEqual({ kind: "web", url: "https://example.com/" });
    expect(linkTarget({ subtype: "Link", dest: "chapter2" })).toEqual({ kind: "dest", dest: "chapter2" });
    expect(linkTarget({ subtype: "Link", dest: [{ num: 4, gen: 0 }, { name: "XYZ" }] })).toEqual({ kind: "dest", dest: [{ num: 4, gen: 0 }, { name: "XYZ" }] });
    expect(linkTarget({ subtype: "Link", action: "NextPage" })).toEqual({ kind: "named", action: "NextPage" });
  });

  it("leaves out what is not a link, or leads nowhere the viewer can go", () => {
    expect(linkTarget({ subtype: "Widget", url: "https://example.com" })).toBeNull();
    expect(linkTarget({ subtype: "Link", url: "mailto:me@example.com" })).toBeNull();
    expect(linkTarget({ subtype: "Link", unsafeUrl: "https://example.com" })).toBeNull();
    expect(linkTarget({ subtype: "Link", action: "Print" })).toBeNull();
    expect(linkTarget({ subtype: "Link" })).toBeNull();
  });
});

describe("namedPage", () => {
  it("turns next, previous, first and last into a page inside the document", () => {
    expect(namedPage("NextPage", 3, 10)).toBe(4);
    expect(namedPage("PrevPage", 3, 10)).toBe(2);
    expect(namedPage("FirstPage", 3, 10)).toBe(1);
    expect(namedPage("LastPage", 3, 10)).toBe(10);
    expect(namedPage("NextPage", 10, 10)).toBe(10);
    expect(namedPage("PrevPage", 1, 10)).toBe(1);
  });
});

describe("linkBox", () => {
  it("places a link on the page in percent, from the top left", () => {
    // A 200 × 100 page; the link runs from (20, 70) to (120, 90) in PDF units, measured from the bottom left.
    expect(linkBox([20, 70, 120, 90], [0, 0, 200, 100])).toEqual({ left: 10, top: 10, width: 50, height: 20 });
    // Corners given the other way round.
    expect(linkBox([120, 90, 20, 70], [0, 0, 200, 100])).toEqual({ left: 10, top: 10, width: 50, height: 20 });
    expect(linkBox([0, 0, 0, 0], [0, 0, 0, 0])).toBeNull();
  });
});
