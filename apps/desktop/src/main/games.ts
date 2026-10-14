import type { TavoraTheme } from "@tavora/sdk/protocol";

/**
 * The theme every module gets through ui.getTheme. Tavora is dark only for
 * now (docs/decisions.md); the tokens match the host UI tokens in
 * src/renderer/styles.css, and a test keeps the two in agreement.
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
    input: "#6b665c",
    ring: "#e0a243",
    rail: "#100e0d",
    success: "#8cbf7f",
    warning: "#e3c75f",
    info: "#6fa8dc",
  },
  radius: 8,
};
