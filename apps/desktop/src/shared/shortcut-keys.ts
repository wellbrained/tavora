import type { HostShortcut } from "./host-api";

/** The parts of a key event that decide a shortcut. Electron's and the browser's both fit. */
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * Tavora-wide shortcuts: Ctrl on Windows and Linux, Cmd on macOS. The main
 * process catches them before any page sees the key (so they work while a
 * module panel has focus and modules cannot take them over, which is why none
 * may be a key editors use, like Ctrl+B); the host page uses the same mapping
 * for key events that reach it without passing through main, such as the
 * synthetic ones in tests. Shown to players in the shortcut overview
 * (renderer/shortcuts.ts); keep both in step.
 */
export function shortcutForKey(input: KeyInput, mac: boolean): HostShortcut | null {
  if (input.type !== "keyDown") return null;
  const mod = mac ? input.meta && !input.control : input.control && !input.meta;
  if (!mod) return null;
  const key = input.key.toLowerCase();
  // Symbols are matched by the character typed, so they work on any layout:
  // "/" needs Shift on a German keyboard and "\" needs AltGr (Ctrl+Alt).
  if (key === "/" && !input.alt) return "shortcuts";
  if (key === "\\") return "toggle-rail";
  if (input.alt || input.shift) return null;
  if (key === "k") return "search";
  if (key === ",") return "settings";
  if (key === "h") return "home";
  if (/^[1-9]$/.test(key)) return `workspace-${Number(key)}`;
  return null;
}