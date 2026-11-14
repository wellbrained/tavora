import type { MessageKey } from "./i18n-core";

// Every keyboard shortcut Tavora has, in one table. The main process matches keys against it, Settings > Shortcuts
// lists it, buttons take their `aria-keyshortcuts` (and so their tooltip's key caps) from it, and shortcuts.test.ts
// fails when two of it share a key. Add a shortcut here first; the place that runs it asks `shortcutIn`.

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

  { id: "layout.undo", keys: "Mod+Z", scope: "layout", group: "overlays", label: "overlays.layout.undo" },
  { id: "layout.redo", keys: "Mod+Y", scope: "layout", group: "overlays", label: "overlays.layout.redo" },

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

export function shortcutSpec(id: ShortcutId): ShortcutSpec {
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

/** One way to press a shortcut on a platform, as a string two specs share exactly when they share the press. */
function combo(held: ReadonlySet<Modifier>, key: string): string {
  return `${MODIFIERS.filter((modifier) => held.has(modifier)).join("+")}:${key.length === 1 ? key.toLowerCase() : key}`;
}

function modifierOf(name: string, mac: boolean): Modifier | null {
  if (name === "Mod") return mac ? "meta" : "control";
  if (name === "OtherMod") return mac ? "control" : "meta";
  if (name === "Control" || name === "Meta" || name === "Alt" || name === "Shift") return name.toLowerCase() as Modifier;
  return null;
}

/** Every press of a spec on a platform, each with what it matches as. */
export function pressesOf(spec: ShortcutSpec, mac: boolean): { combo: string; id: string }[] {
  const presses: { combo: string; id: string }[] = [];
  for (const alternative of spec.keys.split(" ")) {
    const parts = alternative.split(/\+(?!$)/);
    const key = parts.pop()!;
    const held = new Set(parts.map((part) => modifierOf(part, mac)!));
    const loose = (spec.loose ?? []).map((name) => modifierOf(name, mac)!).filter((modifier) => !held.has(modifier));
    const keys = key === "1-9" ? ["1", "2", "3", "4", "5", "6", "7", "8", "9"] : [key];
    for (const each of keys) {
      // Every choice of loose modifiers held or not.
      for (let mask = 0; mask < 1 << loose.length; mask++) {
        const all = new Set([...held, ...loose.filter((_, index) => mask & (1 << index))]);
        presses.push({ combo: combo(all, each), id: key === "1-9" ? `${spec.id}-${each}` : spec.id });
      }
    }
  }
  return presses;
}

const maps = new Map<string, Map<string, string>>();
function pressMap(scope: ShortcutScope, mac: boolean): Map<string, string> {
  const name = `${scope}:${mac}`;
  let map = maps.get(name);
  if (!map) {
    map = new Map();
    for (const spec of SPECS) if (spec.scope === scope) for (const press of pressesOf(spec, mac)) if (!map.has(press.combo)) map.set(press.combo, press.id);
    maps.set(name, map);
  }
  return map;
}

/** The shortcut of a scope a key press stands for, if any. */
export function shortcutIn(scope: ShortcutScope, input: KeyInput, mac: boolean): MatchedShortcut | null {
  if (input.type !== "keyDown") return null;
  const held = new Set(MODIFIERS.filter((modifier) => input[modifier]));
  return (pressMap(scope, mac).get(combo(held, input.key)) as MatchedShortcut | undefined) ?? null;
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

/** A shortcut's keys for `aria-keyshortcuts` on a platform: "Control+T", "Meta+T" on a Mac. */
export function ariaKeys(id: ShortcutId, mac: boolean): string {
  return shortcutSpec(id)
    .keys.split(" ")
    .flatMap((alternative) => {
      const named = alternative.replace(/^Mod\+/, mac ? "Meta+" : "Control+");
      return named.endsWith("1-9") ? ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => named.slice(0, -3) + digit) : [named];
    })
    .join(" ");
}
