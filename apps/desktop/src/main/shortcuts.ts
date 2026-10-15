import type { HostShortcut } from "../shared/host-api";

/** The parts of an Electron key event that decide a shortcut. */
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * Tavora-wide shortcuts. They are caught before any page sees the key, so
 * they work while a module panel has focus, and modules cannot take them
 * over (so none may be a key editors use, like Ctrl+B). Ctrl on Windows and
 * Linux, Cmd on macOS. Shown to players in the shortcut overview
 * (renderer/shortcuts.ts); keep both in step.
 */
export function shortcutFor(input: KeyInput): HostShortcut | null {
  if (input.type !== "keyDown") return null;
  const mod = process.platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
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
  if (/^[1-9]$/.test(key)) return `game-${Number(key)}`;
  return null;
}
