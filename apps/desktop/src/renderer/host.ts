// Host UI state: the latest view state from the main process, plus the
// dialog, menu and toast that are shown over it.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { AccountView, ActionResult, AiUsageView, DiscordView, HostAction, HostShortcut, HostViewState, ModuleMenu } from "../shared/host-api";
import { shortcutForKey } from "../shared/shortcut-keys";
import type { SettingsSection } from "./components/settings/settings-index";
import { numberedGames } from "./shortcuts";
import { setLanguage } from "./i18n";
import { applyTheme } from "./theme";

export const api = window.tavoraHost;
export const state = shallowRef<HostViewState | null>(null);

api.onState((next) => (state.value = next));
void api.getState().then((initial) => {
  if (initial && !state.value) state.value = initial;
});
watch(state, (next) => {
  if (!next) return;
  applyTheme(next.appearance);
  setLanguage(next.language.resolved);
});

/** Settings > Integrations > Discord: the Discord connector's sign-in. */
export const discord = shallowRef<DiscordView | null>(null);
api.onDiscord((next) => (discord.value = next));
void api.getDiscord().then((initial) => {
  if (initial && !discord.value) discord.value = initial;
});

/** The AI usage panel's accounts and readings, and Settings > Integrations. */
export const aiUsage = shallowRef<AiUsageView | null>(null);
api.onAiUsage((next) => (aiUsage.value = next));
void api.getAiUsage().then((initial) => {
  if (initial && !aiUsage.value) aiUsage.value = initial;
});

/** Settings > Account: the address, the devices and where a sign-in is. */
export const account = shallowRef<AccountView | null>(null);
api.onAccount((next) => (account.value = next));
void api.getAccount().then((initial) => {
  if (initial && !account.value) account.value = initial;
});

/** Settings sections not shown on this run: Account until accounts are on. */
export const hiddenSettings = computed<ReadonlySet<SettingsSection>>(() => new Set(account.value?.enabled ? [] : ["account"]));

export const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string): void {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 5000);
}

/** Runs an action. Errors are shown as a toast unless the caller handles them. */
export async function act(action: HostAction, { quiet = false } = {}): Promise<ActionResult> {
  const started = performance.now();
  const result = await api.act(action);
  if (!result.ok && !quiet) showToast(result.error);
  if (result.ok && action.type === "open-game") void measureSwitch(started);
  return result;
}

/** How long a game switch took until the new screen was drawn, for Settings > Diagnostic info. */
async function measureSwitch(started: number): Promise<void> {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  void api.act({ type: "record-timing", name: "game-switch", ms: performance.now() - started });
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

/**
 * Offering icons to Tavora: the games ticked at first, or none. With `steam`, the games of the
 * last Steam import look-up with these appids instead, without adding them to the library.
 */
export interface ShareIconsRequest {
  kind: "share-icons";
  gameIds: string[];
  steam?: number[];
}

/** Adding a module; `slot` is the empty slot (a dock group id) it should fill. */
export interface AddModuleRequest {
  kind: "add-module";
  slot?: string;
}

/** Asking where a link from a module should open (HostViewState.pendingLink). */
export interface LinkChoiceRequest {
  kind: "link-choice";
  url: string;
}

/** A panel could not switch to what another panel asked for; asking whether to open it in a new panel (HostViewState.pendingNavigation). */
export interface NavigationChoiceRequest {
  kind: "navigation-choice";
  panel: string;
  content: string;
}

/**
 * The consent dialog: what a module asks for that the player has not granted. Drawn by Tavora,
 * never by the module. `slot` is where the module goes once allowed; a review (an update that asks
 * for more, from the bar on its panels) opens nothing.
 */
export interface GrantRequest {
  kind: "grant";
  moduleId: string;
  /** The panel type to open once allowed, for a module with panel types. */
  panelType?: string;
  slot: string | null;
  review: boolean;
}

export type DialogRequest =
  | PromptRequest
  | ConfirmRequest
  | ShareIconsRequest
  | LinkChoiceRequest
  | NavigationChoiceRequest
  | { kind: "add-game" }
  | { kind: "steam-import" }
  | AddModuleRequest
  | GrantRequest;

export const dialog = shallowRef<DialogRequest | null>(null);

// A panel could not switch to what another panel of its module asked for: ask whether to open it in a new one.
watch(
  () => state.value?.pendingNavigation ?? null,
  (pending) => {
    if (pending && dialog.value?.kind !== "navigation-choice") dialog.value = { kind: "navigation-choice", ...pending };
  },
);

// A module asked to open a link and no Browser panel is open: ask where.
watch(
  () => state.value?.pendingLink ?? null,
  (url) => {
    if (url && dialog.value?.kind !== "link-choice") dialog.value = { kind: "link-choice", url };
  },
);

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

/** Asks a Browser panel's toolbar to focus its address bar; a new object each time. */
export const addressFocus = shallowRef<{ instanceId: string } | null>(null);
/** Asks the workspace to bring a panel to the front of its group (panels.open); a new object each time. */
export const panelToShow = shallowRef<{ instanceId: string } | null>(null);

function runShortcut(shortcut: HostShortcut): void {
  if (shortcut.startsWith("address:")) addressFocus.value = { instanceId: shortcut.slice("address:".length) };
  else if (shortcut.startsWith("panel:")) panelToShow.value = { instanceId: shortcut.slice("panel:".length) };
  else if (shortcut === "search") searchOpen.value = !searchOpen.value;
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

type ModuleState = HostViewState["modules"][number];

/** Whether the module asks for something the player has not granted yet. */
export function needsGrant(module: ModuleState): boolean {
  return module.permissions.missing.network.length > 0 || module.permissions.missing.connectors.length > 0;
}

/**
 * Adds a module to the current game, into `slot` if given; `panelType` picks one of its panel types
 * (its continuing type when left out). A module that asks for something not granted yet goes through
 * the consent dialog first; once granted, it is added without asking.
 */
export function addModule(moduleId: string, slot: string | null = null, panelType?: string): void {
  const module = state.value?.modules.find((item) => item.id === moduleId);
  if (!module) return;
  if (needsGrant(module)) {
    dialog.value = { kind: "grant", moduleId, slot, review: false, ...(panelType ? { panelType } : {}) };
    return;
  }
  dialog.value = null;
  nextPanelSlot.value = slot;
  void act({ type: "open-module", moduleId, ...(panelType ? { panelType } : {}) });
}

/** Names joined as a sentence in Tavora's language: "A, B and C". */
export function listOf(names: string[]): string {
  return new Intl.ListFormat(state.value?.language.resolved ?? "en", { type: "conjunction" }).format(names);
}

/** The names of the games a module is used in, for the dialogs that remove its panels. */
export function gamesUsing(module: ModuleState): string[] {
  const games = state.value?.library.games ?? {};
  return module.usedIn.flatMap((gameId) => (games[gameId] ? [games[gameId].name] : []));
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

/** The empty slot (a dock group id) the next panel to open goes into, if any. */
export const nextPanelSlot = ref<string | null>(null);

/** A module's menu to draw over its panel (ui.showMenu), or null. */
export const moduleMenu = shallowRef<ModuleMenu | null>(null);
api.onModuleMenu((menu) => (moduleMenu.value = menu));

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
