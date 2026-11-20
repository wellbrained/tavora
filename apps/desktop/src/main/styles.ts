// Style packages: data that changes Tavora's design language (docs/features/style-system.md, ADR 0003). A package is a
// folder with a tavora.style.json that picks one look per kit part and sets a few sizes, a corner radius and a bundled
// font. Nothing else is read from the folder, so a style can never run code or load CSS. Colours stay in themes.
// Tavora's own styles ship with the app; the user's own load from the styles folder of their data folder, like themes.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isModuleId } from "@tavora/module-schema";
import { CLASSIC_STYLE, LATER_STYLE_PARTS, STYLE_LOOKS, STYLE_PARTS, STYLE_RANGES, type StyleLooks, type StyleValues, type TavoraStyle, type TavoraTheme, type ToastPosition } from "@tavora/sdk/protocol";
import { candidates, glassOpacity, insetPanelTheme, moduleTheme, withRadius, type ThemePackage, type ThemeVariation } from "./themes";
import { OFFICIAL_PREFIX, type Provenance } from "./registry";
import { CLASSIC_STYLE_ID, resolveFontId, resolveRadius, STYLE_RADIUS } from "../shared/styles";
import { DEFAULT_FONT_ID, themeFont, UI_FONTS, type UiFontId } from "../shared/ui-fonts";

export const STYLE_MANIFEST = "tavora.style.json";

export const STYLE_LIMITS = {
  /** A manifest is well under a kilobyte; anything far bigger is not a style. */
  manifestBytes: 16 * 1024,
  /** Longest id; data-style on the page takes no longer one. */
  id: 64,
  name: 40,
  description: 200,
  author: 60,
  /** Theme ids a style lists first. */
  themes: 8,
} as const;

export interface StylePackage {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  version: string;
  looks: StyleLooks;
  values: StyleValues;
  /** The style's corner radius in px (STYLE_RADIUS). Classic shows the theme variation's instead (shared/styles.ts). */
  radius: number;
  /** The style's font, one Tavora ships (shared/ui-fonts.ts). */
  font: UiFontId;
  /** Theme ids shown first for this style; any theme still works with it. */
  themes: string[];
}

export interface InstalledStyle {
  style: StylePackage;
  provenance: Provenance;
}

/** A style folder that could not be used, and why. */
export interface StyleProblem {
  folder: string;
  message: string;
}

/** A soft note for style authors: a number was outside its range and was kept in it. The style works. */
export interface StyleHint {
  folder: string;
  message: string;
}

export type StyleCheck = { ok: true; style: StylePackage; hints: string[] } | { ok: false; error: string };

type Fields = Record<string, unknown>;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optionalText = (value: unknown, max: number) => value === undefined || text(value, max);
const unknownKeys = (record: Fields, allowed: readonly string[]) => Object.keys(record).filter((key) => !allowed.includes(key));
const VALUE_KEYS = Object.keys(STYLE_RANGES) as (keyof StyleValues)[];
const FONT_IDS: readonly string[] = UI_FONTS.map((font) => font.id);

/** `value` kept in [min, max]; `round` for whole numbers. Says so in `hints` when it had to change it. */
function clamp(value: number, min: number, max: number, where: string, hints: string[], round = false): number {
  const kept = Math.min(max, Math.max(min, round ? Math.round(value) : value));
  if (kept !== value) hints.push(`${where} ${value} is outside ${min} to ${max}${round ? " or not a whole number" : ""}, so ${kept} is used`);
  return kept;
}

/**
 * Checks a parsed tavora.style.json. Strict like themes: unknown fields, parts and looks are refused, so the format can
 * grow safely. Numbers out of their range are kept in it, with a hint.
 */
export function validateStyle(raw: unknown): StyleCheck {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isRecord(raw)) return fail("The manifest is not a JSON object");
  const extra = unknownKeys(raw, ["id", "name", "description", "author", "version", "looks", "values", "radius", "font", "themes"]);
  if (extra.length) return fail(`Unknown fields: ${extra.join(", ")}`);
  // At most 64 characters: the page's data-style takes no longer word (the SDK's styleMarks), and the page and main
  // must agree on which style is in use.
  if (!isModuleId(raw.id) || raw.id.length > STYLE_LIMITS.id) return fail(`The id must look like "publisher.name", in lowercase, at most ${STYLE_LIMITS.id} characters`);
  if (!text(raw.name, STYLE_LIMITS.name)) return fail(`The name must be 1 to ${STYLE_LIMITS.name} characters`);
  if (!optionalText(raw.description, STYLE_LIMITS.description)) return fail(`The description must be at most ${STYLE_LIMITS.description} characters`);
  if (!optionalText(raw.author, STYLE_LIMITS.author)) return fail(`The author must be at most ${STYLE_LIMITS.author} characters`);
  if (typeof raw.version !== "string" || !SEMVER.test(raw.version)) return fail("The version must be major.minor.patch, like 1.0.0");

  if (!isRecord(raw.looks)) return fail("looks must be an object with a look for each part");
  const extraParts = unknownKeys(raw.looks, STYLE_PARTS);
  if (extraParts.length) return fail(`Unknown parts in looks: ${extraParts.join(", ")}`);
  const looks = {} as Record<string, string>;
  for (const part of STYLE_PARTS) {
    const look = raw.looks[part];
    const allowed: readonly string[] = STYLE_LOOKS[part];
    // A part added later may be left out (a style written before it): it gets the first look.
    if (look === undefined && LATER_STYLE_PARTS.includes(part)) {
      looks[part] = allowed[0]!;
      continue;
    }
    if (look === undefined) return fail(`looks needs ${part}: one of ${allowed.join(", ")}`);
    if (typeof look !== "string" || !allowed.includes(look)) return fail(`looks.${part} must be one of ${allowed.join(", ")}`);
    looks[part] = look;
  }

  const hints: string[] = [];
  if (!isRecord(raw.values)) return fail(`values must be an object with ${VALUE_KEYS.join(", ")}`);
  const extraValues = unknownKeys(raw.values, VALUE_KEYS);
  if (extraValues.length) return fail(`Unknown values: ${extraValues.join(", ")}`);
  const values = {} as StyleValues;
  for (const key of VALUE_KEYS) {
    const value = raw.values[key];
    const { min, max } = STYLE_RANGES[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return fail(`values.${key} must be a number from ${min} to ${max}`);
    values[key] = clamp(value, min, max, `values.${key}`, hints);
  }

  if (typeof raw.radius !== "number" || !Number.isFinite(raw.radius)) return fail(`radius must be a number from ${STYLE_RADIUS.min} to ${STYLE_RADIUS.max}`);
  const radius = clamp(raw.radius, STYLE_RADIUS.min, STYLE_RADIUS.max, "radius", hints, true);
  if (typeof raw.font !== "string" || !FONT_IDS.includes(raw.font)) return fail(`font must be one of Tavora's fonts: ${FONT_IDS.join(", ")}`);

  let themes: string[] = [];
  if (raw.themes !== undefined) {
    if (!Array.isArray(raw.themes) || raw.themes.length > STYLE_LIMITS.themes || !raw.themes.every(isModuleId)) {
      return fail(`themes must be a list of up to ${STYLE_LIMITS.themes} theme ids`);
    }
    themes = [...new Set(raw.themes as string[])];
  }

  return {
    ok: true,
    hints,
    style: {
      id: raw.id,
      name: raw.name.trim(),
      description: typeof raw.description === "string" ? raw.description.trim() : null,
      author: typeof raw.author === "string" ? raw.author.trim() : null,
      version: raw.version,
      looks: looks as StyleLooks,
      values,
      radius,
      font: raw.font as UiFontId,
      themes,
    },
  };
}

/** Classic as written in code. It stands in when the style files are missing, so there is always a style. */
export const FALLBACK_STYLE: StylePackage = {
  id: CLASSIC_STYLE_ID,
  name: CLASSIC_STYLE.name,
  description: "Tavora's own look.",
  author: "Tavora",
  version: "1.0.0",
  looks: { ...CLASSIC_STYLE.looks },
  values: { ...CLASSIC_STYLE.values },
  radius: 8,
  font: DEFAULT_FONT_ID,
  themes: [],
};

export interface StyleSources {
  /** Styles that ship with Tavora. Searched first, so they win over a local copy. */
  official?: string[];
  /** Later: the user's own styles folder. Nothing passes one yet. */
  local?: string[];
}

async function readManifest(dir: string): Promise<unknown> {
  const file = path.join(dir, STYLE_MANIFEST);
  const info = await stat(file);
  if (info.size > STYLE_LIMITS.manifestBytes) throw new Error(`${STYLE_MANIFEST} is larger than 16 KB`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    throw new Error(`${STYLE_MANIFEST} is not valid JSON`);
  }
}

/**
 * Finds style packages in each directory, as themes are found (themes.ts `candidates`). A broken style never stops the
 * others; it is reported with its folder. Provenance comes from where a style was found, so a local one cannot pass
 * itself off as Tavora's, and Classic is always there.
 */
export async function discoverStyles({ official = [], local = [] }: StyleSources): Promise<{
  styles: Map<string, InstalledStyle>;
  problems: StyleProblem[];
  hints: StyleHint[];
}> {
  const styles = new Map<string, InstalledStyle>();
  const problems: StyleProblem[] = [];
  const hints: StyleHint[] = [];
  const dirs = [...official.map((dir) => ({ dir, provenance: "official" as const })), ...local.map((dir) => ({ dir, provenance: "local" as const }))];
  for (const { dir, provenance } of dirs) {
    for (const candidate of await candidates(dir, STYLE_MANIFEST)) {
      const folder = path.basename(candidate);
      try {
        const result = validateStyle(await readManifest(candidate));
        if (!result.ok) throw new Error(result.error);
        const { style } = result;
        if (provenance !== "official" && style.id.startsWith(OFFICIAL_PREFIX)) throw new Error(`Ids starting with "${OFFICIAL_PREFIX}" are reserved for Tavora's own styles`);
        if (styles.has(style.id)) throw new Error(`Another style already uses the id ${style.id}`);
        styles.set(style.id, { style, provenance });
        for (const message of result.hints) {
          if (provenance === "official") console.warn(`[tavora] official style ${candidate}: ${message}`);
          hints.push({ folder, message });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (provenance === "official") console.warn(`[tavora] official style ${candidate} skipped: ${message}`);
        problems.push({ folder, message });
      }
    }
  }
  if (!styles.has(CLASSIC_STYLE_ID)) styles.set(CLASSIC_STYLE_ID, { style: FALLBACK_STYLE, provenance: "official" });
  return { styles, problems, hints };
}

// ── A starter for the user's own style ─────────────────────────────────

export const STYLE_README = `Your own Tavora style
=====================

This folder is a style. Tavora reads only tavora.style.json in it.
A style is data: it picks how each part looks and sets a few sizes.
Colours come from your theme, so any theme works with it.

1. Change "looks" (one look per part) and "values" in tavora.style.json.
   Numbers outside their range are kept in it.
2. In Tavora, open Settings > Appearance and press Reload.
3. Pick your style. If something is wrong, Appearance says what.

Give it your own "id" and "name" before you share it. Ids starting with
"tavora." are reserved. The full format is at
https://docs.mytavora.app/reference/style
`;

/** The id a style's copy gets: `local.my-<name>`, with `-2`, `-3`… after it when that one is taken. */
function starterId(base: StylePackage, suffix: number): string {
  const word = (base.id.split(".").at(-1) ?? "style").replace(/[^a-z0-9-]/g, "").replace(/^(my-)+|^-+/g, "").slice(0, 40) || "style";
  return `local.my-${word}${suffix > 1 ? `-${suffix}` : ""}`;
}

/**
 * A style to copy and change: `base` (the style in use) under a new id and name ("My Hardware", "My Hardware 2"), with
 * its looks, values, radius, font and themes. Built from a checked style, so it always passes validation.
 */
export function starterStyle(base: StylePackage, suffix: number): StylePackage {
  const tag = suffix > 1 ? ` ${suffix}` : "";
  const name = `My ${base.name}`.slice(0, STYLE_LIMITS.name - tag.length).trimEnd() + tag;
  return {
    id: starterId(base, suffix),
    name,
    description: `A copy of ${base.name} to make your own.`.slice(0, STYLE_LIMITS.description),
    author: "You",
    version: "1.0.0",
    looks: { ...base.looks },
    values: { ...base.values },
    radius: base.radius,
    font: base.font,
    themes: [...base.themes],
  };
}

/** The manifest as written to disk, in the order the reference lists the fields. */
export function styleManifest(style: StylePackage): string {
  const { id, name, description, author, version, looks, values, radius, font, themes } = style;
  return `${JSON.stringify({ id, name, ...(description ? { description } : {}), ...(author ? { author } : {}), version, looks, values, radius, font, ...(themes.length ? { themes } : {}) }, null, 2)}\n`;
}

/** The style a saved id names; Classic when it is not installed (kept in the library, so it comes back with the style). */
export function resolveStyle(styles: ReadonlyMap<string, InstalledStyle>, id: string | null | undefined): StylePackage {
  return (id ? styles.get(id)?.style : undefined) ?? styles.get(CLASSIC_STYLE_ID)?.style ?? FALLBACK_STYLE;
}

/** The style as modules get it in `TavoraTheme.style`. */
export function tavoraStyle(style: StylePackage): TavoraStyle {
  return { id: style.id, name: style.name, looks: { ...style.looks }, values: { ...style.values } };
}

/** What the user set in Settings > Appearance that resolving the theme needs (library.ts). */
export interface AppearanceSettings {
  /** The corner radius over the style's, or null for the style's. */
  radius: number | null;
  /** The font id over the style's; left out for the style's. */
  font?: string | undefined;
  toasts: ToastPosition;
}

/**
 * The theme the host page shows and the one module panels get, for a theme choice, a style and the user's settings: the
 * radius and font resolved (shared/styles.ts), the style along. They differ only for an inset style (`insetPanelTheme`).
 * With glass surfaces, the style's glass opacity is raised as far as this theme variation needs for every text on glass
 * to keep its contrast (themes.ts `glassOpacity`), so any style works with any theme.
 */
export function appearanceThemes(
  choice: { theme: ThemePackage; variation: ThemeVariation },
  style: StylePackage,
  settings: AppearanceSettings,
): { host: TavoraTheme; panel: TavoraTheme } {
  const radius = resolveRadius(settings.radius, style, choice.variation.radius);
  const font = themeFont(resolveFontId(settings.font, style));
  const sent = tavoraStyle(style);
  if (style.looks.surface === "glass") sent.values.glassOpacity = glassOpacity(choice.variation, style.values.glassOpacity);
  const host = moduleTheme(withRadius(choice.variation, radius), settings.toasts, font, sent);
  const panel = insetPanelTheme(choice.theme, choice.variation, host);
  // A panel in other colours (an inset style) draws its menus and dialogs as glass over those.
  if (panel === host || style.looks.surface !== "glass") return { host, panel };
  const panelOpacity = glassOpacity({ colors: panel.tokens, contrast: choice.variation.contrast }, sent.values.glassOpacity);
  return { host, panel: { ...panel, style: { ...panel.style!, values: { ...panel.style!.values, glassOpacity: panelOpacity } } } };
}
