// Reads Tavora's module catalog (api.mytavora.app/v1/catalog) from the main process, so the host UI
// needs no network permission. Nothing the service says is trusted (catalog threat model, C1): every
// listing is checked field by field and shown as plain text (C10), the developer name is only ever
// the `publisher` field in the service's name form (C13), and a zip counts only once its SHA-256
// matches the listing. After that the zip goes through the same installer as Install from zip, which
// checks the publisher signature itself.
import { createHash } from "node:crypto";
import { isConnector, isGameId, isHomepage, isModuleId, isNetworkHost, MAX_NETWORK_HOSTS, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS, type Connector } from "@tavora/module-schema";
import { ZIP_LIMITS } from "@tavora/pack";
import type { CatalogListResult, CatalogModuleView } from "../shared/host-api";
import { isWebUrl } from "./browser-url";
import { PlayerError } from "./messages";
import { pictureDataUrl } from "./module-icon";
import { DEFAULT_API_URL } from "./online";
import { isPublisherName } from "./publisher-names";

export const LIST_TIMEOUT_MS = 8000;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
/** Most modules one listing is read for. */
const MAX_MODULES = 500;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const TAVORA_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const FINGERPRINT = /^[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** Text that could change how the text around it reads: controls and direction marks. */
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** A listing's screenshot, fetched by its hash only when the player opens the module's info. */
export interface CatalogScreenshot {
  sha256: string;
  type: "png" | "webp";
  size: number;
}

/** A listed module with the zip it comes as; only the main process sees the hash. */
export interface CatalogEntry extends Omit<CatalogModuleView, "screenshots"> {
  games: string[];
  workspaces: boolean;
  zip: { sha256: string; size: number };
  /** This version's patch notes, plain text. */
  notes: string[];
  shots: CatalogScreenshot[];
}

/** One published version of a module, as GET /v1/catalog/modules/<id> lists them. */
export interface CatalogVersion {
  version: string;
  publishedAt: string;
  notes: string[];
}

/** Most lines of patch notes kept for one version, and most versions read for one module. */
const MAX_NOTES = 50;
const MAX_VERSIONS = 200;

/** Where the player is: a game (its catalog id) or a personal workspace. */
export type CatalogScope = { game: string } | { workspace: true };

export class CatalogError extends PlayerError {}

function plain(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(HIDDEN, " ").replace(/\s+/g, " ").trim();
  return text && text.length <= max ? text : null;
}

/** Patch note lines as plain text; a line that is not text, or too long, is left out. */
function plainNotes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_NOTES)
    .map((line) => plain(line, 500))
    .filter((line): line is string => line !== null);
}

/** The listed screenshots that have the shape the app relies on, at most MAX_SCREENSHOTS, each once. */
function parseScreenshots(value: unknown): CatalogScreenshot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const shots: CatalogScreenshot[] = [];
  for (const raw of value.slice(0, MAX_SCREENSHOTS)) {
    const { sha256, type, size } = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    if (typeof sha256 !== "string" || !SHA256.test(sha256) || seen.has(sha256)) continue;
    if (type !== "png" && type !== "webp") continue;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > MAX_SCREENSHOT_BYTES) continue;
    seen.add(sha256);
    shots.push({ sha256, type, size });
  }
  return shots;
}

/** Keeps a version only if it has the shape the app relies on. */
export function parseCatalogVersion(raw: unknown): CatalogVersion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { version, publishedAt, notes } = raw as Record<string, unknown>;
  if (typeof version !== "string" || !SEMVER.test(version) || version.length > 64) return null;
  return { version, publishedAt: typeof publishedAt === "string" && publishedAt.length <= 40 ? publishedAt : "", notes: plainNotes(notes) };
}

/** Keeps a listing only if every field has the shape the app relies on. */
export function parseCatalogEntry(raw: unknown): CatalogEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const { id, version, minTavora, games, workspaces, permissions, owner, publisher, zip, publishedAt } = entry;
  if (!isModuleId(id) || typeof version !== "string" || !SEMVER.test(version) || version.length > 64) return null;
  const name = plain(entry.name, 100);
  if (!name) return null;
  if (minTavora !== null && minTavora !== undefined && (typeof minTavora !== "string" || !TAVORA_VERSION.test(minTavora))) return null;
  if (!Array.isArray(games) || games.length > 100 || !games.every(isGameId)) return null;
  if (typeof owner !== "string" || !FINGERPRINT.test(owner)) return null;
  const asks = (typeof permissions === "object" && permissions !== null ? permissions : {}) as Record<string, unknown>;
  const network = asks.network ?? [];
  const connectors = asks.connectors ?? [];
  if (!Array.isArray(network) || network.length > MAX_NETWORK_HOSTS || !network.every(isNetworkHost)) return null;
  if (!Array.isArray(connectors) || !connectors.every(isConnector)) return null;
  const file = (typeof zip === "object" && zip !== null ? zip : {}) as Record<string, unknown>;
  if (typeof file.sha256 !== "string" || !SHA256.test(file.sha256)) return null;
  if (typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > ZIP_LIMITS.maxArchiveBytes) return null;
  return {
    id,
    name,
    description: plain(entry.description, 500),
    version,
    minTavora: typeof minTavora === "string" ? minTavora : null,
    games: [...games],
    workspaces: workspaces !== false,
    permissions: { network: [...new Set(network as string[])], connectors: [...new Set(connectors as Connector[])] },
    owner,
    // Only the name the service gives for the key's account, never a name the listing claims elsewhere.
    publisher: isPublisherName(publisher) ? publisher : null,
    size: file.size,
    publishedAt: typeof publishedAt === "string" && publishedAt.length <= 40 ? publishedAt : "",
    zip: { sha256: file.sha256, size: file.size },
    notes: plainNotes(entry.notes),
    // Opened only like a module link (http or https), and shown as plain text.
    homepage: isHomepage(entry.homepage) && isWebUrl(entry.homepage) ? entry.homepage : null,
    shots: parseScreenshots(entry.screenshots),
  };
}

/** Whether a module may go where the player is; the service filters too, but it is not trusted to. */
export function fitsScope(entry: Pick<CatalogEntry, "games" | "workspaces">, scope: CatalogScope): boolean {
  if ("workspace" in scope) return entry.games.length === 0 && entry.workspaces;
  return entry.games.length === 0 || entry.games.includes(scope.game);
}

/** The view the host UI gets: no hash, no games list, and only how many screenshots there are. */
export function catalogView({ games: _games, workspaces: _workspaces, zip: _zip, notes: _notes, shots, ...view }: CatalogEntry): CatalogModuleView {
  return { ...view, screenshots: shots.length };
}

export interface CatalogClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  listTimeoutMs?: number;
  downloadTimeoutMs?: number;
}

const REQUEST = { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" } as const;

export class CatalogClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly listTimeoutMs: number;
  private readonly downloadTimeoutMs: number;

  constructor(options: CatalogClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.listTimeoutMs = options.listTimeoutMs ?? LIST_TIMEOUT_MS;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  }

  /** The modules for a game or a personal workspace, by name. Never throws. */
  async list(scope: CatalogScope): Promise<CatalogListResult> {
    const query = "workspace" in scope ? "workspace=1" : `game=${encodeURIComponent(scope.game)}`;
    try {
      const response = await this.get(`/v1/catalog?${query}`, this.listTimeoutMs, "application/json");
      const failed = failure(response.status);
      if (failed) return { status: failed };
      const body = (await response.json()) as { modules?: unknown } | null;
      const raw = Array.isArray(body?.modules) ? body.modules.slice(0, MAX_MODULES) : [];
      const seen = new Set<string>();
      const entries = raw
        .map(parseCatalogEntry)
        .filter((entry): entry is CatalogEntry => entry !== null && fitsScope(entry, scope) && !seen.has(entry.id) && Boolean(seen.add(entry.id)))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { status: "ok", modules: entries.map(catalogView) };
    } catch {
      return { status: "unreachable" };
    }
  }

  /**
   * Every listed module, for the update check (catalog-updates.ts). It asks for the whole index with
   * no filter, so the service never learns which modules this player has (C11). Null when there is
   * no usable answer.
   */
  async index(): Promise<CatalogEntry[] | null> {
    try {
      const response = await this.get("/v1/catalog", this.listTimeoutMs, "application/json");
      if (failure(response.status)) return null;
      const body = (await response.json()) as { modules?: unknown } | null;
      const raw = Array.isArray(body?.modules) ? body.modules.slice(0, MAX_MODULES) : [];
      const seen = new Set<string>();
      return raw.map(parseCatalogEntry).filter((entry): entry is CatalogEntry => entry !== null && !seen.has(entry.id) && Boolean(seen.add(entry.id)));
    } catch {
      return null;
    }
  }

  /** The newest listing of one module. Throws a CatalogError the player can read. */
  async module(id: string): Promise<CatalogEntry> {
    return (await this.details(id)).entry;
  }

  /** The newest listing of one module and every version it was published at, newest first. Throws a CatalogError the player can read. */
  async details(id: string): Promise<{ entry: CatalogEntry; versions: CatalogVersion[] }> {
    if (!isModuleId(id)) throw new CatalogError("error.catalogNotListed");
    let response: Response;
    try {
      response = await this.get(`/v1/catalog/modules/${encodeURIComponent(id)}`, this.listTimeoutMs, "application/json");
    } catch {
      throw new CatalogError("error.catalogUnreachable");
    }
    if (response.status === 404) throw new CatalogError("error.catalogNotListed");
    throwFailure(response.status);
    const body = (await response.json().catch(() => null)) as { module?: unknown; versions?: unknown } | null;
    const entry = parseCatalogEntry(body?.module);
    if (!entry || entry.id !== id) throw new CatalogError("error.catalogNotListed");
    const versions = (Array.isArray(body?.versions) ? body.versions.slice(0, MAX_VERSIONS) : []).map(parseCatalogVersion).filter((version): version is CatalogVersion => version !== null);
    return { entry, versions };
  }

  /**
   * Downloads a listed zip and gives it back only when it is exactly the listed size and SHA-256.
   * It is read into memory with the size as a cap, so a wrong or endless answer writes nothing.
   */
  async download(zip: CatalogEntry["zip"]): Promise<Buffer> {
    const data = await this.read(`/v1/catalog/zips/${zip.sha256}.zip`, zip.size, this.downloadTimeoutMs, "application/zip");
    if (createHash("sha256").update(data).digest("hex") !== zip.sha256) throw new CatalogError("error.catalogBadZip");
    return data;
  }

  /** Reads an answer of exactly `expected` bytes into memory, with that as a cap. Throws a CatalogError. */
  private async read(pathname: string, expected: number, timeoutMs: number, accept: string): Promise<Buffer> {
    let response: Response;
    try {
      response = await this.get(pathname, timeoutMs, accept);
    } catch {
      throw new CatalogError("error.catalogUnreachable");
    }
    throwFailure(response.status);
    // A compressed answer gives the compressed length, so only a plain one is compared up front.
    const declared = response.headers.has("content-encoding") ? NaN : Number(response.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared !== expected) throw new CatalogError("error.catalogBadZip");
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new CatalogError("error.catalogBadZip");
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > expected) {
          await reader.cancel().catch(() => undefined);
          throw new CatalogError("error.catalogBadZip");
        }
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError("error.catalogUnreachable");
    }
    const data = Buffer.concat(chunks);
    if (data.length !== expected) throw new CatalogError("error.catalogBadZip");
    return data;
  }

  /**
   * A listed screenshot as a data address for the host UI, or null when it cannot be had or is not
   * what the listing says (C10): read into memory with its listed size as a cap, then its SHA-256 and
   * its own first bytes (a PNG or WebP of that type) are checked, like a module icon (G10).
   */
  async screenshot(shot: CatalogScreenshot): Promise<string | null> {
    try {
      const data = await this.read(`/v1/catalog/screenshots/${shot.sha256}.${shot.type}`, shot.size, this.listTimeoutMs, `image/${shot.type}`);
      if (createHash("sha256").update(data).digest("hex") !== shot.sha256) return null;
      const url = pictureDataUrl(data, MAX_SCREENSHOT_BYTES);
      return url?.startsWith(`data:image/${shot.type};`) ? url : null;
    } catch {
      return null;
    }
  }

  /**
   * Reports a zip to Tavora, only after the player pressed Report: the module id, its key's
   * fingerprint and the zip's hash, and nothing else (C12). Throws a CatalogError the player can read.
   */
  async report(report: { id: string; owner: string; sha256: string }): Promise<void> {
    if (!isModuleId(report.id) || !FINGERPRINT.test(report.owner) || !SHA256.test(report.sha256)) throw new CatalogError("error.catalogNotListed");
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/catalog/report`, {
        ...REQUEST,
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, owner: report.owner, sha256: report.sha256 }),
        signal: AbortSignal.timeout(this.listTimeoutMs),
      });
    } catch {
      throw new CatalogError("error.catalogUnreachable");
    }
    if (response.status === 404) throw new CatalogError("error.catalogNotListed");
    throwFailure(response.status);
  }

  private get(pathname: string, timeoutMs: number, accept: string): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${pathname}`, { ...REQUEST, headers: { Accept: accept }, signal: AbortSignal.timeout(timeoutMs) });
  }
}

function failure(status: number): "unavailable" | "busy" | "unreachable" | null {
  if (status === 503) return "unavailable";
  if (status === 429) return "busy";
  return status >= 200 && status < 300 ? null : "unreachable";
}

function throwFailure(status: number): void {
  const failed = failure(status);
  if (failed === "unavailable") throw new CatalogError("error.catalogUnavailable");
  if (failed === "busy") throw new CatalogError("error.catalogBusy");
  if (failed) throw new CatalogError("error.catalogUnreachable");
}
