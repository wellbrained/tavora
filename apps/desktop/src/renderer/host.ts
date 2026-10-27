// Host UI state: the latest view state from the main process, plus the
// dialog, menu and toast that are shown over it.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { EMPTY_INBOX, type InboxView } from "../shared/conversations";
import type { AccountView, ActionResult, ReleaseCopy, ReleaseStatus, ModuleConnector, AiUsageView, CloudCopyView, DeveloperKeysView, DiscordView, HostAction, PairingView, HostShortcut, HostViewState, ModuleMenu, PublishView } from "../shared/host-api";
import { shortcutForKey } from "../shared/shortcut-keys";
import { SETTING_SECTIONS, type SettingsSection } from "./components/settings/settings-index";
import { numberedWorkspaces } from "./shortcuts";
import { setLanguage, t } from "./i18n";
import { applyTheme } from "./theme";
import { developerSetup } from "./developer-setup";

export const api = window.tavoraHost;
export const state = shallowRef<HostViewState | null>(null);

api.onState((next) => (state.value = next));
/** The first state; rejects when the main process fails to give one, so start.ts can show why. */
export const firstState = api.getState().then((initial) => {
  if (initial && !state.value) state.value = initial;
});
watch(state, (next) => {
  if (!next) return;
  applyTheme(next.appearance);
  setLanguage(next.language.resolved);
});

/**
 * What each release copy loaded from a development folder still needs, by module id, as the catalog says;
 * null while unknown (not asked yet, offline). Asked when Settings opens, when a copy changes while it is
 * open and after a Publish; nothing runs in the background otherwise.
 */
export const releaseStatus = shallowRef<Record<string, ReleaseStatus> | null>(null);
let releaseAsk = 0;

/** The release copies loaded now: development-folder modules with a publishable id (not local.…). */
function releaseCopies(): ReleaseCopy[] {
  return (state.value?.modules ?? []).filter((module) => module.origin.kind === "dev" && !module.id.startsWith("local.")).map((module) => ({ id: module.id, version: module.version }));
}

/** One look at the catalog for the release copies; a newer ask makes an older answer not count. */
export async function refreshReleaseStatuses(): Promise<void> {
  const ask = ++releaseAsk;
  const copies = releaseCopies();
  const answer = copies.length ? await api.releaseStatuses(copies) : null;
  if (ask === releaseAsk) releaseStatus.value = answer;
}

/** How many release copies need publishing; 0 while unknown. */
export const releasePendingCount = computed(() => {
  const known = releaseStatus.value;
  if (!known) return 0;
  return releaseCopies().filter((copy) => known[copy.id] === "new-version" || known[copy.id] === "not-published").length;
});

/** Settings > Integrations > Discord: the Discord connector's sign-in. */
export const discord = shallowRef<DiscordView | null>(null);
api.onDiscord((next) => (discord.value = next));
void api.getDiscord().then((initial) => {
  if (initial && !discord.value) discord.value = initial;
});

/** Whether an installed module asks for this connector; Settings > Integrations shows Discord and AI usage only then. */
export function asksFor(connector: ModuleConnector): boolean {
  return (state.value?.modules ?? []).some((module) => module.permissions.asks.connectors.includes(connector));
}

/**
 * The AI usage accounts, for Settings > Integrations and the consent dialog. Asked for only once a
 * module wants them, so Tavora reads no AI login for a user without such a module.
 */
export const aiUsage = shallowRef<AiUsageView | null>(null);
api.onAiUsage((next) => (aiUsage.value = next));
const stopAiUsageWatch = watch(
  () => asksFor("ai-usage"),
  (asks) => {
    if (!asks) return;
    queueMicrotask(() => stopAiUsageWatch());
    void api.getAiUsage().then((initial) => {
      if (initial && !aiUsage.value) aiUsage.value = initial;
    });
  },
  { immediate: true },
);

/** Settings > Account: the address, the devices and where a sign-in is. */
export const account = shallowRef<AccountView | null>(null);
api.onAccount((next) => (account.value = next));
void api.getAccount().then((initial) => {
  if (initial && !account.value) account.value = initial;
});

/** The header's inbox icon, the conversations and the notes about them. */
export const inbox = shallowRef<InboxView>(EMPTY_INBOX);
api.onInbox((next) => (inbox.value = next));
void api.getInbox().then((initial) => {
  if (initial && inbox.value === EMPTY_INBOX) inbox.value = initial;
});
/** The inbox is its own dialog (like Settings), so a confirmation can open on top of it. `id` is the conversation to show; `module` starts a new request. */
export const inboxOpen = shallowRef<{ id?: string } | null>(null);
export function openInbox(id?: string): void {
  inboxOpen.value = id ? { id } : {};
  void act({ type: "inbox-refresh" }, { quiet: true });
}

/** Settings > Account > Cloud copy, and the questions it asks over the app. */
export const cloudCopy = shallowRef<CloudCopyView | null>(null);
api.onCloudCopy((next) => (cloudCopy.value = next));
void api.getCloudCopy().then((initial) => {
  if (initial && !cloudCopy.value) cloudCopy.value = initial;
});
/** Settings > Account > Module developer, and the pack command's sign request over the app. */
export const developerKeys = shallowRef<DeveloperKeysView | null>(null);
api.onDeveloperKeys((next) => (developerKeys.value = next));
void api.getDeveloperKeys().then((initial) => {
  if (initial && !developerKeys.value) developerKeys.value = initial;
});

/** The review screen before a dev module goes to the catalog; null while none is open. */
export const publish = shallowRef<PublishView | null>(null);
api.onPublish((next) => (publish.value = next));
void api.getPublish().then((initial) => {
  if (initial && !publish.value) publish.value = initial;
});

/** Publishing is set up, isn't, or isn't known yet (see `developerSetup`). */
export const developerState = computed(() => developerSetup(account.value, developerKeys.value));
/** Publishing is set up. Until then Publish and Save as zip open the developer onboarding instead. */
export const developerReady = computed(() => developerState.value === "ready");

/**
 * Whether Publish or Save as zip may go on; otherwise it opens the onboarding. While the developer side is
 * unknown it is read first: offline that fails with its message and nothing opens.
 */
async function readyToPublish(then?: string): Promise<boolean> {
  if (developerState.value === "unknown" && account.value?.account && !(await act({ type: "account-refresh" })).ok) return false;
  if (developerReady.value) return true;
  dialog.value = then ? { kind: "developer-start", then } : { kind: "developer-start" };
  return false;
}

/** Publish on a dev module: the review screen, or the onboarding first while publishing isn't set up. */
export function publishModule(moduleId: string): void {
  void readyToPublish(moduleId).then((ready) => {
    if (ready) void act({ type: "publish-review", moduleId });
  });
}

/** Save as zip on a dev module: signed with the kept key, so it needs the same setup as Publish. */
export async function saveModuleZip(moduleId: string): Promise<void> {
  if (!(await readyToPublish())) return;
  const result = await act({ type: "save-module-zip", moduleId });
  if (result.ok && result.id) showToast(t("publish.zipSaved", { file: result.id }));
}

/** Approving a new PC from an old one: this PC asking, or another PC asking this one. */
export const pairing = shallowRef<PairingView | null>(null);
api.onPairing((next) => (pairing.value = next));
void api.getPairing().then((initial) => {
  if (initial && !pairing.value) pairing.value = initial;
});

/** The question the cloud copy asks over the app, unless the user put it off for now. */
export const copyLater = ref<"conflict" | "newer" | null>(null);
export const copyQuestion = computed<"closing" | "conflict" | "newer" | null>(() => {
  const view = cloudCopy.value;
  if (!view) return null;
  if (view.closing) return "closing";
  if (view.conflict && copyLater.value !== "conflict") return "conflict";
  if (view.restartToTake && copyLater.value !== "newer") return "newer";
  return null;
});

/** Settings sections not shown on this run: Account until accounts are on. */
export const hiddenSettings = computed<ReadonlySet<SettingsSection>>(
  () => new Set<SettingsSection>([...(account.value?.enabled ? [] : (["account"] as const)), ...(state.value?.gameOverlays.supported ? [] : (["overlays"] as const))]),
);

/** Single settings not shown on this run: Discord and AI usage until an installed module asks for them. */
export const hiddenSettingIds = computed<ReadonlySet<string>>(
  () => new Set([...(asksFor("discord") ? [] : ["discord-connection"]), ...(asksFor("ai-usage") ? [] : ["ai-usage-accounts"])]),
);

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
  if (result.ok && action.type === "open-workspace") void measureSwitch(started);
  return result;
}

/** How long a workspace switch took until the new screen was drawn, for Settings > Diagnostic info. */
async function measureSwitch(started: number): Promise<void> {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  void api.act({ type: "record-timing", name: "workspace-switch", ms: performance.now() - started });
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
  /** A section's heading, not something to pick. */
  heading?: boolean;
  /** A module's (or one of its panel types') icon in front of the label. */
  icon?: { moduleId: string; panelType?: string | null };
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
 * Offering icons to Tavora: the games of these game workspaces ticked at first, or none. With `steam`, the games of the
 * last Steam import look-up with these appids instead, without adding them to the library.
 */
export interface ShareIconsRequest {
  kind: "share-icons";
  workspaceIds: string[];
  steam?: number[];
}

/** Adding a module; `slot` is the empty slot (a dock group id) it should fill, `view` the library view to open on. */
export interface AddModuleRequest {
  kind: "add-module";
  slot?: string;
  view?: "catalog" | "updates";
  /** Opens the catalog with this module's page, such as one just published. */
  browse?: string;
}

/** Asking where a link from a module should open (HostViewState.pendingLink). */
export interface LinkChoiceRequest {
  kind: "link-choice";
  url: string;
}

/** A game of the library just started and the user chose to be asked (HostViewState.pendingGameSwitch). */
export interface GameSwitchRequest {
  kind: "game-switch";
  gameId: string;
}

/** A panel could not switch to what another panel asked for; asking whether to open it in a new panel (HostViewState.pendingNavigation). */
export interface NavigationChoiceRequest {
  kind: "navigation-choice";
  panel: string;
  content: string;
}

/**
 * The consent dialog: what a module asks for that the user has not granted. Drawn by Tavora,
 * never by the module. `slot` is where the module goes once allowed; a review (an update that asks
 * for more, from the bar on its panels) opens nothing.
 */
export interface GrantRequest {
  kind: "grant";
  moduleId: string;
  /** The panel types to open once allowed, for a module with panel types; one panel of each. */
  panelTypes?: string[];
  slot: string | null;
  /** Back to the module library once the panels are open, so more can be added (AddModuleDialog.vue). */
  backToLibrary?: boolean;
  review: boolean;
  /** A catalog update that asks for more (ModuleState.update): allowing it installs the update. */
  update?: boolean;
  /** Back to the library's Updates view when answered, going on with the ones queued by Update all. */
  backToUpdates?: boolean;
  /** A connector the module asks for on request, now that it needs it (HostViewState.pendingConnector). */
  onRequest?: { id: number; connectors: ModuleConnector[] };
}

export type DialogRequest =
  | PromptRequest
  | ConfirmRequest
  | ShareIconsRequest
  | LinkChoiceRequest
  | NavigationChoiceRequest
  | GameSwitchRequest
  | { kind: "add-game" }
  | { kind: "steam-import" }
  | AddModuleRequest
  | GrantRequest
  /** The developer onboarding; `then` is the module whose Publish opened it, reviewed once it is done. */
  | { kind: "developer-start"; then?: string }
  /** Signed in on a PC without the account's recovery key: unlock the cloud copy and publisher keys here. */
  | { kind: "recovery-ask" }
  /** Make a copy of an example that ships with Tavora (Settings > Development). */
  | { kind: "copy-example"; moduleId: string }
  /** Report a catalog module to Tavora (Settings > Modules). */
  | { kind: "report-module"; moduleId: string; name: string };

export const dialog = shallowRef<DialogRequest | null>(null);

// Just signed in, on a PC without the account's recovery key while the account has one: ask for it
// now, once (the decision log: asked at sign-in, made only when the cloud copy or publishing needs it).
let askAfterSignIn = false;
function askForRecoveryKey(): void {
  const status = developerKeys.value?.status;
  if (!askAfterSignIn || !status || status === "loading" || status === "signed-out") return;
  askAfterSignIn = false;
  if (status === "ask" && !dialog.value) dialog.value = { kind: "recovery-ask" };
}
watch(
  () => (account.value ? Boolean(account.value.account) : null),
  (signedIn, before) => {
    askAfterSignIn = before === false && signedIn === true;
    askForRecoveryKey();
  },
);
watch(() => developerKeys.value?.status, askForRecoveryKey);

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

// A game started while the user chose to be asked: ask whether to switch. It goes away when the game closes.
watch(
  () => state.value?.pendingGameSwitch ?? null,
  (gameId) => {
    if (gameId && (!dialog.value || dialog.value.kind === "game-switch")) dialog.value = { kind: "game-switch", gameId };
    else if (!gameId && dialog.value?.kind === "game-switch") dialog.value = null;
  },
);

// A module needs a connector it asks for on request (its first Copy OBS link): Tavora's consent dialog asks.
watch(
  () => state.value?.pendingConnector ?? null,
  (pending) => {
    if (pending) dialog.value = { kind: "grant", moduleId: pending.moduleId, slot: null, review: true, onRequest: { id: pending.id, connectors: [...pending.connectors] } };
    else if (dialog.value?.kind === "grant" && dialog.value.onRequest) dialog.value = null;
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

// A copy added, removed or built to another version while Settings is open: ask again.
watch(
  () => releaseCopies().map((copy) => `${copy.id}@${copy.version}`).join(","),
  () => {
    if (settingsOpen.value) void refreshReleaseStatuses();
  },
);

// A Publish that went through: ask again, so the badge goes once the new version is listed.
watch(
  () => publish.value?.status,
  (status) => {
    if (status === "published") void refreshReleaseStatuses();
  },
);

/** The search box behind Ctrl+K. */
export const searchOpen = ref(false);
/** Bumped by Ctrl+\; the rail toggles itself when it changes. */
export const railToggles = ref(0);

/** Asks a Browser panel's toolbar to focus its address bar; a new object each time. */
export const addressFocus = shallowRef<{ instanceId: string } | null>(null);
/** Asks the workspace to bring a panel to the front of its group (panels.open); a new object each time. */
export const panelToShow = shallowRef<{ instanceId: string } | null>(null);
/** Asks the workspace to make a panel's group fill it, or to put it back (panel.setMaximized); a new object each time. */
export const panelToMaximize = shallowRef<{ instanceId: string; maximized: boolean } | null>(null);

function runShortcut(shortcut: HostShortcut): void {
  if (shortcut.startsWith("address:")) addressFocus.value = { instanceId: shortcut.slice("address:".length) };
  else if (shortcut.startsWith("panel:")) panelToShow.value = { instanceId: shortcut.slice("panel:".length) };
  else if (shortcut.startsWith("maximize:")) panelToMaximize.value = { instanceId: shortcut.slice("maximize:".length), maximized: true };
  else if (shortcut.startsWith("restore:")) panelToMaximize.value = { instanceId: shortcut.slice("restore:".length), maximized: false };
  else if (shortcut.startsWith("setting:")) {
    const setting = shortcut.slice("setting:".length);
    const section = SETTING_SECTIONS.find(([id]) => id === setting)?.[1];
    if (section) openSettings({ section, setting });
  }
  else if (shortcut === "search") searchOpen.value = !searchOpen.value;
  else if (shortcut === "shortcuts") openSettings({ section: "shortcuts" });
  else if (shortcut === "settings") openSettings();
  else if (shortcut === "toggle-rail") railToggles.value++;
  else if (shortcut === "home") void act({ type: "show-welcome" });
  else {
    const library = state.value?.library;
    const workspaceId = library ? numberedWorkspaces(library)[Number(shortcut.slice("workspace-".length)) - 1] : undefined;
    if (workspaceId) void act({ type: "open-workspace", workspaceId });
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

/** Update all: modules whose update asks for new access, still to answer one after another. */
export const updateQueue = ref<string[]>([]);

/** Opens the consent dialog for a waiting update; answering it returns to the library's Updates view. */
export function askForUpdate(moduleId: string): void {
  dialog.value = { kind: "grant", moduleId, slot: null, review: true, update: true, backToUpdates: true };
}

/** After an update was answered: the next one queued by Update all, or back to the Updates view. */
export function nextUpdateAsk(): void {
  let next = updateQueue.value.shift();
  while (next !== undefined && !state.value?.modules.find((item) => item.id === next)?.update) next = updateQueue.value.shift();
  if (next !== undefined) askForUpdate(next);
  else dialog.value = { kind: "add-module", view: "updates" };
}

/** "Not now" on an update from the Updates view: the rest of the queue is dropped. */
export function stopUpdateAsks(): void {
  updateQueue.value = [];
  dialog.value = { kind: "add-module", view: "updates" };
}

/** Whether the module asks for something the user has not granted yet. */
export function needsGrant(module: ModuleState): boolean {
  return module.permissions.missing.network.length > 0 || module.permissions.missing.connectors.length > 0;
}

/**
 * Adds a module to the current workspace, into `slot` if given; `panelTypes` picks which of its panel
 * types to open, one panel each (its continuing type when left out). A module that asks for something
 * not granted yet goes through the consent dialog first; once granted, it is added without asking.
 * `stay` keeps the module library open afterwards, so more panels can be added from it.
 */
export function addModule(moduleId: string, slot: string | null = null, panelTypes: string[] = [], { stay = false } = {}): void {
  const module = state.value?.modules.find((item) => item.id === moduleId);
  if (!module) return;
  if (needsGrant(module)) {
    dialog.value = { kind: "grant", moduleId, slot, review: false, ...(panelTypes.length ? { panelTypes } : {}), ...(stay ? { backToLibrary: true } : {}) };
    return;
  }
  if (!stay) dialog.value = null;
  void openPanels(moduleId, slot, panelTypes);
}

/**
 * One of a module's panel types (null: a module without types) from the modules menu or Ctrl+K: a panel of it
 * already open in this workspace comes to the front (the one used last), else one is added.
 */
export function showOrAddPanel(moduleId: string, panelType: string | null): void {
  const open = state.value?.panels.some((panel) => panel.moduleId === moduleId && panel.panelType === panelType);
  if (open) void act({ type: "open-module", moduleId, ...(panelType ? { panelType } : {}), reuse: true });
  else addModule(moduleId, null, panelType ? [panelType] : []);
}

/** Opens a module's panels one after another, the first into `slot`; stops at the first that fails (its error is shown). */
export async function openPanels(moduleId: string, slot: string | null, panelTypes: string[]): Promise<void> {
  nextPanelSlot.value = slot;
  for (const panelType of panelTypes.length ? panelTypes : [undefined]) {
    const result = await act({ type: "open-module", moduleId, ...(panelType ? { panelType } : {}) });
    if (!result.ok) return;
  }
}

/** Names joined as a sentence in Tavora's language: "A, B and C". */
export function listOf(names: string[]): string {
  return new Intl.ListFormat(state.value?.language.resolved ?? "en", { type: "conjunction" }).format(names);
}

/** The names of the workspaces a module is used in, for the dialogs that remove its panels. */
export function workspacesUsing(module: ModuleState): string[] {
  const workspaces = state.value?.library.workspaces ?? {};
  return module.usedIn.flatMap((workspaceId) => (workspaces[workspaceId] ? [workspaces[workspaceId].name] : []));
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
let frozenChanges = 0;
/** The pictures not yet painted on screen, and what to do once they all are. */
let unpainted: { ids: Set<string>; done: () => void } | null = null;
// Chromium reports a picture (elementtiming "frozen:<instance id>", PanelContent.vue) once a frame with it is on
// screen. Put in the page is not enough: a big image can take a few frames more, and the slot shows empty until then.
new PerformanceObserver((list) => {
  if (!unpainted) return;
  for (const entry of list.getEntries() as (PerformanceEntry & { identifier: string })[]) unpainted.ids.delete(entry.identifier.replace(/^frozen:/, ""));
  if (!unpainted.ids.size) unpainted.done();
}).observe({ type: "element" });
api.onFrozen((images) => {
  const change = ++frozenChanges;
  unpainted = null;
  frozen.value = images;
  const ids = Object.keys(images);
  // The host hides the panels once their pictures are on screen.
  if (ids.length) unpainted = { ids: new Set(ids), done: () => ((unpainted = null), change === frozenChanges && api.frozenShown()) };
});

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

let hintOpen = false;
let hintRelease: ReturnType<typeof setTimeout> | undefined;
/** For the page's hover hints, which float like a menu. Closing waits a moment, so moving from one hint to the next does not show and hide the panels each time. */
export function setHintFloating(open: boolean): void {
  clearTimeout(hintRelease);
  const set = (value: boolean) => {
    if (value === hintOpen) return;
    hintOpen = value;
    openMenus.value += value ? 1 : -1;
  };
  if (open) set(true);
  else hintRelease = setTimeout(() => set(false), 400);
}

/** A note about the inbox (or the developer note) waits and nothing else is open, so InboxNotes.vue shows it. */
export const noteShown = computed(() => (inbox.value.note !== null || inbox.value.developerNote) && dialog.value === null && !settingsOpen.value && inboxOpen.value === null);

export const overlayOpen = computed(
  () =>
    openMenus.value > 0 ||
    inboxOpen.value !== null ||
    noteShown.value ||
    dialog.value !== null ||
    copyQuestion.value !== null ||
    state.value?.hotkeyRequest != null ||
    publish.value !== null ||
    settingsOpen.value ||
    searchOpen.value ||
    dragging.value,
);
// The panels' pictures stay after a dialog closes, under the panels, until the host says every panel has drawn again.
watch(overlayOpen, (open) => api.setOverlay(open));

// The system draws the window buttons above the page, so a dialog backdrop can't dim them: while one is open,
// the host dims them instead.
let dimmed = false;
new MutationObserver(() => {
  const now = document.querySelector('[data-slot="dialog-overlay"][data-state="open"]') !== null;
  if (now === dimmed) return;
  dimmed = now;
  api.setDimmed(now);
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
