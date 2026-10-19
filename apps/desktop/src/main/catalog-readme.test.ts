import { describe, expect, it } from "vitest";
import { parseReadme, plainInline } from "./catalog-readme";

describe("parseReadme", () => {
  it("keeps headings, paragraphs, lists and code as plain text", () => {
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
      { kind: "heading", level: 2, text: "Tracker" },
      { kind: "paragraph", text: "Tracks your runs and deaths, per act." },
      { kind: "heading", level: 2, text: "Features" },
      { kind: "list", ordered: false, items: ["Splits by act", "Best times across runs"] },
      { kind: "list", ordered: true, items: ["Install", "Add it"] },
      { kind: "code", text: "<script>alert(1)</script>" },
      { kind: "paragraph", text: "Made with love." },
    ]);
  });

  it("keeps only the words of links, drops pictures, and leaves HTML as text (C10)", () => {
    expect(plainInline("See [the wiki](javascript:alert(1)) ![logo](https://evil.example/x.png) now")).toBe("See the wiki logo now");
    expect(plainInline("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
    expect(plainInline("a‮b\u0000c")).toBe("abc");
    expect(plainInline("2 * 3 * 4 and snake_case_name")).toBe("2 * 3 * 4 and snake_case_name");
  });

  it("stops at a few hundred blocks", () => {
    expect(parseReadme(Array.from({ length: 500 }, (_, i) => `Line ${i}\n`).join("\n"))).toHaveLength(200);
  });
});
