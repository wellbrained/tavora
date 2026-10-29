import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME } from "./games";
import {
  contrast,
  contrastProblems,
  DEFAULT_THEME,
  discoverThemes,
  FALLBACK_THEME,
  moduleTheme,
  resolveTheme,
  variationForMode,
  starterTheme,
  THEME_MANIFEST,
  themeManifest,
  validateTheme,
  veiled,
} from "./themes";

const repo = path.resolve(__dirname, "../../../..");
const officialDir = path.join(repo, "themes");

function manifest(overrides: Record<string, unknown> = {}, variation: Record<string, unknown> = {}) {
  return {
    id: "community.ash",
    name: "Ash",
    version: "1.0.0",
    variations: [{ id: "dark", name: "Dark", mode: "dark", colors: { ...THEME.tokens }, ...variation }],
    ...overrides,
  };
}

async function themeFolder(root: string, folder: string, content: unknown) {
  await mkdir(path.join(root, folder), { recursive: true });
  await writeFile(path.join(root, folder, THEME_MANIFEST), typeof content === "string" ? content : JSON.stringify(content));
}

describe("contrast", () => {
  it("matches the WCAG ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrast("#ffffff", "#777777")).toBe(contrast("#777777", "#ffffff"));
  });

  it("finds nothing wrong with the Tavora default", () => {
    expect(contrastProblems({ colors: THEME.tokens, contrast: "normal" })).toEqual([]);
  });
});

describe("veiled", () => {
  it("darkens a colour like a black backdrop of that opacity", () => {
    expect(veiled("#ffffff", 0.8)).toBe("#333333");
    expect(veiled("#1a2b3c", 0)).toBe("#1a2b3c");
    expect(veiled("#1a2b3c", 1)).toBe("#000000");
  });
});

describe("validateTheme", () => {
  it("accepts a full palette and fills in the defaults", () => {
    const result = validateTheme(manifest());
    expect(result).toEqual({
      ok: true,
      theme: {
        id: "community.ash",
        name: "Ash",
        description: null,
        author: null,
        version: "1.0.0",
        variations: [{ id: "dark", name: "Dark", mode: "dark", contrast: "normal", radius: THEME.radius, colors: THEME.tokens }],
      },
    });
  });

  it("refuses unknown fields, so a theme cannot carry anything but data", () => {
    expect(validateTheme(manifest({ css: "body{}" }))).toEqual({ ok: false, error: "Unknown fields: css" });
    expect(validateTheme(manifest({}, { script: "x" }))).toMatchObject({ ok: false, error: expect.stringContaining("unknown fields: script") });
    expect(validateTheme(manifest({}, { colors: { ...THEME.tokens, sparkle: "#ffffff" } }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("unknown colors: sparkle"),
    });
  });

  it("lets a theme colour its toasts, and flips the theme's colours when it doesn't", () => {
    const { toast: _toast, "toast-foreground": _text, ...plain } = THEME.tokens;
    expect(validateTheme(manifest({}, { colors: plain }))).toMatchObject({
      ok: true,
      theme: { variations: [{ colors: { toast: THEME.tokens.foreground, "toast-foreground": THEME.tokens.background } }] },
    });
    const own = validateTheme(manifest({}, { colors: { ...plain, toast: "#2a2521", "toast-foreground": "#f2ece0" } }));
    expect(own).toMatchObject({ ok: true, theme: { variations: [{ colors: { toast: "#2a2521", "toast-foreground": "#f2ece0" } }] } });
    const dim = validateTheme(manifest({}, { colors: { ...plain, toast: "#2a2521", "toast-foreground": "#55504a" } }));
    expect(dim).toMatchObject({ ok: false, error: expect.stringContaining("toast-foreground on toast") });
  });

  it("needs every token as a plain hex colour", () => {
    const { info: _info, ...missing } = THEME.tokens;
    expect(validateTheme(manifest({}, { colors: missing }))).toMatchObject({ ok: false, error: expect.stringContaining("needs info") });
    expect(validateTheme(manifest({}, { colors: { ...THEME.tokens, primary: "gold" } }))).toMatchObject({ ok: false });
    expect(validateTheme(manifest({}, { colors: { ...THEME.tokens, primary: "#e0a24380" } }))).toMatchObject({ ok: false });
  });

  it("keeps the radius in the style guide's range", () => {
    expect(validateTheme(manifest({}, { radius: 12 }))).toMatchObject({ ok: true });
    expect(validateTheme(manifest({}, { radius: 2 }))).toMatchObject({ ok: false, error: expect.stringContaining("radius from 4 to 12") });
    expect(validateTheme(manifest({}, { radius: 8.5 }))).toMatchObject({ ok: false });
  });

  it("refuses text that is hard to read, and holds high-contrast variations to AAA", () => {
    const dim = validateTheme(manifest({}, { colors: { ...THEME.tokens, "muted-foreground": "#55504a" } }));
    expect(dim).toMatchObject({ ok: false, error: expect.stringContaining("muted-foreground on background") });
    const high = validateTheme(manifest({}, { contrast: "high" }));
    expect(high).toMatchObject({ ok: false, error: expect.stringContaining("needs 7:1") });
  });

  it("checks ids, names, versions and the number of variations", () => {
    expect(validateTheme(manifest({ id: "Ash" }))).toMatchObject({ ok: false });
    expect(validateTheme(manifest({ name: "" }))).toMatchObject({ ok: false });
    expect(validateTheme(manifest({ version: "1" }))).toMatchObject({ ok: false });
    expect(validateTheme(manifest({ variations: [] }))).toMatchObject({ ok: false });
    const variation = manifest().variations[0]!;
    const five = [1, 2, 3, 4, 5].map((n) => ({ ...variation, id: `v${n}` }));
    expect(validateTheme(manifest({ variations: five }))).toMatchObject({ ok: false, error: "A theme needs 1 to 4 variations" });
    expect(validateTheme(manifest({ variations: [variation, variation] }))).toMatchObject({ ok: false, error: 'Two variations are called "dark"' });
  });
});

describe("the official themes", () => {
  it("are all valid, and the default's Dark is exactly the look in code and styles.css", async () => {
    const { themes, problems } = await discoverThemes({ official: [officialDir] });
    expect(problems).toEqual([]);
    expect([...themes.keys()].sort()).toEqual(["tavora.default", "tavora.hearthwood", "tavora.nightfall"]);
    expect([...themes.values()].every((entry) => entry.provenance === "official")).toBe(true);
    // Every official theme comes in Dark and Light, nothing else.
    for (const { theme } of themes.values()) expect(theme.variations.map((item) => [item.id, item.mode])).toEqual([["dark", "dark"], ["light", "light"]]);
    const dark = themes.get(DEFAULT_THEME.id)!.theme.variations.find((item) => item.id === DEFAULT_THEME.variation)!;
    expect(dark).toEqual(FALLBACK_THEME.variations[0]);
    expect(moduleTheme(dark)).toEqual(THEME);
  });

  it("are shipped with the installer", async () => {
    const pkg = JSON.parse(await readFile(path.join(repo, "apps/desktop/package.json"), "utf8")) as {
      build: { extraResources: { from: string; to: string; filter: string[] }[] };
    };
    expect(pkg.build.extraResources).toContainEqual({ from: "../../themes", to: "official-themes", filter: [`*/${THEME_MANIFEST}`] });
  });
});

describe("discoverThemes", () => {
  it("loads local themes, reports broken ones by folder, and always has the default", async () => {
    const local = await mkdtemp(path.join(tmpdir(), "tavora-themes-"));
    await themeFolder(local, "ash", manifest());
    await themeFolder(local, "broken", "{ not json");
    await themeFolder(local, "copycat", manifest({ id: "tavora.copycat" }));
    await mkdir(path.join(local, "empty"));
    const { themes, problems } = await discoverThemes({ official: [path.join(local, "missing")], local: [local] });
    expect(themes.get("community.ash")?.provenance).toBe("local");
    expect(themes.get(DEFAULT_THEME.id)?.theme).toBe(FALLBACK_THEME);
    expect(problems).toEqual([
      { folder: "broken", message: `${THEME_MANIFEST} is not valid JSON` },
      { folder: "copycat", message: 'Ids starting with "tavora." are reserved for Tavora\'s own themes' },
    ]);
  });

  it("keeps the official theme when a local one has the same id", async () => {
    const official = await mkdtemp(path.join(tmpdir(), "tavora-official-themes-"));
    const local = await mkdtemp(path.join(tmpdir(), "tavora-themes-"));
    await themeFolder(official, "ash", manifest({ id: "tavora.ash", name: "Official" }));
    await themeFolder(local, "ash", manifest({ id: "tavora.ash", name: "Local" }));
    const { themes, problems } = await discoverThemes({ official: [official], local: [local] });
    expect(themes.get("tavora.ash")?.theme.name).toBe("Official");
    expect(problems).toHaveLength(1);
  });

  it("treats a missing themes folder as having no themes", async () => {
    const { themes, problems } = await discoverThemes({ local: [path.join(tmpdir(), "tavora-no-such-folder")] });
    expect([...themes.keys()]).toEqual([DEFAULT_THEME.id]);
    expect(problems).toEqual([]);
  });
});

describe("resolveTheme", () => {
  it("falls back to the first variation, then to the default theme", async () => {
    const { themes } = await discoverThemes({ official: [officialDir] });
    expect(resolveTheme(themes, { id: "tavora.nightfall", variation: "light" }).variation.id).toBe("light");
    expect(resolveTheme(themes, { id: "tavora.nightfall", variation: "oled" }).variation.id).toBe("dark");
    const gone = resolveTheme(themes, { id: "community.gone", variation: "dark" });
    expect([gone.theme.id, gone.variation.id]).toEqual([DEFAULT_THEME.id, DEFAULT_THEME.variation]);
  });
});

describe("resolveTheme when following the system", () => {
  it("shows the variation that suits the system, whichever one was saved", async () => {
    const { themes } = await discoverThemes({ official: [officialDir] });
    const pick = (variation: string, mode: "dark" | "light") => resolveTheme(themes, { id: "tavora.nightfall", variation }, mode).variation.id;
    expect([pick("dark", "light"), pick("light", "dark"), pick("dark", "dark"), pick("light", "light")]).toEqual(["light", "dark", "dark", "light"]);
  });

  it("uses the default theme's matching variation when the saved theme is gone", async () => {
    const { themes } = await discoverThemes({ official: [officialDir] });
    const gone = resolveTheme(themes, { id: "community.gone", variation: "dark" }, "light");
    expect([gone.theme.id, gone.variation.mode]).toEqual([DEFAULT_THEME.id, "light"]);
  });

  it("prefers normal contrast over high contrast, and keeps a theme that only has the other mode", async () => {
    const { themes } = await discoverThemes({ official: [officialDir] });
    const base = themes.get("tavora.nightfall")!.theme;
    const dark = base.variations.find((item) => item.mode === "dark")!;
    const light = base.variations.find((item) => item.mode === "light")!;
    const withHigh = { ...base, variations: [{ ...light, id: "light-high", contrast: "high" as const }, light, dark] };
    expect(variationForMode(withHigh, "dark", "light").id).toBe(light.id);
    // A saved variation that already suits the system is kept, even a high contrast one.
    expect(variationForMode(withHigh, "light-high", "light").id).toBe("light-high");
    const darkOnly = { ...base, variations: [dark] };
    expect(variationForMode(darkOnly, dark.id, "light").id).toBe(dark.id);
  });
});

describe("the starter theme", () => {
  it("is the Tavora theme under a new local id, and passes validation as written", async () => {
    const { themes } = await discoverThemes({ official: [officialDir] });
    const first = starterTheme(themes, 1);
    expect([first.id, first.name]).toEqual(["local.my-theme", "My theme"]);
    expect([starterTheme(themes, 3).id, starterTheme(themes, 3).name]).toEqual(["local.my-theme-3", "My theme 3"]);
    expect(first.variations).toEqual(themes.get(DEFAULT_THEME.id)!.theme.variations);
    expect(validateTheme(JSON.parse(themeManifest(first)))).toEqual({ ok: true, theme: first });
  });

  it("ships in examples/ for people to copy, and is valid there too", async () => {
    const raw = JSON.parse(await readFile(path.join(repo, "examples/theme-starter", THEME_MANIFEST), "utf8"));
    const result = validateTheme(raw);
    expect(result.ok).toBe(true);
    const { themes } = await discoverThemes({ official: [officialDir] });
    if (result.ok) expect(result.theme.variations).toEqual(themes.get(DEFAULT_THEME.id)!.theme.variations);
  });
});
