// Themes for tests: Tavora's own looks as a panel gets them, and any `tavora.theme.json` turned into the theme Tavora sends.
// The two built-in looks are copied here from the themes Tavora ships (`themes/` in the Tavora repo), so the SDK needs no
// path into that repo; a test in the repo checks the copies still match.
import { OPTIONAL_THEME_TOKENS, THEME_TOKENS, type TavoraTheme, type ThemeToken } from "../protocol.js";

/** One variation of a `tavora.theme.json`, as far as a panel's theme needs it. @since 0.3.14 */
export interface ThemeVariationJson {
  id: string;
  mode: "dark" | "light";
  /** `"high"` variations are the high-contrast ones. Default `"normal"`. */
  contrast?: "normal" | "high";
  /** Corner radius in CSS pixels. Default 8, as in Tavora. */
  radius?: number;
  /** Every theme token as `#rrggbb`. The button fill and toast colours may be left out, as in a theme file. */
  colors: Partial<Record<ThemeToken, string>>;
}

/** A parsed `tavora.theme.json`; fields Tavora needs only for its theme list (name, author…) may be there too. @since 0.3.14 */
export interface ThemePackageJson {
  variations: readonly ThemeVariationJson[];
}

/** Tavora Dark: `themes/tavora`, variation `dark`. */
const TAVORA_DARK: ThemeVariationJson = {
  id: "dark",
  mode: "dark",
  radius: 8,
  colors: {
    background: "#171412",
    foreground: "#f2ece0",
    card: "#201c19",
    "card-foreground": "#f2ece0",
    popover: "#201c19",
    "popover-foreground": "#f2ece0",
    primary: "#e0a243",
    "primary-hover": "#f0b85c",
    "primary-foreground": "#171412",
    secondary: "#2a2521",
    "secondary-foreground": "#f2ece0",
    muted: "#2a2521",
    "muted-foreground": "#9a958c",
    accent: "#2a2521",
    "accent-foreground": "#f2ece0",
    destructive: "#e5675a",
    border: "#35302b",
    input: "#6e695f",
    ring: "#e0a243",
    rail: "#100e0d",
    success: "#8cbf7f",
    warning: "#e3c75f",
    info: "#6fa8dc"
  },
};

/** Hearthwood Light: `themes/hearthwood`, variation `light`. */
const HEARTHWOOD_LIGHT: ThemeVariationJson = {
  id: "light",
  mode: "light",
  radius: 10,
  colors: {
    background: "#f1f4ec",
    foreground: "#1b2219",
    card: "#fbfdf7",
    "card-foreground": "#1b2219",
    popover: "#fbfdf7",
    "popover-foreground": "#1b2219",
    primary: "#4f6b1f",
    "primary-hover": "#3f5718",
    "primary-foreground": "#ffffff",
    secondary: "#e2e8da",
    "secondary-foreground": "#1b2219",
    muted: "#e2e8da",
    "muted-foreground": "#5b6555",
    accent: "#e2e8da",
    "accent-foreground": "#1b2219",
    destructive: "#a93a2c",
    border: "#d1d9c6",
    input: "#7d8875",
    ring: "#4f6b1f",
    rail: "#e6ebdf",
    success: "#2c6b37",
    warning: "#7a5c00",
    info: "#2a6396"
  },
};

const DEFAULT_RADIUS = 8;

/**
 * The theme a panel gets in Tavora for one variation of a theme package (`ui.getTheme`, the `ui.theme` event): every token,
 * the colours a theme may leave out filled in as Tavora does, the summary `colors`, the radius and toasts at the bottom centre (Tavora's default). `variation` picks it by
 * id, or by mode (`"dark"`, `"light"`; normal contrast first); left out, the first variation. Throws a TypeError when the
 * variation isn't there or misses a token.
 *
 * ```ts
 * import myTheme from "../my-theme/tavora.theme.json";
 * const { sdk, host } = createMemoryHost({ theme: themeFromPackage(myTheme, "light") });
 * ```
 *
 * @since 0.3.14
 */
export function themeFromPackage(pkg: ThemePackageJson, variation?: string): TavoraTheme {
  const variations = pkg?.variations;
  if (!Array.isArray(variations) || variations.length === 0) throw new TypeError("the theme package has no variations");
  const byMode = (mode: string) => {
    const suiting = variations.filter((one) => one.mode === mode);
    return suiting.find((one) => (one.contrast ?? "normal") === "normal") ?? suiting[0];
  };
  const chosen = variation === undefined ? variations[0] : (variations.find((one) => one.id === variation) ?? byMode(variation));
  if (!chosen) throw new TypeError(`the theme package has no variation "${variation}"`);
  const colors = { ...chosen.colors };
  for (const [token, copies] of Object.entries(OPTIONAL_THEME_TOKENS) as [ThemeToken, ThemeToken][]) colors[token] ??= colors[copies];
  const missing = THEME_TOKENS.filter((token) => typeof colors[token] !== "string");
  if (missing.length) throw new TypeError(`the variation "${chosen.id}" misses ${missing.join(", ")}`);
  const tokens = colors as Record<ThemeToken, string>;
  return {
    mode: chosen.mode === "light" ? "light" : "dark",
    colors: { background: tokens.background, surface: tokens.card, text: tokens.foreground, textMuted: tokens["muted-foreground"], accent: tokens.primary },
    tokens: { ...tokens },
    radius: chosen.radius ?? DEFAULT_RADIUS,
    toasts: "bottom-center",
  };
}

/**
 * Tavora's own looks, as a panel gets them: `"dark"` is Tavora Dark (the look Tavora starts with), `"light"` is Hearthwood
 * Light. Check a panel in both. Each call returns a fresh copy.
 *
 * ```ts
 * host.changeTheme(themeOf("light"));
 * ```
 *
 * @since 0.3.14
 */
export function themeOf(mode: "dark" | "light"): TavoraTheme {
  return themeFromPackage({ variations: [mode === "light" ? HEARTHWOOD_LIGHT : TAVORA_DARK] });
}
