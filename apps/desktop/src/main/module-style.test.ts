import { describe, expect, it } from "vitest";
import { THEME } from "./games";
import { moduleBaseCss, moduleThemeCss, moduleTokens } from "./module-style";

describe("module base styles", () => {
  it("embed the fonts given and style the page from the --tavora- properties", () => {
    const css = moduleBaseCss({ latin: "data:font/woff2;base64,AAA", latinExt: "data:font/woff2;base64,BBB" });
    expect(css).toContain("url(data:font/woff2;base64,AAA)");
    expect(css).toContain("url(data:font/woff2;base64,BBB)");
    expect(css).toContain("body { margin: 0;");
    expect(css).toContain("background: var(--tavora-background);");
    expect(css).not.toContain(THEME.tokens.background);
  });

  it("set nothing a module's CSS reset leaves alone, so its own controls keep their size", () => {
    const css = moduleBaseCss({ latin: "data:,", latinExt: "data:," });
    // A minimum height stretched shadcn checkboxes and switches; a root font size shrank every rem.
    expect(css).not.toContain("min-height");
    expect(css).not.toMatch(/:root \{[^}]*\sfont(-size)?:/);
  });

  it("put every token of the theme in its own stylesheet, with the colour scheme", () => {
    const css = moduleThemeCss(THEME);
    for (const [name, value] of Object.entries(moduleTokens(THEME))) expect(css).toContain(`--tavora-${name}: ${value};`);
    expect(css).toContain("--tavora-radius: 8px;");
    expect(css).toContain("color-scheme: dark;");
    expect(css).toContain(`stroke='${encodeURIComponent(THEME.tokens["muted-foreground"])}'`);
  });
});
