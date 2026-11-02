import { noteKeyPress } from "@tavora/official-ui/components/ui/sliding-indicator";
import type { HostShortcut } from "../shared/host-api";

// Main sends every `host:shortcut` to the page, but only some come from a key: the ones shortcutForKey produces
// (shared/shortcut-keys.ts). The rest (`panel:`, `panels:`, `maximize:`, `restore:`, `address:`, `setting:`) are
// answers to a click or to a module, and must not make the next dialog look like a key's.
const KEY_SHORTCUTS = new Set<string>(["search", "shortcuts", "settings", "next-tab", "previous-tab", "toggle-rail", "home"]);

/** Whether main sent this shortcut because of a key press. */
export function isKeyShortcut(shortcut: HostShortcut): boolean {
  return KEY_SHORTCUTS.has(shortcut) || /^workspace-\d+$/.test(shortcut);
}

/**
 * The page never sees the key main caught, so a shortcut that came from a key is told to the input tracker: a dialog
 * it opens (Settings, Shortcuts) then appears at once.
 */
export function noteShortcut(shortcut: HostShortcut): void {
  if (isKeyShortcut(shortcut)) noteKeyPress();
}
