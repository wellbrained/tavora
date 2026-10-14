import { describe, expect, it } from "vitest";
import { MODULE_TOKENS, moduleBaseCss } from "./module-style";

describe("module base styles", () => {
  it("offer every token as a --tavora- property and embed the fonts given", () => {
    const css = moduleBaseCss({ latin: "data:font/woff2;base64,AAA", latinExt: "data:font/woff2;base64,BBB" });
    for (const [name, value] of Object.entries(MODULE_TOKENS)) expect(css).toContain(`--tavora-${name}: ${value};`);
    expect(css).toContain("url(data:font/woff2;base64,AAA)");
    expect(css).toContain("url(data:font/woff2;base64,BBB)");
    expect(css).toContain("body { margin: 0; }");
  });
});
