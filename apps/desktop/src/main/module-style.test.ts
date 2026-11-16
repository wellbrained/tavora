import { describe, expect, it } from "vitest";
import { THEME } from "./games";
import { fontStylesheet } from "./module-fonts";
import { moduleBaseCss, moduleFontCss, moduleThemeCss, moduleTokens } from "./module-style";

describe("module base styles", () => {
  it("style the page from the --tavora- properties, with Inter until a font stylesheet says otherwise", () => {
    const css = moduleBaseCss();
    expect(css).toContain("body { margin: 0;");
    expect(css).toContain("background: var(--tavora-background);");
    expect(css).toContain('--tavora-font-sans: "Inter Variable", system-ui, sans-serif;');
    expect(css).not.toContain("@font-face");
    expect(css).not.toContain(THEME.tokens.background);
  });

  it("set nothing a module's CSS reset leaves alone, so its own controls keep their size", () => {
    const css = moduleBaseCss();
    // A minimum height stretched shadcn checkboxes and switches; a root font size shrank every rem.
    expect(css).not.toContain("min-height");
    expect(css).not.toMatch(/:root \{[^}]*\sfont(-size)?:/);
  });

  it("put a font's files and --tavora-font-sans in a stylesheet of their own", () => {
    const css = moduleFontCss(
      { id: "allo", family: '"Allo Variable", system-ui, sans-serif' },
      { name: "Allo Variable", weight: "100 900", faces: [{ src: "data:font/woff2;base64,AAA", range: "U+0000-00FF" }, { src: "data:font/woff2;base64,BBB", range: "U+0100-02BA" }] },
    );
    expect(css).toContain('@font-face { font-family: "Allo Variable"; font-style: normal; font-display: swap; font-weight: 100 900; src: url(data:font/woff2;base64,AAA) format("woff2-variations"); unicode-range: U+0000-00FF; }');
    expect(css).toContain("url(data:font/woff2;base64,BBB)");
    expect(css).toContain(':root { --tavora-font-sans: "Allo Variable", system-ui, sans-serif; }');
  });

  it("give every page Inter's files, also for a font this Tavora doesn't know, and make each stylesheet once", () => {
    const inter = fontStylesheet({ id: "inter", family: "x" });
    expect(inter).toContain('font-family: "Inter Variable"');
    expect(inter.match(/@font-face/g)).toHaveLength(2);
    expect(inter).toContain(':root { --tavora-font-sans: "Inter Variable", system-ui, sans-serif; }');
    expect(fontStylesheet({ id: "gone", family: '"Gone", serif' })).toBe(inter);
    expect(fontStylesheet(undefined)).toBe(inter);
  });

  it("put every token of the theme in its own stylesheet, with the colour scheme", () => {
    const css = moduleThemeCss(THEME);
    for (const [name, value] of Object.entries(moduleTokens(THEME))) expect(css).toContain(`--tavora-${name}: ${value};`);
    expect(css).toContain("--tavora-radius: 8px;");
    expect(css).toContain("color-scheme: dark;");
    expect(css).toContain(`stroke='${encodeURIComponent(THEME.tokens["muted-foreground"])}'`);
  });
});
