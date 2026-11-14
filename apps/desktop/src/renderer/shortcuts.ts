import { isModalOpen } from "@tavora/official-ui/lib/layers";
import { shortcutKeys } from "@tavora/official-ui/components/tooltip";
import type { HostViewState } from "../shared/host-api";
import { ariaKeys, SHORTCUT_GROUPS, SHORTCUTS, shownKeys, type ShortcutId, type ShortcutScope } from "../shared/shortcuts";
import { t } from "./i18n";

// The host page's side of the shortcut table (shared/shortcuts.ts): what Settings > Shortcuts (Ctrl+/) lists, and the
// keys a button names in `aria-keyshortcuts`, which its tooltip shows as key caps.

export const MAC = navigator.platform.startsWith("Mac");
/** The modifier key's name: Cmd on a Mac, otherwise Ctrl (Strg in German). */
export const MOD = (): string => keyCaps("search")[0]!;

/**
 * A shortcut's keys as key caps, the way its tooltip shows them (the kit's `shortcutKeys`): ["Ctrl", "K"], ["Cmd", "K"]
 * on a Mac, ["Strg", "K"] in German. Alternatives follow each other: ["↑", "↓"].
 */
export function keyCaps(id: ShortcutId): string[] {
  return shownKeys(id, MAC)
    .flatMap(shortcutKeys)
    .map((key) => (key === "1-9" ? "1–9" : key));
}

/** For a button's `aria-keyshortcuts`: screen readers announce it, and the button's tooltip shows it as key caps. */
export const keyshortcuts = (id: ShortcutId): string => ariaKeys(id, MAC);

export interface ShortcutRow {
  action: string;
  /** Each entry is one key cap; several entries are pressed together. */
  keys: string[];
}

/** Settings > Shortcuts: every shortcut, under its group's heading. */
export function shortcutGroups(): { title: string; rows: ShortcutRow[] }[] {
  return SHORTCUT_GROUPS.map((group) => ({
    title: t(`shortcuts.group.${group}`),
    rows: SHORTCUTS.filter((spec) => spec.group === group).map((spec) => ({ action: t(spec.label), keys: keyCaps(spec.id) })),
  }));
}

/**
 * Whether a dialog on top holds a scope's shortcuts back: the one place the page's shortcuts ask the kit's layer registry
 * (lib/layers.ts), which knows what is open and in which order. Tavora-wide ones work over dialogs too (main catches them
 * before any page sees the key); the Overlays editor's, Escape included, stand down while one is open. (The Browser
 * panel's keys need no asking: a dialog takes the focus away from them.)
 */
export function heldBackByModal(scope: ShortcutScope): boolean {
  return scope !== "app" && isModalOpen();
}

/**
 * The workspaces Ctrl+1 to Ctrl+9 open: the rail from top to bottom, favorites
 * first, workspaces in folders in their folder's place even when it is closed.
 */
export function numberedWorkspaces(library: HostViewState["library"]): string[] {
  const order: string[] = [...library.favorites];
  const seen = new Set(order);
  const add = (id: string) => {
    if (!seen.has(id) && library.workspaces[id]) {
      seen.add(id);
      order.push(id);
    }
  };
  for (const entry of library.root) {
    if (entry.kind === "workspace") add(entry.id);
    else for (const id of library.folders[entry.id]?.workspaces ?? []) add(id);
  }
  return order.slice(0, 9);
}
