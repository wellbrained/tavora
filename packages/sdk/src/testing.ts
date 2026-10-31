// @tavora/sdk/testing: a test adapter for module tests. It implements the whole `TavoraSDK` and keeps its state in
// memory, so a module can be tested without Tavora; it follows the real host's rules (limits, revisions, errors).
// Not for use in a module's shipped code.
import { menuParams, tooltipParams } from "./anchor.js";
import { SDK_VERSION, TavoraError, type KeyValueStore, type TavoraSDK } from "./index.js";
import {
  BLOB_PATH,
  BLOB_TYPES,
  DOCUMENT_ID,
  LIMITS,
  METHOD_INFO,
  needsGesture,
  supportsCall,
  PROTOCOL_VERSION,
  THEME_TOKENS,
  versionAtLeast,
  type BlobInfo,
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
  type LeaderboardResult,
  type LeaderboardStatus,
  type LeaderboardSubmitResult,
  type MethodName,
  type Methods,
  type PanelContent,
  type PanelLaunch,
  type PanelOpenManyResult,
  type PanelOpenResult,
  type TavoraDocument,
  type TavoraTheme,
  type TavoraViewport,
  type TavoraWorkspace,
} from "./protocol.js";

export { TavoraError } from "./index.js";

type Table = Methods & HttpCalls;
export type { CallName };
type Params<M extends CallName> = Table[M]["params"];
type Result<M extends CallName> = Table[M]["result"];

type Limits = { [K in keyof typeof LIMITS]: number };

export interface MemoryHostOptions {
  /**
   * The Tavora version the host claims, in the handshake. Methods a newer Tavora added throw UNKNOWN_METHOD, as an older
   * Tavora does (`workspace.getCurrent` then falls back to `game.getCurrent`, as the real client does). Default: the newest
   * Tavora the SDK knows.
   */
  version?: string;
  /** The module's id and version in the handshake. */
  module?: { id: string; version: string };
  /** Capabilities the user granted. Default: all of them. */
  capabilities?: Capability[];
  /**
   * `"ignore"` (default) lets every call through. `"enforce"` refuses calls that need a click or key press with
   * PERMISSION_DENIED unless the test made one first with `host.gesture()` or `host.click(fn)`; one press allows one call.
   */
  gestures?: "ignore" | "enforce";
  /** This panel's type (one of the manifest's `panels`). Default: null, a module without panel types. */
  panelType?: string | null;
  /** The panel types of the manifest; `panels.open` refuses another one with INVALID_PARAMS. Default: any. */
  panelTypes?: string[];
  /** Why the page loads. Default: `{ reason: "add" }`. */
  launch?: PanelLaunch;
  workspace?: TavoraWorkspace;
  viewport?: TavoraViewport;
  theme?: Partial<TavoraTheme>;
  language?: string;
  /** Lower limits for a test that wants to hit a quota without writing megabytes. */
  limits?: Partial<Limits>;
  /** The clock for `updatedAt` and `createdAt`. Default: the real time. */
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
  /** The user switched theme; every panel of the shared state hears it. Missing parts stay as they were. */
  changeTheme(theme: Partial<TavoraTheme>): void;
  setLanguage(language: string): void;
  resize(viewport: TavoraViewport): void;
  /** Another panel asked this one to show `content` (panels.open): runs the `panel.onNavigate` handler. */
  navigate(content: PanelContent): Promise<{ handled: boolean; ok: boolean }>;
  suspend(): void;
  resume(): void;
  /** The page goes away: `lifecycle.onDispose` fires and this panel gets no more events from the others. */
  dispose(): void;
  /** The user made one click or key press (or `count`), which lets that many gated calls through when gestures are enforced. */
  gesture(count?: number): void;
  /** Runs `fn` right after a click: one gesture, then `fn`. */
  click<T>(fn: () => T | Promise<T>): Promise<T>;
  /** The user maximized or restored the panel. */
  setMaximized(maximized: boolean): void;
  /** The user closed (or opened) the panel's dialog. */
  setDialog(open: boolean): void;
  readonly state: JsonValue | null;
  readonly content: PanelContent | null;
  readonly maximized: boolean;
  readonly dialog: { open: boolean; width: number; height: number };
  /** What `panel.setLive` last set. */
  readonly live: JsonValue | null;
  /** Panels `panels.open` had to open new, in order. */
  readonly opened: readonly { type: string; content: PanelContent | null }[];
  /** Files and pictures the module saved, in order. */
  readonly saved: readonly { kind: "json" | "picture"; fileName: string; value: JsonValue | Blob }[];
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

/** Newest Tavora the SDK knows, and the default version of a memory host. */
export const LATEST_TAVORA = "0.23.29";
/** Most panel types one call may name: as many as a manifest may declare (MAX_PANEL_TYPES in @tavora/module-schema). */
const MAX_PANEL_TYPES = 16;

/** Calls that answer with nothing when nobody scripted them. */
const SILENT = new Set<CallName>([
  "files.forget", "files.showInFolder", "files.check", "links.open", "ui.tooltip.show", "ui.tooltip.move", "ui.tooltip.hide", "ui.tooltip.close", "ui.showMenu",
  "systemInfo.watch", "systemInfo.clearConnectionLog", "media.watch", "media.control", "discord.connect", "discord.allowControl",
  "discord.subscribe", "discord.unsubscribe", "overlay.resetLink", "overlay.preview", "clipboard.writeImage", "files.pickReadOnly",
  "files.openJson", "discord.image", "hotkeys.set", "overlay.copyLink", "overlay.showOverGame", "panel.navigated",
]);
const SILENT_ANSWER: Partial<Record<CallName, unknown>> = {
  "files.check": { found: false, reason: "unlinked" },
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

function localDay(at: number): string {
  const date = new Date(at);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultTheme(): TavoraTheme {
  const colors = { background: "#101114", surface: "#1b1d22", text: "#f2f3f5", textMuted: "#9a9ea8", accent: "#6d8cff" };
  const tokens = Object.fromEntries(THEME_TOKENS.map((token) => [token, colors.accent])) as TavoraTheme["tokens"];
  Object.assign(tokens, { background: colors.background, foreground: colors.text, card: colors.surface });
  return { mode: "dark", colors, tokens, radius: 8 };
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
  panelTypes: string[] | null;
  settings: Map<string, string>;
  appSettings: Map<string, string>;
  documents: Map<string, StoredDocument>;
  seq: number;
  blobs: Map<string, BlobInfo>;
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
  presses: number;
  state: string | null;
  content: PanelContent | null;
  maximized: boolean;
  dialog: { open: boolean; width: number; height: number };
  live: JsonValue | null;
  navigate: ((content: PanelContent) => void | Promise<void>) | null;
  suspended: boolean;
  listeners: Map<EventName, Set<(data: unknown) => void>>;
  scripts: Map<CallName, (params: never) => unknown>;
  calls: Record<string, unknown[]>;
  log: CallRecord[];
  saved: { kind: "json" | "picture"; fileName: string; value: JsonValue | Blob }[];
  navigations: number;
}

const shares = new WeakMap<MemoryHost, Shared>();

function deliver(panel: Panel, event: EventName, data: unknown): void {
  if (event === "lifecycle.suspend") panel.suspended = true;
  if (event === "lifecycle.resume") panel.suspended = false;
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

const handlers: Handlers = {
  "bridge.handshake": (panel) => handshakeOf(panel),
  "workspace.getCurrent": (panel) => ({ ...panel.shared.workspace }),
  "game.getCurrent": ({ shared }) => ({ id: shared.workspace.id, displayName: shared.workspace.displayName, kind: shared.workspace.kind === "personal" ? "workspace" : "game" }),
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
  "panel.setMaximized": (panel, { maximized }) => {
    if (typeof maximized !== "boolean") fail("INVALID_PARAMS", "params.maximized must be a boolean");
    setMaximized(panel, maximized);
    return null;
  },
  "panel.setDialog": (panel, params) => {
    if (typeof params.open !== "boolean") fail("INVALID_PARAMS", "params.open must be a boolean");
    const side = (key: "width" | "height") => {
      const value = params[key];
      if (value === undefined) return DIALOG[key];
      if (!Number.isSafeInteger(value) || value < DIALOG.min || value > DIALOG.max) fail("INVALID_PARAMS", `params.${key} must be a whole number from ${DIALOG.min} to ${DIALOG.max}`);
      return value;
    };
    const next = params.open ? { open: true, width: side("width"), height: side("height") } : { ...panel.dialog, open: false };
    const changed = next.open !== panel.dialog.open;
    panel.dialog = next;
    if (changed) deliver(panel, "panel.dialog", { open: next.open });
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

  "ui.getTheme": ({ shared }) => structuredClone(shared.theme),
  "ui.getLanguage": ({ shared }) => shared.language,

  "blobs.put": ({ shared }, { file }) => {
    if (!(BLOB_TYPES as readonly string[]).includes(file.type)) fail("INVALID_PARAMS", "only PNG, JPEG, GIF and WebP pictures and PDF files can be stored");
    if (file.size > shared.limits.maxBlobBytes) fail("QUOTA_EXCEEDED", `a file is limited to ${shared.limits.maxBlobBytes} bytes`);
    const used = [...shared.blobs.values()].reduce((sum, blob) => sum + blob.bytes, 0);
    if (used + file.size > shared.limits.maxBlobsBytes) fail("QUOTA_EXCEEDED", `files are limited to ${shared.limits.maxBlobsBytes} bytes per module and workspace`);
    const info: BlobInfo = { id: randomId().replaceAll("-", ""), bytes: file.size, type: file.type as BlobInfo["type"], createdAt: new Date(shared.now()).toISOString() };
    shared.blobs.set(info.id, info);
    return { ...info };
  },
  "blobs.list": ({ shared }) => [...shared.blobs.values()].map((blob) => ({ ...blob })),
  "blobs.usage": ({ shared }) => ({
    bytes: [...shared.blobs.values()].reduce((sum, blob) => sum + blob.bytes, 0),
    count: shared.blobs.size,
    maxBytes: shared.limits.maxBlobsBytes,
    maxFileBytes: shared.limits.maxBlobBytes,
  }),
  "blobs.delete": ({ shared }, { id }) => {
    shared.blobs.delete(id);
    return null;
  },
  "clipboard.writeImage": (_panel, { png }) => {
    if (png.type !== "image/png") fail("INVALID_PARAMS", "only a PNG picture can be copied");
    return null;
  },
  "pictures.save": (panel, { png, name = "" }) => {
    if (png.type !== "image/png") fail("INVALID_PARAMS", "only a PNG picture can be saved");
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
  "files.exportJson": (panel, { value, name = "Build" }) => {
    if (byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) fail("QUOTA_EXCEEDED", "JSON exports may be at most 8 MiB");
    const fileName = `${name.replace(/\.json$/i, "")}.json`;
    panel.saved.push({ kind: "json", fileName, value: parse(JSON.stringify(value)) });
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
  "leaderboards.submit": ({ shared }, { results }): LeaderboardSubmitResult => {
    if (!shared.leaderboard.online) fail("NETWORK_ERROR", "Tavora's service can't be reached");
    if (!shared.leaderboard.signedIn || !shared.leaderboard.shown) fail("PERMISSION_DENIED", "the user is signed out of Tavora or hasn't agreed to show their results yet");
    if (results.length > shared.limits.maxLeaderboardResults) fail("INVALID_PARAMS", `at most ${shared.limits.maxLeaderboardResults} results at once`);
    return { accepted: results.map((result) => result.id), rejected: [] };
  },
  "leaderboards.top": () => ({ rows: [] }),
  "leaderboards.mine": () => ({ boards: [] }),
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

async function invoke<M extends CallName>(panel: Panel, method: M, params?: Params<M>): Promise<Result<M>> {
  (panel.calls[method] ??= []).push(params);
  panel.log.push({ method, params });
  const { shared } = panel;

  const { capability } = METHOD_INFO[method];
  if (!supportsCall(shared.version, method)) fail("UNKNOWN_METHOD", `unknown method ${method}`);
  if (capability && !shared.capabilities.has(capability)) {
    fail("PERMISSION_DENIED", `${method} needs the "${capability}" permission`, { capability });
  }
  if (panel.gestures === "enforce" && needsGesture(method, params)) {
    if (panel.presses <= 0) fail("PERMISSION_DENIED", `${method} must be called right after a click or key press`);
    panel.presses--;
  }

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
    capabilities: new Set(options.capabilities ?? ["network", "aiUsage", "discord", "overlay", "systemInfo", "media", "leaderboards", "files", "clipboard", "sharedData"]),
    panelTypes: options.panelTypes ?? null,
    settings: new Map(),
    appSettings: new Map(),
    documents: new Map(),
    seq: 0,
    blobs: new Map(),
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

  const panel: Panel = {
    shared,
    type: options.panelType ?? null,
    launch: options.launch ?? { reason: "add" },
    gestures: options.gestures ?? "ignore",
    presses: 0,
    state: null,
    content: null,
    maximized: false,
    dialog: { open: false, width: DIALOG.width, height: DIALOG.height },
    live: null,
    navigate: null,
    suspended: false,
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
    game: { getCurrent: () => call("game.getCurrent") },
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
      openDialog: async (size) => void (await call("panel.setDialog", { open: true, ...size })),
      closeDialog: async () => void (await call("panel.setDialog", { open: false })),
      onDialogChange: (fn) => on("panel.dialog", ({ open }) => fn(open)),
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
      getCurrent: () =>
        call("workspace.getCurrent").catch(async (error: unknown) => {
          if (!(error instanceof TavoraError) || error.code !== "UNKNOWN_METHOD") throw error;
          const game = await call("game.getCurrent");
          return { id: game.id, displayName: game.displayName, kind: game.kind === "workspace" ? "personal" : "game" } satisfies TavoraWorkspace;
        }),
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
        show: async (request) => call("ui.tooltip.show", tooltipParams(request)),
        move: async (anchor) => void (await call("ui.tooltip.move", tooltipParams(anchor))),
        hide: async (id) => void (await call("ui.tooltip.hide", { id })),
        close: async (id) => void (await call("ui.tooltip.close", { id })),
        onClose: (fn) => on("ui.tooltipClosed", fn),
      },
    },
    blobs: {
      put: (file) => call("blobs.put", { file }),
      url: (id) => `${BLOB_PATH}${encodeURIComponent(id)}`,
      list: () => call("blobs.list"),
      usage: () => call("blobs.usage"),
      delete: async (id) => void (await call("blobs.delete", { id })),
    },
    clipboard: { writeImage: async (png) => void (await call("clipboard.writeImage", { png })) },
    files: {
      pickReadOnly: ((opts: { extensions: string[]; multiple?: boolean }) => call("files.pickReadOnly", opts)) as TavoraSDK["files"]["pickReadOnly"],
      read: (id) => call("files.read", { id }),
      forget: async (id) => void (await call("files.forget", { id })),
      check: (id) => call("files.check", { id }),
      showInFolder: async (id) => void (await call("files.showInFolder", { id })),
      exportJson: (value, name = "Build") => call("files.exportJson", { value, name }),
      saveJson: (value, name = "") => call("files.saveJson", { value, ...(name ? { name } : {}) }),
      openJson: () => call("files.openJson"),
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
      preview: async (key) => void (await call("overlay.preview", { key })),
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
      shared.theme = { ...shared.theme, ...theme };
      everyPanel((other) => deliver(other, "ui.theme", structuredClone(shared.theme)));
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
    dispose: () => {
      deliver(panel, "lifecycle.dispose", null);
      shared.panels.delete(panel);
    },
    gesture: (count = 1) => void (panel.presses += count),
    click: async (fn) => {
      panel.presses++;
      return fn();
    },
    setMaximized: (maximized) => setMaximized(panel, maximized),
    setDialog: (open) => {
      if (panel.dialog.open === open) return;
      panel.dialog = { ...panel.dialog, open };
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
    get dialog() {
      return { ...panel.dialog };
    },
    get live() {
      return panel.live;
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
