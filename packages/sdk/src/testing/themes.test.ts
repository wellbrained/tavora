import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPTIONAL_THEME_TOKENS, THEME_TOKENS } from "../protocol.js";
import { themeFromPackage, themeOf, type ThemePackageJson } from "../testing.js";

const shipped = (name: string) => JSON.parse(readFileSync(new URL(`../../../../themes/${name}/tavora.theme.json`, import.meta.url), "utf8")) as ThemePackageJson;

describe("themeOf", () => {
  it("is Tavora Dark and Hearthwood Light, as the themes Tavora ships them", () => {
    // The SDK carries copies, so it needs no path into the Tavora repo; this keeps them in step with themes/.
    expect(themeOf("dark")).toEqual(themeFromPackage(shipped("tavora"), "dark"));
    expect(themeOf("light")).toEqual(themeFromPackage(shipped("hearthwood"), "light"));
  });

  it("gives what a panel gets: every token, the summary colours, the radius and the toast position", () => {
    const dark = themeOf("dark");
    expect(dark.mode).toBe("dark");
    expect(Object.keys(dark.tokens).sort()).toEqual([...THEME_TOKENS].sort());
    expect(dark.colors).toEqual({ background: "#171412", surface: "#201c19", text: "#f2ece0", textMuted: "#9a958c", accent: "#e0a243" });
    expect(dark.radius).toBe(8);
    expect(dark.toasts).toBe("bottom-center");
    expect(themeOf("light").mode).toBe("light");
  });

  it("returns a fresh copy each time", () => {
    const one = themeOf("dark");
    one.tokens.background = "#000000";
    expect(themeOf("dark").tokens.background).toBe("#171412");
  });
});

describe("themeFromPackage", () => {
  const colors = Object.fromEntries(THEME_TOKENS.filter((token) => !(token in OPTIONAL_THEME_TOKENS)).map((token) => [token, "#123456"]));
  const pkg: ThemePackageJson = {
    variations: [
      { id: "night", mode: "dark", colors: { ...colors, primary: "#ff0000", "primary-hover": "#ee0000", "primary-foreground": "#ffffff", foreground: "#eeeeee", background: "#111111" } },
      { id: "day-high", mode: "light", contrast: "high", radius: 4, colors },
      { id: "day", mode: "light", radius: 6, colors },
    ],
  };

  it("fills the colours a theme may leave out as Tavora does", () => {
    const theme = themeFromPackage(pkg);
    expect(theme.tokens["primary-fill"]).toBe("#ff0000");
    expect(theme.tokens["primary-fill-hover"]).toBe("#ee0000");
    expect(theme.tokens["primary-fill-foreground"]).toBe("#ffffff");
    expect(theme.tokens.toast).toBe("#eeeeee");
    expect(theme.tokens["toast-foreground"]).toBe("#111111");
    expect(theme.radius).toBe(8);
  });

  it("picks a variation by id, or by mode with normal contrast first, else the first", () => {
    expect(themeFromPackage(pkg).mode).toBe("dark");
    expect(themeFromPackage(pkg, "day-high").radius).toBe(4);
    expect(themeFromPackage(pkg, "light").radius).toBe(6);
  });

  it("says what is wrong with a package it can't use", () => {
    expect(() => themeFromPackage(pkg, "dusk")).toThrow('no variation "dusk"');
    expect(() => themeFromPackage({ variations: [] })).toThrow("no variations");
    expect(() => themeFromPackage({ variations: [{ id: "x", mode: "dark", colors: { background: "#000000" } }] })).toThrow(/misses foreground/);
  });
});
