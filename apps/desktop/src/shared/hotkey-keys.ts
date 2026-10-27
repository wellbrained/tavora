/**
 * Hotkeys the player sets for module actions (hotkeys.set): Electron accelerators such as `Ctrl+Alt+K` or `num5`,
 * registered system-wide while their workspace is shown. Keys are taken by where they are on the keyboard (`event.code`),
 * so they stay the same whatever the layout. A key needs Ctrl, Alt or the Windows key, except F-keys and the number
 * pad, so a hotkey never takes a key the player types with.
 */

/** The parts of a browser key event a hotkey is made from. */
export interface HotkeyInput {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Super"] as const;

const NAMED_KEYS: Record<string, string> = {
  Space: "Space",
  Insert: "Insert",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  NumpadDecimal: "numdec",
};

/** The key part of an accelerator, from a key's place on the keyboard, or null for a key hotkeys don't take. */
function keyOf(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return NAMED_KEYS[code] ?? null;
}

/** Keys that work as a hotkey on their own: F-keys and the number pad. */
function standsAlone(key: string): boolean {
  return /^F\d+$/.test(key) || key.startsWith("num");
}

const KEYS = new Set([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `num${i}`),
  ...Object.values(NAMED_KEYS),
]);

export type HotkeyProblem = "modifier-only" | "unsupported" | "needs-modifier";

/** The accelerator a key press makes, or why it can't be a hotkey. */
export function hotkeyFromInput(input: HotkeyInput): { accelerator: string } | { problem: HotkeyProblem } {
  if (/^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(input.code)) return { problem: "modifier-only" };
  const key = keyOf(input.code);
  if (!key) return { problem: "unsupported" };
  const mods = [input.ctrlKey && "Ctrl", input.altKey && "Alt", input.shiftKey && "Shift", input.metaKey && "Super"].filter((mod): mod is string => !!mod);
  const accelerator = [...mods, key].join("+");
  return isHotkey(accelerator) ? { accelerator } : { problem: "needs-modifier" };
}

/** Whether a string is a hotkey Tavora sets: modifiers in a fixed order, then one key it takes, and a modifier unless the key stands alone. */
export function isHotkey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40) return false;
  const parts = value.split("+");
  const key = parts.pop()!;
  if (!KEYS.has(key)) return false;
  let last = -1;
  for (const part of parts) {
    const at = MODIFIERS.indexOf(part as (typeof MODIFIERS)[number]);
    if (at <= last) return false;
    last = at;
  }
  return parts.some((part) => part !== "Shift") || standsAlone(key);
}

/** The keys of a hotkey as the player reads them, one per key cap: `["Ctrl", "Alt", "K"]`, `["Num 5"]`. */
export function hotkeyKeys(accelerator: string, mac = false): string[] {
  return accelerator.split("+").map((part) => {
    if (part === "Super") return mac ? "⌘" : "Win";
    if (part === "Ctrl" && mac) return "⌃";
    if (part === "Alt" && mac) return "⌥";
    const num = /^num(\d)$/.exec(part);
    if (num) return `Num ${num[1]}`;
    return { numadd: "Num +", numsub: "Num −", nummult: "Num *", numdiv: "Num /", numdec: "Num ." }[part] ?? part;
  });
}
