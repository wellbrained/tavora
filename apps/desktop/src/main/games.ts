import type { TavoraGame, TavoraTheme } from "@tavora/sdk/protocol";

// Fixed game list for the Milestone A spike. Game management (search, Steam
// import, folders) arrives with the local player MVP.
export const GAMES: readonly TavoraGame[] = [
  { id: "poe2", displayName: "Path of Exile 2" },
  { id: "satisfactory", displayName: "Satisfactory" },
];

export const THEMES: Record<TavoraTheme["mode"], TavoraTheme> = {
  dark: {
    mode: "dark",
    colors: { background: "#18181b", surface: "#232327", text: "#f2ece0", textMuted: "#9a958c", accent: "#e0a243" },
  },
  light: {
    mode: "light",
    colors: { background: "#f7f3ea", surface: "#ffffff", text: "#1f1c17", textMuted: "#6b665c", accent: "#a8690f" },
  },
};
