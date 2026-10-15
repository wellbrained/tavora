import { THEME_TOKENS, type TavoraTheme } from "@tavora/sdk";

/** Sets the host's tokens as CSS variables, which theme.css maps into Tailwind. */
export function applyTheme(theme: TavoraTheme, root: HTMLElement = document.documentElement): void {
  for (const name of THEME_TOKENS) {
    const value = theme.tokens?.[name];
    if (typeof value === "string" && value) root.style.setProperty(`--${name}`, value);
  }
  if (typeof theme.radius === "number" && Number.isFinite(theme.radius)) root.style.setProperty("--radius", `${theme.radius}px`);
  root.style.colorScheme = theme.mode === "light" ? "light" : "dark";
  // The shared components' dark: styles follow the theme, as in the host UI.
  root.classList.toggle("dark", theme.mode !== "light");
}
