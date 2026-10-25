import { describe, expect, it } from "vitest";
import { MAX_README_LINKS, parseInline, parseReadme, plainInline, readmeAllowsLink, readmeLinks } from "./catalog-readme";

describe("parseReadme", () => {
  it("keeps headings, paragraphs, lists and code, with inline marks as spans", () => {
    const readme = [
      "# Tracker",
      "",
      "Tracks your **runs** and _deaths_,",
      "per `act`.",
      "",
      "## Features",
      "- Splits by act",
      "- Best times",
      "  across runs",
      "",
      "1. Install",
      "2. Add it",
      "",
      "```",
      "<script>alert(1)</script>",
      "```",
      "> Made with love.",
      "---",
    ].join("\n");
    expect(parseReadme(readme)).toEqual([
      { kind: "heading", level: 1, text: "Tracker" },
      {
        kind: "paragraph",
        spans: [{ text: "Tracks your " }, { text: "runs", bold: true }, { text: " and " }, { text: "deaths", italic: true }, { text: ", per " }, { text: "act", code: true }, { text: "." }],
      },
      { kind: "heading", level: 2, text: "Features" },
      { kind: "list", ordered: false, items: [{ spans: [{ text: "Splits by act" }] }, { spans: [{ text: "Best times across runs" }] }] },
      { kind: "list", ordered: true, items: [{ spans: [{ text: "Install" }] }, { spans: [{ text: "Add it" }] }] },
      { kind: "code", text: "<script>alert(1)</script>" },
      { kind: "paragraph", spans: [{ text: "Made with love." }] },
    ]);
  });

  it("nests list items one level", () => {
    const blocks = parseReadme(["- Maps", "  - Zoom", "  - Pan", "    - deeper", "- Notes"].join("\n"));
    expect(blocks).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [{ spans: [{ text: "Maps" }], children: [[{ text: "Zoom" }], [{ text: "Pan" }], [{ text: "deeper" }]] }, { spans: [{ text: "Notes" }] }],
      },
    ]);
  });

  it("keeps http and https links as words plus an address, and nothing else", () => {
    const [block] = parseReadme('See [the **guide**](https://example.com/a(b)?x=1 "title"), [mail](mailto:a@b.c), [js](javascript:alert(1)), [file](file:///c:/x) and [plain](http://example.org).');
    expect(block).toEqual({
      kind: "paragraph",
      spans: [
        { text: "See " },
        { text: "the ", url: "https://example.com/a(b)?x=1" },
        { text: "guide", bold: true, url: "https://example.com/a(b)?x=1" },
        { text: ", mail, js, file and " },
        { text: "plain", url: "http://example.org" },
        { text: "." },
      ],
    });
  });

  it("keeps a code span as code, even when it looks like a link", () => {
    expect(parseInline("`[a](https://x.test)`")).toEqual([{ text: "[a](https://x.test)", code: true }]);
  });

  it("blocks pictures and leaves HTML as text (C10)", () => {
    expect(plainInline("See [the wiki](javascript:alert(1)) ![logo](https://evil.example/x.png) now")).toBe("See the wiki logo now");
    expect(plainInline("[![badge](https://img.test/b.svg)](https://x.test)")).toBe("badge");
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ text: "<img src=x onerror=alert(1)>" }]);
    expect(plainInline("a\u202Eb\u0000c")).toBe("abc");
    expect(plainInline("2 * 3 * 4 and snake_case_name")).toBe("2 * 3 * 4 and snake_case_name");
  });

  it("rejects addresses with controls or no host, and caps links", () => {
    expect(parseInline("[x](https://)")).toEqual([{ text: "x" }]);
    expect(parseInline("[x](https://a.test/a b)")).toEqual([{ text: "[x](https://a.test/a b)" }]);
    const many = Array.from({ length: MAX_README_LINKS + 5 }, (_, i) => `[l${i}](https://a.test/${i})`).join(" ");
    expect(readmeLinks(parseReadme(many)).size).toBe(MAX_README_LINKS);
  });

  it("stops at a few hundred blocks", () => {
    expect(parseReadme(Array.from({ length: 500 }, (_, i) => `Line ${i}\n`).join("\n"))).toHaveLength(200);
  });
});

describe("readmeAllowsLink", () => {
  const readme = "Read the [guide](https://example.com/guide).\n\n- [Item](http://example.org/x)\n\n`[no](https://code.test)`";
  it("allows only addresses the readme shows as links", () => {
    expect(readmeAllowsLink(readme, "https://example.com/guide")).toBe(true);
    expect(readmeAllowsLink(readme, "http://example.org/x")).toBe(true);
  });
  it("refuses other addresses, other schemes and a missing readme", () => {
    expect(readmeAllowsLink(readme, "https://evil.test/")).toBe(false);
    expect(readmeAllowsLink(readme, "https://code.test")).toBe(false);
    expect(readmeAllowsLink(readme, "https://example.com/guide/")).toBe(false);
    expect(readmeAllowsLink("[x](javascript:alert(1))", "javascript:alert(1)")).toBe(false);
    expect(readmeAllowsLink("[x](ftp://a.test/f)", "ftp://a.test/f")).toBe(false);
    expect(readmeAllowsLink(null, "https://example.com/guide")).toBe(false);
    expect(readmeAllowsLink(readme, 5)).toBe(false);
  });
});
