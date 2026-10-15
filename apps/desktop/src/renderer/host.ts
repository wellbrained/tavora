// Host UI state: the latest view state from the main process, plus the
// dialog, menu and toast that are shown over it.
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { ActionResult, HostAction, HostShortcut, HostViewState } from "../shared/host-api";
import { shortcutForKey } from "../shared/shortcut-keys";
import type { SettingsSection } from "./components/settings/settings-index";
import { numberedGames } from "./shortcuts";
import { applyTheme } from "./theme";

export const api = window.tavoraHost;
export const state = shallowRef<HostViewState | null>(null);

api.onState((next) => (state.value = next));
void api.getState().then((initial) => {
  if (initial && !state.value) state.value = initial;
});
watch(state, (next) => next && applyTheme(next.appearance));

export const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string): void {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 5000);
}

/** Runs an action. Errors are shown as a toast unless the caller handles them. */
export async function act(action: HostAction, { quiet = false } = {}): Promise<ActionResult> {
  const result = await api.act(action);
  if (!result.ok && !quiet) showToast(result.error);
  return result;
}

// ── Menus and dialogs ──────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  testid?: string;
  danger?: boolean;
  /** Starts a new section of the menu. */
  separator?: boolean;
  disabled?: boolean;
  /** Marks the current choice in a list of choices; a list where any item sets this shows a check column. */
  checked?: boolean;
  /** Opens a nested list. */
  submenu?: () => MenuItem[];
  run?: () => unknown;
}

export interface PromptRequest {
  kind: "prompt";
  title: string;
  label: string;
  value: string;
  confirm: string;
  maxLength: number;
  /** Returns an error to show, or null when done. */
  submit(value: string): Promise<string | null>;
}

export interface ConfirmRequest {
  kind: "confirm";
  title: string;
  message: string;
  confirm: string;
  danger: boolean;
  run(): Promise<string | null>;
}

/** Offering icons to Tavora: the games ticked at first, or none. */
export interface ShareIconsRequest {
  kind: "share-icons";
  gameIds: string[];
}

export type DialogRequest = PromptRequest | ConfirmRequest | ShareIconsRequest | { kind: "add-game" } | { kind: "add-module" };

export const dialog = shallowRef<DialogRequest | null>(null);

/** Settings is its own dialog, so a confirmation can open on top of it. */
export const settingsOpen = ref(false);

/** Where Settings opens: a section, and optionally a setting to point out. */
export const settingsTarget = shallowRef<{ section: SettingsSection; setting?: string }>({ section: "general" });

export function openSettings(target: { section: SettingsSection; setting?: string } = { section: "general" }): void {
  settingsTarget.value = target;
  settingsOpen.value = true;
}

/** The search box behind Ctrl+K. */
export const searchOpen = ref(false);
/** Bumped by Ctrl+\; the rail toggles itself when it changes. */
export const railToggles = ref(0);

function runShortcut(shortcut: HostShortcut): void {
  if (shortcut === "search") searchOpen.value = !searchOpen.value;
  else if (shortcut === "shortcuts") openSettings({ section: "shortcuts" });
  else if (shortcut === "settings") openSettings();
  else if (shortcut === "toggle-rail") railToggles.value++;
  else if (shortcut === "home") void act({ type: "show-welcome" });
  else {
    const library = state.value?.library;
    const gameId = library ? numberedGames(library)[Number(shortcut.slice("game-".length)) - 1] : undefined;
    if (gameId) void act({ type: "open-game", gameId });
  }
}

api.onShortcut(runShortcut);

// Main catches Tavora's shortcuts before any page sees the key (and stops it
// there, so this never runs twice for one press). This covers key events that
// reach the page without passing through main, such as synthetic ones in tests.
addEventListener("keydown", (event) => {
  const shortcut = shortcutForKey(
    { type: "keyDown", key: event.key, control: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey },
    navigator.platform.startsWith("Mac"),
  );
  if (!shortcut) return;
  event.preventDefault();
  runShortcut(shortcut);
});

export function prompt(request: Omit<PromptRequest, "kind" | "value" | "maxLength"> & { value?: string; maxLength?: number }) {
  dialog.value = { kind: "prompt", value: "", maxLength: 80, ...request };
}

export function confirmAction(request: Omit<ConfirmRequest, "kind" | "danger"> & { danger?: boolean }) {
  dialog.value = { kind: "confirm", danger: false, ...request };
}

/** Prompt submit helper: runs the action and reports its error inline. */
export async function submitAction(action: HostAction): Promise<string | null> {
  const result = await act(action, { quiet: true });
  return result.ok ? null : result.error;
}

// Module panels are separate native views drawn above this page, so they
// are hidden while a menu, dialog or drag floats over the workspace. Still
// images of them stand in meanwhile.
const openMenus = ref(0);

/** True while a panel or group is dragged, or a split is being resized. */
export const dragging = ref(false);

/** Still images of the panels, by instance id, while they are hidden. */
export const frozen = shallowRef<Record<string, string>>({});
api.onFrozen((images) => (frozen.value = images));

/** For a menu component: reports its open state, also when it unmounts open. */
export function useFloating(): (open: boolean) => void {
  let isOpen = false;
  const set = (open: boolean) => {
    if (open === isOpen) return;
    isOpen = open;
    openMenus.value += open ? 1 : -1;
  };
  onBeforeUnmount(() => set(false));
  return set;
}

export const overlayOpen = computed(
  () =>
    openMenus.value > 0 ||
    dialog.value !== null ||
    settingsOpen.value ||
    searchOpen.value ||
    dragging.value,
);
watch(overlayOpen, (open) => {
  if (!open) frozen.value = {};
  api.setOverlay(open);
});
