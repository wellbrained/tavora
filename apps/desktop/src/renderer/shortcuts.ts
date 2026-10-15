import type { HostViewState } from "../shared/host-api";

// What Settings > Keyboard shortcuts (Ctrl+/) lists. The Tavora-wide ones are
// caught in main/shortcuts.ts; keep both in step.

const MOD = navigator.platform.startsWith("Mac") ? "Cmd" : "Ctrl";

export interface ShortcutRow {
  action: string;
  /** Each entry is one key cap; several entries are pressed together. */
  keys: string[];
}

export const SHORTCUT_GROUPS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: "General",
    rows: [
      { action: "Search games, modules and settings", keys: [MOD, "K"] },
      { action: "Keyboard shortcuts", keys: [MOD, "/"] },
      { action: "Settings", keys: [MOD, ","] },
      { action: "Home", keys: [MOD, "H"] },
      { action: "Collapse or expand the game list", keys: [MOD, "\\"] },
    ],
  },
  {
    title: "Games",
    rows: [{ action: "Open game 1 to 9 in the game list", keys: [MOD, "1–9"] }],
  },
  {
    title: "Browser panel",
    rows: [
      { action: "Go to the address bar", keys: [MOD, "L"] },
      { action: "Back", keys: ["Alt", "←"] },
      { action: "Forward", keys: ["Alt", "→"] },
      { action: "Leave full screen", keys: ["Esc"] },
    ],
  },
  {
    title: "Lists and dialogs",
    rows: [
      { action: "Move through the game list", keys: ["↑", "↓"] },
      { action: "Resize the game list when its edge has focus", keys: ["←", "→"] },
      { action: "Pick the highlighted result", keys: ["Enter"] },
      { action: "Close a dialog, menu or search", keys: ["Esc"] },
    ],
  },
];

/**
 * The games Ctrl+1 to Ctrl+9 open: the rail from top to bottom, favorites
 * first, games in folders in their folder's place even when it is closed.
 */
export function numberedGames(library: HostViewState["library"]): string[] {
  const order: string[] = [...library.favorites];
  const seen = new Set(order);
  const add = (id: string) => {
    if (!seen.has(id) && library.games[id]) {
      seen.add(id);
      order.push(id);
    }
  };
  for (const entry of library.root) {
    if (entry.kind === "game") add(entry.id);
    else for (const id of library.folders[entry.id]?.games ?? []) add(id);
  }
  return order.slice(0, 9);
}
