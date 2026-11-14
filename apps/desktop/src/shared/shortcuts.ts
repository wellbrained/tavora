import type { MessageKey } from "./i18n-core";

// The keyboard shortcuts Settings > Shortcuts lists, in one table. The main process, the Browser panel and the Overlays
// editor match keys against it (`shortcutIn`), the list and buttons' `aria-keyshortcuts` (so their tooltip's key caps)
// come from it, and shortcuts.test.ts fails when two of it share a key. A new shortcut goes in here first.
// Keys that work inside one control only (Del or the arrows on the Overlays canvas, Page Up in a list) stay with it.

/**
 * Where a shortcut works, and so which others it must not share a key with.
 * - `app`: anywhere in Tavora, also while a module panel has the focus. Main catches these before any page sees the
 *   key, so none may be a key editors use, like Ctrl+B. They clash with every other scope.
 * - `browser`: in a Browser panel, its page or its toolbar.
 * - `layout`: on the Overlays page's editor.
 * - `list`: keys lists and dialogs share. Each list handles them itself; the table only names them.
 */
export type ShortcutScope = "app" | "browser" | "layout" | "list";

/** The heading a shortcut is listed under in Settings > Shortcuts, in this order. */
export const SHORTCUT_GROUPS = ["general", "workspaces", "browser", "overlays", "lists"] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

/** A modifier that may be held or not without changing the shortcut. `OtherMod` is whichever of Ctrl and Cmd `Mod` isn't. */
export type LooseModifier = "Shift" | "Alt" | "Control" | "Meta" | "OtherMod";

export interface ShortcutSpec {
  id: string;
  /**
   * The keys as `aria-keyshortcuts` writes them: `+` joins keys pressed together, a space separates alternatives.
   * `Mod` is Ctrl, Cmd on a Mac; `Control` is Ctrl on a Mac too. `1-9` stands for each digit, and the id gets it
   * (`workspace` matches as `workspace-3`).
   */
  keys: string;
  /** More presses that do the same, written like `keys`; they count, but the list and the key caps show `keys` only. */
  also?: string;
  scope: ShortcutScope;
  /** Listed in Settings > Shortcuts under this heading. */
  group: ShortcutGroup;
  /** What it does, in the list. */
  label: MessageKey;
  loose?: readonly LooseModifier[];
}

export const SHORTCUTS = [
  { id: "search", keys: "Mod+K", scope: "app", group: "general", label: "shortcuts.search" },
  // Symbols match the character typed, so they work on any layout: "/" needs Shift on a German keyboard and "\"
  // needs AltGr (Ctrl+Alt).
  { id: "shortcuts", keys: "Mod+/", scope: "app", group: "general", label: "shortcuts.shortcuts", loose: ["Shift"] },
  { id: "settings", keys: "Mod+,", scope: "app", group: "general", label: "shortcuts.settings" },
  { id: "home", keys: "Mod+H", scope: "app", group: "general", label: "shortcuts.home" },
  { id: "toggle-rail", keys: "Mod+\\", scope: "app", group: "general", label: "shortcuts.rail", loose: ["Shift", "Alt"] },
  { id: "workspace", keys: "Mod+1-9", scope: "app", group: "workspaces", label: "shortcuts.openWorkspace" },
  // Ctrl+Tab is Ctrl on a Mac too, as in browsers.
  { id: "next-tab", keys: "Control+Tab", scope: "app", group: "workspaces", label: "shortcuts.nextTab" },
  { id: "previous-tab", keys: "Control+Shift+Tab", scope: "app", group: "workspaces", label: "shortcuts.previousTab" },

  { id: "browser.address", keys: "Mod+L", scope: "browser", group: "browser", label: "shortcuts.address", loose: ["OtherMod"] },
  { id: "browser.new-tab", keys: "Mod+T", scope: "browser", group: "browser", label: "shortcuts.newTab", loose: ["OtherMod"] },
  { id: "browser.close-tab", keys: "Mod+W", scope: "browser", group: "browser", label: "shortcuts.closeTab", loose: ["OtherMod"] },
  { id: "browser.back", keys: "Alt+ArrowLeft", scope: "browser", group: "browser", label: "shortcuts.back", loose: ["Shift", "OtherMod"] },
  { id: "browser.forward", keys: "Alt+ArrowRight", scope: "browser", group: "browser", label: "shortcuts.forward", loose: ["Shift", "OtherMod"] },
  // Esc always leaves full screen, whatever else is held.
  { id: "browser.leave-fullscreen", keys: "Escape", scope: "browser", group: "browser", label: "shortcuts.leaveFullscreen", loose: ["Shift", "Alt", "Control", "Meta"] },

  // Ctrl and Cmd both work here, on every platform.
  { id: "layout.undo", keys: "Mod+Z", also: "OtherMod+Z", scope: "layout", group: "overlays", label: "overlays.layout.undo", loose: ["OtherMod"] },
  { id: "layout.redo", keys: "Mod+Y", also: "OtherMod+Y Mod+Shift+Z OtherMod+Shift+Z", scope: "layout", group: "overlays", label: "overlays.layout.redo", loose: ["OtherMod", "Shift"] },

  { id: "list.move", keys: "ArrowUp ArrowDown", scope: "list", group: "lists", label: "shortcuts.moveList" },
  { id: "list.resize", keys: "ArrowLeft ArrowRight", scope: "list", group: "lists", label: "shortcuts.resizeList" },
  { id: "list.pick", keys: "Enter", scope: "list", group: "lists", label: "shortcuts.pick" },
  { id: "list.close", keys: "Escape", scope: "list", group: "lists", label: "shortcuts.closeDialog" },
] as const satisfies readonly ShortcutSpec[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];
/** What a matched key stands for: a shortcut's id, a numbered one with its digit (`workspace-3`). */
export type MatchedShortcut = Exclude<ShortcutId, "workspace"> | `workspace-${number}`;
/** The ids of the Tavora-wide shortcuts, as main sends them to the host page. */
export type AppShortcut = Extract<MatchedShortcut, Extract<(typeof SHORTCUTS)[number], { scope: "app" }>["id"] | `workspace-${number}`>;

const SPECS: readonly ShortcutSpec[] = SHORTCUTS;

function shortcutSpec(id: ShortcutId): ShortcutSpec {
  return SPECS.find((spec) => spec.id === id)!;
}

/** The parts of a key event that decide a shortcut. Electron's and the browser's both fit. */
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

/** A browser KeyboardEvent as a KeyInput. */
export function keyInput(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): KeyInput {
  return { type: "keyDown", key: event.key, control: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey };
}

type Modifier = "control" | "meta" | "alt" | "shift";
const MODIFIERS: readonly Modifier[] = ["control", "meta", "alt", "shift"];

/** A press as a lookup key: the modifiers held and the key, a letter in lower case. */
function combo(held: Iterable<Modifier>, key: string): string {
  const set = new Set(held);
  return `${MODIFIERS.filter((modifier) => set.has(modifier)).join("+")}:${key.length === 1 ? key.toLowerCase() : key}`;
}

function modifierOf(name: string, mac: boolean): Modifier | null {
  if (name === "Mod") return mac ? "meta" : "control";
  if (name === "OtherMod") return mac ? "control" : "meta";
  if (name === "Control" || name === "Meta" || name === "Alt" || name === "Shift") return name.toLowerCase() as Modifier;
  return null;
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** A spec's presses on a platform as written (`keys`, then `also`), each with the id it matches as. */
function written(spec: ShortcutSpec, mac: boolean): { held: Modifier[]; key: string; id: string }[] {
  const alternatives = [...spec.keys.split(" "), ...(spec.also?.split(" ") ?? [])];
  return alternatives.flatMap((alternative) => {
    const parts = alternative.split(/\+(?!$)/);
    const key = parts.pop()!;
    const held = parts.map((part) => modifierOf(part, mac)!);
    return key === "1-9" ? DIGITS.map((digit) => ({ held, key: digit, id: `${spec.id}-${digit}` })) : [{ held, key, id: spec.id }];
  });
}

/** Every press of a spec on a platform, loose modifiers held or not, each with what it matches as. */
function pressesOf(spec: ShortcutSpec, mac: boolean): { combo: string; id: string }[] {
  return written(spec, mac).flatMap(({ held, key, id }) => {
    const loose = (spec.loose ?? []).map((name) => modifierOf(name, mac)!).filter((modifier) => !held.includes(modifier));
    return Array.from({ length: 1 << loose.length }, (_, mask) => ({ combo: combo([...held, ...loose.filter((_, index) => mask & (1 << index))], key), id }));
  });
}

/** Per scope and platform: each press and the shortcut it stands for. */
const pressMaps = new Map<string, Map<string, string>>();
function pressMap(scope: ShortcutScope, mac: boolean): Map<string, string> {
  const name = `${scope}:${mac}`;
  let map = pressMaps.get(name);
  if (!map) {
    map = new Map();
    for (const spec of SPECS) if (spec.scope === scope) for (const press of pressesOf(spec, mac)) if (!map.has(press.combo)) map.set(press.combo, press.id);
    pressMaps.set(name, map);
  }
  return map;
}

/** The shortcut of a scope a key press stands for, if any. */
export function shortcutIn(scope: ShortcutScope, input: KeyInput, mac: boolean): MatchedShortcut | null {
  if (input.type !== "keyDown") return null;
  return (pressMap(scope, mac).get(combo(MODIFIERS.filter((modifier) => input[modifier]), input.key)) as MatchedShortcut | undefined) ?? null;
}

/**
 * The Tavora-wide shortcut a key press stands for, if any. The main process catches these before any page sees the
 * key (so they work while a module panel has focus, and modules cannot take them over); the host page asks the same
 * for key events that reach it without passing through main, such as the synthetic ones in tests.
 */
export function shortcutForKey(input: KeyInput, mac: boolean): AppShortcut | null {
  return shortcutIn("app", input, mac) as AppShortcut | null;
}

const APP_IDS = new Set(SPECS.filter((spec) => spec.scope === "app").flatMap((spec) => pressesOf(spec, false).map((press) => press.id)));

/** Whether an id names one of the Tavora-wide shortcuts (`workspace-3` included). */
export function isAppShortcut(id: string): id is AppShortcut {
  return APP_IDS.has(id);
}

/** Pairs of shortcuts that would share a press on a platform: within one scope, or with a Tavora-wide one. */
export function shortcutClashes(specs: readonly ShortcutSpec[], mac: boolean): string[] {
  const clashes: string[] = [];
  const seen: { scope: ShortcutScope; id: string; combo: string }[] = [];
  for (const spec of specs) {
    for (const press of pressesOf(spec, mac)) {
      const other = seen.find((each) => each.combo === press.combo && each.id !== spec.id && (each.scope === spec.scope || each.scope === "app" || spec.scope === "app"));
      if (other) clashes.push(`${other.id} and ${spec.id} both take ${press.combo}${mac ? " on a Mac" : ""}`);
      seen.push({ scope: spec.scope, id: spec.id, combo: press.combo });
    }
  }
  return [...new Set(clashes)];
}

/** A shortcut's keys for `aria-keyshortcuts` on a platform, every press that counts: "Control+T", "Meta+T" on a Mac. */
export function ariaKeys(id: ShortcutId, mac: boolean): string {
  return written(shortcutSpec(id), mac)
    .map(({ held, key }) => [...MODIFIERS.filter((modifier) => held.includes(modifier)).map((modifier) => modifier[0]!.toUpperCase() + modifier.slice(1)), key].join("+"))
    .join(" ");
}

/** A shortcut's keys as shown (`keys`, not `also`), with `Mod` and `OtherMod` named for the platform: "Control+1-9", "Meta+T". */
export function shownKeys(id: ShortcutId, mac: boolean): string[] {
  const spec = shortcutSpec(id);
  return spec.keys.split(" ").map((alternative) => alternative.replace(/^Mod\+/, mac ? "Meta+" : "Control+").replace(/^OtherMod\+/, mac ? "Control+" : "Meta+"));
}
