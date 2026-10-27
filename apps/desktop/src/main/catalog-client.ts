// Reads Tavora's module catalog (api.mytavora.app/v1/catalog) from the main process, so the host UI
// needs no network permission. Nothing the service says is trusted (catalog threat model, C1): every
// listing is checked field by field and shown as plain text (C10), the developer name is only ever
// the `publisher` field in the service's name form (C13), and a zip counts only once its SHA-256
// matches the listing. After that the zip goes through the same installer as Install from zip, which
// checks the publisher signature itself.
import { createHash } from "node:crypto";
import { isConnector, isGameId, isHomepage, isLanguageCode, isSupportEmail, isSupportLink, isModuleId, isNetworkHost, MAX_NETWORK_HOSTS, MAX_README_BYTES, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS, MAX_TRANSLATIONS, translationsFor, type Connector } from "@tavora/module-schema";
import { ZIP_LIMITS } from "@tavora/pack";
import type { CatalogListResult, CatalogModuleView, CatalogOwnReview, CatalogRating } from "../shared/host-api";
import { isWebUrl } from "./browser-url";
import { catalogGame } from "./catalog";
import type { MessageKey } from "../shared/i18n";
import { PlayerError } from "./messages";
import { MAX_MODULE_ICON, pictureDataUrl } from "./module-icon";
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

/** A listing's screenshot or icon, fetched by its hash only when the player looks at it. */
export interface CatalogScreenshot {
  sha256: string;
  type: "png" | "webp";
  size: number;
}

/** A listed module with the zip it comes as; only the main process sees the hash. */
export interface CatalogEntry extends Omit<CatalogModuleView, "screenshots" | "icon" | "fits" | "forGames"> {
  games: string[];
  workspaces: boolean;
  zip: { sha256: string; size: number };
  /** This version's patch notes, plain text. */
  notes: string[];
  shots: CatalogScreenshot[];
  /** At most MAX_MODULE_ICON, like an installed module's icon (G10). */
  icon: CatalogScreenshot | null;
  /** The name and description in other languages, by language code (the manifest's `translations`). */
  translations: Record<string, { name?: string; description?: string }>;
}

/** A listing's translated names and descriptions, as plain text; languages with neither are left out. */
function parseTranslations(raw: unknown): CatalogEntry["translations"] {
  const translations: CatalogEntry["translations"] = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return translations;
  for (const [code, value] of Object.entries(raw).slice(0, MAX_TRANSLATIONS)) {
    if (!isLanguageCode(code) || typeof value !== "object" || value === null) continue;
    const name = plain((value as Record<string, unknown>).name, 100);
    const description = plain((value as Record<string, unknown>).description, 500);
    if (name || description) translations[code] = { ...(name ? { name } : {}), ...(description ? { description } : {}) };
  }
  return translations;
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

/** A listed picture with the shape the app relies on, at most `maxBytes`, or null. */
function parsePicture(raw: unknown, maxBytes: number): CatalogScreenshot | null {
  const { sha256, type, size } = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) return null;
  if (type !== "png" && type !== "webp") return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > maxBytes) return null;
  return { sha256, type, size };
}

/** The listed screenshots that have the shape the app relies on, at most MAX_SCREENSHOTS, each once. */
function parseScreenshots(value: unknown): CatalogScreenshot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const shots: CatalogScreenshot[] = [];
  for (const raw of value.slice(0, MAX_SCREENSHOTS)) {
    const shot = parsePicture(raw, MAX_SCREENSHOT_BYTES);
    if (!shot || seen.has(shot.sha256)) continue;
    seen.add(shot.sha256);
    shots.push(shot);
  }
  return shots;
}

/** A listing's ratings, or null unless it has the shape the app relies on: whole counts that add up, an average from 1 to 5. */
export function parseRating(raw: unknown): CatalogRating | null {
  const { average, count, stars } = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(stars) || stars.length !== 5 || !stars.every((n) => Number.isSafeInteger(n) && (n as number) >= 0)) return null;
  const counts = stars as CatalogRating["stars"];
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (!Number.isSafeInteger(count) || count !== total || total === 0) return null;
  if (typeof average !== "number" || !Number.isFinite(average) || average < 1 || average > 5) return null;
  return { average: Math.round(average * 10) / 10, count: total, stars: [...counts] };
}

/** A review as the service lists it, with the author's picture still to fetch. */
export interface CatalogReview {
  id: string;
  stars: number;
  text: string;
  version: string;
  date: string;
  author: { name: string | null; initials: string | null; picture: { sha256: string; size: number } | null };
  reply: { text: string; date: string } | null;
}

/** Most a reviewer's picture may be: the account profile's limit. */
export const MAX_REVIEWER_PICTURE = 512 * 1024;
const REVIEW_ID = /^[A-Za-z0-9_-]{16}$/;

/** A review's text as plain text: line breaks kept (at most one blank line), hidden marks taken out. */
function reviewText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(HIDDEN, (char) => (char === "\n" ? "\n" : "")).replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text && text.length <= 2000 ? text : null;
}

/** Keeps a review only if it has the shape the app relies on. */
export function parseCatalogReview(raw: unknown): CatalogReview | null {
  if (typeof raw !== "object" || raw === null) return null;
  const review = raw as Record<string, unknown>;
  const text = reviewText(review.text);
  if (typeof review.id !== "string" || !REVIEW_ID.test(review.id) || !text) return null;
  if (!Number.isInteger(review.stars) || (review.stars as number) < 1 || (review.stars as number) > 5) return null;
  if (typeof review.version !== "string" || !SEMVER.test(review.version) || review.version.length > 64) return null;
  const author = (typeof review.author === "object" && review.author !== null ? review.author : {}) as Record<string, unknown>;
  const picture = (typeof author.picture === "object" && author.picture !== null ? author.picture : {}) as Record<string, unknown>;
  const reply = (typeof review.reply === "object" && review.reply !== null ? review.reply : null) as Record<string, unknown> | null;
  const replyText = reply ? reviewText(reply.text) : null;
  const date = (value: unknown) => (typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : "");
  const name = plain(author.name, 32);
  return {
    id: review.id,
    stars: review.stars as number,
    text,
    version: review.version,
    date: date(review.updatedAt),
    author: {
      name,
      initials: name ? plain(author.initials, 3) : null,
      picture:
        typeof picture.sha256 === "string" && SHA256.test(picture.sha256) && Number.isSafeInteger(picture.size) && (picture.size as number) > 0 && (picture.size as number) <= MAX_REVIEWER_PICTURE
          ? { sha256: picture.sha256, size: picture.size as number }
          : null,
    },
    reply: replyText ? { text: replyText, date: date(reply!.updatedAt) } : null,
  };
}

/** The player's own rating as the service answers it, or null. */
function parseOwnReview(raw: unknown): CatalogOwnReview | null {
  if (typeof raw !== "object" || raw === null) return null;
  const review = raw as Record<string, unknown>;
  if (!Number.isInteger(review.stars) || (review.stars as number) < 1 || (review.stars as number) > 5) return null;
  if (typeof review.version !== "string" || !SEMVER.test(review.version) || review.version.length > 64) return null;
  return { stars: review.stars as number, text: reviewText(review.text), version: review.version, hidden: review.hidden === true, held: review.held === true };
}

/** What the service said went wrong with a rating or reply, as a message for the player. */
const REVIEW_REASONS: Record<string, MessageKey> = {
  "own-module": "error.reviewOwn",
  "review-words": "error.reviewWords",
  "review-link": "error.reviewLink",
  "account-too-new": "error.reviewTooNew",
  "daily-limit": "error.reviewDailyLimit",
  "not-publisher": "error.reviewNotPublisher",
  "signed-out": "account.error.signedOut",
  "not-found": "error.catalogNotListed",
  unavailable: "error.reviewsUnavailable",
};

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
    installs: typeof entry.installs === "number" && Number.isSafeInteger(entry.installs) && entry.installs >= 0 ? entry.installs : 0,
    publishedAt: typeof publishedAt === "string" && publishedAt.length <= 40 ? publishedAt : "",
    zip: { sha256: file.sha256, size: file.size },
    notes: plainNotes(entry.notes),
    // Opened only like a module link (http or https), and shown as plain text.
    homepage: isHomepage(entry.homepage) && isWebUrl(entry.homepage) ? entry.homepage : null,
    // An https address or an email address; opened only after a click, and checked again from the listing.
    support: isSupportLink(entry.support) && (isSupportEmail(entry.support) || isWebUrl(entry.support)) ? entry.support : null,
    shots: parseScreenshots(entry.screenshots),
    icon: parsePicture(entry.icon, MAX_MODULE_ICON),
    translations: parseTranslations(entry.translations),
    rating: parseRating(entry.rating),
  };
}

/** Whether a module may go where the player is; the service filters too, but it is not trusted to. */
export function fitsScope(entry: Pick<CatalogEntry, "games" | "workspaces">, scope: CatalogScope): boolean {
  if ("workspace" in scope) return entry.games.length === 0 && entry.workspaces;
  return entry.games.length === 0 || entry.games.includes(scope.game);
}

/** A listing's name and description in `language` (Tavora's), each from the first translation that has it, else as listed. */
export function shownTexts(entry: Pick<CatalogEntry, "name" | "description" | "translations">, language: string): { name: string; description: string | null } {
  const found = translationsFor(entry.translations, language);
  return { name: found.find((t) => t.name)?.name ?? entry.name, description: found.find((t) => t.description)?.description ?? entry.description };
}

/**
 * The view the host UI gets: no hash, the name and description in `language`, the games by name, whether it fits
 * where the player is, and only whether there are pictures.
 */
export function catalogView({ games, workspaces, zip: _zip, notes: _notes, shots, icon, translations, ...view }: CatalogEntry, language: string, scope?: CatalogScope): CatalogModuleView {
  const fits = scope ? fitsScope({ games, workspaces }, scope) : true;
  return { ...view, ...shownTexts({ ...view, translations }, language), fits, forGames: games.map((id) => catalogGame(id)?.name ?? id), screenshots: shots.length, icon: icon !== null };
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
  /** The listings of the last list, so their icons are fetched without asking for the list again. */
  private listed = new Map<string, CatalogEntry>();
  /** Icons already checked, by hash; a few hundred at most. */
  private readonly icons = new Map<string, string | null>();

  constructor(options: CatalogClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.listTimeoutMs = options.listTimeoutMs ?? LIST_TIMEOUT_MS;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  }

  /**
   * Every listed module, in `language`: those that fit the game or personal workspace first, then the rest, each by
   * name. The whole index is asked for, so the service doesn't learn which game is open. Never throws.
   */
  async list(scope: CatalogScope, language: string): Promise<CatalogListResult> {
    try {
      const response = await this.get("/v1/catalog", this.listTimeoutMs, "application/json");
      const failed = failure(response.status);
      if (failed) return { status: failed };
      const body = (await response.json()) as { modules?: unknown } | null;
      const raw = Array.isArray(body?.modules) ? body.modules.slice(0, MAX_MODULES) : [];
      const seen = new Set<string>();
      const entries = raw
        .map(parseCatalogEntry)
        .filter((entry): entry is CatalogEntry => entry !== null && !seen.has(entry.id) && Boolean(seen.add(entry.id)))
        .map((entry) => ({ entry, fits: fitsScope(entry, scope), name: shownTexts(entry, language).name }))
        .sort((a, b) => Number(b.fits) - Number(a.fits) || a.name.localeCompare(b.name))
        .map(({ entry }) => entry);
      this.listed = new Map(entries.map((entry) => [entry.id, entry]));
      return { status: "ok", modules: entries.map((entry) => catalogView(entry, language, scope)) };
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
  async details(id: string): Promise<{ entry: CatalogEntry; versions: CatalogVersion[]; readme: string | null }> {
    if (!isModuleId(id)) throw new CatalogError("error.catalogNotListed");
    let response: Response;
    try {
      response = await this.get(`/v1/catalog/modules/${encodeURIComponent(id)}`, this.listTimeoutMs, "application/json");
    } catch {
      throw new CatalogError("error.catalogUnreachable");
    }
    if (response.status === 404) throw new CatalogError("error.catalogNotListed");
    throwFailure(response.status);
    const body = (await response.json().catch(() => null)) as { module?: unknown; versions?: unknown; readme?: unknown } | null;
    const entry = parseCatalogEntry(body?.module);
    if (!entry || entry.id !== id) throw new CatalogError("error.catalogNotListed");
    const versions = (Array.isArray(body?.versions) ? body.versions.slice(0, MAX_VERSIONS) : []).map(parseCatalogVersion).filter((version): version is CatalogVersion => version !== null);
    const readme = typeof body?.readme === "string" && Buffer.byteLength(body.readme) <= MAX_README_BYTES ? body.readme : null;
    return { entry, versions, readme };
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
   * A listed screenshot or icon as a data address for the host UI, or null when it cannot be had or is
   * not what the listing says (C10): read into memory with its listed size as a cap, then its SHA-256 and
   * its own first bytes (a PNG or WebP of that type) are checked, like a module icon (G10).
   */
  async picture(shot: CatalogScreenshot, maxBytes = MAX_SCREENSHOT_BYTES): Promise<string | null> {
    try {
      const data = await this.read(`/v1/catalog/pictures/${shot.sha256}.${shot.type}`, shot.size, this.listTimeoutMs, `image/${shot.type}`);
      if (createHash("sha256").update(data).digest("hex") !== shot.sha256) return null;
      const url = pictureDataUrl(data, maxBytes);
      return url?.startsWith(`data:image/${shot.type};`) ? url : null;
    } catch {
      return null;
    }
  }

  /** The icon of a module from the last list, checked like any listed picture, or null. Never throws. */
  async icon(id: string): Promise<string | null> {
    const shot = this.listed.get(id)?.icon;
    if (!shot) return null;
    if (this.icons.has(shot.sha256)) return this.icons.get(shot.sha256)!;
    const url = await this.picture(shot, MAX_MODULE_ICON);
    if (this.icons.size >= MAX_MODULES) this.icons.clear();
    this.icons.set(shot.sha256, url);
    return url;
  }

  /**
   * Reports a zip to Tavora, only after the player pressed Report: the module id, its key's
   * fingerprint and the zip's hash, and nothing else (C12). Throws a CatalogError the player can read.
   */
  async report(report: { id: string; owner: string; sha256: string }, token?: string): Promise<void> {
    if (!isModuleId(report.id) || !FINGERPRINT.test(report.owner) || !SHA256.test(report.sha256)) throw new CatalogError("error.catalogNotListed");
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/catalog/report`, {
        ...REQUEST,
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id: report.id, owner: report.owner, sha256: report.sha256 }),
        signal: AbortSignal.timeout(this.listTimeoutMs),
      });
    } catch {
      throw new CatalogError("error.catalogUnreachable");
    }
    if (response.status === 404) throw new CatalogError("error.catalogNotListed");
    if (response.status === 401) throw new CatalogError("error.reportSignIn");
    throwFailure(response.status);
  }

  /** Tells the catalog a module was installed from Browse: only its id, so the listing can show a count. Never throws. */
  async installed(id: string): Promise<void> {
    if (!isModuleId(id)) return;
    await this.fetchImpl(`${this.baseUrl}/v1/catalog/installed`, {
      ...REQUEST,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(this.listTimeoutMs),
    }).catch(() => undefined);
  }

  /** Tells the catalog a module from it was updated: only its id, counted per day, never who. Never throws. */
  async updated(id: string): Promise<void> {
    if (!isModuleId(id)) return;
    await this.fetchImpl(`${this.baseUrl}/v1/catalog/updated`, {
      ...REQUEST,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(this.listTimeoutMs),
    }).catch(() => undefined);
  }

  /** A module's ratings and newest reviews, each checked; a review that isn't is left out. Throws a CatalogError the player can read. */
  async reviews(id: string): Promise<{ rating: CatalogRating | null; reviews: CatalogReview[] }> {
    const body = await this.send("GET", `/v1/catalog/modules/${encodeURIComponent(id)}/reviews`);
    const seen = new Set<string>();
    const reviews = (Array.isArray(body.reviews) ? body.reviews.slice(0, 200) : [])
      .map(parseCatalogReview)
      .filter((review): review is CatalogReview => review !== null && !seen.has(review.id) && Boolean(seen.add(review.id)));
    return { rating: parseRating(body.summary), reviews };
  }

  /** A reviewer's picture as a checked PNG data address, or null. Never throws. */
  async reviewerPicture(reviewId: string, picture: { sha256: string; size: number }): Promise<string | null> {
    try {
      const data = await this.read(`/v1/catalog/reviews/${reviewId}/picture/${picture.sha256}.png`, picture.size, this.listTimeoutMs, "image/png");
      if (createHash("sha256").update(data).digest("hex") !== picture.sha256) return null;
      const url = pictureDataUrl(data, MAX_REVIEWER_PICTURE);
      return url?.startsWith("data:image/png;") ? url : null;
    } catch {
      return null;
    }
  }

  /** The signed-in account's own rating of a module, and whether the module is its own. Throws a CatalogError. */
  async ownReview(id: string, token: string): Promise<{ mine: CatalogOwnReview | null; own: boolean }> {
    const body = await this.send("GET", `/v1/catalog/modules/${encodeURIComponent(id)}/review`, token);
    return { mine: parseOwnReview(body.review), own: body.own === true };
  }

  /** Rates a module with the account, on a version the catalog published. Throws a CatalogError the player can read. */
  async rate(id: string, token: string, rating: { stars: number; text: string | null; version: string }): Promise<void> {
    await this.send("PUT", `/v1/catalog/modules/${encodeURIComponent(id)}/review`, token, { stars: rating.stars, text: rating.text, version: rating.version });
  }

  async unrate(id: string, token: string): Promise<void> {
    await this.send("DELETE", `/v1/catalog/modules/${encodeURIComponent(id)}/review`, token);
  }

  /** The publisher's reply under a review; null takes it back. Throws a CatalogError the player can read. */
  async reply(reviewId: string, token: string, text: string | null): Promise<void> {
    if (!REVIEW_ID.test(reviewId)) throw new CatalogError("error.catalogNotListed");
    await this.send(text === null ? "DELETE" : "PUT", `/v1/catalog/reviews/${reviewId}/reply`, token, text === null ? undefined : { text });
  }

  /** Reports a review, only after the player pressed Report: its id, signed in (decided 2026-10-27). */
  async reportReview(reviewId: string, token?: string): Promise<void> {
    if (!REVIEW_ID.test(reviewId)) throw new CatalogError("error.reviewGone");
    try {
      await this.send("POST", `/v1/catalog/reviews/${reviewId}/report`, token);
    } catch (error) {
      if (error instanceof CatalogError && error.key === "account.error.signedOut") throw new CatalogError("error.reportSignIn");
      if (error instanceof CatalogError && error.key === "error.catalogNotListed") throw new CatalogError("error.reviewGone");
      throw error;
    }
  }

  /** One JSON request for ratings and reviews, signed in when a token is given. Throws a CatalogError the player can read. */
  private async send(method: string, pathname: string, token?: string, body?: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        ...REQUEST,
        method,
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.listTimeoutMs),
      });
    } catch {
      throw new CatalogError("error.catalogUnreachable");
    }
    if (response.status === 204) return {};
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok) return json && typeof json === "object" && !Array.isArray(json) ? json : {};
    const key = typeof json?.reason === "string" ? REVIEW_REASONS[json.reason] : undefined;
    // The limits say how many hours are left.
    if (key) throw new CatalogError(key, Number.isInteger(json?.hours) && (json!.hours as number) > 0 ? { hours: json!.hours as number } : undefined);
    if (response.status === 404) throw new CatalogError("error.catalogNotListed");
    if (response.status === 401) throw new CatalogError("account.error.signedOut");
    throwFailure(response.status);
    throw new CatalogError("error.generic");
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
