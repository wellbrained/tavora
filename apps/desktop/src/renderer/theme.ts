// Puts the active theme on the page. styles.css defines the Tavora default
// on :root for the first paint; the active variation's tokens are set on top
// as inline custom properties, so every component follows without a reload.
import type { AppearanceView, ThemeVariationView } from "../shared/host-api";

export function activeVariation(appearance: AppearanceView): ThemeVariationView | undefined {
  return appearance.themes.find((theme) => theme.id === appearance.themeId)?.variations.find((variation) => variation.id === appearance.variationId);
}

let applied = "";

export function applyTheme(appearance: AppearanceView): void {
  const variation = activeVariation(appearance);
  if (!variation) return;
  const key = JSON.stringify(variation);
  if (key === applied) return;
  applied = key;
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(variation.colors)) root.setProperty(`--${name}`, value);
  root.setProperty("--radius", `${variation.radius}px`);
  root.setProperty("color-scheme", variation.mode);
  document.documentElement.dataset.themeMode = variation.mode;
}
