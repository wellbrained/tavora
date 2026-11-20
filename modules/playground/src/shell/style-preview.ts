// Previews the kit in another style and theme inside the Playground only: Tavora's own settings don't change.
// Reads the built-in style and theme files at build time and writes them on this page the way the host would send them.
import type { TavoraTheme } from "@tavora/sdk";
import { applyHostTheme } from "@tavora/sdk/bootstrap";
import { applyKitTheme } from "@tavora/official-ui";

// The SDK's style types (feat/style-core) replace these once that half is merged.
type StylePart = "surface" | "tabs" | "content" | "buttons" | "inputs" | "lists" | "labels" | "status";
type StyleLooks = Record<StylePart, string>;
interface StyleValues {
  borderWidth: number;
  depth: number;
  textSize: number;
  controlHeight: number;
  spacing: number;
  glassOpacity: number;
}
interface TavoraStyle {
  id: string;
  name: string;
  looks: StyleLooks;
  values: StyleValues;
}

interface StyleFile extends TavoraStyle {
  radius: number;
  font: string;
  themes?: string[];
}
interface ThemeVariationFile {
  id: string;
  name: string;
  mode: "dark" | "light";
  radius?: number;
  colors: Record<string, string>;
}
interface ThemeFile {
  id: string;
  name: string;
  variations: ThemeVariationFile[];
}

/** Classic as the contract writes it; used when the built-in file isn't there yet. */
const CLASSIC: StyleFile = {
  id: "tavora.classic",
  name: "Classic",
  looks: { surface: "flat", tabs: "pill", content: "plain", buttons: "soft", inputs: "soft", lists: "fill", labels: "normal", status: "none" },
  values: { borderWidth: 1, depth: 1, textSize: 13, controlHeight: 32, spacing: 1, glassOpacity: 0.8 },
  radius: 8,
  font: "inter",
};

const styleFiles = Object.values(import.meta.glob<StyleFile>("../../../../styles/*/tavora.style.json", { eager: true, import: "default" }));
const themeFiles = Object.values(import.meta.glob<ThemeFile>("../../../../themes/*/tavora.theme.json", { eager: true, import: "default" }));

export const STYLES: StyleFile[] = [CLASSIC, ...styleFiles.filter((style) => style.id !== CLASSIC.id)];
export const THEMES = themeFiles.flatMap((theme) => theme.variations.map((variation) => ({ id: `${theme.id}/${variation.id}`, theme, variation })));

const FONTS: Record<string, string> = {
  inter: '"Inter Variable", system-ui, sans-serif',
  "jetbrains-mono": '"JetBrains Mono Variable", ui-monospace, monospace',
};
const PARTS = ["surface", "tabs", "content", "buttons", "inputs", "lists", "labels", "status"] as const satisfies readonly (keyof StyleLooks)[];
const VALUES: [keyof StyleValues, string, string][] = [
  ["borderWidth", "--style-border-width", "px"],
  ["depth", "--style-depth", ""],
  ["textSize", "--style-text", "px"],
  ["controlHeight", "--style-control-height", "px"],
  ["spacing", "--style-space", ""],
  ["glassOpacity", "--style-glass-opacity", ""],
];

/** Writes a style the way the host's theme does: data-style, data-look-*, the --style-* values. */
function writeStyle(style: TavoraStyle | undefined, root: HTMLElement): void {
  if (!style) {
    root.removeAttribute("data-style");
    for (const part of PARTS) root.removeAttribute(`data-look-${part}`);
    for (const [, name] of VALUES) root.style.removeProperty(name);
    return;
  }
  root.setAttribute("data-style", style.id);
  for (const part of PARTS) root.setAttribute(`data-look-${part}`, style.looks[part]);
  for (const [key, name, unit] of VALUES) root.style.setProperty(name, `${style.values[key]}${unit}`);
}

/**
 * Shows the kit in `styleId` ("" = Tavora's) with the theme variation `themeId` (an id from THEMES; "" = Tavora's).
 * `host` is what Tavora sends now (null outside Tavora: the page's default theme).
 */
export function previewStyle(styleId: string, themeId: string, host: TavoraTheme | null, root: HTMLElement = document.documentElement): void {
  if (!styleId && !themeId) return endPreview(host, root);
  const hostStyle = (host as (TavoraTheme & { style?: StyleFile }) | null)?.style;
  const style = STYLES.find((item) => item.id === styleId) ?? hostStyle ?? CLASSIC;
  const picked = THEMES.find((item) => item.id === themeId);
  const tokens: Record<string, string> | undefined = picked ? { ...picked.variation.colors } : host?.tokens ? { ...host.tokens } : undefined;
  if (tokens) {
    tokens["primary-fill"] ??= tokens.primary ?? "";
    tokens["primary-fill-hover"] ??= tokens["primary-hover"] ?? "";
    tokens["primary-fill-foreground"] ??= tokens["primary-foreground"] ?? "";
    tokens.toast ??= tokens.foreground ?? "";
    tokens["toast-foreground"] ??= tokens.background ?? "";
  }
  const classic = style.id === CLASSIC.id;
  const variationRadius = picked ? (picked.variation.radius ?? 8) : (host?.radius ?? 8);
  const theme = {
    mode: picked?.variation.mode ?? host?.mode ?? "dark",
    colors: tokens ? { background: tokens.background, surface: tokens.card, text: tokens.foreground, textMuted: tokens["muted-foreground"], accent: tokens.primary } : undefined,
    tokens,
    radius: classic ? variationRadius : (style.radius ?? variationRadius),
    font: { id: style.font ?? "inter", family: FONTS[style.font ?? "inter"] ?? FONTS.inter },
    style,
  } as unknown as TavoraTheme;
  applyHostTheme(theme, root);
  applyKitTheme(theme, root);
  writeStyle(style, root);
}

/** Back to what Tavora sends (or the page's defaults outside Tavora). */
export function endPreview(hostTheme: TavoraTheme | null, root: HTMLElement = document.documentElement): void {
  writeStyle(undefined, root);
  if (hostTheme) {
    applyHostTheme(hostTheme, root);
    applyKitTheme(hostTheme, root);
    writeStyle((hostTheme as TavoraTheme & { style?: TavoraStyle }).style, root);
    return;
  }
  root.removeAttribute("style");
  root.classList.remove("dark");
  root.removeAttribute("data-mode");
}
