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
 * such as Inventory or Build planner. Players add each type on its own and may open several copies;
 * every type shares the module's saved content and permissions.
 */
export interface ModulePanelType {
  /** Stable identity, never shown. Saved layouts keep it, so renaming `name` changes nothing for players. */
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
  /** A JSON file inside the package with the module's patch notes (see validateChangelog), shown to players in Settings > Modules. */
  changelog?: string;
  games: string[];
  /**
   * Whether the module may be added to a personal workspace, which belongs to no game. Only modules for any game
   * (an empty `games`) can be; leave it out for true, and set false for one that only makes sense in a game.
   */
  workspaces?: boolean;
  viewport: ModuleViewport;
  /** Named panel types. Without them the module has one panel, made from `entry`, `icon` and `viewport`. */
  panels?: ModulePanelType[];
  permissions: {
    /** Hosts the module asks to reach through network.fetch, such as `api.example.com`. Each needs the player's grant. */
    network: string[];
    /** Parts of Tavora that hold a sign-in, which the module asks to use (see CONNECTORS). Each needs the player's grant. */
    connectors?: Connector[];
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
const FIELDS = ["$schema", "id", "name", "description", "version", "apiVersion", "minTavora", "entry", "icon", "changelog", "games", "workspaces", "viewport", "panels", "permissions"];
const VIEWPORT_FIELDS = ["minWidth", "minHeight", "preferredWidth", "preferredHeight"];

/** Most panel types one module may offer, and the longest short name a tab shows. */
export const MAX_PANEL_TYPES = 16;
export const MAX_PANEL_NAME = 24;
const PANEL_TYPE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const PANEL_FIELDS = ["id", "name", "entry", "icon", "viewport", "continues"];

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
}

/** The module's panel types, resolved; empty for a module with one panel and no types. */
export function panelTypes(manifest: ModuleManifest): ResolvedPanelType[] {
  return (manifest.panels ?? []).map((type) => ({
    id: type.id,
    name: type.name,
    entry: type.entry ?? manifest.entry,
    icon: type.icon ?? manifest.icon,
    viewport: type.viewport ?? manifest.viewport,
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
  /** What players notice, one line each, as plain text. */
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

/** Every page and icon the manifest names, its panel types' included, each once: the files a package must hold. */
export function manifestFiles(manifest: ModuleManifest): { entries: string[]; icons: string[] } {
  const entries = new Set([manifest.entry]);
  const icons = new Set(manifest.icon === undefined ? [] : [manifest.icon]);
  for (const type of manifest.panels ?? []) {
    if (type.entry !== undefined) entries.add(type.entry);
    if (type.icon !== undefined) icons.add(type.icon);
  }
  return { entries: [...entries], icons: [...icons] };
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
 * Connectors (glossary): parts of Tavora that hold a sign-in and let a granted module use it without
 * seeing the token. `ai-usage` reads the usage of the player's Claude and Codex accounts; `discord` talks to the
 * Discord app on this PC with Tavora's Discord sign-in (voice channels, who is talking, joining and muting).
 */
export const CONNECTORS = ["ai-usage", "discord"] as const;
export type Connector = (typeof CONNECTORS)[number];

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

function checkPanels(panels: unknown, errors: string[]): void {
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
    const unknown = Object.keys(type).filter((key) => !PANEL_FIELDS.includes(key));
    if (unknown.length > 0) errors.push(`unknown ${at} fields: ${unknown.join(", ")}`);
  });
  if (continuing > 1) errors.push("only one panel type may set continues");
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

  if (!Array.isArray(input.games) || !input.games.every(isGameId)) {
    errors.push("games must be an array of game ids (empty means any game)");
  }
  if (input.workspaces !== undefined && typeof input.workspaces !== "boolean") errors.push("workspaces must be true or false");
  else if (input.workspaces === true && Array.isArray(input.games) && input.games.length > 0) {
    errors.push("workspaces can only be true for a module made for any game (games is empty)");
  }

  checkViewport(input.viewport, "viewport", errors);
  if (input.panels !== undefined) checkPanels(input.panels, errors);

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
    const unsupported = Object.keys(permissions).filter((key) => key !== "network" && key !== "connectors" && key !== "webAssembly");
    if (unsupported.length > 0) errors.push(`unsupported permissions: ${unsupported.join(", ")}`);
    if ("connectors" in permissions) {
      const connectors = permissions.connectors;
      if (!Array.isArray(connectors) || !connectors.every(isConnector)) errors.push(`permissions.connectors must list connectors Tavora has: ${CONNECTORS.join(", ")}`);
      else if (new Set(connectors).size !== connectors.length) errors.push("permissions.connectors lists a connector twice");
    }
    if ("webAssembly" in permissions && typeof permissions.webAssembly !== "boolean") errors.push("permissions.webAssembly must be true or false");
  }

  const extra = Object.keys(input).filter((key) => !FIELDS.includes(key));
  if (extra.length > 0) errors.push(`unknown fields: ${extra.join(", ")}`);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: input as unknown as ModuleManifest };
}
