import { shortcutForKey, type AppShortcut, type KeyInput } from "../shared/shortcuts";

export type { KeyInput };

/** The shortcut a key event in the main process stands for, if any (the table: shared/shortcuts.ts). */
export function shortcutFor(input: KeyInput): AppShortcut | null {
  return shortcutForKey(input, process.platform === "darwin");
}