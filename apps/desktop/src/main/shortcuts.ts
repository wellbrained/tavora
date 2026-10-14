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
 * over. Ctrl on Windows and Linux, Cmd on macOS.
 */
export function shortcutFor(input: KeyInput): HostShortcut | null {
  if (input.type !== "keyDown" || input.alt || input.shift) return null;
  const mod = process.platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
  if (mod && input.key.toLowerCase() === "k") return "search";
  return null;
}
