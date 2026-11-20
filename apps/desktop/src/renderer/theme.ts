// Puts the active theme on the page. styles.css defines the Tavora default
// on :root for the first paint; the active variation's tokens are set on top
// as inline custom properties, so every component follows without a reload.
// The design style goes on as module pages get it (the SDK's applyHostTheme): data-style, data-look-<part> and the
// --style-* variables, as main worked them out (AppearanceView.styleMarks).
import type { AppearanceView, ThemeVariationView } from "../shared/host-api";

export function activeVariation(appearance: AppearanceView): ThemeVariationView | undefined {
  return appearance.themes.find((theme) => theme.id === appearance.themeId)?.variations.find((variation) => variation.id === appearance.variationId);
}

let applied = "";

export function applyTheme(appearance: AppearanceView): void {
  const variation = activeVariation(appearance);
  if (!variation) return;
  const radius = appearance.resolvedRadius;
  const marks = appearance.styleMarks;
  const key = JSON.stringify([variation, radius, appearance.font.family, marks]);
  if (key === applied) return;
  applied = key;
  const html = document.documentElement;
  const root = html.style;
  for (const [name, value] of Object.entries(variation.colors)) root.setProperty(`--${name}`, value);
  root.setProperty("--radius", `${radius}px`);
  // The font the user picked; styles.css reads it through --font-sans.
  root.setProperty("--tavora-font-sans", appearance.font.family);
  root.setProperty("color-scheme", variation.mode);
  // shadcn-vue's dark: variants follow the theme's mode.
  html.classList.toggle("dark", variation.mode === "dark");
  for (const [name, value] of marks.attributes) {
    if (value === null) html.removeAttribute(name);
    else html.setAttribute(name, value);
  }
  for (const [name, value] of marks.properties) {
    if (value === null) root.removeProperty(name);
    else root.setProperty(name, value);
  }
}
