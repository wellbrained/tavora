// Manifest v1 for tavora.module.json (apps/docs/reference/manifest.md). The JSON Schema
// in schema/ describes the same rules for editors; tests keep the two in step.

export interface ModuleViewport {
  minWidth: number;
  minHeight: number;
  preferredWidth?: number;
  preferredHeight?: number;
}

/**
 * A named panel type (the decision log, named panels rows of 2026-10-17): one tool a module offers,
 * such as Inventory or Build planner. Users add each type on its own and may open several copies;
 * every type shares the module's saved content and permissions.
 */
export interface ModulePanelType {
  /** Stable identity, never shown. Saved layouts keep it, so renaming `name` changes nothing for users. */
  id: string;
  /** Short name on the panel's tab, such as `Build planner`. */
  name: string;
  /** The page for this type; the module's own `entry` when left out, so one page may serve every type. */
  entry?: string;
  /** The tab icon for this type; the module's own `icon` when left out. */
  icon?: string;
  /** This type's sizes; the module's own `viewport` when left out. */
  viewport?: ModuleViewport;
  /** Panels opened before the module had panel types become this type. At most one type says so; without one, the first type. */
  continues?: boolean;
  /**
   * The user may show this panel in their game: its menu offers Show in game, and the panel appears over the game only
   * while the user holds Tavora's in-game layer open. Needs a `minTavora` newer than LAST_TAVORA_WITHOUT_IN_GAME_PANELS.
   */
  inGame?: boolean;
}

/** Something a module can do on a key press (manifest `actions`). The user binds the key in Tavora; the module only hears which action fired. */
export interface ModuleAction {
  /** Stable identity, never shown. Saved hotkeys keep it. */
  id: string;
  /** Short name shown next to the key in Tavora, such as `Start/Pause`. */
  name: string;
}

/**
 * One language's texts (manifest `translations`). Each one Tavora finds replaces the plain field when it shows
 * that language; anything left out stays as the plain field says.
 */
export interface ModuleTranslation {
  name?: string;
  description?: string;
  /** Panel type id to the name on its tab. */
  panels?: Record<string, string>;
  /** Action id to the name shown next to its key. */
  actions?: Record<string, string>;
}

export interface ModuleManifest {
  $schema?: string;
  id: string;
  name: string;
  description?: string;
  version: string;
  apiVersion: "1";
  /** The oldest Tavora the module works with, such as `0.18.0`. An older Tavora refuses to install or load it, and says why. */
  minTavora?: string;
  entry: string;
  icon?: string;
  /** A JSON file inside the package with the module's patch notes (see validateChangelog), shown to users in Settings > Modules. */
  changelog?: string;
  /** The module's web page, `http` or `https`, shown in the catalog. Tavora opens it like a module link. */
  homepage?: string;
  /** Where users send feedback: an https address or an email address. A click opens the web page or the mail app. */
  support?: string;
  /**
   * A `.md` or `.txt` file inside the package introducing the module, at most MAX_README_BYTES, shown in the catalog.
   * Tavora shows its headings, paragraphs and lists as plain text: no links, pictures or HTML.
   */
  readme?: string;
  /** Up to MAX_SCREENSHOTS pictures inside the package, `.png` or `.webp`, shown in the catalog before installing. */
  screenshots?: string[];
  games: string[];
  /**
   * Whether the module may be added to a personal workspace, which belongs to no game. Only modules for any game
   * (an empty `games`) can be; leave it out for true, and set false for one that only makes sense in a game.
   */
  workspaces?: boolean;
  viewport: ModuleViewport;
  /** Named panel types. Without them the module has one panel, made from `entry`, `icon` and `viewport`. */
  panels?: ModulePanelType[];
  /**
   * For a module without panel types: the user may show its panel in their game, like a type's `inGame`. Needs a
   * `minTavora` newer than LAST_TAVORA_WITHOUT_IN_GAME_PANELS; a module with `panels` sets it per type instead.
   */
  inGame?: boolean;
  /**
   * The page streaming software such as OBS shows as a Browser Source (overlay.copyLink). Tavora serves it on this PC
   * only, with the files next to it, and gives it live data from the module. Game overlays (overlay.showOverGame) show the
   * same page over the user's game and need no connector; the `stream-overlay` connector is only for OBS links, and
   * needs this page. A module with an overlay and no connector needs a `minTavora` newer than
   * LAST_TAVORA_WITHOUT_GAME_OVERLAYS, because older Tavoras refuse that.
   */
  overlay?: string;
  /**
   * The size `overlay` starts at over the user's game, in pixels (the user can still resize it). Needs `overlay` and a
   * `minTavora` newer than LAST_TAVORA_WITHOUT_OVERLAY_SIZE.
   */
  overlaySize?: { width: number; height: number };
  /** What the module can do on a key press (hotkeys.set). Up to MAX_ACTIONS. */
  actions?: ModuleAction[];
  /**
   * The module's name, description, panel and action names in other languages, keyed by a lowercase language code
   * such as `de` or `pt-br` (see translateManifest). Needs a `minTavora` newer than LAST_TAVORA_WITHOUT_TRANSLATIONS,
   * because older Tavoras refuse the field; Tavora's own modules ship with the app and need none.
   */
  translations?: Record<string, ModuleTranslation>;
  permissions: {
    /** Hosts the module asks to reach through network.fetch, such as `api.example.com`. Each needs the user's grant. */
    network: string[];
    /** Parts of Tavora that hold a sign-in, which the module asks to use (see CONNECTORS). Each needs the user's grant. */
    connectors?: Connector[];
    /**
     * Connectors of `connectors` that Tavora asks for only when the module first needs one (such as copying an overlay
     * link), not when it is added, so the module works without them. Only ON_REQUEST_CONNECTORS can be asked for this way.
     */
    onRequest?: Connector[];
    /** Lets the page compile WebAssembly (Excalidraw's picture resizing needs it). Only Tavora's own modules may ask for it. */
    webAssembly?: boolean;
  };
}

export type ManifestResult =
  | { ok: true; manifest: ModuleManifest }
  | { ok: false; errors: string[] };

// Module and game ids end up in session partitions, origins and file paths,
// so they are restricted to a small, path-safe alphabet.
const MODULE_ID = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*){1,4}$/;
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
const MAX_VIEWPORT = 10_000;
const FIELDS = ["$schema", "id", "name", "description", "version", "apiVersion", "minTavora", "entry", "icon", "changelog", "homepage", "support", "readme", "screenshots", "games", "workspaces", "viewport", "panels", "inGame", "overlay", "overlaySize", "actions", "translations", "permissions"];
const VIEWPORT_FIELDS = ["minWidth", "minHeight", "preferredWidth", "preferredHeight"];

/** Most screenshots a manifest may name, and the longest homepage address. */
export const MAX_SCREENSHOTS = 5;
/** Largest readme file the catalog takes. */
export const MAX_README_BYTES = 20 * 1024;
/** Largest screenshot file the catalog takes and the app shows. */
export const MAX_SCREENSHOT_BYTES = 1024 * 1024;
export const MAX_HOMEPAGE_LENGTH = 300;
// http or https, a host without a user name or password, and no spaces or control characters.
const HOMEPAGE = /^https?:\/\/[^\s\u0000-\u001f/?#@\\]+(?:[/?#][^\s\u0000-\u001f\\]*)?$/;

/** Longest support link, web address or email address. */
export const MAX_SUPPORT_LENGTH = 300;
const SUPPORT_EMAIL = /^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Whether a support link is an https address with a host (without a sign-in) or a plain email address, at most MAX_SUPPORT_LENGTH characters. */
export function isSupportLink(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_SUPPORT_LENGTH) return false;
  if (SUPPORT_EMAIL.test(value)) return true;
  return value.startsWith("https://") && isHomepage(value);
}

/** Whether a support link is an email address (otherwise it is an https address). */
export function isSupportEmail(value: string): boolean {
  return SUPPORT_EMAIL.test(value);
}

/** Whether a homepage is an address Tavora opens: `http` or `https` with a host, at most MAX_HOMEPAGE_LENGTH characters. */
export function isHomepage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_HOMEPAGE_LENGTH || !HOMEPAGE.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** Most panel types one module may offer, and the longest short name a tab shows. */
export const MAX_PANEL_TYPES = 16;
export const MAX_PANEL_NAME = 24;
const PANEL_TYPE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const PANEL_FIELDS = ["id", "name", "entry", "icon", "viewport", "continues", "inGame"];

/** Most hotkey actions one module may declare, and the longest name Tavora shows for one. */
export const MAX_ACTIONS = 16;
export const MAX_ACTION_NAME = 40;
const ACTION_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function isActionId(value: unknown): value is string {
  return typeof value === "string" && ACTION_ID.test(value);
}

export function isPanelTypeId(value: unknown): value is string {
  return typeof value === "string" && PANEL_TYPE_ID.test(value);
}

/** A panel type with the module's own entry, icon and viewport filled in where the type has none. */
export interface ResolvedPanelType {
  id: string;
  name: string;
  entry: string;
  icon: string | undefined;
  viewport: ModuleViewport;
  /** The user may show this panel in their game (the type's `inGame`). */
  inGame?: true;
}

/** The module's panel types, resolved; empty for a module with one panel and no types. */
export function panelTypes(manifest: ModuleManifest): ResolvedPanelType[] {
  return (manifest.panels ?? []).map((type) => ({
    id: type.id,
    name: type.name,
    entry: type.entry ?? manifest.entry,
    icon: type.icon ?? manifest.icon,
    viewport: type.viewport ?? manifest.viewport,
    ...(type.inGame === true ? { inGame: true as const } : {}),
  }));
}

/** The type a panel opened before the module had types becomes: the one marked `continues`, else the first. Null without types. */
export function continuingPanelType(manifest: ModuleManifest): string | null {
  const panels = manifest.panels ?? [];
  return (panels.find((type) => type.continues) ?? panels[0])?.id ?? null;
}

/** One version in a module's patch notes. */
export interface ChangelogEntry {
  /** The module version, semver as in the manifest. */
  version: string;
  /** YYYY-MM-DD, when the version came out. */
  date?: string;
  /** What users notice, one line each, as plain text. */
  notes: string[];
}

/** Limits of a changelog file: it is read by the host and shown as plain text. */
export const CHANGELOG_LIMITS = { maxBytes: 64 * 1024, maxEntries: 100, maxNotes: 20, maxNoteLength: 500 } as const;

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type ChangelogResult = { ok: true; entries: ChangelogEntry[] } | { ok: false; errors: string[] };

/**
 * Checks the contents of a changelog file: an array of `{ version, date?, notes }`, newest first, each version once.
 * Notes are plain text: Tavora never reads them as HTML or Markdown.
 */
export function validateChangelog(input: unknown): ChangelogResult {
  if (!Array.isArray(input)) return { ok: false, errors: ["the changelog must be an array of versions, newest first"] };
  const errors: string[] = [];
  if (input.length > CHANGELOG_LIMITS.maxEntries) errors.push(`the changelog may list at most ${CHANGELOG_LIMITS.maxEntries} versions`);
  const seen = new Set<string>();
  input.slice(0, CHANGELOG_LIMITS.maxEntries).forEach((entry: unknown, index) => {
    const at = `changelog[${index}]`;
    if (!isRecord(entry)) return void errors.push(`${at} must be an object`);
    const extra = Object.keys(entry).filter((key) => key !== "version" && key !== "date" && key !== "notes");
    if (extra.length > 0) errors.push(`${at} has unknown fields: ${extra.join(", ")}`);
    if (typeof entry.version !== "string" || !SEMVER.test(entry.version)) errors.push(`${at}.version must be semver, e.g. 1.0.0`);
    else if (seen.has(entry.version)) errors.push(`${at}.version ${entry.version} is listed twice`);
    else seen.add(entry.version);
    if (entry.date !== undefined && (typeof entry.date !== "string" || !DATE.test(entry.date))) errors.push(`${at}.date must be YYYY-MM-DD`);
    const notes = entry.notes;
    if (!Array.isArray(notes) || notes.length === 0 || notes.length > CHANGELOG_LIMITS.maxNotes) {
      errors.push(`${at}.notes must be an array of 1 to ${CHANGELOG_LIMITS.maxNotes} lines`);
    } else if (!notes.every((note) => typeof note === "string" && note.trim() !== "" && note.length <= CHANGELOG_LIMITS.maxNoteLength && !/[\u0000-\u001f]/.test(note))) {
      errors.push(`${at}.notes must be lines of 1 to ${CHANGELOG_LIMITS.maxNoteLength} characters, without line breaks`);
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries: input as ChangelogEntry[] };
}

/** Every page and icon the manifest names, its panel types' included, each once, and its screenshots: the files a package must hold. */
export function manifestFiles(manifest: ModuleManifest): { entries: string[]; icons: string[]; screenshots: string[] } {
  const entries = new Set([manifest.entry]);
  if (manifest.overlay !== undefined) entries.add(manifest.overlay);
  const icons = new Set(manifest.icon === undefined ? [] : [manifest.icon]);
  for (const type of manifest.panels ?? []) {
    if (type.entry !== undefined) entries.add(type.entry);
    if (type.icon !== undefined) icons.add(type.icon);
  }
  return { entries: [...entries], icons: [...icons], screenshots: [...(manifest.screenshots ?? [])] };
}

export function isModuleId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && MODULE_ID.test(value);
}

/**
 * Who owns a module's data (the decision log, publisher row of 2026-10-16):
 * Tavora's own modules, unsigned local ones, or a publisher's signing key,
 * named by the hex fingerprint of the publisher's first key. Owners end up in
 * paths and session partitions, so no dots or other separators.
 */
export const OFFICIAL_OWNER = "official";
export const LOCAL_OWNER = "local";
const KEY_FINGERPRINT = /^[0-9a-f]{32}$/;

export function isOwnerId(value: unknown): value is string {
  return value === OFFICIAL_OWNER || value === LOCAL_OWNER || (typeof value === "string" && KEY_FINGERPRINT.test(value));
}

export function isGameId(value: unknown): value is string {
  return typeof value === "string" && GAME_ID.test(value);
}

/**
 * Connectors (glossary): parts of Tavora that reach outside the module's panel and let a granted module use them
 * without seeing what is behind them. `ai-usage` reads the usage of the user's Claude and Codex accounts with their
 * sign-ins; `discord` talks to the Discord app on this PC with Tavora's Discord sign-in (voice channels, who is
 * talking, joining and muting); `stream-overlay` shows the module's `overlay` page in streaming software on this PC;
 * `system-info` reads this PC's hardware and how busy it is (CPU, graphics card, memory, drives); `media` sees what plays
 * on this PC (Spotify, browsers, video players) and can play, pause and skip.
 */
export const CONNECTORS = ["ai-usage", "discord", "media", "stream-overlay", "system-info"] as const;
export type Connector = (typeof CONNECTORS)[number];

/** Connectors a module may have Tavora ask for on first use (permissions.onRequest) instead of when it is added. */
export const ON_REQUEST_CONNECTORS: readonly Connector[] = ["stream-overlay"];

/** The connectors Tavora asks for when the module is added or updated: all it lists, but those it asks for on request. */
export function connectorsAtAdd(permissions: ModuleManifest["permissions"]): Connector[] {
  const later = new Set(permissions.onRequest ?? []);
  return (permissions.connectors ?? []).filter((name) => !later.has(name));
}

export function isConnector(value: unknown): value is Connector {
  return (CONNECTORS as readonly unknown[]).includes(value);
}

/** Most hosts one manifest may ask for. */
export const MAX_NETWORK_HOSTS = 32;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A host a module may ask to reach (the decision log, module grants row of 2026-10-16): an exact,
 * lowercase public name such as `api.example.com`. No wildcards, ports, schemes, IP addresses or
 * names of this PC or the local network (`localhost`, `.local`), so a grant always names one site.
 */
export function isNetworkHost(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 253) return false;
  const labels = value.split(".");
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return false;
  const last = labels.at(-1)!;
  // A top-level label of digits only is an IP address (or not a name at all).
  return !/^\d+$/.test(last) && !["localhost", "local", "internal", "arpa"].includes(last);
}

/** Most languages one manifest may translate into. */
export const MAX_TRANSLATIONS = 32;
/** The last Tavora that refuses an `overlay` without the `stream-overlay` connector. */
export const LAST_TAVORA_WITHOUT_GAME_OVERLAYS = "0.20.50";
/** The last Tavora that refuses a panel type's `inGame`; a manifest with it needs a newer `minTavora`. */
export const LAST_TAVORA_WITHOUT_IN_GAME_PANELS = "0.21.2";
/** The last Tavora that refuses `translations`; a manifest with them needs a newer `minTavora`. */
export const LAST_TAVORA_WITHOUT_TRANSLATIONS = "0.20.12";
/** The last Tavora that refuses `overlaySize`; a manifest with it needs a newer `minTavora`. */
export const LAST_TAVORA_WITHOUT_OVERLAY_SIZE = "0.21.27";
const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

/** Whether a manifest may key a translation by this: a lowercase language code such as `de` or `pt-br`. */
export function isLanguageCode(value: unknown): value is string {
  return typeof value === "string" && LANGUAGE_CODE.test(value);
}
const TRANSLATION_FIELDS = ["name", "description", "panels", "actions"];
// Tavora's own modules ship with the app, so no older Tavora ever loads them.
const OFFICIAL_ID_PREFIX = "tavora.";

/**
 * The translations that apply to `language` (Tavora's language, such as `de` or `pt-br`), the first one first:
 * the one for exactly that code, then the one for its base language (`pt` for `pt-br`).
 */
export function translationsFor<T>(translations: Record<string, T> | undefined, language: string): T[] {
  const code = language.toLowerCase();
  const base = code.split("-")[0]!;
  return [translations?.[code], base === code ? undefined : translations?.[base]].filter((translation): translation is T => translation !== undefined);
}

/**
 * The manifest with its texts in `language`. For each text Tavora takes the first translation that has it
 * (translationsFor), else the plain field.
 */
export function translateManifest(manifest: ModuleManifest, language: string): ModuleManifest {
  const found = translationsFor(manifest.translations, language);
  if (found.length === 0) return manifest;
  const pick = <T>(text: (translation: ModuleTranslation) => T | undefined, plain: T): T => {
    for (const translation of found) {
      const value = text(translation);
      if (value !== undefined) return value;
    }
    return plain;
  };
  const translated: ModuleManifest = { ...manifest, name: pick((t) => t.name, manifest.name) };
  const description = pick((t) => t.description, manifest.description);
  if (description !== undefined) translated.description = description;
  if (manifest.panels) translated.panels = manifest.panels.map((type) => ({ ...type, name: pick((t) => t.panels?.[type.id], type.name) }));
  if (manifest.actions) translated.actions = manifest.actions.map((action) => ({ ...action, name: pick((t) => t.actions?.[action.id], action.name) }));
  return translated;
}

/** A Tavora release version: major.minor.patch, numbers only. */
const TAVORA_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/**
 * Whether this Tavora is older than the module's `minTavora`. Compares major, minor and patch as
 * numbers; anything after the patch number of Tavora's own version (a pre-release) is ignored.
 */
export function needsNewerTavora(manifest: Pick<ModuleManifest, "minTavora">, tavoraVersion: string): boolean {
  if (!manifest.minTavora) return false;
  const parts = (version: string) => version.split(/[-+]/)[0]!.split(".").map((part) => Number(part) || 0);
  const need = parts(manifest.minTavora);
  const have = parts(tavoraVersion);
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) !== (need[i] ?? 0)) return (have[i] ?? 0) < (need[i] ?? 0);
  }
  return false;
}

function officialId(input: Record<string, unknown>): boolean {
  return typeof input.id === "string" && input.id.startsWith(OFFICIAL_ID_PREFIX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= maxLength;
}

function isDimension(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= MAX_VIEWPORT;
}

// Paths must be plain and relative inside the package: no "..", no
// absolute paths, no backslashes, no URL schemes.
function isPackagePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes(":") || value.includes("\0")) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function checkViewport(viewport: unknown, at: string, errors: string[]): void {
  if (!isRecord(viewport)) {
    errors.push(`${at} must be an object`);
    return;
  }
  if (!isDimension(viewport.minWidth) || !isDimension(viewport.minHeight)) {
    errors.push(`${at}.minWidth and ${at}.minHeight must be positive integers`);
  }
  for (const key of ["preferredWidth", "preferredHeight"] as const) {
    if (viewport[key] !== undefined && !isDimension(viewport[key])) errors.push(`${at}.${key} must be a positive integer`);
  }
  const unknown = Object.keys(viewport).filter((key) => !VIEWPORT_FIELDS.includes(key));
  if (unknown.length > 0) errors.push(`unknown ${at} fields: ${unknown.join(", ")}`);
}

function checkPanels(panels: unknown, errors: string[], inGameAllowed = true): void {
  if (!Array.isArray(panels) || panels.length === 0 || panels.length > MAX_PANEL_TYPES) {
    errors.push(`panels must be an array of 1 to ${MAX_PANEL_TYPES} panel types`);
    return;
  }
  const ids = new Set<string>();
  let continuing = 0;
  panels.forEach((type: unknown, index) => {
    const at = `panels[${index}]`;
    if (!isRecord(type)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (!isPanelTypeId(type.id)) errors.push(`${at}.id must be lowercase letters, digits and -, starting with a letter, at most 32 characters`);
    else if (ids.has(type.id)) errors.push(`panels lists the id ${type.id} twice`);
    else ids.add(type.id);
    if (!isText(type.name, MAX_PANEL_NAME)) errors.push(`${at}.name must be a non-empty string of at most ${MAX_PANEL_NAME} characters`);
    if (type.entry !== undefined) {
      if (!isPackagePath(type.entry)) errors.push(`${at}.entry must be a relative path inside the package`);
      else if (!type.entry.endsWith(".html")) errors.push(`${at}.entry must be an .html file`);
    }
    if (type.icon !== undefined) {
      if (!isPackagePath(type.icon)) errors.push(`${at}.icon must be a relative path inside the package`);
      else if (!/\.(png|webp)$/.test(type.icon)) errors.push(`${at}.icon must be a .png or .webp file`);
    }
    if (type.viewport !== undefined) checkViewport(type.viewport, `${at}.viewport`, errors);
    if (type.continues !== undefined && typeof type.continues !== "boolean") errors.push(`${at}.continues must be true or false`);
    if (type.continues === true) continuing++;
    if (type.inGame !== undefined && typeof type.inGame !== "boolean") errors.push(`${at}.inGame must be true or false`);
    else if (type.inGame === true && !inGameAllowed) errors.push(`${at}.inGame needs a minTavora newer than ${LAST_TAVORA_WITHOUT_IN_GAME_PANELS}, because older Tavoras refuse it`);
    const unknown = Object.keys(type).filter((key) => !PANEL_FIELDS.includes(key));
    if (unknown.length > 0) errors.push(`unknown ${at} fields: ${unknown.join(", ")}`);
  });
  if (continuing > 1) errors.push("only one panel type may set continues");
}

function checkActions(actions: unknown, errors: string[]): void {
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > MAX_ACTIONS) {
    errors.push(`actions must be an array of 1 to ${MAX_ACTIONS} actions`);
    return;
  }
  const ids = new Set<string>();
  actions.forEach((action: unknown, index) => {
    const at = `actions[${index}]`;
    if (!isRecord(action)) return void errors.push(`${at} must be an object`);
    if (!isActionId(action.id)) errors.push(`${at}.id must be lowercase letters, digits and -, starting with a letter, at most 32 characters`);
    else if (ids.has(action.id)) errors.push(`actions lists the id ${action.id} twice`);
    else ids.add(action.id);
    if (!isText(action.name, MAX_ACTION_NAME) || /[\u0000-\u001f]/.test(action.name)) errors.push(`${at}.name must be a non-empty string of at most ${MAX_ACTION_NAME} characters on one line`);
    const unknown = Object.keys(action).filter((key) => key !== "id" && key !== "name");
    if (unknown.length > 0) errors.push(`unknown ${at} fields: ${unknown.join(", ")}`);
  });
}

function checkTranslations(input: Record<string, unknown>, errors: string[]): void {
  const translations = input.translations;
  if (!isRecord(translations) || Object.keys(translations).length === 0 || Object.keys(translations).length > MAX_TRANSLATIONS) {
    errors.push(`translations must be an object of 1 to ${MAX_TRANSLATIONS} languages`);
    return;
  }
  const idsOf = (list: unknown) => new Set(Array.isArray(list) ? list.filter(isRecord).map((item) => item.id) : []);
  const panelIds = idsOf(input.panels);
  const actionIds = idsOf(input.actions);
  for (const [code, translation] of Object.entries(translations)) {
    const at = `translations.${code}`;
    if (!isLanguageCode(code)) errors.push(`translations must be keyed by lowercase language codes such as de or pt-br, not ${code}`);
    if (!isRecord(translation)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (translation.name !== undefined && !isText(translation.name, 80)) errors.push(`${at}.name must be a non-empty string of at most 80 characters`);
    if (translation.description !== undefined && !isText(translation.description, 300)) errors.push(`${at}.description must be a non-empty string of at most 300 characters`);
    const names = (field: "panels" | "actions", ids: Set<unknown>, max: number) => {
      const map = translation[field];
      if (map === undefined) return;
      if (!isRecord(map)) return void errors.push(`${at}.${field} must be an object of ${field === "panels" ? "panel type" : "action"} ids to names`);
      for (const [id, name] of Object.entries(map)) {
        if (!ids.has(id)) errors.push(`${at}.${field} names ${id}, which ${field} does not list`);
        if (!isText(name, max) || /[\u0000-\u001f]/.test(name)) errors.push(`${at}.${field}.${id} must be a non-empty string of at most ${max} characters on one line`);
      }
    };
    names("panels", panelIds, MAX_PANEL_NAME);
    names("actions", actionIds, MAX_ACTION_NAME);
    const unknown = Object.keys(translation).filter((key) => !TRANSLATION_FIELDS.includes(key));
    if (unknown.length > 0) errors.push(`unknown ${at} fields: ${unknown.join(", ")}`);
  }
  const official = typeof input.id === "string" && input.id.startsWith(OFFICIAL_ID_PREFIX);
  const minTavora = typeof input.minTavora === "string" ? { minTavora: input.minTavora } : {};
  if (!official && !needsNewerTavora(minTavora, LAST_TAVORA_WITHOUT_TRANSLATIONS)) {
    errors.push(`translations need a minTavora newer than ${LAST_TAVORA_WITHOUT_TRANSLATIONS}, because older Tavoras refuse them`);
  }
}

export function validateManifest(input: unknown): ManifestResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["manifest must be a JSON object"] };

  if (!isModuleId(input.id)) errors.push("id must look like publisher.module-name (lowercase, dot-separated)");
  if (input.$schema !== undefined && typeof input.$schema !== "string") errors.push("$schema must be a string");
  if (!isText(input.name, 80)) errors.push("name must be a non-empty string of at most 80 characters");
  if (input.description !== undefined && !isText(input.description, 300)) {
    errors.push("description must be a non-empty string of at most 300 characters");
  }
  if (typeof input.version !== "string" || !SEMVER.test(input.version)) errors.push("version must be semver, e.g. 1.0.0");
  if (input.apiVersion !== "1") errors.push('apiVersion must be "1"');
  if (input.minTavora !== undefined && (typeof input.minTavora !== "string" || !TAVORA_VERSION.test(input.minTavora))) errors.push("minTavora must be a Tavora version such as 0.18.0");
  if (!isPackagePath(input.entry)) errors.push("entry must be a relative path inside the package");
  else if (!input.entry.endsWith(".html")) errors.push("entry must be an .html file");
  if (input.icon !== undefined) {
    if (!isPackagePath(input.icon)) errors.push("icon must be a relative path inside the package");
    else if (!/\.(png|webp)$/.test(input.icon)) errors.push("icon must be a .png or .webp file");
  }

  if (input.changelog !== undefined) {
    if (!isPackagePath(input.changelog)) errors.push("changelog must be a relative path inside the package");
    else if (!input.changelog.endsWith(".json")) errors.push("changelog must be a .json file");
  }

  if (input.homepage !== undefined && !isHomepage(input.homepage)) {
    errors.push(`homepage must be an http or https address of at most ${MAX_HOMEPAGE_LENGTH} characters`);
  }
  if (input.support !== undefined && !isSupportLink(input.support)) {
    errors.push(`support must be an https address or an email address of at most ${MAX_SUPPORT_LENGTH} characters`);
  }
  if (input.readme !== undefined) {
    if (!isPackagePath(input.readme)) errors.push("readme must be a relative path inside the package");
    else if (!/\.(md|txt)$/.test(input.readme)) errors.push("readme must be a .md or .txt file");
  }
  if (input.screenshots !== undefined) {
    const shots = input.screenshots;
    if (!Array.isArray(shots) || shots.length === 0 || shots.length > MAX_SCREENSHOTS) errors.push(`screenshots must be an array of 1 to ${MAX_SCREENSHOTS} files`);
    else if (!shots.every((shot) => isPackagePath(shot) && /\.(png|webp)$/.test(shot))) errors.push("screenshots must be .png or .webp files inside the package");
    else if (new Set(shots).size !== shots.length) errors.push("screenshots lists a file twice");
  }

  if (!Array.isArray(input.games) || !input.games.every(isGameId)) {
    errors.push("games must be an array of game ids (empty means any game)");
  }
  if (input.workspaces !== undefined && typeof input.workspaces !== "boolean") errors.push("workspaces must be true or false");
  else if (input.workspaces === true && Array.isArray(input.games) && input.games.length > 0) {
    errors.push("workspaces can only be true for a module made for any game (games is empty)");
  }

  checkViewport(input.viewport, "viewport", errors);
  if (input.panels !== undefined) {
    const minTavora = { minTavora: typeof input.minTavora === "string" ? input.minTavora : "" };
    checkPanels(input.panels, errors, officialId(input) || needsNewerTavora(minTavora, LAST_TAVORA_WITHOUT_IN_GAME_PANELS));
  }
  if (input.inGame !== undefined) {
    if (typeof input.inGame !== "boolean") errors.push("inGame must be true or false");
    else if (input.inGame && input.panels !== undefined) errors.push("inGame is for a module without panel types; set it on the panel types instead");
    else if (input.inGame && !officialId(input) && !needsNewerTavora({ minTavora: typeof input.minTavora === "string" ? input.minTavora : "" }, LAST_TAVORA_WITHOUT_IN_GAME_PANELS)) errors.push(`inGame needs a minTavora newer than ${LAST_TAVORA_WITHOUT_IN_GAME_PANELS}, because older Tavoras refuse it`);
  }
  if (input.actions !== undefined) checkActions(input.actions, errors);
  if (input.translations !== undefined) checkTranslations(input, errors);
  if (input.overlay !== undefined) {
    if (!isPackagePath(input.overlay)) errors.push("overlay must be a relative path inside the package");
    else if (!input.overlay.endsWith(".html")) errors.push("overlay must be an .html file");
  }
  if (input.overlaySize !== undefined) {
    const size = input.overlaySize;
    if (!isRecord(size) || !isDimension(size.width) || !isDimension(size.height) || Object.keys(size).some((key) => key !== "width" && key !== "height")) {
      errors.push("overlaySize must be { width, height } in pixels");
    } else if (input.overlay === undefined) errors.push("overlaySize needs an overlay page");
    else if (!officialId(input) && !needsNewerTavora({ minTavora: typeof input.minTavora === "string" ? input.minTavora : "" }, LAST_TAVORA_WITHOUT_OVERLAY_SIZE)) {
      errors.push(`overlaySize needs a minTavora newer than ${LAST_TAVORA_WITHOUT_OVERLAY_SIZE}, because older Tavoras refuse it`);
    }
  }

  const permissions = input.permissions;
  if (!isRecord(permissions) || !Array.isArray(permissions.network)) {
    errors.push("permissions.network must be an array");
  } else {
    const hosts = permissions.network as unknown[];
    if (hosts.length > MAX_NETWORK_HOSTS) errors.push(`permissions.network may name at most ${MAX_NETWORK_HOSTS} hosts`);
    const bad = hosts.filter((host) => !isNetworkHost(host));
    if (bad.length > 0) {
      errors.push(`permissions.network must list exact public host names such as api.example.com (lowercase, no scheme, port or wildcard): ${bad.slice(0, 3).map(String).join(", ")}`);
    } else if (new Set(hosts).size !== hosts.length) {
      errors.push("permissions.network lists a host twice");
    }
  }
  if (isRecord(permissions)) {
    const unsupported = Object.keys(permissions).filter((key) => key !== "network" && key !== "connectors" && key !== "onRequest" && key !== "webAssembly");
    if (unsupported.length > 0) errors.push(`unsupported permissions: ${unsupported.join(", ")}`);
    if ("connectors" in permissions) {
      const connectors = permissions.connectors;
      if (!Array.isArray(connectors) || !connectors.every(isConnector)) errors.push(`permissions.connectors must list connectors Tavora has: ${CONNECTORS.join(", ")}`);
      else if (new Set(connectors).size !== connectors.length) errors.push("permissions.connectors lists a connector twice");
    }
    if ("webAssembly" in permissions && typeof permissions.webAssembly !== "boolean") errors.push("permissions.webAssembly must be true or false");
    if ("onRequest" in permissions) {
      const later = permissions.onRequest;
      const listed: unknown[] = Array.isArray(permissions.connectors) ? permissions.connectors : [];
      if (!Array.isArray(later) || !later.every((name) => ON_REQUEST_CONNECTORS.includes(name as Connector))) {
        errors.push(`permissions.onRequest may only list ${ON_REQUEST_CONNECTORS.join(", ")}`);
      } else if (new Set(later).size !== later.length) errors.push("permissions.onRequest lists a connector twice");
      else if (!later.every((name) => listed.includes(name))) errors.push("permissions.onRequest may only list connectors that permissions.connectors lists");
    }
    const overlayConnector = Array.isArray(permissions.connectors) && permissions.connectors.includes("stream-overlay");
    // Without the connector the page serves game overlays only, which older Tavoras refuse: the manifest says so by minTavora.
    if (input.overlay !== undefined && !overlayConnector && !officialId(input) && !needsNewerTavora({ minTavora: typeof input.minTavora === "string" ? input.minTavora : "" }, LAST_TAVORA_WITHOUT_GAME_OVERLAYS)) {
      errors.push(`overlay without the "stream-overlay" connector needs a minTavora newer than ${LAST_TAVORA_WITHOUT_GAME_OVERLAYS}, because older Tavoras refuse it`);
    }
    if (overlayConnector && input.overlay === undefined) errors.push('the "stream-overlay" connector needs an overlay page');
  }

  const extra = Object.keys(input).filter((key) => !FIELDS.includes(key));
  if (extra.length > 0) errors.push(`unknown fields: ${extra.join(", ")}`);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: input as unknown as ModuleManifest };
}
