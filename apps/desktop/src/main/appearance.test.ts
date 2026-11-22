import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Appearance, type AppearanceOptions } from "./appearance";
import { emptyLibrary, LibraryError, type Library } from "./library";
import { discoverStyles } from "./styles";
import { discoverThemes, THEME_MANIFEST } from "./themes";

const REPO = path.resolve(import.meta.dirname, "../../../..");

/** Appearance over Tavora's own themes and styles and a temp data folder, with the system in `mode`. */
async function setup(options: Partial<AppearanceOptions> & { mode?: "dark" | "light" } = {}) {
  const userData = await mkdtemp(path.join(tmpdir(), "tavora-appearance-"));
  const sources = { themes: { official: [path.join(REPO, "themes")], local: [path.join(userData, "themes")] }, styles: { official: [path.join(REPO, "styles")], local: [path.join(userData, "styles")] } };
  const [themes, styles] = await Promise.all([discoverThemes(sources.themes), discoverStyles(sources.styles)]);
  const library: Library = emptyLibrary();
  let mode = options.mode ?? "dark";
  const applied = vi.fn<(changed: boolean) => void>();
  const openPath = vi.fn(async () => "");
  const appearance = new Appearance({
    library,
    userData,
    sources,
    appVersion: "0.24.0",
    installed: { themes: themes.themes, themeProblems: themes.problems, themeHints: themes.hints, styles: styles.styles, styleProblems: styles.problems, styleHints: styles.hints },
    systemMode: () => mode,
    openPath,
    hidden: false,
    applied,
    ...options,
  });
  return { appearance, library, userData, applied, openPath, setMode: (next: "dark" | "light") => (mode = next) };
}

describe("Appearance at the start", () => {
  it("is Tavora's theme, in the system's mode, with the Classic style", async () => {
    const { appearance } = await setup({ mode: "light" });
    expect(appearance.view()).toMatchObject({ themeId: "tavora.default", variationId: "light", isDefault: true, followSystem: true, styleId: "tavora.classic" });
    expect(appearance.host.mode).toBe("light");
    expect(appearance.view().themes[0]?.id).toBe("tavora.default");
    expect(appearance.view().styles[0]?.id).toBe("tavora.classic");
  });
});

describe("Appearance.refresh", () => {
  it("follows the system's mode while the user wants it, and says when the look changed", async () => {
    const { appearance, applied, setMode, library } = await setup();
    appearance.refresh();
    expect(applied).toHaveBeenLastCalledWith(false);
    setMode("light");
    appearance.refresh();
    expect(applied).toHaveBeenLastCalledWith(true);
    expect(appearance.host.mode).toBe("light");
    // Not following any more: the theme's own variation shows, whatever the system says.
    library.followSystem = false;
    appearance.refresh();
    expect(appearance.host.mode).toBe("dark");
    setMode("light");
    appearance.refresh();
    expect(applied).toHaveBeenLastCalledWith(false);
  });
});

describe("Appearance.choose", () => {
  it("picks a theme and variation, and a fixed pick stops following the system", async () => {
    const { appearance, library, applied } = await setup();
    appearance.choose({ type: "set-theme", themeId: "tavora.nothing", variationId: "light", fixed: true });
    expect(library.theme).toEqual({ id: "tavora.nothing", variation: "light" });
    expect(library.followSystem).toBe(false);
    expect(applied).toHaveBeenLastCalledWith(true);
    expect(appearance.view()).toMatchObject({ themeId: "tavora.nothing", variationId: "light", isDefault: false });
  });

  it("refuses a theme or variation that is not installed", async () => {
    const { appearance, library } = await setup();
    expect(() => appearance.choose({ type: "set-theme", themeId: "community.gone", variationId: "dark" })).toThrow(LibraryError);
    expect(() => appearance.choose({ type: "set-theme", themeId: "tavora.default", variationId: "sepia" })).toThrow(LibraryError);
    expect(library.theme).toEqual({ id: "tavora.default", variation: "dark" });
  });

  it("sets a mode by picking the theme's variation for it, or follows the system again", async () => {
    const { appearance, library } = await setup();
    appearance.choose({ type: "set-appearance-mode", mode: "light" });
    expect(library).toMatchObject({ theme: { id: "tavora.default", variation: "light" }, followSystem: false });
    appearance.choose({ type: "set-appearance-mode", mode: "system" });
    expect(library.followSystem).toBe(true);
    expect(appearance.host.mode).toBe("dark");
  });

  it("keeps the user's radius and font over the style's, and null goes back to the style's", async () => {
    const { appearance, library } = await setup();
    appearance.choose({ type: "set-radius", radius: 0 });
    appearance.choose({ type: "set-font", font: "inter" });
    expect(appearance.view()).toMatchObject({ radius: 0, resolvedRadius: 0, fontOverride: "inter", isDefault: false });
    appearance.choose({ type: "set-font", font: null });
    expect(library.font).toBeUndefined();
    expect(appearance.view().fontOverride).toBeNull();
  });

  it("starts a style never used with its own first theme, in the mode shown now", async () => {
    const { appearance, library } = await setup({ mode: "light" });
    appearance.choose({ type: "set-style", styleId: "tavora.glass" });
    expect(library.styleId).toBe("tavora.glass");
    expect(library.theme).toEqual({ id: "tavora.glass", variation: "light" });
    // Classic keeps the theme it had.
    appearance.choose({ type: "set-style", styleId: "tavora.classic" });
    expect(library.theme.id).toBe("tavora.default");
  });

  it("goes back to Tavora's look on reset", async () => {
    const { appearance, library } = await setup();
    appearance.choose({ type: "set-style", styleId: "tavora.glass" });
    appearance.choose({ type: "set-radius", radius: 4 });
    appearance.choose({ type: "set-font", font: "inter" });
    appearance.choose({ type: "reset-theme" });
    expect(appearance.view().isDefault).toBe(true);
    expect(library.styleId).toBeUndefined();
  });
});

describe("Appearance.createStarter and openFolder", () => {
  it("writes a starter theme into the user's themes folder, loads it and shows the folder", async () => {
    const { appearance, userData, openPath } = await setup();
    const id = await appearance.createStarter("theme");
    const folder = path.join(userData, "themes", "my-theme");
    expect(JSON.parse(await readFile(path.join(folder, THEME_MANIFEST), "utf8"))).toMatchObject({ id });
    expect(existsSync(path.join(folder, "README.txt"))).toBe(true);
    expect(appearance.view().themes.some((theme) => theme.id === id && theme.provenance === "local")).toBe(true);
    expect(openPath).toHaveBeenCalledWith(folder);
    // A second one gets the next free folder.
    const next = await appearance.createStarter("theme");
    expect(next).not.toBe(id);
    expect(existsSync(path.join(userData, "themes", "my-theme-2"))).toBe(true);
  });

  it("writes a starter style from the style in use, and a hidden test run opens no file manager", async () => {
    const { appearance, openPath } = await setup({ hidden: true });
    const id = await appearance.createStarter("style");
    expect(appearance.view().styles.some((style) => style.id === id && style.provenance === "local")).toBe(true);
    expect(openPath).not.toHaveBeenCalled();
  });

  it("says why a folder could not be shown", async () => {
    const { appearance, userData } = await setup({ openPath: async () => "no file manager" });
    await expect(appearance.openFolder("style")).rejects.toMatchObject({ key: "error.openStylesFolder", params: { problem: "no file manager" } });
    await expect(appearance.openFolder("theme")).rejects.toMatchObject({ key: "error.openThemesFolder" });
    expect(existsSync(path.join(userData, "styles"))).toBe(true);
  });
});

describe("Appearance.corners", () => {
  it("keeps Classic's corners whatever the radius, and rounds another style's by the radius in use", async () => {
    const { appearance } = await setup();
    const classic = appearance.corners();
    appearance.choose({ type: "set-radius", radius: 0 });
    expect(appearance.corners()).toEqual(classic);
    appearance.choose({ type: "set-style", styleId: "tavora.glass" });
    expect(appearance.corners()).toEqual({ module: 0, page: 0, cover: 0 });
  });
});
