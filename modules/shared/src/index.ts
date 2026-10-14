// Shared by the official modules (Notes, To-Dos). Everything here uses only
// the public @tavora/sdk, like any community module could.

import { connect, THEME_TOKENS, type TavoraSDK, type TavoraTheme } from "@tavora/sdk";

export { cn } from "./lib/utils";
export { default as ConfirmDialog } from "./components/ConfirmDialog.vue";
export { errorMessage, readDocument, serial, updateDocument, type UpdateOptions, type Versioned } from "./documents";

/** Connects to Tavora and keeps the page's CSS tokens in step with the host theme. */
export async function connectModule(): Promise<TavoraSDK> {
  const sdk = await connect();
  applyTheme(await sdk.ui.getTheme());
  sdk.ui.onThemeChange(applyTheme);
  return sdk;
}

/** Sets the host's tokens as CSS variables, which theme.css maps into Tailwind. */
export function applyTheme(theme: TavoraTheme, root: HTMLElement = document.documentElement): void {
  for (const name of THEME_TOKENS) {
    const value = theme.tokens?.[name];
    if (typeof value === "string" && value) root.style.setProperty(`--${name}`, value);
  }
  if (typeof theme.radius === "number" && Number.isFinite(theme.radius)) root.style.setProperty("--radius", `${theme.radius}px`);
  root.style.colorScheme = theme.mode === "light" ? "light" : "dark";
}
