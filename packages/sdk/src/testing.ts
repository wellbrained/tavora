// @tavora/sdk/testing: a test adapter for module tests. It implements the whole `TavoraSDK` and keeps its state in
// memory, so a module can be tested without Tavora; it follows the real host's rules (limits, revisions, errors).
// For tests of a real panel in a browser it also has `mountPanel` (the module's page on a memory host), Tavora's own
// themes (`themeOf`) and layout and Tab checks (`inspectLayout`, `checkFocus`…): see testing/. Not for use in a
// module's shipped code. Nothing here needs vitest, Playwright or a framework.
import { menuParams, skinParams, tooltipParams, tooltipShowParams } from "./anchor.js";
import { SDK_VERSION, TavoraError, type KeyValueStore, type TavoraSDK } from "./index.js";
import {
  APP_BLOB_PATH,
  BLOB_PATH,
  BLOB_TYPES,
  checkActionId,
  checkBlobId,
  checkClipboardText,
  checkDialogTitle,
  checkDiscordImage,
  checkFileReference,
  checkHotkeyLabel,
  checkLeaderboardMine,
  checkLeaderboardSubmit,
  leaderboardSubmitProblem,
  type LeaderboardDeclared,
  checkLeaderboardTop,
  checkMenu,
  checkModuleKey,
  checkOverlaySources,
  checkPickReadOnly,
  checkTooltip,
  checkTooltipAnchor,
  checkTooltipId,
  checkTooltipSkin,
  isPanelTypeId,
  type ParamCheck,
  DOCUMENT_ID,
  DOCUMENT_ID_RULE_TAVORA,
  DOCUMENT_ID_ZERO_DEVICES_TAVORA,
  CLASSIC_STYLE,
  FIELD_SINCE,
  STYLE_TAVORA,
  TAB_OVERFLOW_TAVORA,
  HOST_FEATURES,
  LIMITS,
  METHOD_INFO,
  needsGesture,
  newDocumentIdProblem,
  supportsCall,
  PROTOCOL_VERSION,
  THEME_TOKENS,
  versionAtLeast,
  type BlobInfo,
  type BlobUsage,
  type CallName,
  type Capability,
  type DocumentChange,
  type DocumentSummary,
  type ErrorCode,
  type EventName,
  type Events,
  type HandshakeResult,
  type HttpCalls,
  type HotkeyBinding,
  type JsonValue,
  type LeaderboardMine,
  type LeaderboardResult,
  type LeaderboardStatus,
  type LeaderboardSubmitResult,
  type Methods,
  type OverlaySource,
  type PanelContent,
  type PanelLaunch,
  type PanelOpenManyResult,
  type PanelOpenResult,
  type TavoraDocument,
  type TavoraStyle,
  type TabOverflow,
  type TavoraTheme,
  type TavoraViewport,
  type TavoraWorkspace,
} from "./protocol.js";

export { TavoraError } from "./index.js";
export { catalogProblems, type CheckCatalogsOptions } from "./testing/catalogs.js";
export { themeFromPackage, themeOf, type ThemePackageJson, type ThemeVariationJson } from "./testing/themes.js";
export { mountPanel, type MountedPanel, type MountPanelOptions, type StartingPanel, type StopPanel } from "./testing/mount.js";
export {
  checkFocus,
  checkLayout,
  inspectFocus,
  inspectLayout,
  type CheckIssue,
  type FocusCheckOptions,
  type FocusIssue,
  type FocusIssueKind,
  type FocusResult,
  type LayoutCheckOptions,
  type LayoutIssue,
  type LayoutIssueKind,
  type TestPage,
} from "./testing/checks.js";
import { localDay } from "./local-day.js";

type Table = Methods & HttpCalls;
export type { CallName };
type Params<M extends CallName> = Table[M]["params"];
type Result<M extends CallName> = Table[M]["result"];

type Limits = { [K in keyof typeof LIMITS]: number };

export interface MemoryHostOptions {
  /**
   * The Tavora version the host claims, in the handshake. Methods a newer Tavora added throw UNKNOWN_METHOD, as an older
   * Tavora does. Default: the newest Tavora the SDK knows.
   */
  version?: string;
  /** The module's id and version in the handshake. */
  module?: { id: string; version: string };
  /** Capabilities the user granted. Default: all of them. */
  capabilities?: Capability[];
  /**
   * Capabilities the manifest asks for on request (`permissions.onRequest`) and the user has not granted yet. A call that
   * needs one asks the user first, as Tavora does, instead of failing with PERMISSION_DENIED: today `overlay.copyLink`
   * (the `overlay` capability of the `stream-overlay` connector). @since 0.4.11
   */
  onRequest?: Capability[];
  /**
   * What the user answers when a call asks for a capability on request (`onRequest`): `"allow"` (default) grants it from
   * then on, `"deny"` makes the call answer as Tavora does then (`overlay.copyLink` gives `"denied"`). @since 0.4.11
   */
  consent?: "allow" | "deny";
  /**
   * `"ignore"` (default) lets every call through. `"enforce"` refuses calls that need a click or key press with
   * PERMISSION_DENIED unless the test made one first with `host.gesture()` or `host.click(fn)`. As in Tavora, the panel
   * keeps only its latest press: it lets one call through, within `GESTURE_MS` (2 s). Presses don't add up.
   */
  gestures?: "ignore" | "enforce";
  /**
   * The add pass, as in Tavora: a panel just added (`launch.reason` "add") may open its dialog once without a click,
   * within `ADD_DIALOG_MS` (10 s) of starting, for a welcome. Its first `panel.openDialog` uses it up either way, and a
   * press waiting to be used goes first. Default: true. `false` is a Tavora that holds the welcome back (over the game).
   */
  addPass?: boolean;
  /** This panel's type (one of the manifest's `panels`). Default: null, a module without panel types. */
  panelType?: string | null;
  /** The panel types of the manifest; `panels.open` refuses another one with INVALID_PARAMS. Default: any. */
  panelTypes?: string[];
  /**
   * The boards of the manifest's `leaderboards`, by `id` and `name`. As in Tavora, `leaderboards.submit` and
   * `leaderboards.top` refuse another board with INVALID_PARAMS, and `leaderboards.mine` lists every one of them, with
   * no standing where the user has none (signed out too). Default: any board id, and `mine` lists none. @since 0.4.13
   */
  leaderboards?: ({ id: string; name: string } & Partial<LeaderboardDeclared>)[];
  /** Why the page loads. Default: `{ reason: "add" }`. */
  launch?: PanelLaunch;
  /**
   * This panel's own state when it starts (what `panel.getState` answers until the page sets another), as Tavora keeps it
   * for a panel it restores. Same limits as `panel.setState`. Default: null. @since 0.3.15
   */
  state?: JsonValue | null;
  workspace?: TavoraWorkspace;
  viewport?: TavoraViewport;
  theme?: Partial<TavoraTheme>;
  language?: string;
  /** Lower limits for a test that wants to hit a quota without writing megabytes. */
  limits?: Partial<Limits>;
  /** The clock for `updatedAt` and `createdAt`, and for how long a press and the add pass last. Default: the real time. */
  now?: () => number;
  /** Another memory host to share its storage, documents and workspace with: a second panel of the same module. */
  share?: MemoryHost;
}

export interface CallRecord {
  method: CallName;
  params: unknown;
}

/** A view of one key/value store (storage or storage.app) for seeding and checking. */
export interface StoreView {
  entries(): Record<string, JsonValue>;
  get(key: string): JsonValue | null;
  /** Sets a value the way the module's own `set` does, limits and all. */
  set(key: string, value: JsonValue): void;
  clear(): void;
}

export interface MemoryHost {
  /** What the host sent in the handshake. */
  readonly handshake: HandshakeResult;
  /** Every call this panel made, by method: the params of each, oldest first. */
  readonly calls: { [M in CallName]?: Params<M>[] };
  /** Every call this panel made, in order. */
  readonly log: readonly CallRecord[];
  /**
   * Scripts a method: `fn` answers instead of the memory host (it may throw a TavoraError). Limits, permissions and
   * Tavora versions are still checked first. Scripting a method again replaces the script.
   */
  answer<M extends CallName>(method: M, fn: (params: Params<M>) => Result<M> | Promise<Result<M>>): void;
  /** Takes a script away. */
  unanswer(method: CallName): void;
  /** Raises an event in this panel. */
  emit<E extends EventName>(event: E, data: Events[E]): void;
  /**
   * The user switched theme; every panel of the shared state hears it. Missing parts stay as they were. `style` sends a
   * design style (the default is `CLASSIC_STYLE`); `style: undefined` takes it away, as an older Tavora sends the theme.
   * A host older than `STYLE_TAVORA` never sends one. `tabOverflow` (`"list"` by default) works the same way, with
   * `TAB_OVERFLOW_TAVORA`.
   */
  changeTheme(theme: Partial<Omit<TavoraTheme, "style" | "tabOverflow">> & { style?: TavoraStyle | undefined; tabOverflow?: TabOverflow | undefined }): void;
  setLanguage(language: string): void;
  resize(viewport: TavoraViewport): void;
  /** Another panel asked this one to show `content` (panels.open): runs the `panel.onNavigate` handler. */
  navigate(content: PanelContent): Promise<{ handled: boolean; ok: boolean }>;
  suspend(): void;
  resume(): void;
  /** Tavora's window went behind another program (the game), or came back in front: `lifecycle.onBehindChange` fires. */
  behind(behind?: boolean): void;
  /** The page goes away: `lifecycle.onDispose` fires and this panel gets no more events from the others. */
  dispose(): void;
  /**
   * The user clicked or pressed a key. With gestures enforced, it lets the next call that needs one through, within
   * `GESTURE_MS`. Tavora keeps one press, not a count: a new press replaces the one before, and `count` is ignored.
   */
  gesture(count?: number): void;
  /** Runs `fn` right after a click: one gesture, then `fn`. */
  click<T>(fn: () => T | Promise<T>): Promise<T>;
  /** The user maximized or restored the panel. */
  setMaximized(maximized: boolean): void;
  /**
   * The user opened the in-game layer and the panel went over the game (true), or it came back to its slot (false):
   * `panel.isOverGame` answers it and `panel.onOverGameChange` fires, on a host new enough to have them.
   */
  setPanelOverGame(over: boolean): void;
  /** The user closed (or opened) the panel's dialog. */
  setDialog(open: boolean): void;
  readonly state: JsonValue | null;
  readonly content: PanelContent | null;
  readonly maximized: boolean;
  /** Whether the panel is over the game now (`setPanelOverGame`). */
  readonly panelOverGame: boolean;
  readonly dialog: { open: boolean; width: number; height: number };
  /** The title the panel set for its dialog (`panel.setDialogTitle`), or null for the module's name. Null while no dialog is open. */
  readonly dialogTitle: string | null;
  /** What `panel.setLive` last set. */
  readonly live: JsonValue | null;
  /** What `overlay.setSources` last set. */
  readonly sources: readonly OverlaySource[];
  /** The user added or removed game overlays on the Overlay page: `overlay.onOverGameChange` fires with the keys now shown. */
  setOverGame(keys: string[]): void;
  /** The user pressed Settings on an overlay's frame: the panel is put in its dialog (`dialog.open`) and `panel.onOpenSettings` fires with `key`. */
  openSettings(key: string): void;
  /** Panels `panels.open` had to open new, in order. */
  readonly opened: readonly { type: string; content: PanelContent | null }[];
  /** Files and pictures the module saved, in order. */
  readonly saved: readonly { kind: "json" | "picture" | "csv" | "xlsx"; fileName: string; value: JsonValue | Blob | string | Uint8Array }[];
  /** What the module published, by overlay key. */
  readonly overlays: Readonly<Record<string, JsonValue>>;
  readonly storage: StoreView;
  readonly appStorage: StoreView;
  readonly documents: {
    list(): DocumentSummary[];
    get(id: string): TavoraDocument | null;
    /**
     * Puts a document as if another panel did: the same rules and revisions, and every panel of the shared state hears
     * a DocumentChange.
     */
    put(document: { id?: string; title: string; data: JsonValue; ifRevision?: number }): DocumentSummary;
    delete(id: string, options?: { ifRevision?: number }): void;
    clear(): void;
  };
  readonly leaderboards: {
    readonly status: LeaderboardStatus;
    /** Changes what `leaderboards.status` answers (signed out, offline, not shown). */
    setStatus(status: Partial<LeaderboardStatus>): void;
  };
  setWorkspace(workspace: TavoraWorkspace): void;
}

/** Newest Tavora the SDK knows, and the default version of a memory host: the newest `since` of every call it has. */
export const LATEST_TAVORA: string = [...Object.values(METHOD_INFO).map((info) => info.since), ...Object.values(FIELD_SINCE), ...Object.values(HOST_FEATURES), STYLE_TAVORA, TAB_OVERFLOW_TAVORA].reduce((a, b) =>
  versionAtLeast(a, b) ? a : b,
);
/** How long a click or key press lets a call through, as in Tavora (module-view.ts). */
export const GESTURE_MS = 2_000;
/** How long after it starts a panel just added may open its dialog without a click, as in Tavora (module-view.ts). */
export const ADD_DIALOG_MS = 10_000;
/** Most panel types one call may name: as many as a manifest may declare (MAX_PANEL_TYPES in @tavora/module-schema). */
const MAX_PANEL_TYPES = 16;

/** Every capability, what the memory host grants unless a test says otherwise. */
const ALL_CAPABILITIES: Capability[] = ["network", "aiUsage", "discord", "overlay", "systemInfo", "media", "leaderboards", "folders", "files", "clipboard", "sharedData"];

/** Calls that answer with nothing when nobody scripted them. */
const SILENT = new Set<CallName>([
  "files.forget", "files.showInFolder", "files.check", "links.open", "ui.tooltip.show", "ui.tooltip.move", "ui.tooltip.hide", "ui.tooltip.close", "ui.tooltip.defineSkin", "ui.showMenu",
  "systemInfo.watch", "systemInfo.clearConnectionLog", "media.watch", "media.control", "discord.connect", "discord.allowControl",
  "discord.subscribe", "discord.unsubscribe", "overlay.resetLink", "overlay.preview", "clipboard.writeImage", "clipboard.writeText", "files.pickReadOnly",
  "files.openJson", "files.open", "discord.image", "folders.watch", "folders.choose", "folders.showInFolder", "hotkeys.set", "overlay.copyLink", "overlay.showOverGame", "overlay.openPage", "panel.navigated",
]);
const SILENT_ANSWER: Partial<Record<CallName, unknown>> = {
  "files.check": { found: false, reason: "unlinked" },
  "folders.choose": false,
  "ui.tooltip.show": true,
  "media.control": true,
  "hotkeys.set": "set",
  "overlay.copyLink": "copied",
  "overlay.showOverGame": "shown",
};
const EMPTY_LISTS = new Set<CallName>(["aiUsage.accounts"]);

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).byteLength;

function fail(code: ErrorCode, message: string, extra: { revision?: number; capability?: Capability } = {}): never {
  throw new TavoraError({ code, message, ...extra });
}

/** The params as Tavora's own check (`@tavora/sdk/protocol`) takes them, or its refusal. */
function checked<T>(result: ParamCheck<T>): T {
  if (!result.ok) fail(result.code, result.message);
  return result.value;
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  }
  return false;
}

function serializeJson(value: unknown, what: string): string {
  if (!isJsonValue(value)) fail("INVALID_PARAMS", `${what} must be plain JSON data`);
  return JSON.stringify(value);
}

const parse = <T = JsonValue>(serialized: string) => JSON.parse(serialized) as T;

/** Whether two JSON values hold the same, whatever the order of their objects' keys. */
function sameJson(a: JsonValue | null, b: JsonValue | null): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameJson(item, b[index]!));
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && sameJson(a[key]!, b[key]!));
}

function validateKey(key: unknown, limits: Limits): asserts key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > limits.maxKeyLength) {
    fail("INVALID_PARAMS", `key must be a string of 1 to ${limits.maxKeyLength} characters`);
  }
}

function validateId(id: unknown): string {
  if (typeof id !== "string" || !DOCUMENT_ID.test(id)) fail("INVALID_PARAMS", "document id must be 1 to 64 letters, digits, '-' or '_'");
  return id;
}

function checkRevision(existing: { revision: number } | undefined, ifRevision: number | undefined): void {
  if (ifRevision === undefined) return;
  const current = existing?.revision ?? 0;
  if (current !== ifRevision) fail("CONFLICT", `document is at revision ${current}, not ${ifRevision}`, { revision: current });
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultTheme(): TavoraTheme {
  const colors = { background: "#101114", surface: "#1b1d22", text: "#f2f3f5", textMuted: "#9a9ea8", accent: "#6d8cff" };
  const tokens = Object.fromEntries(THEME_TOKENS.map((token) => [token, colors.accent])) as TavoraTheme["tokens"];
  Object.assign(tokens, { background: colors.background, foreground: colors.text, card: colors.surface });
  return { mode: "dark", colors, tokens, radius: 8, style: structuredClone(CLASSIC_STYLE), tabOverflow: "list" };
}

/** The theme as a panel gets it: a Tavora older than STYLE_TAVORA sends no style, one older than TAB_OVERFLOW_TAVORA no tabOverflow. */
function themeFor(shared: Shared): TavoraTheme {
  const theme = structuredClone(shared.theme);
  if (theme.style === undefined || !versionAtLeast(shared.version, STYLE_TAVORA)) delete theme.style;
  if (theme.tabOverflow === undefined || !versionAtLeast(shared.version, TAB_OVERFLOW_TAVORA)) delete theme.tabOverflow;
  return theme;
}

interface StoredDocument extends DocumentSummary {
  data: string;
  seq: number;
}

/** What the panels of one module in one workspace share. */
interface Shared {
  limits: Limits;
  version: string;
  now: () => number;
  handshakeModule: { id: string; version: string };
  capabilities: Set<Capability>;
  onRequest: Set<Capability>;
  consent: "allow" | "deny";
  panelTypes: string[] | null;
  /** The manifest's boards (`leaderboards` option), or null for any. */
  boards: { id: string; name: string }[] | null;
  /** The same boards with what their kind says (`kind`, `daily`, `order`, `minGames`), for the size of a submit. */
  declared: Map<string, LeaderboardDeclared>;
  settings: Map<string, string>;
  appSettings: Map<string, string>;
  documents: Map<string, StoredDocument>;
  seq: number;
  blobs: Map<string, BlobInfo>;
  /** blobs.app: the module's files for every workspace. */
  appBlobs: Map<string, BlobInfo>;
  overlays: Map<string, JsonValue>;
  gameOverlays: Set<string>;
  hotkeys: HotkeyBinding[];
  opened: { type: string; content: PanelContent | null }[];
  workspace: TavoraWorkspace;
  viewport: TavoraViewport;
  theme: TavoraTheme;
  language: string;
  leaderboard: LeaderboardStatus;
  panels: Set<Panel>;
}

interface Panel {
  shared: Shared;
  type: string | null;
  launch: PanelLaunch;
  gestures: "ignore" | "enforce";
  /** The latest click or key press: one call may use it, within GESTURE_MS. */
  press: { at: number; used: boolean } | null;
  /** Until when a panel just added may open its dialog once without a click, or null. */
  addPass: { until: number } | null;
  state: string | null;
  content: PanelContent | null;
  maximized: boolean;
  overGame: boolean;
  dialog: { open: boolean; width: number; height: number };
  dialogTitle: string | null;
  live: JsonValue | null;
  sources: OverlaySource[];
  navigate: ((content: PanelContent) => void | Promise<void>) | null;
  /** A Settings press that came before the page had a `panel.onOpenSettings` handler: the first handler gets it, as in the SDK. */
  earlySettings: { key: string } | null;
  suspended: boolean;
  behind: boolean;
  listeners: Map<EventName, Set<(data: unknown) => void>>;
  scripts: Map<CallName, (params: never) => unknown>;
  calls: Record<string, unknown[]>;
  log: CallRecord[];
  saved: { kind: "json" | "picture" | "csv" | "xlsx"; fileName: string; value: JsonValue | Blob | string | Uint8Array }[];
  navigations: number;
}

const shares = new WeakMap<MemoryHost, Shared>();

function deliver(panel: Panel, event: EventName, data: unknown): void {
  if (event === "lifecycle.behind") panel.behind = (data as { behind: boolean }).behind;
  if (event === "lifecycle.suspend") panel.suspended = true;
  if (event === "lifecycle.resume") panel.suspended = false;
  if (event === "panel.openSettings" && !panel.listeners.get(event)?.size) panel.earlySettings = data as { key: string };
  for (const fn of [...(panel.listeners.get(event) ?? [])]) {
    try {
      fn(data);
    } catch (error) {
      console.error(`[tavora] ${event} listener failed`, error);
    }
  }
}

/** Tells the other panels (all of them when `origin` is null) about a change, the way the host does: after the call. */
function broadcastDocument(shared: Shared, change: DocumentChange, origin: Panel | null): void {
  for (const panel of shared.panels) {
    if (panel !== origin) queueMicrotask(() => shared.panels.has(panel) && deliver(panel, "documents.changed", change));
  }
}

function storeOps(shared: Shared, map: Map<string, string>, maxBytes: () => number) {
  const size = (key: string, serialized: string) => byteLength(key) + byteLength(serialized);
  const total = () => [...map].reduce((sum, [key, value]) => sum + size(key, value), 0);
  const write = (key: string, serialized: string) => {
    const previous = map.get(key);
    const next = total() - (previous === undefined ? 0 : size(key, previous)) + size(key, serialized);
    if (next > maxBytes()) fail("QUOTA_EXCEEDED", `settings are limited to ${maxBytes()} bytes per store`);
    map.set(key, serialized);
  };
  return {
    get: ({ key }: { key: string }) => {
      validateKey(key, shared.limits);
      const raw = map.get(key);
      return raw === undefined ? null : parse(raw);
    },
    keys: () => [...map.keys()].sort(),
    set: ({ key, value }: { key: string; value: JsonValue }) => {
      validateKey(key, shared.limits);
      write(key, serializeJson(value, "value"));
      return null;
    },
    delete: ({ key }: { key: string }) => {
      validateKey(key, shared.limits);
      map.delete(key);
      return null;
    },
    compareAndSet: ({ key, expected, value }: { key: string; expected: JsonValue | null; value: JsonValue }) => {
      validateKey(key, shared.limits);
      const wanted = expected === null ? null : parse(serializeJson(expected, "expected"));
      const serialized = serializeJson(value, "value");
      const previous = map.get(key);
      if (!sameJson(previous === undefined ? null : parse(previous), wanted)) return false;
      write(key, serialized);
      return true;
    },
  };
}

/** Refuses an id a new document can't have on this Tavora (the SDK's one rule; an older Tavora took some of them). */
function checkNewDocumentId(version: string, id: string, saved: Iterable<string>): void {
  if (!versionAtLeast(version, DOCUMENT_ID_RULE_TAVORA)) return;
  if (!versionAtLeast(version, DOCUMENT_ID_ZERO_DEVICES_TAVORA) && /^(?:com|lpt)0$/i.test(id)) return;
  const problem = newDocumentIdProblem(id, saved);
  if (problem !== null) fail("INVALID_PARAMS", problem);
}

/** Puts a document with the host's rules; `origin` is the panel that did it (it is not told), or null for the test itself. */
function putDocument(shared: Shared, params: unknown, origin: Panel | null): DocumentSummary {
  if (typeof params !== "object" || params === null) fail("INVALID_PARAMS", "params must be an object");
  const { id, title, data, ifRevision } = params as { id?: string; title?: unknown; data?: unknown; ifRevision?: number };
  const docId = id === undefined ? randomId() : validateId(id);
  if (typeof title !== "string" || title.length > shared.limits.maxTitleLength) {
    fail("INVALID_PARAMS", `title must be a string of at most ${shared.limits.maxTitleLength} characters`);
  }
  if (!("data" in params)) fail("INVALID_PARAMS", "data is required");
  const serialized = serializeJson(data, "data");
  const bytes = byteLength(serialized);
  if (bytes > shared.limits.maxDocumentBytes) fail("QUOTA_EXCEEDED", `a document is limited to ${shared.limits.maxDocumentBytes} bytes`);
  if (ifRevision !== undefined && !Number.isSafeInteger(ifRevision)) fail("INVALID_PARAMS", "ifRevision must be an integer");

  const existing = shared.documents.get(docId);
  // Before the revision, as Tavora checks it.
  if (!existing) checkNewDocumentId(shared.version, docId, shared.documents.keys());
  checkRevision(existing, ifRevision);
  if (!existing && shared.documents.size >= shared.limits.maxDocuments) {
    fail("QUOTA_EXCEEDED", `a module may keep at most ${shared.limits.maxDocuments} documents per workspace`);
  }
  const total = [...shared.documents.values()].reduce((sum, doc) => sum + doc.bytes, 0) - (existing?.bytes ?? 0) + bytes;
  if (total > shared.limits.maxDocumentsBytes) {
    fail("QUOTA_EXCEEDED", `documents are limited to ${shared.limits.maxDocumentsBytes} bytes per module and workspace`);
  }
  const stored: StoredDocument = {
    id: docId,
    title,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: new Date(shared.now()).toISOString(),
    bytes,
    data: serialized,
    seq: ++shared.seq,
  };
  shared.documents.set(docId, stored);
  broadcastDocument(shared, { id: docId, revision: stored.revision, deleted: false }, origin);
  return summary(stored);
}

function deleteDocument(shared: Shared, id: unknown, ifRevision: unknown, origin: Panel | null): void {
  const docId = validateId(id);
  if (ifRevision !== undefined && !Number.isSafeInteger(ifRevision)) fail("INVALID_PARAMS", "ifRevision must be an integer");
  const existing = shared.documents.get(docId);
  if (!existing) return;
  checkRevision(existing, ifRevision as number | undefined);
  shared.documents.delete(docId);
  broadcastDocument(shared, { id: docId, revision: existing.revision, deleted: true }, origin);
}

const summary = ({ id, title, revision, updatedAt, bytes }: StoredDocument): DocumentSummary => ({ id, title, revision, updatedAt, bytes });

function documentOf(stored: StoredDocument): TavoraDocument {
  return { ...summary(stored), data: parse(stored.data) };
}

function checkContent(content: unknown, limits: Limits): PanelContent {
  const c = content as Partial<PanelContent> | null;
  const ok =
    typeof c === "object" && c !== null && typeof c.id === "string" && c.id.length >= 1 && c.id.length <= limits.maxContentIdLength &&
    typeof c.title === "string" && c.title.length >= 1 && c.title.length <= limits.maxTitleLength;
  if (!ok) fail("INVALID_PARAMS", `params.content must be null or { id, title }: an id of 1 to ${limits.maxContentIdLength} characters and a title of 1 to ${limits.maxTitleLength}`);
  return { id: c.id!, title: c.title! };
}

const DIALOG = { min: 240, max: 2000, width: 560, height: 640 } as const;

type Handlers = { [M in CallName]?: (panel: Panel, params: Params<M>) => Result<M> | Promise<Result<M>> };

/** A picture to copy or save: not empty, and not past the host's limit (it also checks every part of the PNG, which this host doesn't). */
function checkPictureSize(png: Blob, max: number, what: string): void {
  if (png.size === 0) fail("INVALID_PARAMS", `only a complete PNG picture can be ${what}`);
  if (png.size > max) fail("QUOTA_EXCEEDED", `a picture to be ${what} is limited to ${max} bytes`);
}

/** blobs.put and blobs.app.put: the type is the Blob's own here, where the real host looks at the bytes. */
function putBlob(shared: Shared, blobs: Map<string, BlobInfo>, file: Blob, scope: string): BlobInfo {
  if (!(BLOB_TYPES as readonly string[]).includes(file.type)) fail("INVALID_PARAMS", "only PNG, JPEG, GIF and WebP pictures, PDF files and MP3, Ogg and WAV sounds can be stored");
  // An empty file is no picture: Tavora looks at the bytes, and there are none.
  if (file.size === 0) fail("INVALID_PARAMS", "only PNG, JPEG, GIF and WebP pictures, PDF files and MP3, Ogg and WAV sounds can be stored");
  if (file.size > shared.limits.maxBlobBytes) fail("QUOTA_EXCEEDED", `a file is limited to ${shared.limits.maxBlobBytes} bytes`);
  const used = [...blobs.values()].reduce((sum, blob) => sum + blob.bytes, 0);
  if (used + file.size > shared.limits.maxBlobsBytes) fail("QUOTA_EXCEEDED", `files are limited to ${shared.limits.maxBlobsBytes} bytes per module and ${scope}`);
  const info: BlobInfo = { id: randomId().replaceAll("-", ""), bytes: file.size, type: file.type as BlobInfo["type"], createdAt: new Date(shared.now()).toISOString() };
  blobs.set(info.id, info);
  return { ...info };
}

function blobUsage(shared: Shared, blobs: Map<string, BlobInfo>): BlobUsage {
  return {
    bytes: [...blobs.values()].reduce((sum, blob) => sum + blob.bytes, 0),
    count: blobs.size,
    maxBytes: shared.limits.maxBlobsBytes,
    maxFileBytes: shared.limits.maxBlobBytes,
  };
}

const handlers: Handlers = {
  "bridge.handshake": (panel) => handshakeOf(panel),
  "workspace.getCurrent": (panel) => ({ ...panel.shared.workspace }),
  "workspace.getViewport": ({ shared }) => ({ ...shared.viewport }),

  "storage.get": ({ shared }, params) => storeOps(shared, shared.settings, () => shared.limits.maxStoreBytes).get(params),
  "storage.set": ({ shared }, params) => storeOps(shared, shared.settings, () => shared.limits.maxStoreBytes).set(params),
  "storage.delete": ({ shared }, params) => storeOps(shared, shared.settings, () => shared.limits.maxStoreBytes).delete(params),
  "storage.keys": ({ shared }) => storeOps(shared, shared.settings, () => shared.limits.maxStoreBytes).keys(),
  "storage.compareAndSet": ({ shared }, params) => storeOps(shared, shared.settings, () => shared.limits.maxStoreBytes).compareAndSet(params),
  "storage.app.get": ({ shared }, params) => storeOps(shared, shared.appSettings, () => shared.limits.maxStoreBytes).get(params),
  "storage.app.set": ({ shared }, params) => storeOps(shared, shared.appSettings, () => shared.limits.maxStoreBytes).set(params),
  "storage.app.delete": ({ shared }, params) => storeOps(shared, shared.appSettings, () => shared.limits.maxStoreBytes).delete(params),
  "storage.app.keys": ({ shared }) => storeOps(shared, shared.appSettings, () => shared.limits.maxStoreBytes).keys(),
  "storage.app.compareAndSet": ({ shared }, params) => storeOps(shared, shared.appSettings, () => shared.limits.maxStoreBytes).compareAndSet(params),

  "documents.list": ({ shared }) =>
    [...shared.documents.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.seq - a.seq).map(summary),
  "documents.get": ({ shared }, { id }) => {
    const stored = shared.documents.get(validateId(id));
    return stored ? documentOf(stored) : null;
  },
  "documents.put": (panel, params) => putDocument(panel.shared, params, panel),
  "documents.delete": (panel, { id, ifRevision }) => {
    deleteDocument(panel.shared, id, ifRevision, panel);
    return null;
  },

  "panel.getState": (panel) => (panel.state === null ? null : parse(panel.state)),
  "panel.setState": (panel, { value }) => {
    if (value === null) {
      panel.state = null;
      return null;
    }
    const serialized = serializeJson(value, "value");
    if (byteLength(serialized) > panel.shared.limits.maxPanelStateBytes) {
      fail("QUOTA_EXCEEDED", `panel state is limited to ${panel.shared.limits.maxPanelStateBytes} bytes`);
    }
    panel.state = serialized;
    return null;
  },
  "panel.getLaunch": (panel) => structuredClone(panel.launch),
  "panel.setContent": (panel, { content }) => {
    panel.content = content === null ? null : checkContent(content, panel.shared.limits);
    return null;
  },
  "panel.navigated": () => null,
  "panel.isMaximized": (panel) => panel.maximized,
  "panel.isOverGame": (panel) => panel.overGame,
  "panel.setMaximized": (panel, { maximized }) => {
    if (typeof maximized !== "boolean") fail("INVALID_PARAMS", "params.maximized must be a boolean");
    setMaximized(panel, maximized);
    return null;
  },
  "panel.setDialog": (panel, params) => {
    if (typeof params.open !== "boolean") fail("INVALID_PARAMS", "params.open must be a boolean");
    const next = params.open ? { open: true, width: dialogSide(params, "width"), height: dialogSide(params, "height") } : { ...panel.dialog, open: false };
    const changed = next.open !== panel.dialog.open;
    panel.dialog = next;
    if (!next.open) panel.dialogTitle = null;
    if (changed) deliver(panel, "panel.dialog", { open: next.open });
    return null;
  },
  "panel.setDialogTitle": (panel, params) => {
    const title = checked(checkDialogTitle(record(params).title, panel.shared.limits.maxTitleLength));
    if (panel.dialog.open) panel.dialogTitle = title;
    return null;
  },
  "panel.setLive": (panel, { state }) => {
    if (state !== null && byteLength(serializeJson(state, "state")) > panel.shared.limits.maxOverlayStateBytes) {
      fail("QUOTA_EXCEEDED", `the live state is limited to ${panel.shared.limits.maxOverlayStateBytes} bytes`);
    }
    panel.live = state === null ? null : parse(JSON.stringify(state));
    return null;
  },
  "panels.open": (panel, { type, content }) => {
    const { shared } = panel;
    if (typeof type !== "string" || !type || (shared.panelTypes && !shared.panelTypes.includes(type))) {
      fail("INVALID_PARAMS", `${String(type)} is not one of this module's panel types`);
    }
    const wanted = content === undefined ? null : checkContent(content, shared.limits);
    const siblings = [...shared.panels].filter((other) => other !== panel && other.type === type);
    if (!wanted && siblings.length > 0) return "shown";
    if (wanted && siblings.some((other) => other.content?.id === wanted.id)) return "shown";
    const target = siblings.at(-1);
    if (wanted && target?.navigate) return navigatePanel(target, wanted).then(({ ok }): PanelOpenResult => (ok ? "switched" : "failed"));
    shared.opened.push({ type, content: wanted });
    return "opened";
  },
  "panels.openMany": (panel, { types }) => {
    const { shared } = panel;
    if (!Array.isArray(types) || types.length === 0 || types.length > MAX_PANEL_TYPES) fail("INVALID_PARAMS", `types must be 1 to ${MAX_PANEL_TYPES} panel types`);
    if (new Set(types).size !== types.length) fail("INVALID_PARAMS", "types lists a panel type twice");
    for (const type of types) {
      if (typeof type !== "string" || !type || (shared.panelTypes && !shared.panelTypes.includes(type))) fail("INVALID_PARAMS", `${String(type)} is not one of this module's panel types`);
    }
    const result: Record<string, PanelOpenManyResult> = {};
    for (const type of types) {
      // A type open already (the asking panel's own, too) comes to the front; the rest open new, without content.
      if ([...shared.panels].some((other) => other.type === type) || shared.opened.some((item) => item.type === type)) result[type] = "shown";
      else {
        shared.opened.push({ type, content: null });
        result[type] = "opened";
      }
    }
    return result;
  },

  "ui.getTheme": ({ shared }) => themeFor(shared),
  "ui.getLanguage": ({ shared }) => shared.language,

  "blobs.put": ({ shared }, { file }) => putBlob(shared, shared.blobs, file, "workspace"),
  "blobs.list": ({ shared }) => [...shared.blobs.values()].map((blob) => ({ ...blob })),
  "blobs.usage": ({ shared }) => blobUsage(shared, shared.blobs),
  "blobs.delete": ({ shared }, { id }) => {
    shared.blobs.delete(checked(checkBlobId(id)));
    return null;
  },
  "blobs.app.put": ({ shared }, { file }) => putBlob(shared, shared.appBlobs, file, "every workspace together"),
  "blobs.app.list": ({ shared }) => [...shared.appBlobs.values()].map((blob) => ({ ...blob })),
  "blobs.app.usage": ({ shared }) => blobUsage(shared, shared.appBlobs),
  "blobs.app.delete": ({ shared }, { id }) => {
    shared.appBlobs.delete(checked(checkBlobId(id)));
    return null;
  },
  "clipboard.writeImage": (panel, { png }) => {
    if (png.type !== "image/png") fail("INVALID_PARAMS", "only a PNG picture can be copied");
    checkPictureSize(png, panel.shared.limits.maxClipboardImageBytes, "copied");
    return null;
  },
  "pictures.save": (panel, { png, name = "" }) => {
    if (png.type !== "image/png") fail("INVALID_PARAMS", "only a PNG picture can be saved");
    checkPictureSize(png, panel.shared.limits.maxClipboardImageBytes, "saved");
    const fileName = `${(name || "Picture").replace(/\.png$/i, "")}.png`;
    panel.saved.push({ kind: "picture", fileName, value: png });
    return { fileName };
  },
  "files.saveJson": (panel, { value, name = "" }) => {
    const body = JSON.stringify(value);
    if (body === undefined) fail("INVALID_PARAMS", "only JSON can be saved");
    if (byteLength(body) > 8 * 1024 * 1024) fail("QUOTA_EXCEEDED", "JSON files may be at most 8 MiB");
    const fileName = `${(name || "Untitled").replace(/\.json$/i, "")}.json`;
    panel.saved.push({ kind: "json", fileName, value: parse(body) });
    return { fileName };
  },
  "files.save": (panel, { data, type, name = "" }) => {
    if (type !== "csv" && type !== "xlsx") fail("INVALID_PARAMS", "only a csv or xlsx file can be saved");
    if (type === "csv" ? typeof data !== "string" : !(data instanceof Uint8Array)) fail("INVALID_PARAMS", type === "csv" ? "a csv file is saved from text" : "an xlsx file is saved from bytes");
    if ((typeof data === "string" ? byteLength(data) : data.byteLength) > 8 * 1024 * 1024) fail("QUOTA_EXCEEDED", "files may be at most 8 MiB");
    const fileName = `${(name || "Untitled").replace(new RegExp(`\\.${type}$`, "i"), "")}.${type}`;
    panel.saved.push({ kind: type, fileName, value: data });
    return { fileName };
  },
  "files.open": (_panel, params) => {
    const types = params?.types;
    if (types !== undefined && (!Array.isArray(types) || !types.length || !types.every((kind) => kind === "csv" || kind === "xlsx"))) fail("INVALID_PARAMS", "only csv and xlsx files can be opened");
    return null;
  },
  "files.exportJson": (panel, { value, name = "Build" }) => {
    const body = JSON.stringify(value);
    if (body === undefined) fail("INVALID_PARAMS", "only JSON can be exported");
    if (byteLength(body) > 8 * 1024 * 1024) fail("QUOTA_EXCEEDED", "JSON exports may be at most 8 MiB");
    const fileName = `${name.replace(/\.json$/i, "")}.json`;
    panel.saved.push({ kind: "json", fileName, value: parse(body) });
    return { fileName };
  },
  "files.read": (_panel, { id }) => {
    if (!/^[a-f0-9]{32}$/.test(id)) fail("INVALID_PARAMS", "Invalid file reference.");
    return fail("INTERNAL", "files.read: no answer scripted; call host.answer(\"files.read\", …)");
  },

  "overlay.publish": ({ shared }, { key, state }) => {
    if (byteLength(serializeJson(state, "state")) > shared.limits.maxOverlayStateBytes) {
      fail("QUOTA_EXCEEDED", `an overlay is limited to ${shared.limits.maxOverlayStateBytes} bytes`);
    }
    // As in Tavora: without the stream-overlay connector nothing reads a link, so state is kept only for a key a game overlay shows.
    if (!shared.capabilities.has("overlay") && !shared.gameOverlays.has(key)) return null;
    if (!shared.overlays.has(key) && shared.overlays.size >= shared.limits.maxOverlays) fail("QUOTA_EXCEEDED", `a module may have at most ${shared.limits.maxOverlays} overlays`);
    shared.overlays.set(key, parse(JSON.stringify(state)));
    return null;
  },
  "overlay.remove": ({ shared }, { key }) => {
    shared.overlays.delete(key);
    return null;
  },
  "overlay.showOverGame": ({ shared }, { key }) => {
    shared.gameOverlays.add(key);
    return "shown";
  },
  "overlay.hideOverGame": ({ shared }, { key }) => {
    shared.gameOverlays.delete(key);
    return null;
  },
  "overlay.overGame": ({ shared }) => [...shared.gameOverlays],
  "overlay.setSources": (panel, params) => {
    if (!("sources" in record(params))) fail("INVALID_PARAMS", "params.sources is required");
    panel.sources = checked(checkOverlaySources(record(params).sources, panel.shared.limits));
    return null;
  },
  "hotkeys.list": ({ shared }) => shared.hotkeys.map((binding) => ({ ...binding })),
  "hotkeys.set": ({ shared }, { action, target }) => {
    if (!shared.hotkeys.some((binding) => binding.action === action && binding.target === target)) shared.hotkeys.push({ action, target });
    return "set";
  },
  "hotkeys.remove": ({ shared }, { target, action }) => {
    shared.hotkeys = shared.hotkeys.filter((binding) => binding.target !== target || (action !== undefined && binding.action !== action));
    return null;
  },

  "leaderboards.status": ({ shared }) => ({ ...shared.leaderboard }),
  "leaderboards.show": ({ shared }) => {
    shared.leaderboard = { ...shared.leaderboard, shown: shared.leaderboard.signedIn && shared.leaderboard.available, name: shared.leaderboard.signedIn ? (shared.leaderboard.name ?? "Player") : null };
    return { ...shared.leaderboard };
  },
  "leaderboards.hide": ({ shared }) => {
    shared.leaderboard = { ...shared.leaderboard, shown: false, name: null };
    return { ...shared.leaderboard };
  },
  // Their params were checked first (CHECKS_BEFORE_PRESS), as Tavora does.
  "leaderboards.submit": ({ shared }, { results }): LeaderboardSubmitResult => {
    if (!shared.leaderboard.signedIn) fail("PERMISSION_DENIED", "the user is signed out of Tavora");
    if (!shared.leaderboard.online) fail("NETWORK_ERROR", "can't reach Tavora's service");
    if (!shared.leaderboard.shown) fail("PERMISSION_DENIED", "the user hasn't agreed to show their results yet (leaderboards.show)");
    return { accepted: results.map((result) => result.id), rejected: [] };
  },
  "leaderboards.top": ({ shared }) => {
    if (!shared.leaderboard.online) fail("NETWORK_ERROR", "can't reach Tavora's service");
    return { rows: [] };
  },
  // Every board of the manifest, in every period, as Tavora lists them: a standing only once a script gives one.
  "leaderboards.mine": ({ shared }): LeaderboardMine => {
    if (shared.leaderboard.signedIn && !shared.leaderboard.online) fail("NETWORK_ERROR", "can't reach Tavora's service");
    return { boards: (shared.boards ?? []).map((board) => ({ ...board, periods: { day: null, week: null, month: null, year: null, all: null } })) };
  },
};

function handshakeOf(panel: Panel): HandshakeResult {
  const { shared } = panel;
  return {
    protocol: PROTOCOL_VERSION,
    host: { name: "tavora-desktop", version: shared.version },
    module: { ...shared.handshakeModule },
    capabilities: [...shared.capabilities],
    ...(versionAtLeast(shared.version, "0.17.12") ? { panel: { type: panel.type } } : {}),
  };
}

function setMaximized(panel: Panel, maximized: boolean): void {
  if (panel.maximized === maximized) return;
  panel.maximized = maximized;
  deliver(panel, "panel.maximized", { maximized });
}

/** As in Tavora: only a host that has `panel.isOverGame` tells the panel it went over the game. */
function setPanelOverGame(panel: Panel, over: boolean): void {
  if (panel.overGame === over) return;
  panel.overGame = over;
  if (supportsCall(panel.shared.version, "panel.isOverGame")) deliver(panel, "panel.overGame", { over });
}

/** Asks a panel to switch to other content, as the host does with `panel.navigate`. */
async function navigatePanel(panel: Panel, content: PanelContent): Promise<{ handled: boolean; ok: boolean }> {
  const handler = panel.navigate;
  let ok = false;
  if (handler) {
    try {
      await handler(content);
      ok = true;
    } catch (error) {
      console.error("[tavora] panel.onNavigate handler failed", error);
    }
  }
  await invoke(panel, "panel.navigated", { requestId: ++panel.navigations, handled: handler !== null, ok });
  return { handled: handler !== null, ok };
}

/** The press is recent and no call has used it yet. */
function unusedPress(panel: Panel): boolean {
  const { press } = panel;
  return press !== null && !press.used && panel.shared.now() - press.at <= GESTURE_MS;
}

function takePress(panel: Panel, method: CallName): void {
  if (!unusedPress(panel)) fail("PERMISSION_DENIED", `${method} must be called right after a click or key press`);
  panel.press!.used = true;
}

/** Opening the dialog: the add pass lets it through once, unless a press is waiting to be used. Used up either way. */
function useAddPass(panel: Panel): boolean {
  const pass = panel.addPass;
  panel.addPass = null;
  return pass !== null && !unusedPress(panel) && panel.shared.now() <= pass.until;
}

// Tavora's rule for a page on this PC or the local network (apps/desktop/src/main/browser-url.ts, isPrivateHost), copied:
// the SDK can't import the app. apps/desktop/src/main/browser-url-sdk.test.ts runs both on the same addresses.
/**
 * Endings that only a home or office network's own DNS answers (RFC 6762, RFC 8375, ICANN's
 * reserved `.internal`, and names routers use by habit), so a name with one is on the local network.
 */
const LOCAL_SUFFIXES = [".localhost", ".local", ".lan", ".home", ".home.arpa", ".internal", ".intranet", ".localdomain", ".corp", ".private"];
/** Router and NAS names that are full domains but answered by the device itself on its network. */
const LOCAL_NAMES = new Set(["fritz.box", "speedport.ip", "myfritz.box", "router.asus.com", "routerlogin.net", "routerlogin.com", "tplinkwifi.net", "tplinklogin.net"]);

function ipv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every((n) => n >= 0 && n <= 255) ? numbers : null;
}

function privateIpv4([a, b]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
}

/** Whether a host name (as `URL.hostname` gives it) points at this PC or the local network. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || LOCAL_NAMES.has(host) || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const v4 = ipv4(host);
  if (v4) return privateIpv4(v4);
  if (!host.startsWith("[")) return host !== "" && !host.includes(".");
  const v6 = host.slice(1, -1);
  if (v6 === "::" || v6 === "::1") return true;
  // IPv4-mapped (::ffff:7f00:1, as the URL parser writes ::ffff:127.0.0.1).
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16);
    const low = parseInt(mapped[2]!, 16);
    return privateIpv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  const first = parseInt(v6.split(":")[0] || "0", 16);
  // fc00::/7 unique local, fe80::/10 link-local.
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/** Longest link `links.open` takes, as Tavora's bridge (LINK_MAX). */
const LINK_MAX = 2048;

/** A dialog side as Tavora's bridge checks it: absent, or a whole number in range. */
function dialogSide(params: { width?: number; height?: number } | undefined, key: "width" | "height"): number {
  const value = params?.[key];
  if (value === undefined) return DIALOG[key];
  if (!Number.isSafeInteger(value) || value < DIALOG.min || value > DIALOG.max) fail("INVALID_PARAMS", `params.${key} must be a whole number from ${DIALOG.min} to ${DIALOG.max}`);
  return value;
}

const record = (params: unknown): Record<string, unknown> => (params !== null && typeof params === "object" ? (params as Record<string, unknown>) : {});

/**
 * The checks Tavora makes before it takes the press or the add pass, so a call refused by them leaves both unused: the
 * bridge checks the params of its calls first (bridge.ts), and links.open the address too. Whether a panel type is the
 * module's own is checked after the press, as in Tavora. The calls the page makes over HTTP (files, pictures, the
 * clipboard) take the press first there, and here too.
 */
const CHECKS_BEFORE_PRESS: Partial<Record<CallName, (panel: Panel, params: unknown) => void>> = {
  "links.open": (_, params) => {
    const raw = record(params).url;
    if (typeof raw !== "string" || raw.length === 0 || raw.length > LINK_MAX) fail("INVALID_PARAMS", "params.url must be a web address");
    let url: URL | null = null;
    try {
      url = new URL(raw);
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "") fail("INVALID_PARAMS", "params.url must be an http or https address");
    if (isPrivateHost(url.hostname)) fail("PERMISSION_DENIED", "links.open opens only public addresses, not this PC or the local network");
  },
  "panel.setMaximized": (_, params) => {
    if (typeof record(params).maximized !== "boolean") fail("INVALID_PARAMS", "params.maximized must be a boolean");
  },
  "panel.setDialog": (_, params) => {
    if (typeof record(params).open !== "boolean") fail("INVALID_PARAMS", "params.open must be a boolean");
    dialogSide(params as { width?: number; height?: number }, "width");
    dialogSide(params as { width?: number; height?: number }, "height");
  },
  "panels.open": (panel, params) => {
    const { type, content } = record(params);
    if (!isPanelTypeId(type)) fail("INVALID_PARAMS", "params.type must be a panel type id of this module");
    if (content !== undefined) checkContent(content, panel.shared.limits);
  },
  "panels.openMany": (_, params) => {
    const { types } = record(params);
    if (!Array.isArray(types) || types.length === 0 || types.length > MAX_PANEL_TYPES || !types.every(isPanelTypeId)) {
      fail("INVALID_PARAMS", `types must be 1 to ${MAX_PANEL_TYPES} panel types`);
    }
    if (new Set(types).size !== types.length) fail("INVALID_PARAMS", "types lists a panel type twice");
  },
  // The bridge checks these params before anything else (bridge.ts), with the same functions.
  "files.pickReadOnly": (_, params) => void checked(checkPickReadOnly(params)),
  "files.forget": (_, params) => void checked(checkFileReference(record(params).id)),
  "files.check": (_, params) => void checked(checkFileReference(record(params).id)),
  "files.showInFolder": (_, params) => void checked(checkFileReference(record(params).id)),
  "overlay.publish": (_, params) => void checked(checkModuleKey(record(params).key, "key")),
  "overlay.remove": (_, params) => void checked(checkModuleKey(record(params).key, "key")),
  "overlay.copyLink": (_, params) => void checked(checkModuleKey(record(params).key, "key")),
  "overlay.resetLink": (_, params) => void checked(checkModuleKey(record(params).key, "key")),
  "overlay.showOverGame": (_, params) => void checked(checkModuleKey(record(params).key, "key")),
  "overlay.hideOverGame": (_, params) => void checked(checkModuleKey(record(params).key, "key")),
  "overlay.preview": (_, params) => void checked(checkModuleKey(record(params).key, "key")),
  "clipboard.writeText": (panel, params) => void checked(checkClipboardText(record(params).text, panel.shared.limits.maxClipboardTextBytes)),
  "hotkeys.set": (panel, params) => {
    const { action, target, label } = record(params);
    checked(checkActionId(action));
    checked(checkModuleKey(target, "target"));
    checked(checkHotkeyLabel(label, panel.shared.limits.maxHotkeyLabel));
  },
  "hotkeys.remove": (_, params) => {
    const { action, target } = record(params);
    checked(checkModuleKey(target, "target"));
    if (action !== undefined) checked(checkActionId(action));
  },
  "ui.showMenu": (_, params) => void checked(checkMenu(params)),
  "ui.tooltip.show": (_, params) => void checked(checkTooltip(params)),
  "ui.tooltip.move": (_, params) => void checked(checkTooltipAnchor(params)),
  "ui.tooltip.hide": (_, params) => void checked(checkTooltipId(params)),
  "ui.tooltip.close": (_, params) => void checked(checkTooltipId(params)),
  "ui.tooltip.defineSkin": (_, params) => void checked(checkTooltipSkin(params)),
  "discord.image": (_, params) => void checked(checkDiscordImage(record(params).url)),
  "leaderboards.submit": ({ shared }, params) => {
    const submit = checked(checkLeaderboardSubmit(params, boardIds(shared, record(params).board), shared.limits.maxLeaderboardResults));
    // The body's size depends on the board's kind, as in Tavora.
    const tooBig = leaderboardSubmitProblem(shared.declared.get(submit.board) ?? { kind: "score" }, submit.results);
    if (tooBig) fail("INVALID_PARAMS", tooBig);
  },
  "leaderboards.top": ({ shared }, params) => void checked(checkLeaderboardTop(params, boardIds(shared, record(params).board), shared.limits.maxLeaderboardRows)),
  "leaderboards.mine": (_, params) => void checked(checkLeaderboardMine(params)),
};

/** A board id as a manifest may declare one (as in @tavora/module-schema). */
const BOARD_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** The boards a leaderboards call may name: the manifest's, or, without the `leaderboards` option, any board id. */
function boardIds(shared: Shared, asked: unknown): string[] {
  if (shared.boards) return shared.boards.map((board) => board.id);
  return typeof asked === "string" && asked.length <= 32 && BOARD_ID.test(asked) ? [asked] : [];
}

/**
 * A call that needs a capability the module asks for on request (`onRequest`) and wasn't granted: Tavora asks the user
 * (ConnectorQuestions in panel-gate.ts). True when the call goes on, with the capability granted from then on; false
 * when the user said no. Only `overlay.copyLink` asks so far.
 */
function askOnRequest(shared: Shared, capability: Capability): boolean {
  if (shared.consent === "deny") return false;
  shared.capabilities.add(capability);
  return true;
}

async function invoke<M extends CallName>(panel: Panel, method: M, params?: Params<M>): Promise<Result<M>> {
  (panel.calls[method] ??= []).push(params);
  panel.log.push({ method, params });
  const { shared } = panel;

  const { capability } = METHOD_INFO[method];
  if (!supportsCall(shared.version, method)) fail("UNKNOWN_METHOD", `unknown method ${method}`);
  // overlay.copyLink asks for its connector after its params and the press, as in Tavora; every other call needs the grant first.
  const asks = capability !== null && !shared.capabilities.has(capability) && method === "overlay.copyLink" && shared.onRequest.has(capability);
  if (capability && !shared.capabilities.has(capability) && !asks) {
    fail("PERMISSION_DENIED", `${method} needs the "${capability}" permission`, { capability });
  }
  // A call's own checks that Tavora makes before it takes the press, so a refused call leaves the press unused.
  CHECKS_BEFORE_PRESS[method]?.(panel, params);
  if (panel.gestures === "enforce" && needsGesture(method, params) && !(method === "panel.setDialog" && useAddPass(panel))) takePress(panel, method);
  if (asks && !askOnRequest(shared, capability)) return "denied" as Result<M>;

  const script = panel.scripts.get(method);
  if (script) return structuredClone(await (script as (params: unknown) => Result<M>)(params));
  const handler = handlers[method] as ((panel: Panel, params: Params<M>) => Result<M> | Promise<Result<M>>) | undefined;
  if (handler) return structuredClone(await handler(panel, params as Params<M>));
  if (method === "files.pickReadOnly" && (params as { multiple?: boolean } | undefined)?.multiple === true) return [] as Result<M>;
  if (SILENT.has(method)) return (method in SILENT_ANSWER ? SILENT_ANSWER[method] : null) as Result<M>;
  if (EMPTY_LISTS.has(method)) return [] as Result<M>;
  return fail("INTERNAL", `${method}: nothing is scripted for it; call host.answer("${method}", …)`);
}

function storeView(shared: Shared, map: Map<string, string>): StoreView {
  const ops = storeOps(shared, map, () => shared.limits.maxStoreBytes);
  return {
    entries: () => Object.fromEntries([...map].map(([key, value]) => [key, parse(value)])),
    get: (key) => ops.get({ key }),
    set: (key, value) => void ops.set({ key, value }),
    clear: () => map.clear(),
  };
}

/**
 * A `TavoraSDK` that keeps everything in memory, and `host`, the controls and state a test needs. Pass `share: host` to
 * get a second panel of the same module and workspace: its own sdk and panel state, the same storage and documents.
 */
export function createMemoryHost(options: MemoryHostOptions = {}): { sdk: TavoraSDK; host: MemoryHost } {
  const parent = options.share ? shares.get(options.share) : undefined;
  if (options.share && !parent) throw new TypeError("share must be the host of another createMemoryHost");
  const shared: Shared = parent ?? {
    limits: { ...LIMITS, ...options.limits },
    version: options.version ?? LATEST_TAVORA,
    now: options.now ?? Date.now,
    handshakeModule: options.module ?? { id: "local.test.module", version: "1.0.0" },
    capabilities: new Set(options.capabilities ?? ALL_CAPABILITIES),
    onRequest: new Set(options.onRequest ?? []),
    consent: options.consent ?? "allow",
    panelTypes: options.panelTypes ?? null,
    boards: options.leaderboards?.map((board) => ({ id: board.id, name: board.name })) ?? null,
    declared: new Map((options.leaderboards ?? []).map((board) => [board.id, { ...board, kind: board.kind ?? "score" }])),
    settings: new Map(),
    appSettings: new Map(),
    documents: new Map(),
    seq: 0,
    blobs: new Map(),
    appBlobs: new Map(),
    overlays: new Map(),
    gameOverlays: new Set(),
    hotkeys: [],
    opened: [],
    workspace: options.workspace ?? { id: "local-test", displayName: "Test", kind: "personal" },
    viewport: options.viewport ?? { width: 800, height: 600 },
    theme: { ...defaultTheme(), ...options.theme },
    language: options.language ?? "en",
    leaderboard: { online: true, signedIn: true, available: true, shown: false, name: null },
    panels: new Set(),
  };

  const state = options.state === undefined || options.state === null ? null : serializeJson(options.state, "state");
  if (state !== null && byteLength(state) > shared.limits.maxPanelStateBytes) throw new TypeError(`state is limited to ${shared.limits.maxPanelStateBytes} bytes, as panel state is`);

  const panel: Panel = {
    shared,
    type: options.panelType ?? null,
    launch: options.launch ?? { reason: "add" },
    gestures: options.gestures ?? "ignore",
    press: null,
    addPass: (options.addPass ?? true) && (options.launch ?? { reason: "add" }).reason === "add" ? { until: shared.now() + ADD_DIALOG_MS } : null,
    state,
    content: null,
    maximized: false,
    overGame: false,
    dialog: { open: false, width: DIALOG.width, height: DIALOG.height },
    dialogTitle: null,
    live: null,
    sources: [],
    navigate: null,
    earlySettings: null,
    suspended: false,
    behind: false,
    listeners: new Map(),
    scripts: new Map(),
    calls: {},
    log: [],
    saved: [],
    navigations: 0,
  };
  shared.panels.add(panel);

  const call = <M extends CallName>(method: M, params?: Params<M>) => invoke(panel, method, params);
  const on = <E extends EventName>(event: E, fn: (data: Events[E]) => void): (() => void) => {
    let set = panel.listeners.get(event);
    if (!set) panel.listeners.set(event, (set = new Set()));
    const listener = fn as (data: unknown) => void;
    set.add(listener);
    if (event === "lifecycle.suspend" && panel.suspended) {
      try {
        listener(null);
      } catch (error) {
        console.error(`[tavora] ${event} listener failed`, error);
      }
    }
    if (event === "lifecycle.behind" && panel.behind) {
      try {
        listener({ behind: true });
      } catch (error) {
        console.error(`[tavora] ${event} listener failed`, error);
      }
    }
    // As the SDK does: a Settings press that came before the first handler goes to it.
    if (event === "panel.openSettings" && panel.earlySettings) {
      const early = panel.earlySettings;
      panel.earlySettings = null;
      try {
        listener(early);
      } catch (error) {
        console.error(`[tavora] ${event} listener failed`, error);
      }
    }
    return () => set.delete(listener);
  };

  const store = (prefix: "storage" | "storage.app"): KeyValueStore => {
    const m = (name: "get" | "set" | "delete" | "keys" | "compareAndSet") => `${prefix}.${name}` as CallName;
    return {
      get: <T = JsonValue>(key: string) => call(m("get") as "storage.get", { key }) as Promise<T | null>,
      set: async (key, value) => void (await call(m("set") as "storage.set", { key, value })),
      delete: async (key) => void (await call(m("delete") as "storage.delete", { key })),
      keys: () => call(m("keys") as "storage.keys"),
      compareAndSet: (key, expected, value) => call(m("compareAndSet") as "storage.compareAndSet", { key, expected, value }),
    };
  };

  void invoke(panel, "bridge.handshake", { protocol: PROTOCOL_VERSION, sdkVersion: SDK_VERSION }).catch(() => {});
  const handshake = handshakeOf(panel);

  const sdk: TavoraSDK = {
    host: handshake,
    supports: (name) => supportsCall(shared.version, name),
    storage: { ...store("storage"), app: store("storage.app") },
    documents: {
      list: () => call("documents.list"),
      get: <T = JsonValue>(id: string) => call("documents.get", { id }) as Promise<(TavoraDocument & { data: T }) | null>,
      put: (document) => call("documents.put", document),
      delete: async (id, opts = {}) => void (await call("documents.delete", { id, ...opts })),
      onChange: (fn) => on("documents.changed", fn),
    },
    panel: {
      type: handshake.panel?.type ?? null,
      getState: <T = JsonValue>() => call("panel.getState") as Promise<T | null>,
      setState: async (value) => void (await call("panel.setState", { value })),
      getLaunch: () => call("panel.getLaunch"),
      setLive: async (state) => void (await call("panel.setLive", { state })),
      setContent: async (content) => void (await call("panel.setContent", { content })),
      isMaximized: () => call("panel.isMaximized"),
      setMaximized: async (maximized) => void (await call("panel.setMaximized", { maximized })),
      onMaximizedChange: (fn) => on("panel.maximized", ({ maximized }) => fn(maximized)),
      isOverGame: () => call("panel.isOverGame"),
      onOverGameChange: (fn) => on("panel.overGame", ({ over }) => fn(over)),
      openDialog: async (size) => void (await call("panel.setDialog", { open: true, ...size })),
      closeDialog: async () => void (await call("panel.setDialog", { open: false })),
      setDialogTitle: async (title) => void (await call("panel.setDialogTitle", { title })),
      onDialogChange: (fn) => on("panel.dialog", ({ open }) => fn(open)),
      onOpenSettings: (fn) => on("panel.openSettings", ({ key }) => fn({ key })),
      onNavigate: (fn) => {
        panel.navigate = fn;
        return () => {
          if (panel.navigate === fn) panel.navigate = null;
        };
      },
    },
    panels: {
      open: (type, opts = {}) => call("panels.open", { type, ...(opts.content ? { content: opts.content } : {}) }),
      openMany: (types) => call("panels.openMany", { types: [...types] }),
    },
    workspace: {
      getCurrent: () => call("workspace.getCurrent"),
      getViewport: () => call("workspace.getViewport"),
      onResize: (fn) => on("workspace.resize", fn),
    },
    ui: {
      getTheme: () => call("ui.getTheme"),
      onThemeChange: (fn) => on("ui.theme", fn),
      getLanguage: () => call("ui.getLanguage"),
      onLanguageChange: (fn) => on("ui.language", fn),
      showMenu: async (request) => call("ui.showMenu", menuParams(request)),
      tooltip: {
        show: async (request) => call("ui.tooltip.show", tooltipShowParams(request, shared.version)),
        move: async (anchor) => void (await call("ui.tooltip.move", tooltipParams(anchor, shared.version))),
        hide: async (id) => void (await call("ui.tooltip.hide", { id })),
        close: async (id) => void (await call("ui.tooltip.close", { id })),
        onClose: (fn) => on("ui.tooltipClosed", fn),
        defineSkin: async (name, skin) => {
          if (supportsCall(shared.version, "ui.tooltip.skin")) await call("ui.tooltip.defineSkin", skinParams(name, skin, shared.version));
        },
      },
    },
    blobs: {
      put: (file) => call("blobs.put", { file }),
      url: (id) => `${BLOB_PATH}${encodeURIComponent(id)}`,
      list: () => call("blobs.list"),
      usage: () => call("blobs.usage"),
      delete: async (id) => void (await call("blobs.delete", { id })),
      app: {
        put: (file) => call("blobs.app.put", { file }),
        url: (id) => `${APP_BLOB_PATH}${encodeURIComponent(id)}`,
        list: () => call("blobs.app.list"),
        usage: () => call("blobs.app.usage"),
        delete: async (id) => void (await call("blobs.app.delete", { id })),
      },
    },
    clipboard: {
      writeImage: async (png) => void (await call("clipboard.writeImage", { png })),
      writeText: async (text) => void (await call("clipboard.writeText", { text })),
    },
    folders: {
      state: (folder) => call("folders.state", { folder }),
      list: (folder) => call("folders.list", { folder }),
      read: (folder, path) => call("folders.read", { folder, path }),
      watch: async (folder, fn) => {
        const off = on("folders.changed", (change) => {
          if (change.folder === folder) fn(change);
        });
        try {
          await call("folders.watch", { folder, on: true });
        } catch (error) {
          off();
          throw error;
        }
        return () => {
          off();
          void call("folders.watch", { folder, on: false }).catch(() => undefined);
        };
      },
      choose: (folder) => call("folders.choose", { folder }),
      showInFolder: async (folder, path) => void (await call("folders.showInFolder", { folder, path })),
    },
    files: {
      pickReadOnly: ((opts: { extensions: string[]; multiple?: boolean }) => call("files.pickReadOnly", opts)) as TavoraSDK["files"]["pickReadOnly"],
      read: (id) => call("files.read", { id }),
      forget: async (id) => void (await call("files.forget", { id })),
      check: (id) => call("files.check", { id }),
      showInFolder: async (id) => void (await call("files.showInFolder", { id })),
      exportJson: (value, name = "Build") => call("files.exportJson", { value, name }),
      saveJson: (value, name = "") => call("files.saveJson", { value, ...(name ? { name } : {}) }),
      openJson: () => call("files.openJson"),
      save: (data, options) => call("files.save", { data, type: options.type, ...(options.name ? { name: options.name } : {}) }),
      open: (options) => call("files.open", options?.types ? { types: options.types } : undefined),
    },
    pictures: { save: (png, name = "") => call("pictures.save", { png, ...(name ? { name } : {}) }) },
    links: { open: async (url) => void (await call("links.open", { url })) },
    network: {
      fetch: (url, init = {}) => call("network.fetch", { ...init, url }),
      readPage: (url) => call("network.readPage", { url }),
    },
    connectors: {
      aiUsage: {
        accounts: () => call("aiUsage.accounts"),
        read: (accountId) => call("aiUsage.read", { accountId }),
        onAccountsChange: (fn) => on("aiUsage.accountsChanged", () => fn()),
      },
      systemInfo: {
        info: () => call("systemInfo.info"),
        watch: async (opts) => void (await call("systemInfo.watch", opts)),
        onSnapshot: (fn) => on("systemInfo.snapshot", fn),
        onDrivesChange: (fn) => on("systemInfo.drivesChanged", () => fn()),
        connectionLog: () => call("systemInfo.connectionLog"),
        clearConnectionLog: async () => void (await call("systemInfo.clearConnectionLog")),
        connectionSettings: () => call("systemInfo.connectionSettings"),
        setConnectionSettings: (settings) => call("systemInfo.setConnectionSettings", settings),
        onConnectionChange: (fn) => on("systemInfo.connectionChanged", fn),
        apps: () => call("systemInfo.apps"),
        traffic: () => call("systemInfo.traffic"),
      },
      media: {
        watch: async () => (await call("media.watch", { on: true })) ?? { state: "unavailable", sessions: [] },
        unwatch: async () => void (await call("media.watch", { on: false })),
        onChange: (fn) => on("media.changed", fn),
        control: (session, action) => call("media.control", { session, action }),
      },
      discord: {
        state: () => call("discord.state"),
        onStateChange: (fn) => on("discord.state", fn),
        connect: async () => void (await call("discord.connect")),
        allowControl: async () => void (await call("discord.allowControl")),
        command: (command, args) => call("discord.command", { command, args }),
        subscribe: async (event, channelId) => void (await call("discord.subscribe", channelId === undefined ? { event } : { event, channelId })),
        unsubscribe: async (event, channelId) => void (await call("discord.unsubscribe", channelId === undefined ? { event } : { event, channelId })),
        onEvent: (fn) => on("discord.event", fn),
        image: (url) => call("discord.image", { url }),
      },
    },
    leaderboards: {
      status: () => call("leaderboards.status"),
      show: () => call("leaderboards.show"),
      hide: () => call("leaderboards.hide"),
      submit: (board, results: LeaderboardResult[]) =>
        call("leaderboards.submit", { board, results: results.map((result) => (result.day === undefined ? { ...result, day: localDay(result.at) } : result)) }),
      top: (board, opts = {}) => call("leaderboards.top", { board, ...opts }),
      mine: (opts = {}) => call("leaderboards.mine", { ...opts }),
    },
    overlay: {
      publish: async (key, state) => void (await call("overlay.publish", { key, state })),
      remove: async (key) => void (await call("overlay.remove", { key })),
      copyLink: (key) => call("overlay.copyLink", { key }),
      showOverGame: (key) => call("overlay.showOverGame", { key }),
      hideOverGame: async (key) => void (await call("overlay.hideOverGame", { key })),
      overGame: () => call("overlay.overGame", undefined),
      setSources: async (sources) => void (await call("overlay.setSources", { sources })),
      onOverGameChange: (fn) => on("overlay.overGameChanged", ({ keys }) => fn(keys)),
      preview: async (key) => void (await call("overlay.preview", { key })),
      openPage: async () => void (await call("overlay.openPage", undefined)),
      resetLink: async (key) => void (await call("overlay.resetLink", { key })),
    },
    hotkeys: {
      list: () => call("hotkeys.list"),
      set: (action, target, label) => call("hotkeys.set", { action, target, label }),
      remove: async (target, action) => void (await call("hotkeys.remove", action === undefined ? { target } : { target, action })),
      onPress: (fn) => on("hotkeys.pressed", fn),
    },
    lifecycle: {
      onSuspend: (fn) => on("lifecycle.suspend", fn),
      onResume: (fn) => on("lifecycle.resume", fn),
      onBehindChange: (fn) => on("lifecycle.behind", ({ behind }) => fn(behind)),
      onDispose: (fn) => on("lifecycle.dispose", fn),
    },
  };

  const everyPanel = (fn: (other: Panel) => void) => shared.panels.forEach(fn);
  const host: MemoryHost = {
    handshake,
    calls: panel.calls as MemoryHost["calls"],
    log: panel.log,
    answer: (method, fn) => void panel.scripts.set(method, fn as (params: never) => unknown),
    unanswer: (method) => void panel.scripts.delete(method),
    emit: (event, data) => deliver(panel, event, data),
    changeTheme: (theme) => {
      shared.theme = { ...shared.theme, ...theme } as TavoraTheme;
      if (shared.theme.style === undefined) delete shared.theme.style;
      if (shared.theme.tabOverflow === undefined) delete shared.theme.tabOverflow;
      everyPanel((other) => deliver(other, "ui.theme", themeFor(shared)));
    },
    setLanguage: (language) => {
      shared.language = language;
      everyPanel((other) => deliver(other, "ui.language", language));
    },
    resize: (viewport) => {
      shared.viewport = { ...viewport };
      everyPanel((other) => deliver(other, "workspace.resize", { ...viewport }));
    },
    navigate: (content) => navigatePanel(panel, content),
    suspend: () => deliver(panel, "lifecycle.suspend", null),
    resume: () => deliver(panel, "lifecycle.resume", null),
    behind: (behind = true) => deliver(panel, "lifecycle.behind", { behind }),
    dispose: () => {
      deliver(panel, "lifecycle.dispose", null);
      shared.panels.delete(panel);
    },
    gesture: () => void (panel.press = { at: shared.now(), used: false }),
    click: async (fn) => {
      panel.press = { at: shared.now(), used: false };
      return fn();
    },
    setMaximized: (maximized) => setMaximized(panel, maximized),
    setPanelOverGame: (over) => setPanelOverGame(panel, over),
    setDialog: (open) => {
      if (panel.dialog.open === open) return;
      panel.dialog = { ...panel.dialog, open };
      if (!open) panel.dialogTitle = null;
      deliver(panel, "panel.dialog", { open });
    },
    get state() {
      return panel.state === null ? null : parse(panel.state);
    },
    get content() {
      return panel.content && { ...panel.content };
    },
    get maximized() {
      return panel.maximized;
    },
    get panelOverGame() {
      return panel.overGame;
    },
    get dialog() {
      return { ...panel.dialog };
    },
    get dialogTitle() {
      return panel.dialogTitle;
    },
    get live() {
      return panel.live;
    },
    get sources() {
      return panel.sources.map((source) => ({ ...source }));
    },
    setOverGame: (keys) => {
      shared.gameOverlays = new Set(keys);
      for (const other of shared.panels) deliver(other, "overlay.overGameChanged", { keys: [...shared.gameOverlays] });
    },
    openSettings: (key) => {
      if (!panel.dialog.open) {
        panel.dialog = { ...panel.dialog, open: true };
        deliver(panel, "panel.dialog", { open: true });
      }
      deliver(panel, "panel.openSettings", { key });
    },
    get opened() {
      return shared.opened;
    },
    get saved() {
      return panel.saved;
    },
    get overlays() {
      return Object.fromEntries(shared.overlays);
    },
    storage: storeView(shared, shared.settings),
    appStorage: storeView(shared, shared.appSettings),
    documents: {
      list: () => (handlers["documents.list"]!(panel, undefined) as DocumentSummary[]),
      get: (id) => {
        const stored = shared.documents.get(validateId(id));
        return stored ? documentOf(stored) : null;
      },
      put: (document) => putDocument(shared, document, null),
      delete: (id, opts = {}) => deleteDocument(shared, id, opts.ifRevision, null),
      clear: () => shared.documents.clear(),
    },
    leaderboards: {
      get status() {
        return { ...shared.leaderboard };
      },
      setStatus: (status) => void (shared.leaderboard = { ...shared.leaderboard, ...status }),
    },
    setWorkspace: (workspace) => void (shared.workspace = { ...workspace }),
  };
  shares.set(host, shared);
  return { sdk, host };
}
