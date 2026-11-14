import { isModalOpen } from "@tavora/official-ui/components/ui/dialog";
import type { HostViewState } from "../shared/host-api";
import { ariaKeys, SHORTCUT_GROUPS, SHORTCUTS, shortcutSpec, type ShortcutId, type ShortcutScope } from "../shared/shortcuts";
import { t } from "./i18n";

// The host page's side of the shortcut table (shared/shortcuts.ts): what Settings > Shortcuts (Ctrl+/) lists, and the
// keys a button names in `aria-keyshortcuts`, which its tooltip shows as key caps.

export const MAC = navigator.platform.startsWith("Mac");
/** The modifier key's name: Cmd on a Mac, otherwise Ctrl (Strg in German). */
export const MOD = (): string => (MAC ? "Cmd" : t("shortcuts.ctrl"));

const CAPS: Record<string, string> = { Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", "1-9": "1–9" };

/** A shortcut's keys as key caps, in the language shown: ["Ctrl", "K"], ["Cmd", "K"] on a Mac, ["Strg", "K"] in German. */
export function keyCaps(id: ShortcutId): string[] {
  return shortcutSpec(id)
    .keys.split(" ")
    .flatMap((alternative) => alternative.split(/\+(?!$)/))
    .map((key) => (key === "Mod" ? MOD() : key === "Control" ? t("shortcuts.ctrl") : (CAPS[key] ?? (key.length === 1 ? key.toUpperCase() : key))));
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
 * Whether a dialog on top holds a scope's shortcuts back. Tavora-wide ones work over dialogs too (main catches them
 * before any page sees the key); the others stand down while one is open. Every shortcut that cares asks here, so
 * this is the one place to change when dialogs, menus and popovers say which layer is on top.
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
