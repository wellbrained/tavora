// Previews the kit in another style and theme inside the Playground only: Tavora's own settings don't change.
// Reads the built-in style and theme files at build time and writes them on this page the way the host sends them
// (the SDK's applyHostTheme puts the style's data-look-* attributes and --style-* values on <html>).
import { CLASSIC_STYLE, styleMarks, type TavoraStyle, type TavoraTheme } from "@tavora/sdk";
import { applyHostTheme } from "@tavora/sdk/bootstrap";
import { applyKitTheme } from "@tavora/official-ui";

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

const CLASSIC: StyleFile = { ...CLASSIC_STYLE, radius: 8, font: "inter" };

const styleFiles = Object.values(import.meta.glob<StyleFile>("../../../../styles/*/tavora.style.json", { eager: true, import: "default" }));
const themeFiles = Object.values(import.meta.glob<ThemeFile>("../../../../themes/*/tavora.theme.json", { eager: true, import: "default" }));

export const STYLES: StyleFile[] = [styleFiles.find((style) => style.id === CLASSIC.id) ?? CLASSIC, ...styleFiles.filter((style) => style.id !== CLASSIC.id)];
export const THEMES = themeFiles.flatMap((theme) => theme.variations.map((variation) => ({ id: `${theme.id}/${variation.id}`, theme, variation })));

/** The page's fonts (the kit bundles Inter and JetBrains Mono); a style's font outside them shows in Inter here. */
const FONTS: Record<string, string> = {
  inter: '"Inter Variable", system-ui, sans-serif',
  "jetbrains-mono": '"JetBrains Mono Variable", ui-monospace, monospace',
};

/**
 * Shows the kit in `styleId` ("" = Tavora's) with the theme variation `themeId` (an id from THEMES; "" = Tavora's).
 * `host` is what Tavora sends now (null outside Tavora: the page's default theme).
 */
export function previewStyle(styleId: string, themeId: string, host: TavoraTheme | null, root: HTMLElement = document.documentElement): void {
  if (!styleId && !themeId) return endPreview(host, root);
  const fromHost: StyleFile | undefined = host?.style ? { ...host.style, radius: host.radius ?? 8, font: host.font?.id ?? "inter" } : undefined;
  const style: StyleFile = STYLES.find((item) => item.id === styleId) ?? fromHost ?? CLASSIC;
  const picked = THEMES.find((item) => item.id === themeId);
  const tokens: Record<string, string> | undefined = picked ? { ...picked.variation.colors } : host?.tokens ? { ...host.tokens } : undefined;
  if (tokens) {
    tokens["primary-fill"] ??= tokens.primary ?? "";
    tokens["primary-fill-hover"] ??= tokens["primary-hover"] ?? "";
    tokens["primary-fill-foreground"] ??= tokens["primary-foreground"] ?? "";
    tokens.toast ??= tokens.foreground ?? "";
    tokens["toast-foreground"] ??= tokens.background ?? "";
  }
  const variationRadius = picked ? (picked.variation.radius ?? 8) : (host?.radius ?? 8);
  const theme = {
    mode: picked?.variation.mode ?? host?.mode ?? "dark",
    colors: tokens ? { background: tokens.background, surface: tokens.card, text: tokens.foreground, textMuted: tokens["muted-foreground"], accent: tokens.primary } : undefined,
    tokens,
    radius: style.id === CLASSIC.id ? variationRadius : style.radius,
    font: { id: style.font, family: FONTS[style.font] ?? FONTS.inter },
    style: { id: style.id, name: style.name, looks: style.looks, values: style.values },
  } as unknown as TavoraTheme;
  applyHostTheme(theme, root);
  applyKitTheme(theme, root);
}

/** Back to what Tavora sends (or the page's defaults outside Tavora). */
export function endPreview(host: TavoraTheme | null, root: HTMLElement = document.documentElement): void {
  if (host) {
    applyHostTheme(host, root);
    applyKitTheme(host, root);
    return;
  }
  // Outside Tavora: nothing but the stylesheet's defaults.
  const { attributes } = styleMarks(undefined);
  for (const [name] of attributes) root.removeAttribute(name);
  root.removeAttribute("style");
  root.classList.remove("dark");
  root.removeAttribute("data-mode");
}
