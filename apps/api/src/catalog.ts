import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isGameId, LOCAL_OWNER, manifestFiles, MAX_README_BYTES, MAX_SCREENSHOT_BYTES, validateChangelog, validateManifest, type ModuleManifest } from "@tavora/module-schema";
import { MANIFEST_FILE, readZip, SIGNATURE_FILE, verifyFiles, ZIP_LIMITS, ZipError, type ZipFile } from "@tavora/pack";
import { inspectPng, isWebp } from "./png.ts";

/**
 * The module catalog (Milestone E, docs/catalog-threat-model.md): community modules, each with the
 * versions that were added, and their zips stored under their SHA-256. Publishers upload with
 * `tavora-pack publish` (catalog-publish.ts); the maintainer can add by hand with `scripts/catalog.ts`. Every zip is checked the way the app's
 * zip installer checks it (C1, C8) before anything is stored, and nothing in it is ever unpacked to
 * disk or run. The app still checks each zip again itself; the service is never what makes one trusted.
 */

export class CatalogError extends Error {}

/** Tavora's own modules stay bundled with the app; the catalog holds community modules only. */
const OFFICIAL_PREFIX = "tavora.";
const SHA256 = /^[0-9a-f]{64}$/;
/** Widest and tallest screenshot the catalog takes, in pixels. */
export const MAX_SCREENSHOT_PIXELS = 4096;

export type ScreenshotType = "png" | "webp";

/** A screenshot's kind by its own bytes (C10, like icons in G10), or null unless it is a well-formed PNG or WebP within the limits. */
export function screenshotType(bytes: Uint8Array): ScreenshotType | null {
  if (inspectPng(bytes, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_PIXELS)) return "png";
  return isWebp(bytes, MAX_SCREENSHOT_BYTES) ? "webp" : null;
}

/** Largest icon a listing shows, as for icons in the app (G10). */
export const MAX_LISTING_ICON_BYTES = 256 * 1024;

/** An icon's kind by its own bytes, or null unless it is a well-formed PNG or WebP of at most 256 KB and 1024 px. */
export function iconType(bytes: Uint8Array): ScreenshotType | null {
  if (inspectPng(bytes, MAX_LISTING_ICON_BYTES, 1024)) return "png";
  return isWebp(bytes, MAX_LISTING_ICON_BYTES) ? "webp" : null;
}

/** A readme as text, or null unless it is UTF-8 of at most MAX_README_BYTES without control characters other than tabs and line breaks. */
export function readmeText(bytes: Buffer): string | null {
  if (bytes.length > MAX_README_BYTES) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? null : text.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
}

/** A picture of a listing (a screenshot or the icon): the file is served by its hash, so the app can check it. */
export interface CatalogScreenshot {
  sha256: string;
  type: ScreenshotType;
  size: number;
}

/**
 * The lists signed offline with Tavora's catalogue key (`pnpm tavora-catalog-sign`): revoked keys with
 * their allowlists (C6), blocked zips (C14) and key successions (C7). The service only stores and serves
 * them unchanged; the app checks the signature, the sequence number and the age itself (C2).
 */
export const SIGNED_LISTS = ["revocations", "blocks", "successions"] as const;
export type SignedList = (typeof SIGNED_LISTS)[number];
export const MAX_LIST_BYTES = 1024 * 1024;
export const isSignedList = (value: string): value is SignedList => (SIGNED_LISTS as readonly string[]).includes(value);

/**
 * Version order, newest last. The same order as `compareModuleVersions` in the app's installer,
 * which decides on the player's PC whether a catalog version is an update.
 */
export function compareModuleVersions(a: string, b: string): number {
  const split = (version: string) => {
    const [core = "", pre] = version.split(/-(.*)/s);
    return { core: core.split(".").map(Number), pre: pre === undefined ? [] : pre.split(".") };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!;
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]!;
    const q = y.pre[i]!;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

export interface CheckedZip {
  manifest: ModuleManifest;
  /** The publisher key's fingerprint: whose data the module gets on a player's PC. */
  owner: string;
  sha256: string;
  size: number;
  /** This version's patch notes from the module's changelog, if it has an entry for it. */
  notes: string[];
  /** The screenshots the manifest names, in its order, each checked to be a real picture. */
  screenshots: (CatalogScreenshot & { data: Buffer })[];
  /** The manifest icon when it is a real small picture; a listing simply has none otherwise. */
  icon: (CatalogScreenshot & { data: Buffer }) | null;
  /** The readme's text, checked to be plain UTF-8 within the limit. */
  readme: string | null;
  /** Every file of the zip, for the automatic checks (moderation.ts). Never stored. */
  files: ZipFile[];
}

/** Why a version waits: which check stopped it, a short text for its developer, and what helps the maintainer judge it. */
export interface ReviewReason {
  check: string;
  text: string;
  detail?: string;
}

/** What is kept with a version that waits for review. */
export interface ReviewInfo {
  reasons: ReviewReason[];
  /** The language of the developer's request ("en" or "de"), for the emails that follow. */
  language: string;
  /** The publish token's name when it came from CI. */
  token: string | null;
}

export type VersionStatus = "listed" | "waiting";

/** A version waiting for review, with what the maintainer needs to judge it. */
export interface WaitingVersion {
  sha256: string;
  id: string;
  version: string;
  size: number;
  owner: string;
  accountId: string | null;
  queuedAt: string;
  manifest: ModuleManifest;
  notes: string[];
  readme: string | null;
  screenshots: CatalogScreenshot[];
  icon: CatalogScreenshot | null;
  review: ReviewInfo;
}

/** The files of a zip that count for telling copies apart: [sha256, size] each. Tiny files and the manifest and signature are left out. */
export const MIN_COPY_FILE_BYTES = 64;
export function copyHashes(files: readonly ZipFile[]): [string, number][] {
  return files
    .filter((file) => file.name !== MANIFEST_FILE && file.name !== SIGNATURE_FILE && file.data.length >= MIN_COPY_FILE_BYTES)
    .map((file): [string, number] => [createHash("sha256").update(file.data).digest("hex"), file.data.length]);
}

/** Checks a module zip the way the app's installer does, and refuses what the catalog does not take. */
export function checkCatalogZip(bytes: Buffer): CheckedZip {
  if (bytes.length > ZIP_LIMITS.maxArchiveBytes) throw new CatalogError("The zip is too big.");
  let files;
  try {
    files = readZip(bytes);
  } catch (error) {
    if (error instanceof ZipError) throw new CatalogError(`The zip was refused: ${error.message}.`);
    throw error;
  }
  const file = (name: string) => files.find((entry) => entry.name === name);
  const json = (name: string): unknown => {
    try {
      return JSON.parse(file(name)!.data.toString("utf8"));
    } catch {
      throw new CatalogError(`Its ${name} is not valid JSON.`);
    }
  };
  if (!file(MANIFEST_FILE)) throw new CatalogError(`It has no ${MANIFEST_FILE}.`);
  const result = validateManifest(json(MANIFEST_FILE));
  if (!result.ok) throw new CatalogError(`Its manifest is invalid: ${result.errors.slice(0, 2).join("; ")}.`);
  const { manifest } = result;
  const { entries, icons, screenshots: shots } = manifestFiles(manifest);
  for (const name of [...entries, ...icons, ...shots]) if (!file(name)) throw new CatalogError(`It names ${name}, which is missing.`);
  if (manifest.id.startsWith(OFFICIAL_PREFIX)) throw new CatalogError("Its id is reserved for Tavora's own modules, which stay bundled with the app.");

  const verified = verifyFiles(files);
  if (!verified.ok) throw new CatalogError(`It was refused: ${verified.reason}.`);
  if (verified.owner === LOCAL_OWNER) throw new CatalogError("It is not signed. Pack it with tavora-pack, which signs it with your publisher key.");

  let notes: string[] = [];
  if (manifest.changelog !== undefined) {
    if (!file(manifest.changelog)) throw new CatalogError(`It names ${manifest.changelog}, which is missing.`);
    const changelog = validateChangelog(json(manifest.changelog));
    if (!changelog.ok) throw new CatalogError(`Its changelog is invalid: ${changelog.errors.slice(0, 2).join("; ")}.`);
    notes = changelog.entries.find((entry) => entry.version === manifest.version)?.notes ?? [];
  }
  const screenshots = shots.map((name) => {
    const data = file(name)!.data;
    const type = screenshotType(data);
    if (!type || !name.endsWith(`.${type}`)) {
      throw new CatalogError(`Its screenshot ${name} is not a ${name.endsWith(".webp") ? "WebP" : "PNG"} of at most ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MB and ${MAX_SCREENSHOT_PIXELS} px.`);
    }
    return { sha256: createHash("sha256").update(data).digest("hex"), type, size: data.length, data };
  });
  let readme: string | null = null;
  if (manifest.readme !== undefined) {
    const data = file(manifest.readme)?.data;
    if (!data) throw new CatalogError(`It names ${manifest.readme}, which is missing.`);
    readme = readmeText(data);
    if (readme === null) throw new CatalogError(`Its readme ${manifest.readme} must be UTF-8 text of at most ${MAX_README_BYTES / 1024} KB.`);
  }
  const iconData = manifest.icon === undefined ? undefined : file(manifest.icon)?.data;
  const kind = iconData ? iconType(iconData) : null;
  const icon = iconData && kind && manifest.icon!.endsWith(`.${kind}`) ? { sha256: createHash("sha256").update(iconData).digest("hex"), type: kind, size: iconData.length, data: iconData } : null;
  return { manifest, owner: verified.owner, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, notes, screenshots, icon, readme, files };
}

/** What a player sees of a module in the catalog, at its newest version. */
export interface CatalogEntry {
  id: string;
  name: string;
  description: string | null;
  version: string;
  minTavora: string | null;
  /** Empty: for any game. */
  games: string[];
  /** Whether it may be added to a personal workspace (only modules for any game can be). */
  workspaces: boolean;
  permissions: { network: string[]; connectors: string[] };
  /** The fingerprint of the publisher key that signed this version: the module's first key, or its successor. */
  owner: string;
  zip: { sha256: string; size: number };
  publishedAt: string;
  notes: string[];
  /** The module's web page from its manifest, http or https; the app shows it as plain text and opens it like a module link. */
  homepage: string | null;
  /** Where players send feedback, from its manifest: an https address or an email address; the app opens it only after a click. */
  support: string | null;
  /** The name and description in other languages, from the manifest's `translations`, keyed by language code. */
  translations: Record<string, { name?: string; description?: string }>;
  screenshots: CatalogScreenshot[];
  icon: CatalogScreenshot | null;
}

export interface CatalogVersion {
  version: string;
  publishedAt: string;
  notes: string[];
}

export type CatalogFilter = { game: string } | { workspace: true } | Record<string, never>;

export interface CatalogReport {
  sha256: string;
  id: string;
  name: string;
  version: string;
  owner: string;
  count: number;
  firstAt: string;
  lastAt: string;
  listed: boolean;
}

export interface CatalogModuleRow {
  id: string;
  owner: string;
  listed: boolean;
  versions: number;
  latest: string;
}

/** A module as the admin panel lists it; versions newest first. */
export interface AdminModule {
  id: string;
  name: string;
  owner: string;
  listed: boolean;
  createdAt: string;
  installs: number;
  storedBytes: number;
  versions: { version: string; sha256: string; publishedAt: string; size: number; zipKept: boolean }[];
}

interface WaitingSql {
  sha256: string;
  module_id: string;
  version: string;
  size: number;
  manifest: string;
  notes: string;
  published_at: string;
  account_id: string | null;
  signer: string | null;
  screenshots: string | null;
  icon: string | null;
  readme: string | null;
  review: string | null;
  owner: string;
}

interface VersionSql {
  module_id: string;
  owner: string;
  version: string;
  sha256: string;
  size: number;
  manifest: string;
  notes: string;
  published_at: string;
  screenshots: string | null;
  icon: string | null;
}

const LATEST = `
  select m.id as module_id, coalesce(v.signer, m.owner) as owner, v.version, v.sha256, v.size, v.manifest, v.notes, v.published_at, v.screenshots, v.icon
  from modules m join versions v on v.seq = (select max(seq) from versions where module_id = m.id and status = 'listed')
  where m.listed = 1`;

/** The manifest's translated name and description, by language; languages that translate neither are left out. */
function listedTranslations(manifest: ModuleManifest): CatalogEntry["translations"] {
  const listed: CatalogEntry["translations"] = {};
  for (const [code, { name, description }] of Object.entries(manifest.translations ?? {})) {
    if (name !== undefined || description !== undefined) listed[code] = { ...(name !== undefined ? { name } : {}), ...(description !== undefined ? { description } : {}) };
  }
  return listed;
}

function entryOf(row: VersionSql): CatalogEntry {
  const manifest = JSON.parse(row.manifest) as ModuleManifest;
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description ?? null,
    version: row.version,
    minTavora: manifest.minTavora ?? null,
    games: manifest.games,
    workspaces: manifest.games.length === 0 && manifest.workspaces !== false,
    permissions: { network: manifest.permissions.network, connectors: manifest.permissions.connectors ?? [] },
    owner: row.owner,
    zip: { sha256: row.sha256, size: row.size },
    publishedAt: row.published_at,
    notes: JSON.parse(row.notes) as string[],
    homepage: manifest.homepage ?? null,
    support: manifest.support ?? null,
    translations: listedTranslations(manifest),
    screenshots: row.screenshots === null ? [] : (JSON.parse(row.screenshots) as CatalogScreenshot[]),
    icon: row.icon === null ? null : (JSON.parse(row.icon) as CatalogScreenshot),
  };
}

/**
 * The catalog's own files, in a folder of the state directory: `catalog.sqlite` with the modules and
 * their versions, and `zips/<sha256>.zip`. A module's owner is set by its first version; later versions
 * must come from the same key, or its successor by a signed succession (C7), and be newer, so a version
 * can never be replaced or go back.
 */
export class CatalogStore {
  private readonly db: DatabaseSync;
  private readonly zips: string;
  private readonly shots: string;
  private readonly lists: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.zips = path.join(dir, "zips");
    mkdirSync(this.zips, { recursive: true });
    this.shots = path.join(dir, "pictures");
    mkdirSync(this.shots, { recursive: true });
    this.lists = path.join(dir, "lists");
    mkdirSync(this.lists, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "catalog.sqlite"));
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists modules (
        id text primary key, owner text not null, listed integer not null default 1, created_at text not null
      );
      create table if not exists versions (
        seq integer primary key autoincrement,
        module_id text not null references modules (id), version text not null,
        sha256 text not null unique, size integer not null, manifest text not null, notes text not null,
        published_at text not null, account_id text,
        unique (module_id, version)
      );
    `);
    // Reports (C12): the module, key and zip a player pressed Report on, counted, never who pressed it.
    this.db.exec(`
      create table if not exists reports (
        sha256 text primary key, module_id text not null, owner text not null,
        count integer not null, first_at text not null, last_at text not null
      );
      create table if not exists report_notices (owner text primary key, notified_at text not null);
    `);
    // Installs from Browse, counted per module, never who installed it or from where.
    this.db.exec("create table if not exists installs (module_id text primary key, count integer not null)");
    // Since when the whole catalog has had no room (C9), and when the maintainer was last told.
    this.db.exec("create table if not exists catalog_state (name text primary key, value text not null)");
    // Catalogs from before signed uploads have no account_id: those versions were added by hand.
    const columns = (this.db.prepare("pragma table_info(versions)").all() as unknown as { name: string }[]).map((column) => column.name);
    if (!columns.includes("account_id")) this.db.exec("alter table versions add column account_id text");
    // The key that signed a version when it is not the module's owner (a successor key); null means the owner.
    if (!columns.includes("signer")) this.db.exec("alter table versions add column signer text");
    // A version's screenshots as JSON ([{ sha256, type, size }]); null for versions from before them.
    if (!columns.includes("screenshots")) this.db.exec("alter table versions add column screenshots text");
    // The listing icon ({ sha256, type, size }) and the readme's text; null without one.
    if (!columns.includes("icon")) this.db.exec("alter table versions add column icon text");
    if (!columns.includes("readme")) this.db.exec("alter table versions add column readme text");
    // When an older version's zip was deleted to make room (prune); the row stays for its notes and the signed lists.
    if (!columns.includes("zip_removed")) this.db.exec("alter table versions add column zip_removed text");
    // Review before listing (decided 2026-10-26): 'waiting' versions are not listed, and their zip stays private until a person
    // approves them. `review` holds why (JSON, see ReviewInfo), `file_hashes` the files' [sha256, size] for telling copies apart.
    if (!columns.includes("status")) this.db.exec("alter table versions add column status text not null default 'listed'");
    if (!columns.includes("review")) this.db.exec("alter table versions add column review text");
    if (!columns.includes("file_hashes")) this.db.exec("alter table versions add column file_hashes text");
    this.db.exec(`
      create table if not exists trusted_accounts (account_id text primary key, since text not null);
      create table if not exists declined (
        sha256 text primary key, module_id text not null, version text not null, account_id text, reason text not null, note text, at text not null
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Adds a checked zip as a module's newest version, and stores the zip under its hash. `uploadedBy`
   * is the account a publisher's upload came from; versions added by hand have none. `firstKey` says
   * which key a signing key succeeds (catalog-trust.ts); without it only the owner key adds versions. With `review` that has reasons the version
   * waits (not listed, zip kept privately) until approve(); without reasons it lists at once.
   */
  add(
    bytes: Buffer,
    now: Date = new Date(),
    uploadedBy: string | null = null,
    checked: CheckedZip = checkCatalogZip(bytes),
    firstKey: (fingerprint: string) => string = (fingerprint) => fingerprint,
    review?: ReviewInfo,
  ): CheckedZip {
    const { manifest, owner, sha256 } = checked;
    const module = this.db.prepare("select owner from modules where id = ?").get(manifest.id) as { owner: string } | undefined;
    if (module && module.owner !== owner && firstKey(owner) !== module.owner) throw new CatalogError(`${manifest.id} belongs to another publisher key.`);
    const latest = this.db.prepare("select version from versions where module_id = ? order by seq desc limit 1").get(manifest.id) as { version: string } | undefined;
    if (latest && compareModuleVersions(manifest.version, latest.version) <= 0) {
      throw new CatalogError(`${manifest.id} already has ${latest.version}; a new version must be newer.`);
    }
    if (this.db.prepare("select 1 from versions where sha256 = ?").get(sha256)) throw new CatalogError("This exact zip is already in the catalog.");

    // The files first, under their hashes, so a row never points at a file that is not there.
    const write = (target: string, data: Buffer) => {
      const temporary = `${target}.${process.pid}.tmp`;
      writeFileSync(temporary, data);
      renameSync(temporary, target);
    };
    write(path.join(this.zips, `${sha256}.zip`), bytes);
    for (const shot of [...checked.screenshots, ...(checked.icon ? [checked.icon] : [])]) write(path.join(this.shots, `${shot.sha256}.${shot.type}`), shot.data);
    const screenshots = checked.screenshots.map(({ sha256: hash, type, size }) => ({ sha256: hash, type, size }));
    const icon = checked.icon ? { sha256: checked.icon.sha256, type: checked.icon.type, size: checked.icon.size } : null;
    const at = now.toISOString();
    const waits = review !== undefined && review.reasons.length > 0;
    this.db.exec("begin");
    try {
      if (!module) this.db.prepare("insert into modules (id, owner, created_at) values (?, ?, ?)").run(manifest.id, owner, at);
      this.db
        .prepare("insert into versions (module_id, version, sha256, size, manifest, notes, published_at, account_id, signer, screenshots, icon, readme, status, review, file_hashes) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          manifest.id,
          manifest.version,
          sha256,
          checked.size,
          JSON.stringify(manifest),
          JSON.stringify(checked.notes),
          at,
          uploadedBy,
          module && module.owner !== owner ? owner : null,
          screenshots.length ? JSON.stringify(screenshots) : null,
          icon ? JSON.stringify(icon) : null,
          checked.readme,
          waits ? "waiting" : "listed",
          review ? JSON.stringify(review) : null,
          JSON.stringify(copyHashes(checked.files)),
        );
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return checked;
  }

  /** How many versions an account uploaded since a moment (ISO time). */
  uploadsSince(accountId: string, since: Date): number {
    return (this.db.prepare("select count(*) as n from versions where account_id = ? and published_at >= ?").get(accountId, since.toISOString()) as { n: number }).n;
  }

  /** The bytes of every zip an account uploaded, or of the whole catalog, that is still stored. */
  storedBytes(accountId?: string): number {
    const row = (accountId === undefined
      ? this.db.prepare("select coalesce(sum(size), 0) as n from versions where zip_removed is null").get()
      : this.db.prepare("select coalesce(sum(size), 0) as n from versions where account_id = ? and zip_removed is null").get(accountId)) as { n: number };
    return row.n;
  }

  /** A module's versions that still have their zip, past its newest `keep`, newest first. */
  private storedBeyond(moduleId: string, keep: number): { sha256: string; size: number; account_id: string | null }[] {
    return this.db
      .prepare("select sha256, size, account_id from versions where module_id = ? and zip_removed is null and status = 'listed' order by seq desc limit -1 offset ?")
      .all(moduleId, Math.max(0, keep)) as unknown as { sha256: string; size: number; account_id: string | null }[];
  }

  /**
   * The bytes a module's next version frees when only its newest `keep` versions keep their zips: the zips past
   * its newest `keep - 1` now. Only the account's own uploads count when `accountId` is given.
   */
  freedByNextVersion(moduleId: string, keep: number, accountId?: string): number {
    return this.storedBeyond(moduleId, keep - 1)
      .filter((version) => accountId === undefined || version.account_id === accountId)
      .reduce((sum, version) => sum + version.size, 0);
  }

  /**
   * Deletes the zips of a module's versions past its newest `keep`, so the catalog doesn't only grow. Their rows
   * stay (notes, signed lists, reports); the zips are gone for good and no longer handed out. Returns how many.
   */
  prune(moduleId: string, keep: number, now: Date = new Date()): number {
    const old = this.storedBeyond(moduleId, keep);
    const mark = this.db.prepare("update versions set zip_removed = ? where sha256 = ?");
    for (const version of old) {
      // The row first: a zip that is not counted any more is never handed out, even if deleting the file fails.
      mark.run(now.toISOString(), version.sha256);
      rmSync(path.join(this.zips, `${version.sha256}.zip`), { force: true });
    }
    return old.length;
  }

  /** The zips (SHA-256) a key signed that the catalog took before a moment, oldest first. */
  signedBy(fingerprint: string, before: Date): string[] {
    return (
      this.db
        .prepare("select v.sha256 from versions v join modules m on m.id = v.module_id where coalesce(v.signer, m.owner) = ? and v.published_at < ? and v.status = 'listed' order by v.seq")
        .all(fingerprint, before.toISOString()) as unknown as { sha256: string }[]
    ).map((row) => row.sha256);
  }

  /** Takes a module out of the catalog or puts it back. Its versions and zips are kept. */
  setListed(id: string, listed: boolean): boolean {
    return Number(this.db.prepare("update modules set listed = ? where id = ?").run(listed ? 1 : 0, id).changes) > 0;
  }

  // ── Review before listing (decided 2026-10-26) ─────────────────────────

  private zipPath(sha256: string): string {
    return path.join(this.zips, `${sha256}.zip`);
  }

  /** A stored zip by its hash, whatever its status; null when it is gone or is not what its name says. Private: only the maintainer's review reads it. */
  zipBytes(sha256: string): Buffer | null {
    if (!SHA256.test(sha256)) return null;
    try {
      const bytes = readFileSync(this.zipPath(sha256));
      return createHash("sha256").update(bytes).digest("hex") === sha256 ? bytes : null;
    } catch {
      return null;
    }
  }

  private waitingOf(row: WaitingSql): WaitingVersion {
    return {
      sha256: row.sha256,
      id: row.module_id,
      version: row.version,
      size: row.size,
      owner: row.signer ?? row.owner,
      accountId: row.account_id,
      queuedAt: row.published_at,
      manifest: JSON.parse(row.manifest) as ModuleManifest,
      notes: JSON.parse(row.notes) as string[],
      readme: row.readme,
      screenshots: row.screenshots === null ? [] : (JSON.parse(row.screenshots) as CatalogScreenshot[]),
      icon: row.icon === null ? null : (JSON.parse(row.icon) as CatalogScreenshot),
      review: row.review === null ? { reasons: [], language: "en", token: null } : (JSON.parse(row.review) as ReviewInfo),
    };
  }

  private static readonly WAITING_SELECT =
    "select v.sha256, v.module_id, v.version, v.size, v.manifest, v.notes, v.published_at, v.account_id, v.signer, v.screenshots, v.icon, v.readme, v.review, m.owner from versions v join modules m on m.id = v.module_id where v.status = 'waiting'";

  /** The versions waiting for review, oldest first. */
  waitingVersions(): WaitingVersion[] {
    return (this.db.prepare(`${CatalogStore.WAITING_SELECT} order by v.seq`).all() as unknown as WaitingSql[]).map((row) => this.waitingOf(row));
  }

  /** One waiting version by its zip's hash, or null. */
  waitingVersion(sha256: string): WaitingVersion | null {
    const row = this.db.prepare(`${CatalogStore.WAITING_SELECT} and v.sha256 = ?`).get(sha256) as WaitingSql | undefined;
    return row ? this.waitingOf(row) : null;
  }

  /** How many versions an account has waiting. */
  waitingCount(accountId: string): number {
    return (this.db.prepare("select count(*) as n from versions where account_id = ? and status = 'waiting'").get(accountId) as { n: number }).n;
  }

  /** Lists a waiting version, and counts its account as approved from now on. Null when no such version waits or its zip is gone. */
  approve(sha256: string, now: Date = new Date()): WaitingVersion | null {
    const waiting = this.waitingVersion(sha256);
    if (!waiting || this.zipBytes(sha256) === null) return null;
    this.db.exec("begin");
    try {
      this.db.prepare("update versions set status = 'listed' where sha256 = ? and status = 'waiting'").run(sha256);
      if (waiting.accountId) this.trustAccount(waiting.accountId, now);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return waiting;
  }

  /** Counts an account as approved: its next versions' first-module check passes (the other checks still run). */
  trustAccount(accountId: string, now: Date = new Date()): void {
    this.db.prepare("insert into trusted_accounts (account_id, since) values (?, ?) on conflict (account_id) do nothing").run(accountId, now.toISOString());
  }

  /**
   * Takes a waiting version away for good: its row, its zip and the pictures nothing else uses (withdrawn by its developer or
   * declined). A module left without any version goes too. Null when no such version waits.
   */
  removeWaiting(sha256: string): WaitingVersion | null {
    const waiting = this.waitingVersion(sha256);
    if (!waiting) return null;
    this.db.prepare("delete from versions where sha256 = ? and status = 'waiting'").run(sha256);
    rmSync(this.zipPath(sha256), { force: true });
    if (!this.db.prepare("select 1 from versions where module_id = ?").get(waiting.id)) this.db.prepare("delete from modules where id = ?").run(waiting.id);
    for (const picture of [...waiting.screenshots, ...(waiting.icon ? [waiting.icon] : [])]) {
      const pattern = `%"${picture.sha256}"%`;
      if (!this.db.prepare("select 1 from versions where screenshots like ? or icon like ?").get(pattern, pattern)) rmSync(path.join(this.shots, `${picture.sha256}.${picture.type}`), { force: true });
    }
    return waiting;
  }

  /** Remembers a declined zip, so exactly this zip is not taken again. */
  recordDeclined(waiting: WaitingVersion, reason: string, note: string | null, now: Date = new Date()): void {
    this.db
      .prepare("insert into declined (sha256, module_id, version, account_id, reason, note, at) values (?, ?, ?, ?, ?, ?, ?) on conflict (sha256) do nothing")
      .run(waiting.sha256, waiting.id, waiting.version, waiting.accountId, reason, note, now.toISOString());
  }

  isDeclined(sha256: string): boolean {
    return this.db.prepare("select 1 from declined where sha256 = ?").get(sha256) !== undefined;
  }

  /**
   * Whether an account has had a version approved or listed: it has a listed version of its own, or a listed module
   * whose key it holds (accounts from before the review count as approved), or the maintainer approved one.
   */
  accountApproved(accountId: string, fingerprints: readonly string[]): boolean {
    if (this.db.prepare("select 1 from trusted_accounts where account_id = ?").get(accountId)) return true;
    if (this.db.prepare("select 1 from versions where account_id = ? and status = 'listed' limit 1").get(accountId)) return true;
    for (const fingerprint of fingerprints) {
      if (this.db.prepare("select 1 from versions v join modules m on m.id = v.module_id where v.status = 'listed' and coalesce(v.signer, m.owner) = ? limit 1").get(fingerprint)) return true;
    }
    return false;
  }

  /** A module's newest listed version (other than `except`), with what the checks compare a new one to; null when it has none. */
  previousListed(moduleId: string, except?: string): { version: string; manifest: ModuleManifest; icon: CatalogScreenshot | null; screenshots: CatalogScreenshot[] } | null {
    const row = this.db
      .prepare("select version, manifest, icon, screenshots from versions where module_id = ? and status = 'listed' and sha256 is not ? order by seq desc limit 1")
      .get(moduleId, except ?? null) as { version: string; manifest: string; icon: string | null; screenshots: string | null } | undefined;
    return row
      ? {
          version: row.version,
          manifest: JSON.parse(row.manifest) as ModuleManifest,
          icon: row.icon === null ? null : (JSON.parse(row.icon) as CatalogScreenshot),
          screenshots: row.screenshots === null ? [] : (JSON.parse(row.screenshots) as CatalogScreenshot[]),
        }
      : null;
  }

  /** The language an account's newest upload asked for ("en" or "de"), for emails nobody asked in a request. */
  languageOf(accountId: string): string {
    const row = this.db.prepare("select review from versions where account_id = ? and review is not null order by seq desc limit 1").get(accountId) as { review: string } | undefined;
    return row ? ((JSON.parse(row.review) as Partial<ReviewInfo>).language ?? "en") : "en";
  }

  /**
   * Every other publisher's listed module (its newest listed version) as id and names, translated names too. Waiting versions are
   * left out, so a copy that waits never makes the original's developer wait.
   */
  othersNames(self: { moduleId: string; accountId: string | null; fingerprints: readonly string[] }): { id: string; names: string[] }[] {
    const rows = this.db
      .prepare(
        `select v.module_id, v.account_id, v.manifest, coalesce(v.signer, m.owner) as signer from versions v join modules m on m.id = v.module_id
         where v.status = 'listed' and v.seq = (select max(seq) from versions where module_id = v.module_id and status = 'listed')`,
      )
      .all() as unknown as { module_id: string; account_id: string | null; manifest: string; signer: string }[];
    return rows
      .filter((row) => row.module_id !== self.moduleId && (self.accountId === null || row.account_id !== self.accountId) && !self.fingerprints.includes(row.signer))
      .map((row) => {
        const manifest = JSON.parse(row.manifest) as ModuleManifest;
        return { id: row.module_id, names: [manifest.name, ...Object.values(manifest.translations ?? {}).flatMap((translation) => translation.name ?? [])] };
      });
  }

  /**
   * The other publisher's version whose files share the most bytes with `hashes` (see copyHashes), as a share of them from 0 to 1;
   * null when no other publisher's version has a file in common. Versions from before the hashes were kept are read from their zip.
   */
  mostSimilar(self: { moduleId: string; accountId: string | null; fingerprints: readonly string[] }, hashes: readonly [string, number][]): { id: string; version: string; share: number } | null {
    const total = hashes.reduce((sum, [, size]) => sum + size, 0);
    if (total === 0) return null;
    const rows = this.db
      .prepare(
        `select v.module_id, v.version, v.sha256, v.account_id, v.file_hashes, v.zip_removed, coalesce(v.signer, m.owner) as signer
         from versions v join modules m on m.id = v.module_id where v.status = 'listed'`,
      )
      .all() as unknown as { module_id: string; version: string; sha256: string; account_id: string | null; file_hashes: string | null; zip_removed: string | null; signer: string }[];
    let best: { id: string; version: string; share: number } | null = null;
    for (const row of rows) {
      if (row.module_id === self.moduleId || (self.accountId !== null && row.account_id === self.accountId) || self.fingerprints.includes(row.signer)) continue;
      let theirs: [string, number][] | null = row.file_hashes === null ? null : (JSON.parse(row.file_hashes) as [string, number][]);
      if (theirs === null && row.zip_removed === null) {
        const bytes = this.zipBytes(row.sha256);
        try {
          theirs = bytes ? copyHashes(readZip(bytes)) : null;
        } catch {
          theirs = null;
        }
      }
      if (!theirs) continue;
      const known = new Set(theirs.map(([hash]) => hash));
      const shared = hashes.reduce((sum, [hash, size]) => (known.has(hash) ? sum + size : sum), 0);
      if (shared > 0 && (!best || shared / total > best.share)) best = { id: row.module_id, version: row.version, share: shared / total };
    }
    return best;
  }

  /** The ids of every module an account's keys or uploads made, listed or not. */
  modulesOfAccount(accountId: string, fingerprints: readonly string[]): string[] {
    const ids = new Set((this.db.prepare("select distinct module_id from versions where account_id = ?").all(accountId) as unknown as { module_id: string }[]).map((row) => row.module_id));
    for (const fingerprint of fingerprints) {
      const rows = this.db.prepare("select distinct m.id from modules m join versions v on v.module_id = m.id where m.owner = ? or v.signer = ?").all(fingerprint, fingerprint) as unknown as { id: string }[];
      for (const row of rows) ids.add(row.id);
    }
    return [...ids];
  }

  /** Delists these modules; returns those that were listed (and so are the ones to list again later). */
  unlistAll(ids: readonly string[]): string[] {
    return ids.filter((id) => Number(this.db.prepare("update modules set listed = 0 where id = ? and listed = 1").run(id).changes) > 0);
  }

  /** A waiting version's picture for the maintainer's review: only one a waiting version names. */
  waitingPicture(sha256: string, type: string): Buffer | null {
    if (!SHA256.test(sha256) || (type !== "png" && type !== "webp")) return null;
    const pattern = `%"${sha256}"%`;
    if (!this.db.prepare("select 1 from versions where status = 'waiting' and (screenshots like ? or icon like ?)").get(pattern, pattern)) return null;
    try {
      const bytes = readFileSync(path.join(this.shots, `${sha256}.${type}`));
      return createHash("sha256").update(bytes).digest("hex") === sha256 ? bytes : null;
    } catch {
      return null;
    }
  }

  /** The listed modules' newest versions that still have their zip, for the one-time run of the checks over what is already live. */
  liveVersions(): { id: string; version: string; sha256: string; owner: string; accountId: string | null; manifest: ModuleManifest }[] {
    return (
      this.db
        .prepare(
          `select m.id, v.version, v.sha256, coalesce(v.signer, m.owner) as owner, v.account_id, v.manifest
           from modules m join versions v on v.seq = (select max(seq) from versions where module_id = m.id and status = 'listed')
           where m.listed = 1 and v.zip_removed is null order by m.id`,
        )
        .all() as unknown as { id: string; version: string; sha256: string; owner: string; account_id: string | null; manifest: string }[]
    ).map((row) => ({ id: row.id, version: row.version, sha256: row.sha256, owner: row.owner, accountId: row.account_id, manifest: JSON.parse(row.manifest) as ModuleManifest }));
  }

  /** A saved note of the catalog (the one-time run's results), or null. */
  /** The module and version of a zip the catalog has or had, by its hash; null when it never had it. */
  versionBySha(sha256: string): { id: string; name: string; version: string } | null {
    const row = this.db.prepare("select module_id, version, manifest from versions where sha256 = ?").get(sha256) as { module_id: string; version: string; manifest: string } | undefined;
    return row ? { id: row.module_id, name: (JSON.parse(row.manifest) as { name: string }).name, version: row.version } : null;
  }

  getState(name: string): string | null {
    return (this.db.prepare("select value from catalog_state where name = ?").get(name) as { value: string } | undefined)?.value ?? null;
  }

  setState(name: string, value: string): void {
    this.db.prepare("insert into catalog_state (name, value) values (?, ?) on conflict (name) do update set value = excluded.value").run(name, value);
  }

  /**
   * Records a player's report of a zip. Only a zip the catalog lists, under that module id and key
   * (the module's owner, or the key that signed that version), can be reported. Reports hide nothing: a person decides on the admin page (C12).
   */
  report(input: { id: string; owner: string; sha256: string }, now: Date = new Date()): boolean {
    const known = this.db
      .prepare("select 1 from versions v join modules m on m.id = v.module_id where v.sha256 = ? and m.id = ? and (m.owner = ? or v.signer = ?) and m.listed = 1 and v.status = 'listed'")
      .get(input.sha256, input.id, input.owner, input.owner);
    if (!known) return false;
    const at = now.toISOString();
    this.db
      .prepare("insert into reports (sha256, module_id, owner, count, first_at, last_at) values (?, ?, ?, 1, ?, ?) on conflict (sha256) do update set count = count + 1, last_at = excluded.last_at")
      .run(input.sha256, input.id, input.owner, at, at);
    return true;
  }

  /** Counts one install of a listed module from Browse. Nothing about the player is kept. */
  countInstall(id: string): boolean {
    if (!this.db.prepare("select 1 from modules m where m.id = ? and m.listed = 1 and exists (select 1 from versions where module_id = m.id and status = 'listed')").get(id)) return false;
    this.db.prepare("insert into installs (module_id, count) values (?, 1) on conflict (module_id) do update set count = count + 1").run(id);
    return true;
  }

  /** Whether a module is in the catalog and listed. */
  isListed(id: string): boolean {
    return Boolean(this.db.prepare("select 1 from modules where id = ? and listed = 1").get(id));
  }

  /** How many times a module was installed from Browse. */
  installCount(id: string): number {
    return (this.db.prepare("select count from installs where module_id = ?").get(id) as { count: number } | undefined)?.count ?? 0;
  }

  /** Whether a key's owner may be told about reports now: at most once a day. Saying yes counts as telling. */
  takeReportNotice(owner: string, now: Date = new Date()): boolean {
    const last = this.db.prepare("select notified_at from report_notices where owner = ?").get(owner) as { notified_at: string } | undefined;
    if (last && now.getTime() - Date.parse(last.notified_at) < 86_400_000) return false;
    this.db.prepare("insert into report_notices (owner, notified_at) values (?, ?) on conflict (owner) do update set notified_at = excluded.notified_at").run(owner, now.toISOString());
    return true;
  }

  /**
   * Marks the catalog as full (an upload was refused for room) and says whether the maintainer may be
   * told now: at most once a day. Saying yes counts as telling.
   */
  markFull(now: Date = new Date()): boolean {
    const at = now.toISOString();
    this.db.prepare("insert into catalog_state (name, value) values ('full_since', ?) on conflict (name) do nothing").run(at);
    const last = this.db.prepare("select value from catalog_state where name = 'full_notified_at'").get() as { value: string } | undefined;
    if (last && now.getTime() - Date.parse(last.value) < 86_400_000) return false;
    this.db.prepare("insert into catalog_state (name, value) values ('full_notified_at', ?) on conflict (name) do update set value = excluded.value").run(at);
    return true;
  }

  /** An upload fit again: the catalog is no longer full. */
  clearFull(): void {
    this.db.exec("delete from catalog_state where name = 'full_since'");
  }

  /** Since when uploads are refused for room (ISO time), or null while there is room. */
  fullSince(): string | null {
    return (this.db.prepare("select value from catalog_state where name = 'full_since'").get() as { value: string } | undefined)?.value ?? null;
  }

  /** Open reports, most reported first, with what the maintainer needs to decide. */
  reports(): CatalogReport[] {
    return (
      this.db
        .prepare(
          `select r.sha256, r.module_id, r.owner, r.count, r.first_at, r.last_at, v.version, v.manifest, m.listed
           from reports r join versions v on v.sha256 = r.sha256 join modules m on m.id = r.module_id
           order by r.count desc, r.last_at desc`,
        )
        .all() as unknown as { sha256: string; module_id: string; owner: string; count: number; first_at: string; last_at: string; version: string; manifest: string; listed: number }[]
    ).map((row) => ({
      sha256: row.sha256,
      id: row.module_id,
      name: (JSON.parse(row.manifest) as ModuleManifest).name,
      version: row.version,
      owner: row.owner,
      count: row.count,
      firstAt: row.first_at,
      lastAt: row.last_at,
      listed: row.listed === 1,
    }));
  }

  /** Closes a report once a person has looked at it. */
  dismissReport(sha256: string): boolean {
    return Number(this.db.prepare("delete from reports where sha256 = ?").run(sha256).changes) > 0;
  }

  /** Whether any module, listed or not, has an id under this prefix. */
  hasModuleUnder(prefix: string): boolean {
    return this.db.prepare("select 1 from modules where substr(id, 1, ?) = ? limit 1").get(prefix.length + 1, `${prefix}.`) !== undefined;
  }

  /** Every module, listed or not, for the maintainer. */
  modules(): CatalogModuleRow[] {
    return (
      this.db
        .prepare(
          `select m.id, m.owner, m.listed, count(v.seq) as versions,
             (select version from versions where module_id = m.id order by seq desc limit 1) as latest
           from modules m join versions v on v.module_id = m.id group by m.id order by m.id`,
        )
        .all() as unknown as { id: string; owner: string; listed: number; versions: number; latest: string }[]
    ).map((row) => ({ ...row, listed: row.listed === 1 }));
  }

  /** Every module, listed or not, with its versions, installs and stored bytes, for the admin panel. */
  adminModules(): AdminModule[] {
    const rows = this.db.prepare("select id, owner, listed, created_at from modules order by id").all() as unknown as { id: string; owner: string; listed: number; created_at: string }[];
    const versions = this.db
      .prepare("select module_id, version, sha256, manifest, size, published_at, zip_removed from versions order by seq desc")
      .all() as unknown as { module_id: string; version: string; sha256: string; manifest: string; size: number; published_at: string; zip_removed: string | null }[];
    const installs = new Map((this.db.prepare("select module_id, count from installs").all() as unknown as { module_id: string; count: number }[]).map((row) => [row.module_id, row.count]));
    return rows.map((row) => {
      const own = versions.filter((version) => version.module_id === row.id);
      return {
        id: row.id,
        name: own[0] ? (JSON.parse(own[0].manifest) as ModuleManifest).name : row.id,
        owner: row.owner,
        listed: row.listed === 1,
        createdAt: row.created_at,
        installs: installs.get(row.id) ?? 0,
        storedBytes: own.filter((version) => version.zip_removed === null).reduce((sum, version) => sum + version.size, 0),
        versions: own.map((version) => ({ version: version.version, sha256: version.sha256, publishedAt: version.published_at, size: version.size, zipKept: version.zip_removed === null })),
      };
    });
  }

  /** The listed modules at their newest version: all, those for one game (and any game), or those for a personal workspace. */
  index(filter: CatalogFilter = {}): CatalogEntry[] {
    const entries = (this.db.prepare(`${LATEST} order by m.id`).all() as unknown as VersionSql[]).map(entryOf);
    if ("game" in filter) return entries.filter((entry) => entry.games.length === 0 || entry.games.includes(filter.game));
    if ("workspace" in filter) return entries.filter((entry) => entry.workspaces);
    return entries;
  }

  /** A listed module at its newest version, with its readme and every version's notes, newest first. */
  module(id: string): { module: CatalogEntry; versions: CatalogVersion[]; readme: string | null } | null {
    const row = this.db.prepare(`${LATEST} and m.id = ?`).get(id) as VersionSql | undefined;
    if (!row) return null;
    const readme = (this.db.prepare("select readme from versions where sha256 = ?").get(row.sha256) as { readme: string | null }).readme;
    const versions = (
      this.db.prepare("select version, published_at, notes from versions where module_id = ? and status = 'listed' order by seq desc").all(id) as unknown as {
        version: string;
        published_at: string;
        notes: string;
      }[]
    ).map((version) => ({ version: version.version, publishedAt: version.published_at, notes: JSON.parse(version.notes) as string[] }));
    return { module: entryOf(row), versions, readme };
  }

  /**
   * Stores a signed list as it is. It must be JSON and at most MAX_LIST_BYTES; its signature is the
   * app's to check, against the catalogue key the service never holds.
   */
  setList(name: SignedList, bytes: Buffer): void {
    if (bytes.length > MAX_LIST_BYTES) throw new CatalogError(`A signed list may be at most ${MAX_LIST_BYTES} bytes.`);
    try {
      JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new CatalogError("That is not JSON. Upload the file tavora-catalog-sign wrote, unchanged.");
    }
    const target = path.join(this.lists, `${name}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, target);
  }

  /** A signed list's bytes as they were stored, or null before there is one. */
  list(name: SignedList): Buffer | null {
    try {
      return readFileSync(path.join(this.lists, `${name}.json`));
    } catch {
      return null;
    }
  }

  /**
   * A picture (screenshot or icon) of a listed module's newest version by its hash and type, or null.
   * Only the newest version's pictures are handed out, and none of a delisted module.
   */
  picture(sha256: string, type: string): Buffer | null {
    if (!SHA256.test(sha256) || (type !== "png" && type !== "webp")) return null;
    const pattern = `%"${sha256}"%`;
    const listed = (this.db.prepare(`${LATEST} and (v.screenshots like ? or v.icon like ?)`).all(pattern, pattern) as unknown as VersionSql[])
      .some((row) => {
        const entry = entryOf(row);
        return [...entry.screenshots, ...(entry.icon ? [entry.icon] : [])].some((shot) => shot.sha256 === sha256 && shot.type === type);
      });
    if (!listed) return null;
    try {
      const bytes = readFileSync(path.join(this.shots, `${sha256}.${type}`));
      return createHash("sha256").update(bytes).digest("hex") === sha256 ? bytes : null;
    } catch {
      return null;
    }
  }

  /** A zip of a listed module by its hash, or null. A delisted module's zips are not handed out. */
  zip(sha256: string): Buffer | null {
    if (!SHA256.test(sha256)) return null;
    const listed = this.db.prepare("select 1 from versions v join modules m on m.id = v.module_id where v.sha256 = ? and m.listed = 1 and v.zip_removed is null and v.status = 'listed'").get(sha256);
    if (!listed) return null;
    try {
      const bytes = readFileSync(path.join(this.zips, `${sha256}.zip`));
      // Never hand out a file that is not what its name says.
      return createHash("sha256").update(bytes).digest("hex") === sha256 ? bytes : null;
    } catch {
      return null;
    }
  }
}

/** The filter a request asks for: `?game=<id>`, `?workspace=1`, or neither for the whole catalog. */
export function catalogFilter(game: string | undefined, workspace: string | undefined): CatalogFilter | null {
  if (game !== undefined && workspace !== undefined) return null;
  if (game !== undefined) return isGameId(game) ? { game } : null;
  if (workspace !== undefined) return workspace === "1" ? { workspace: true } : null;
  return {};
}
