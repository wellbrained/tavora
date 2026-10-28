import type { TavoraTheme } from "@tavora/sdk/protocol";

/**
 * The Tavora default theme (Tavora, Dark), as modules get it through
 * ui.getTheme. Other installed themes replace it (themes.ts). The tokens
 * match the host UI's first-paint tokens in src/renderer/styles.css and
 * themes/tavora/tavora.theme.json; tests keep all three in agreement.
 */
export const THEME: TavoraTheme = {
  mode: "dark",
  colors: { background: "#171412", surface: "#201c19", text: "#f2ece0", textMuted: "#9a958c", accent: "#e0a243" },
  tokens: {
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
    info: "#6fa8dc",
  },
  radius: 8,
};
