// Manifest v1 for tavora.module.json (docs/sdk/manifest.md). The JSON Schema
// in schema/ describes the same rules for editors; tests keep the two in step.

export interface ModuleViewport {
  minWidth: number;
  minHeight: number;
  preferredWidth?: number;
  preferredHeight?: number;
}

export interface ModuleManifest {
  $schema?: string;
  id: string;
  name: string;
  description?: string;
  version: string;
  apiVersion: "1";
  entry: string;
  icon?: string;
  games: string[];
  viewport: ModuleViewport;
  permissions: {
    network: string[];
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
const FIELDS = ["$schema", "id", "name", "description", "version", "apiVersion", "entry", "icon", "games", "viewport", "permissions"];
const VIEWPORT_FIELDS = ["minWidth", "minHeight", "preferredWidth", "preferredHeight"];

export function isModuleId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && MODULE_ID.test(value);
}

export function isGameId(value: unknown): value is string {
  return typeof value === "string" && GAME_ID.test(value);
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
  if (!isPackagePath(input.entry)) errors.push("entry must be a relative path inside the package");
  else if (!input.entry.endsWith(".html")) errors.push("entry must be an .html file");
  if (input.icon !== undefined) {
    if (!isPackagePath(input.icon)) errors.push("icon must be a relative path inside the package");
    else if (!/\.(png|webp)$/.test(input.icon)) errors.push("icon must be a .png or .webp file");
  }

  if (!Array.isArray(input.games) || !input.games.every(isGameId)) {
    errors.push("games must be an array of game ids (empty means any game)");
  }

  const viewport = input.viewport;
  if (!isRecord(viewport)) {
    errors.push("viewport must be an object");
  } else {
    if (!isDimension(viewport.minWidth) || !isDimension(viewport.minHeight)) {
      errors.push("viewport.minWidth and viewport.minHeight must be positive integers");
    }
    for (const key of ["preferredWidth", "preferredHeight"] as const) {
      if (viewport[key] !== undefined && !isDimension(viewport[key])) errors.push(`viewport.${key} must be a positive integer`);
    }
    const unknown = Object.keys(viewport).filter((key) => !VIEWPORT_FIELDS.includes(key));
    if (unknown.length > 0) errors.push(`unknown viewport fields: ${unknown.join(", ")}`);
  }

  const permissions = input.permissions;
  if (!isRecord(permissions) || !Array.isArray(permissions.network)) {
    errors.push("permissions.network must be an array");
  } else if (permissions.network.length > 0) {
    // Mediated network access arrives after Milestone B; refuse rather than
    // silently ignore a permission the module expects to have.
    errors.push("permissions.network is not supported yet and must be empty");
  }
  if (isRecord(permissions)) {
    const unsupported = Object.keys(permissions).filter((key) => key !== "network");
    if (unsupported.length > 0) errors.push(`unsupported permissions: ${unsupported.join(", ")}`);
  }

  const extra = Object.keys(input).filter((key) => !FIELDS.includes(key));
  if (extra.length > 0) errors.push(`unknown fields: ${extra.join(", ")}`);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: input as unknown as ModuleManifest };
}
