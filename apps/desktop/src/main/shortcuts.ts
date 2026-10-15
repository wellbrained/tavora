import { shortcutForKey, type KeyInput } from "../shared/shortcut-keys";
import type { HostShortcut } from "../shared/host-api";

export type { KeyInput };

/** The shortcut a key event in the main process stands for, if any (mapping: shared/shortcut-keys.ts). */
export function shortcutFor(input: KeyInput): HostShortcut | null {
  return shortcutForKey(input, process.platform === "darwin");
}