import type { HostViewState } from "../shared/host-api";
import { t } from "./i18n";

// What Settings > Keyboard shortcuts (Ctrl+/) lists. The Tavora-wide ones are
// caught in main/shortcuts.ts; keep both in step.

const MAC = navigator.platform.startsWith("Mac");
/** The modifier key's name: Cmd on a Mac, otherwise Ctrl (Strg in German). */
export const MOD = (): string => (MAC ? "Cmd" : t("shortcuts.ctrl"));

export interface ShortcutRow {
  action: string;
  /** Each entry is one key cap; several entries are pressed together. */
  keys: string[];
}

export function shortcutGroups(): { title: string; rows: ShortcutRow[] }[] {
  const mod = MOD();
  return [
    {
      title: t("shortcuts.group.general"),
      rows: [
        { action: t("shortcuts.search"), keys: [mod, "K"] },
        { action: t("shortcuts.shortcuts"), keys: [mod, "/"] },
        { action: t("shortcuts.settings"), keys: [mod, ","] },
        { action: t("shortcuts.home"), keys: [mod, "H"] },
        { action: t("shortcuts.rail"), keys: [mod, "\\"] },
      ],
    },
    {
      title: t("shortcuts.group.games"),
      rows: [{ action: t("shortcuts.openGame"), keys: [mod, "1–9"] }],
    },
    {
      title: t("shortcuts.group.browser"),
      rows: [
        { action: t("shortcuts.address"), keys: [mod, "L"] },
        { action: t("shortcuts.back"), keys: ["Alt", "←"] },
        { action: t("shortcuts.forward"), keys: ["Alt", "→"] },
        { action: t("shortcuts.leaveFullscreen"), keys: ["Esc"] },
      ],
    },
    {
      title: t("shortcuts.group.lists"),
      rows: [
        { action: t("shortcuts.moveList"), keys: ["↑", "↓"] },
        { action: t("shortcuts.resizeList"), keys: ["←", "→"] },
        { action: t("shortcuts.pick"), keys: ["Enter"] },
        { action: t("shortcuts.closeDialog"), keys: ["Esc"] },
      ],
    },
  ];
}

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
