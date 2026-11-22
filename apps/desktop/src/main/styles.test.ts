import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLASSIC_STYLE, STYLE_LOOKS } from "@tavora/sdk/protocol";
import { THEME } from "./games";
import { appearanceThemes, discoverStyles, FALLBACK_STYLE, resolveStyle, starterStyle, STYLE_MANIFEST, STYLE_README, styleManifest, tavoraStyle, validateStyle, type StylePackage } from "./styles";
import { discoverThemes, glassOpacity, glassProblems, insetPanelTheme, mixed, moduleTheme, type ThemePackage, type ThemeVariation } from "./themes";
import { CLASSIC_STYLE_ID, isStyleRadius, resolveFontId, resolveRadius } from "../shared/styles";
import { UI_FONTS } from "../shared/ui-fonts";

const repo = path.resolve(__dirname, "../../../..");
const officialDir = path.join(repo, "styles");

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "community.chunky",
    name: "Chunky",
    version: "1.0.0",
    looks: { surface: "raised", tabs: "keycap", content: "inset", buttons: "keycap", inputs: "inset", lists: "inverted", labels: "caps-mono", status: "led" },
    values: { borderWidth: 2, depth: 3, textSize: 14, controlHeight: 36, spacing: 1.1, glassOpacity: 0.7 },
    radius: 4,
    font: "saira",
    ...overrides,
  };
}

async function styleFolder(root: string, name: string, content: unknown): Promise<void> {
  await mkdir(path.join(root, name), { recursive: true });
  await writeFile(path.join(root, name, STYLE_MANIFEST), typeof content === "string" ? content : JSON.stringify(content));
}

const fail = (raw: unknown) => {
  const result = validateStyle(raw);
  return result.ok ? null : result.error;
};

describe("validateStyle", () => {
  it("takes a full style", () => {
    const result = validateStyle(manifest({ description: " Big keys. ", author: "Ash", themes: ["tavora.default", "tavora.default", "community.ash"] }));
    expect(result.ok && result.style).toEqual({
      id: "community.chunky",
      name: "Chunky",
      description: "Big keys.",
      author: "Ash",
      version: "1.0.0",
      looks: manifest().looks,
      values: manifest().values,
      radius: 4,
      font: "saira",
      themes: ["tavora.default", "community.ash"],
    });
    expect(result.ok && result.hints).toEqual([]);
  });

  it("refuses unknown fields, parts and looks", () => {
    expect(fail(manifest({ css: "body{}" }))).toBe("Unknown fields: css");
    expect(fail(manifest({ looks: { ...manifest().looks, knob: "round" } }))).toBe("Unknown parts in looks: knob");
    expect(fail(manifest({ looks: { ...manifest().looks, tabs: "folder" } }))).toBe("looks.tabs must be one of pill, keycap");
    expect(fail(manifest({ values: { ...manifest().values, blur: 3 } }))).toBe("Unknown values: blur");
  });

  it("needs every part and every value", () => {
    const { status: _status, ...looks } = manifest().looks;
    expect(fail(manifest({ looks }))).toBe("looks needs status: one of none, led");
    const { spacing: _spacing, ...values } = manifest().values;
    expect(fail(manifest({ values }))).toBe("values.spacing must be a number from 0.85 to 1.2");
    expect(fail(manifest({ values: { ...manifest().values, depth: "2" } }))).toBe("values.depth must be a number from 0 to 3");
    expect(fail(manifest({ looks: "flat" }))).toBe("looks must be an object with a look for each part");
  });

  it("checks the id, name, version, radius, font and themes", () => {
    expect(fail(manifest({ id: "Chunky" }))).toMatch(/id must look like/);
    // The page's data-style takes up to 64 characters; a longer id would make the page and main disagree.
    expect(fail(manifest({ id: `community.${"a".repeat(55)}` }))).toMatch(/at most 64 characters/);
    expect(validateStyle(manifest({ id: `community.${"a".repeat(54)}` })).ok).toBe(true);
    expect(fail(manifest({ name: "" }))).toMatch(/name must be/);
    expect(fail(manifest({ version: "1" }))).toMatch(/version must be/);
    expect(fail(manifest({ radius: "4" }))).toBe("radius must be a number from 0 to 16");
    expect(fail(manifest({ themes: "tavora.default" }))).toMatch(/themes must be a list/);
    expect(fail(manifest({ themes: Array.from({ length: 9 }, (_, i) => `community.t${i}`) }))).toMatch(/themes must be a list/);
    expect(fail([])).toBe("The manifest is not a JSON object");
  });

  it("takes only a font Tavora ships", () => {
    expect(fail(manifest({ font: "comic-sans" }))).toMatch(/^font must be one of Tavora's fonts: inter, /);
    expect(fail(manifest({ font: undefined }))).toMatch(/^font must be one of/);
    for (const { id } of UI_FONTS) expect(validateStyle(manifest({ font: id })).ok, id).toBe(true);
  });

  it("keeps numbers in their range, with a hint for each", () => {
    const result = validateStyle(manifest({ radius: 20.4, values: { borderWidth: -1, depth: 9, textSize: 18, controlHeight: 20, spacing: 2, glassOpacity: 0.1 } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.style.values).toEqual({ borderWidth: 0, depth: 3, textSize: 15, controlHeight: 28, spacing: 1.2, glassOpacity: 0.55 });
    expect(result.style.radius).toBe(16);
    expect(result.hints).toHaveLength(7);
    expect(result.hints).toContain("values.textSize 18 is outside 12 to 15, so 15 is used");
    // The radius is a whole number, like the user's own.
    const half = validateStyle(manifest({ radius: 5.5 }));
    expect(half.ok && [half.style.radius, half.hints]).toEqual([6, ["radius 5.5 is outside 0 to 16 or not a whole number, so 6 is used"]]);
    expect(validateStyle(manifest({ radius: 0 })).ok).toBe(true);
  });
});

describe("Tavora's own styles", () => {
  it("are all valid, with no hints, and Classic is the SDK's Classic", async () => {
    const { styles, problems, hints } = await discoverStyles({ official: [officialDir] });
    expect(problems).toEqual([]);
    expect(hints).toEqual([]);
    expect(styles.get(CLASSIC_STYLE_ID)?.provenance).toBe("official");
    const classic = styles.get(CLASSIC_STYLE_ID)!.style;
    expect(tavoraStyle(classic)).toEqual(CLASSIC_STYLE);
    expect([classic.radius, classic.font]).toEqual([8, "inter"]);
    // The file and the stand-in in code look the same.
    expect({ ...classic, description: null, themes: [] }).toEqual({ ...FALLBACK_STYLE, description: null, themes: [] });
    for (const { style } of styles.values()) {
      for (const [part, look] of Object.entries(style.looks)) expect(STYLE_LOOKS[part as keyof typeof STYLE_LOOKS] as readonly string[]).toContain(look);
    }
  });

  it("are shipped with the installer", async () => {
    const pkg = JSON.parse(await readFile(path.join(repo, "apps/desktop/package.json"), "utf8")) as {
      build: { extraResources: { from: string; to: string; filter: string[] }[] };
    };
    expect(pkg.build.extraResources).toContainEqual({ from: "../../styles", to: "official-styles", filter: [`*/${STYLE_MANIFEST}`] });
  });

  it("are found in a packaged app where index.ts looks for them", async () => {
    const index = await readFile(path.join(repo, "apps/desktop/src/main/index.ts"), "utf8");
    expect(index).toContain('path.join(process.resourcesPath, "official-styles")');
    expect(index).toContain('path.join(repoRoot, "styles")');
  });

  it("keep the shared Classic id the SDK's", () => {
    expect(CLASSIC_STYLE_ID).toBe(CLASSIC_STYLE.id);
  });
});

describe("discoverStyles", () => {
  it("has Classic even without any style files", async () => {
    const { styles, problems } = await discoverStyles({ official: [path.join(tmpdir(), "tavora-no-such-styles")] });
    expect([...styles.keys()]).toEqual([CLASSIC_STYLE_ID]);
    expect(styles.get(CLASSIC_STYLE_ID)?.style).toBe(FALLBACK_STYLE);
    expect(problems).toEqual([]);
  });

  it("reports a broken style with its folder and keeps the others", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tavora-styles-"));
    await styleFolder(root, "a-good", manifest({ id: "tavora.good" }));
    await styleFolder(root, "b-broken", "{ nope");
    await styleFolder(root, "c-bad", manifest({ id: "tavora.bad", looks: { ...manifest().looks, tabs: "tube" } }));
    await styleFolder(root, "d-big", manifest({ id: "tavora.big", textSize: 1 }));
    await styleFolder(root, "e-clamped", manifest({ id: "tavora.clamped", radius: 30 }));
    const { styles, problems, hints } = await discoverStyles({ official: [root] });
    expect([...styles.keys()].sort()).toEqual(["tavora.clamped", CLASSIC_STYLE_ID, "tavora.good"].sort());
    expect(problems.map((problem) => problem.folder)).toEqual(["b-broken", "c-bad", "d-big"]);
    expect(problems[0]!.message).toBe(`${STYLE_MANIFEST} is not valid JSON`);
    expect(hints).toEqual([{ folder: "e-clamped", message: "radius 30 is outside 0 to 16 or not a whole number, so 16 is used" }]);
  });

  it("keeps Tavora's ids for its own styles, and the first of two with one id", async () => {
    const official = await mkdtemp(path.join(tmpdir(), "tavora-official-styles-"));
    const local = await mkdtemp(path.join(tmpdir(), "tavora-local-styles-"));
    await styleFolder(official, "chunky", manifest({ id: "tavora.chunky", name: "Official" }));
    await styleFolder(local, "chunky", manifest({ id: "tavora.chunky", name: "Local" }));
    await styleFolder(local, "mine", manifest({ id: "local.mine" }));
    await styleFolder(local, "copy", manifest({ id: "local.mine", name: "Copy" }));
    const { styles, problems } = await discoverStyles({ official: [official], local: [local] });
    expect(styles.get("tavora.chunky")?.style.name).toBe("Official");
    expect(styles.get("local.mine")?.provenance).toBe("local");
    expect(problems.map((problem) => problem.message).sort()).toEqual(['Another style already uses the id local.mine', 'Ids starting with "tavora." are reserved for Tavora\'s own styles']);
  });
});

describe("resolveStyle", () => {
  it("gives the saved style, else Classic", async () => {
    const { styles } = await discoverStyles({ official: [officialDir] });
    expect(resolveStyle(styles, "tavora.hardware").id).toBe("tavora.hardware");
    expect(resolveStyle(styles, "community.gone").id).toBe(CLASSIC_STYLE_ID);
    expect(resolveStyle(styles, undefined).id).toBe(CLASSIC_STYLE_ID);
    expect(resolveStyle(new Map(), "tavora.hardware")).toBe(FALLBACK_STYLE);
  });
});

// ── Resolving ────────────────────────────────────────────────────────────

const variation = (id: string, mode: "dark" | "light", contrast: "normal" | "high" = "normal", background = mode === "dark" ? "#101010" : "#fafafa"): ThemeVariation => ({
  id,
  name: id,
  mode,
  contrast,
  radius: 6,
  colors: { ...THEME.tokens, background },
});
const themeOf = (...variations: ThemeVariation[]): ThemePackage => ({ id: "community.test", name: "Test", description: null, author: null, version: "1.0.0", minTavora: null, variations });
const style = (overrides: Partial<StylePackage> = {}): StylePackage => ({ ...FALLBACK_STYLE, ...overrides });
const HARDWARE = style({ id: "tavora.hardware", name: "Hardware", radius: 4, font: "saira", looks: { ...CLASSIC_STYLE.looks, content: "inset" }, values: { ...CLASSIC_STYLE.values, borderWidth: 1 } });
const GLASS = style({ id: "tavora.glass", name: "Glass", radius: 12, looks: { ...CLASSIC_STYLE.looks, surface: "glass" } });

describe("resolveRadius and resolveFontId", () => {
  it("Classic keeps the theme variation's radius; other styles have their own; the user's wins", () => {
    expect(resolveRadius(null, FALLBACK_STYLE, 6)).toBe(6);
    expect(resolveRadius(null, HARDWARE, 6)).toBe(4);
    expect(resolveRadius(10, FALLBACK_STYLE, 6)).toBe(10);
    expect(resolveRadius(0, HARDWARE, 6)).toBe(0);
    expect(resolveRadius(undefined, GLASS, 6)).toBe(12);
  });

  it("the font is the user's, else the style's", () => {
    expect(resolveFontId(undefined, FALLBACK_STYLE)).toBe("inter");
    expect(resolveFontId(null, HARDWARE)).toBe("saira");
    expect(resolveFontId("inter", HARDWARE)).toBe("inter");
    // A font from a newer Tavora counts as no pick: the style's font, not Inter.
    expect(resolveFontId("gone-font", HARDWARE)).toBe("saira");
  });

  it("a radius override is a whole number from 0 to 16", () => {
    expect([0, 3, 12, 16].every(isStyleRadius)).toBe(true);
    expect([-1, 17, 6.5, "8", null].some(isStyleRadius)).toBe(false);
  });
});

describe("appearanceThemes", () => {
  const dark = variation("dark", "dark");
  const light = variation("light", "light");
  const settings = { radius: null, toasts: "bottom-center" as const };

  it("in Classic, with no settings of the user's, is today's theme plus the Classic style", () => {
    const { host, panel } = appearanceThemes({ theme: themeOf(dark, light), variation: dark }, FALLBACK_STYLE, settings);
    expect(host).toEqual({ ...moduleTheme(dark), style: CLASSIC_STYLE });
    expect(host.radius).toBe(6);
    expect(host.font).toEqual({ id: "inter", family: '"Inter Variable", system-ui, sans-serif' });
    expect(panel).toBe(host);
  });

  it("carries another style's radius and font, and the user's own over them", () => {
    const choice = { theme: themeOf(dark, light), variation: dark };
    const plain = appearanceThemes(choice, HARDWARE, settings).host;
    expect([plain.radius, plain.font?.id, plain.style?.id]).toEqual([4, "saira", "tavora.hardware"]);
    const own = appearanceThemes(choice, HARDWARE, { ...settings, radius: 0, font: "inter" }).host;
    expect([own.radius, own.font?.id]).toEqual([0, "inter"]);
    const classic = appearanceThemes(choice, FALLBACK_STYLE, { ...settings, radius: 14, font: "rubik" }).host;
    expect([classic.radius, classic.font?.id]).toEqual([14, "rubik"]);
  });

  it("gives module panels the theme's dark colours in an inset style over a light variation", () => {
    const { host, panel } = appearanceThemes({ theme: themeOf(dark, light), variation: light }, HARDWARE, settings);
    expect(host.mode).toBe("light");
    expect(host.tokens.background).toBe("#fafafa");
    expect(panel.mode).toBe("dark");
    expect(panel.tokens.background).toBe("#101010");
    expect(panel.colors.background).toBe("#101010");
    // Only the colours change: the style, corner, font and toasts stay the host's.
    expect({ ...panel, mode: host.mode, colors: host.colors, tokens: host.tokens }).toEqual(host);
  });

  it("sends how tabs that don't fit are reached, the list unless the user picked arrows", () => {
    const choice = { theme: themeOf(dark, light), variation: light };
    expect(appearanceThemes(choice, FALLBACK_STYLE, settings).host.tabOverflow).toBe("list");
    const { host, panel } = appearanceThemes(choice, HARDWARE, { ...settings, tabOverflow: "arrows" });
    // Module panels get it too, also in an inset style's own colours.
    expect([host.tabOverflow, panel.tabOverflow]).toEqual(["arrows", "arrows"]);
    expect(panel).not.toBe(host);
  });
});

describe("insetPanelTheme", () => {
  const dark = variation("dark", "dark", "normal", "#101010");
  const darkHigh = variation("dark-high", "dark", "high", "#000000");
  const light = variation("light", "light");
  const lightHigh = variation("light-high", "light", "high");
  const host = (v: ThemeVariation, s: StylePackage = HARDWARE) => moduleTheme(v, "bottom-center", undefined, tavoraStyle(s));

  it("takes the dark variation of the same contrast, else the first dark one", () => {
    const theme = themeOf(light, dark, lightHigh, darkHigh);
    expect(insetPanelTheme(theme, lightHigh, host(lightHigh)).tokens.background).toBe("#000000");
    expect(insetPanelTheme(theme, light, host(light)).tokens.background).toBe("#101010");
    expect(insetPanelTheme(themeOf(lightHigh, dark), lightHigh, host(lightHigh)).tokens.background).toBe("#101010");
  });

  it("changes nothing without a dark variation, over a dark one, or in a style that isn't inset", () => {
    const onlyLight = host(light);
    expect(insetPanelTheme(themeOf(light), light, onlyLight)).toBe(onlyLight);
    const overDark = host(dark);
    expect(insetPanelTheme(themeOf(light, dark), dark, overDark)).toBe(overDark);
    const plain = host(light, FALLBACK_STYLE);
    expect(insetPanelTheme(themeOf(light, dark), light, plain)).toBe(plain);
    const older = moduleTheme(light);
    expect(insetPanelTheme(themeOf(light, dark), light, older)).toBe(older);
  });
});

describe("glass and every theme", () => {
  const themeDir = path.join(repo, "themes");

  it("mixes like CSS color-mix in srgb", () => {
    expect(mixed("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(mixed("#ff0000", "#0000ff", 1)).toBe("#ff0000");
    expect(mixed("#ff0000", "#0000ff", 0)).toBe("#0000ff");
  });

  it("finds an opacity for every theme of Tavora's at which all text on glass keeps its contrast", async () => {
    const { styles } = await discoverStyles({ official: [officialDir] });
    const glass = styles.get("tavora.glass")!.style;
    const { themes } = await discoverThemes({ official: [themeDir] });
    for (const { theme } of themes.values()) {
      for (const item of theme.variations) {
        const opacity = glassOpacity(item, glass.values.glassOpacity);
        expect(opacity, `${theme.id} ${item.id}`).toBeGreaterThanOrEqual(glass.values.glassOpacity);
        expect(glassProblems(item, opacity), `${theme.id} ${item.id}`).toEqual([]);
      }
    }
  });

  it("keeps the style's own opacity with the style's own themes", async () => {
    const { styles } = await discoverStyles({ official: [officialDir] });
    const { themes } = await discoverThemes({ official: [themeDir] });
    for (const { style: item } of styles.values()) {
      if (item.looks.surface !== "glass") continue;
      for (const id of item.themes) {
        for (const v of themes.get(id)!.theme.variations) expect(glassOpacity(v, item.values.glassOpacity), `${id} ${v.id}`).toBe(item.values.glassOpacity);
      }
    }
  });

  it("raises the opacity only as far as needed, and never past solid", () => {
    // Pale text on a pale card: fine solid, not with a dark field showing through.
    const pale = variation("pale", "light");
    const colors = { ...pale.colors, background: "#202020", card: "#ffffff", rail: "#ffffff", popover: "#ffffff", primary: "#202020", info: "#202020", success: "#202020", warning: "#202020" };
    for (const token of ["foreground", "card-foreground", "popover-foreground", "muted-foreground", "destructive", "ring"] as const) colors[token] = "#6a6a6a";
    const item = { colors, contrast: "normal" as const };
    expect(glassProblems(item, 0.55).length).toBeGreaterThan(0);
    const opacity = glassOpacity(item, 0.55);
    expect(opacity).toBeGreaterThan(0.55);
    expect(opacity).toBeLessThanOrEqual(1);
    expect(glassProblems(item, opacity)).toEqual([]);
    expect(glassProblems(item, opacity - 0.01).length).toBeGreaterThan(0);
  });

  it("sends the raised opacity with a glass style, and the style's own otherwise", async () => {
    const { themes } = await discoverThemes({ official: [themeDir] });
    const garnet = themes.get("tavora.garnet")!.theme;
    const dark = garnet.variations.find((item) => item.mode === "dark")!;
    const glass = style({ id: "tavora.glass", looks: { ...CLASSIC_STYLE.looks, surface: "glass" }, values: { ...CLASSIC_STYLE.values, glassOpacity: 0.72 } });
    const sent = appearanceThemes({ theme: garnet, variation: dark }, glass, { radius: null, toasts: "bottom-center" }).host.style!;
    expect(sent.values.glassOpacity).toBe(glassOpacity(dark, 0.72));
    expect(sent.values.glassOpacity).toBeGreaterThan(0.72);
    // A style without glass sends its value as it is: nothing is drawn see-through.
    const flat = appearanceThemes({ theme: garnet, variation: dark }, style({ values: { ...CLASSIC_STYLE.values, glassOpacity: 0.6 } }), { radius: null, toasts: "bottom-center" }).host.style!;
    expect(flat.values.glassOpacity).toBe(0.6);
  });
});

describe("a starter for the user's own style", () => {
  it("copies the style in use under a local id and a name of its own, and passes validation", async () => {
    const { styles } = await discoverStyles({ official: [officialDir] });
    const hardware = styles.get("tavora.hardware")!.style;
    const copy = starterStyle(hardware, 1);
    expect([copy.id, copy.name, copy.author]).toEqual(["local.my-hardware", "My Hardware", "You"]);
    expect({ looks: copy.looks, values: copy.values, radius: copy.radius, font: copy.font, themes: copy.themes }).toEqual({
      looks: hardware.looks,
      values: hardware.values,
      radius: hardware.radius,
      font: hardware.font,
      themes: hardware.themes,
    });
    const written = validateStyle(JSON.parse(styleManifest(copy)));
    expect(written.ok && written.style).toEqual(copy);
    expect(written.ok && written.hints).toEqual([]);
    expect([starterStyle(hardware, 2).id, starterStyle(hardware, 2).name]).toEqual(["local.my-hardware-2", "My Hardware 2"]);
    // A copy of a copy doesn't stack "my-".
    expect(starterStyle(copy, 1).id).toBe("local.my-hardware");
    expect(starterStyle(FALLBACK_STYLE, 1).id).toBe("local.my-classic");
  });

  it("keeps a long name within the limit, number included", () => {
    const long = style({ id: "community.long", name: "A".repeat(40) });
    const copy = starterStyle(long, 12);
    expect(copy.name.length).toBeLessThanOrEqual(40);
    expect(copy.name.endsWith(" 12")).toBe(true);
    expect(validateStyle(JSON.parse(styleManifest(copy))).ok).toBe(true);
  });

  it("loads from the user's styles folder as a local style", async () => {
    const local = await mkdtemp(path.join(tmpdir(), "tavora-own-styles-"));
    const copy = starterStyle(FALLBACK_STYLE, 1);
    await styleFolder(local, "my-classic", styleManifest(copy));
    await writeFile(path.join(local, "my-classic", "README.txt"), STYLE_README);
    const { styles, problems } = await discoverStyles({ official: [officialDir], local: [local] });
    expect(problems).toEqual([]);
    expect(styles.get("local.my-classic")).toEqual({ style: copy, provenance: "local" });
  });
});
