// Theme packages: data that recolours Tavora. A package is a folder with a
// tavora.theme.json that names one to four variations, each a full set of
// the semantic colour tokens plus a corner radius. Nothing else is read from
// the folder, so a theme can never run code, load CSS or reach Electron.
// Every variation is checked against the style guide's contrast rules before
// it can be picked, and the Tavora default is always there to go back to.
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isModuleId } from "@tavora/module-schema";
import { THEME_TOKENS, type TavoraTheme, type ThemeToken, type ToastPosition } from "@tavora/sdk/protocol";
import { THEME } from "./games";
import { OFFICIAL_PREFIX, type Provenance } from "./registry";

export const THEME_MANIFEST = "tavora.theme.json";

/** The theme Tavora starts with and Reset goes back to. */
export const DEFAULT_THEME = { id: "tavora.default", variation: "dark" } as const;

export const THEME_LIMITS = {
  /** A manifest is a few kilobytes; anything far bigger is not a theme. */
  manifestBytes: 64 * 1024,
  variations: 4,
  name: 40,
  variationName: 24,
  description: 200,
  author: 60,
  /** Corner radius in px, the range the style guide allows. */
  radius: { min: 4, max: 12 },
} as const;

/** Minimum contrast ratios from the style guide; high-contrast variations need AAA for text. */
const TEXT_AA = 4.5;
const TEXT_AAA = 7;
const NON_TEXT = 3;

export interface ThemeVariation {
  id: string;
  name: string;
  mode: "dark" | "light";
  /** "high" variations are held to AAA contrast for text. */
  contrast: "normal" | "high";
  radius: number;
  colors: Record<ThemeToken, string>;
}

export interface ThemePackage {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  version: string;
  variations: ThemeVariation[];
}

export interface InstalledTheme {
  theme: ThemePackage;
  provenance: Provenance;
}

/** A theme folder that could not be used, and why, so theme authors can fix it. */
export interface ThemeProblem {
  folder: string;
  message: string;
}

export interface ThemeChoice {
  id: string;
  variation: string;
}

const VARIATION_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const HEX = /^#[0-9a-f]{6}$/i;

export function isVariationId(value: unknown): value is string {
  return typeof value === "string" && VARIATION_ID.test(value);
}

// ── Contrast ─────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio of two #rrggbb colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** A #rrggbb colour seen through a black veil of the given opacity, as a dialog backdrop draws it. */
export function veiled(hex: string, opacity: number): string {
  const channel = (offset: number) => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * (1 - opacity));
  return `#${[1, 3, 5].map((offset) => channel(offset).toString(16).padStart(2, "0")).join("")}`;
}

type Pair = [fore: ThemeToken, back: ThemeToken, kind: "text" | "non-text"];

/**
 * The colour pairs the host UI actually draws, from the style guide. Text on
 * every surface it appears on, plus input outlines (against the window, as in the style guide) and the focus ring, which only
 * need to be told apart from what is around them.
 */
const PAIRS: Pair[] = [
  ["foreground", "background", "text"],
  ["card-foreground", "card", "text"],
  ["popover-foreground", "popover", "text"],
  ["secondary-foreground", "secondary", "text"],
  ["accent-foreground", "accent", "text"],
  ["foreground", "rail", "text"],
  ["muted-foreground", "background", "text"],
  ["muted-foreground", "card", "text"],
  ["muted-foreground", "muted", "text"],
  ["primary-foreground", "primary", "text"],
  ["primary-foreground", "primary-hover", "text"],
  ["primary", "background", "text"],
  ["primary", "card", "text"],
  ["destructive", "background", "text"],
  ["destructive", "card", "text"],
  ["destructive", "secondary", "text"],
  ["success", "background", "text"],
  ["warning", "background", "text"],
  ["info", "background", "text"],
  ["input", "background", "non-text"],
  ["ring", "background", "non-text"],
  ["ring", "card", "non-text"],
];

/** Every pair below the ratio it needs, as sentences a theme author can act on. */
export function contrastProblems(variation: Pick<ThemeVariation, "colors" | "contrast">): string[] {
  const problems: string[] = [];
  for (const [fore, back, kind] of PAIRS) {
    const needed = kind === "non-text" ? NON_TEXT : variation.contrast === "high" ? TEXT_AAA : TEXT_AA;
    const ratio = contrast(variation.colors[fore], variation.colors[back]);
    if (ratio < needed) problems.push(`${fore} on ${back} has a contrast of ${ratio.toFixed(2)}:1 and needs ${needed}:1`);
  }
  return problems;
}

// ── Validation ───────────────────────────────────────────────────────────

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const optionalText = (value: unknown, max: number) => value === undefined || (typeof value === "string" && value.trim().length > 0 && value.length <= max);
const name = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;

function unknownKeys(record: Fields, allowed: string[]): string[] {
  return Object.keys(record).filter((key) => !allowed.includes(key));
}

function parseVariation(raw: unknown, where: string): ThemeVariation | string {
  if (!isRecord(raw)) return `${where} is not an object`;
  const extra = unknownKeys(raw, ["id", "name", "mode", "contrast", "radius", "colors"]);
  if (extra.length) return `${where} has unknown fields: ${extra.join(", ")}`;
  if (!isVariationId(raw.id)) return `${where} needs an id of lowercase letters, digits and dashes`;
  if (!name(raw.name, THEME_LIMITS.variationName)) return `${where} needs a name of at most ${THEME_LIMITS.variationName} characters`;
  if (raw.mode !== "dark" && raw.mode !== "light") return `${where} needs a mode of "dark" or "light"`;
  if (raw.contrast !== undefined && raw.contrast !== "normal" && raw.contrast !== "high") return `${where} has a contrast other than "normal" or "high"`;
  const radius = raw.radius ?? THEME.radius;
  const { min, max } = THEME_LIMITS.radius;
  if (!Number.isInteger(radius) || (radius as number) < min || (radius as number) > max) return `${where} needs a radius from ${min} to ${max}`;
  if (!isRecord(raw.colors)) return `${where} needs colors`;
  const extraColors = unknownKeys(raw.colors, [...THEME_TOKENS]);
  if (extraColors.length) return `${where} has unknown colors: ${extraColors.join(", ")}`;
  const colors = {} as Record<ThemeToken, string>;
  for (const token of THEME_TOKENS) {
    const value = raw.colors[token];
    if (typeof value !== "string" || !HEX.test(value)) return `${where} needs ${token} as a #rrggbb colour`;
    colors[token] = value.toLowerCase();
  }
  const variation: ThemeVariation = {
    id: raw.id,
    name: raw.name.trim(),
    mode: raw.mode,
    contrast: raw.contrast ?? "normal",
    radius: radius as number,
    colors,
  };
  const problems = contrastProblems(variation);
  if (problems.length) return `${where}: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`;
  return variation;
}

/** Checks a parsed tavora.theme.json. Strict: unknown fields are refused, so the format can grow safely. */
export function validateTheme(raw: unknown): { ok: true; theme: ThemePackage } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isRecord(raw)) return fail("The manifest is not a JSON object");
  const extra = unknownKeys(raw, ["$schema", "id", "name", "description", "author", "version", "variations"]);
  if (extra.length) return fail(`Unknown fields: ${extra.join(", ")}`);
  if (!isModuleId(raw.id)) return fail('The id must look like "publisher.name", in lowercase');
  if (!name(raw.name, THEME_LIMITS.name)) return fail(`The name must be 1 to ${THEME_LIMITS.name} characters`);
  if (!optionalText(raw.description, THEME_LIMITS.description)) return fail(`The description must be at most ${THEME_LIMITS.description} characters`);
  if (!optionalText(raw.author, THEME_LIMITS.author)) return fail(`The author must be at most ${THEME_LIMITS.author} characters`);
  if (typeof raw.version !== "string" || !SEMVER.test(raw.version)) return fail("The version must be major.minor.patch, like 1.0.0");
  if (!Array.isArray(raw.variations) || raw.variations.length < 1 || raw.variations.length > THEME_LIMITS.variations) {
    return fail(`A theme needs 1 to ${THEME_LIMITS.variations} variations`);
  }
  const variations: ThemeVariation[] = [];
  for (const [index, item] of raw.variations.entries()) {
    const id = isRecord(item) && typeof item.id === "string" ? `"${item.id}"` : `${index + 1}`;
    const variation = parseVariation(item, `Variation ${id}`);
    if (typeof variation === "string") return fail(variation);
    if (variations.some((other) => other.id === variation.id)) return fail(`Two variations are called "${variation.id}"`);
    variations.push(variation);
  }
  return {
    ok: true,
    theme: {
      id: raw.id,
      name: raw.name.trim(),
      description: typeof raw.description === "string" ? raw.description.trim() : null,
      author: typeof raw.author === "string" ? raw.author.trim() : null,
      version: raw.version,
      variations,
    },
  };
}

// ── Discovery ────────────────────────────────────────────────────────────

/**
 * The Tavora default as written in code. It stands in when the official
 * theme files are missing, so there is always a theme to fall back to.
 */
export const FALLBACK_THEME: ThemePackage = {
  id: DEFAULT_THEME.id,
  name: "Tavora",
  description: "Warm charcoal and firelight gold.",
  author: "Tavora",
  version: "1.0.0",
  variations: [{ id: DEFAULT_THEME.variation, name: "Dark", mode: "dark", contrast: "normal", radius: THEME.radius, colors: { ...THEME.tokens } }],
};

export interface ThemeSources {
  /** Themes that ship with Tavora. Searched first, so they win over a local copy. */
  official?: string[];
  /** The user's own themes folder, and any extra folders in development. */
  local?: string[];
}

async function readManifest(dir: string): Promise<unknown> {
  const file = path.join(dir, THEME_MANIFEST);
  const info = await stat(file);
  if (info.size > THEME_LIMITS.manifestBytes) throw new Error(`${THEME_MANIFEST} is larger than 64 KB`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    throw new Error(`${THEME_MANIFEST} is not valid JSON`);
  }
}

/**
 * Finds theme packages in each directory: the directory itself if it has a
 * manifest, otherwise its direct children. A broken theme never stops the
 * others; it is reported with its folder instead. Provenance comes from
 * where a theme was found, so a local theme cannot pass itself off as
 * official, and the default is always present.
 */
export async function discoverThemes({ official = [], local = [] }: ThemeSources): Promise<{
  themes: Map<string, InstalledTheme>;
  problems: ThemeProblem[];
}> {
  const themes = new Map<string, InstalledTheme>();
  const problems: ThemeProblem[] = [];
  const dirs = [
    ...official.map((dir) => ({ dir, provenance: "official" as const })),
    ...local.map((dir) => ({ dir, provenance: "local" as const })),
  ];
  for (const { dir, provenance } of dirs) {
    for (const candidate of await candidates(dir)) {
      try {
        const result = validateTheme(await readManifest(candidate));
        if (!result.ok) throw new Error(result.error);
        const { theme } = result;
        if (provenance !== "official" && theme.id.startsWith(OFFICIAL_PREFIX)) {
          throw new Error(`Ids starting with "${OFFICIAL_PREFIX}" are reserved for Tavora's own themes`);
        }
        if (themes.has(theme.id)) throw new Error(`Another theme already uses the id ${theme.id}`);
        themes.set(theme.id, { theme, provenance });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (provenance === "official") console.warn(`[tavora] official theme ${candidate} skipped: ${message}`);
        problems.push({ folder: path.basename(candidate), message });
      }
    }
  }
  if (!themes.has(DEFAULT_THEME.id)) themes.set(DEFAULT_THEME.id, { theme: FALLBACK_THEME, provenance: "official" });
  return { themes, problems };
}

async function candidates(dir: string): Promise<string[]> {
  let root: string;
  try {
    root = await realpath(dir);
  } catch {
    return []; // A themes folder that does not exist yet has no themes.
  }
  const hasManifest = async (folder: string) => {
    try {
      return (await stat(path.join(folder, THEME_MANIFEST))).isFile();
    } catch {
      return false;
    }
  };
  if (await hasManifest(root)) return [root];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && (await hasManifest(path.join(root, entry.name)))) found.push(path.join(root, entry.name));
  }
  return found;
}

// ── Using a theme ────────────────────────────────────────────────────────

/**
 * The variation of a theme that suits the system's light or dark setting: the saved one when it already
 * suits, else the first of that mode (normal contrast before high), else the saved one (a theme that
 * only comes in the other mode keeps its look).
 */
export function variationForMode(theme: ThemePackage, saved: string, mode: "dark" | "light"): ThemeVariation {
  const savedVariation = theme.variations.find((item) => item.id === saved);
  if (savedVariation?.mode === mode) return savedVariation;
  const suiting = theme.variations.filter((item) => item.mode === mode);
  return suiting.find((item) => item.contrast === "normal") ?? suiting[0] ?? savedVariation ?? theme.variations[0]!;
}

/**
 * The theme and variation to show for a saved choice; anything missing falls back to the default. With a
 * `systemMode` (the user follows the system) the variation is the one that suits it.
 */
export function resolveTheme(
  themes: Map<string, InstalledTheme>,
  choice: ThemeChoice,
  systemMode?: "dark" | "light",
): { theme: ThemePackage; variation: ThemeVariation } {
  const installed = themes.get(choice.id);
  if (installed) {
    const variation = systemMode
      ? variationForMode(installed.theme, choice.variation, systemMode)
      : (installed.theme.variations.find((item) => item.id === choice.variation) ?? installed.theme.variations[0]!);
    return { theme: installed.theme, variation };
  }
  const fallback = themes.get(DEFAULT_THEME.id)?.theme ?? FALLBACK_THEME;
  const saved = fallback.variations.find((item) => item.id === DEFAULT_THEME.variation) ?? fallback.variations[0]!;
  return { theme: fallback, variation: systemMode ? variationForMode(fallback, saved.id, systemMode) : saved };
}

/** What modules get through ui.getTheme and the ui.theme event, with where the user wants toasts. */
export function moduleTheme(variation: ThemeVariation, toasts: ToastPosition = "bottom-center"): TavoraTheme {
  const { colors } = variation;
  return {
    mode: variation.mode,
    colors: { background: colors.background, surface: colors.card, text: colors.foreground, textMuted: colors["muted-foreground"], accent: colors.primary },
    tokens: { ...colors },
    radius: variation.radius,
    toasts,
  };
}

// ── A starter for the user's own theme ─────────────────────────────────

export const STARTER_README = `Your own Tavora theme
=====================

This folder is a theme. Tavora reads only tavora.theme.json in it.

1. Change the colours in tavora.theme.json. Every colour is #rrggbb.
   "dark" and "light" are the two variations users switch between.
2. In Tavora, open Settings > Appearance and press Reload.
3. Pick your theme. If something is wrong, Appearance says what,
   for example a colour pair without enough contrast.

Give it your own "id" and "name" before you share it. Ids starting with
"tavora." are reserved. The full format is at
https://docs.mytavora.app/reference/theme
`;

/**
 * A theme to copy and change: the Tavora default's variations under a new id
 * and name. Built from the installed default, so it always passes validation.
 */
export function starterTheme(themes: Map<string, InstalledTheme>, suffix: number): ThemePackage {
  const base = themes.get(DEFAULT_THEME.id)?.theme ?? FALLBACK_THEME;
  const tag = suffix > 1 ? ` ${suffix}` : "";
  return {
    id: `local.my-theme${suffix > 1 ? `-${suffix}` : ""}`,
    name: `My theme${tag}`,
    description: "A copy of the Tavora theme to make your own.",
    author: "You",
    version: "1.0.0",
    variations: base.variations.map((variation) => ({ ...variation, colors: { ...variation.colors } })),
  };
}

/** The manifest as written to disk: defaults that a user would not need are left out. */
export function themeManifest(theme: ThemePackage): string {
  const variations = theme.variations.map(({ contrast, ...rest }) => (contrast === "high" ? { ...rest, contrast } : rest));
  return `${JSON.stringify({ id: theme.id, name: theme.name, description: theme.description, author: theme.author, version: theme.version, variations }, null, 2)}\n`;
}
