import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isGameId, LOCAL_OWNER, manifestFiles, validateChangelog, validateManifest, type ModuleManifest } from "@tavora/module-schema";
import { MANIFEST_FILE, readZip, verifyFiles, ZIP_LIMITS, ZipError } from "@tavora/pack";

/**
 * The module catalog (Milestone E, docs/catalog-threat-model.md): community modules, each with the
 * versions that were added, and their zips stored under their SHA-256. This step is read-only for the
 * service: modules are added by hand with `scripts/catalog.ts`. Every zip is checked the way the app's
 * zip installer checks it (C1, C8) before anything is stored, and nothing in it is ever unpacked to
 * disk or run. The app still checks each zip again itself; the service is never what makes one trusted.
 */

export class CatalogError extends Error {}

/** Tavora's own modules stay bundled with the app; the catalog holds community modules only. */
const OFFICIAL_PREFIX = "tavora.";
const SHA256 = /^[0-9a-f]{64}$/;

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
  const { entries, icons } = manifestFiles(manifest);
  for (const name of [...entries, ...icons]) if (!file(name)) throw new CatalogError(`It names ${name}, which is missing.`);
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
  return { manifest, owner: verified.owner, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, notes };
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
  /** The publisher key's fingerprint. */
  owner: string;
  zip: { sha256: string; size: number };
  publishedAt: string;
  notes: string[];
}

export interface CatalogVersion {
  version: string;
  publishedAt: string;
  notes: string[];
}

export type CatalogFilter = { game: string } | { workspace: true } | Record<string, never>;

export interface CatalogModuleRow {
  id: string;
  owner: string;
  listed: boolean;
  versions: number;
  latest: string;
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
}

const LATEST = `
  select m.id as module_id, m.owner, v.version, v.sha256, v.size, v.manifest, v.notes, v.published_at
  from modules m join versions v on v.seq = (select max(seq) from versions where module_id = m.id)
  where m.listed = 1`;

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
  };
}

/**
 * The catalog's own files, in a folder of the state directory: `catalog.sqlite` with the modules and
 * their versions, and `zips/<sha256>.zip`. A module's owner is set by its first version; later versions
 * must come from the same key and be newer, so a version can never be replaced or go back.
 */
export class CatalogStore {
  private readonly db: DatabaseSync;
  private readonly zips: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.zips = path.join(dir, "zips");
    mkdirSync(this.zips, { recursive: true });
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
        published_at text not null,
        unique (module_id, version)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** Adds a checked zip as a module's newest version, and stores the zip under its hash. */
  add(bytes: Buffer, now: Date = new Date()): CheckedZip {
    const checked = checkCatalogZip(bytes);
    const { manifest, owner, sha256 } = checked;
    const module = this.db.prepare("select owner from modules where id = ?").get(manifest.id) as { owner: string } | undefined;
    if (module && module.owner !== owner) throw new CatalogError(`${manifest.id} belongs to another publisher key.`);
    const latest = this.db.prepare("select version from versions where module_id = ? order by seq desc limit 1").get(manifest.id) as { version: string } | undefined;
    if (latest && compareModuleVersions(manifest.version, latest.version) <= 0) {
      throw new CatalogError(`${manifest.id} already has ${latest.version}; a new version must be newer.`);
    }
    if (this.db.prepare("select 1 from versions where sha256 = ?").get(sha256)) throw new CatalogError("This exact zip is already in the catalog.");

    // The file first, under its hash, so a row never points at a zip that is not there.
    const target = path.join(this.zips, `${sha256}.zip`);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, target);
    const at = now.toISOString();
    this.db.exec("begin");
    try {
      if (!module) this.db.prepare("insert into modules (id, owner, created_at) values (?, ?, ?)").run(manifest.id, owner, at);
      this.db
        .prepare("insert into versions (module_id, version, sha256, size, manifest, notes, published_at) values (?, ?, ?, ?, ?, ?, ?)")
        .run(manifest.id, manifest.version, sha256, checked.size, JSON.stringify(manifest), JSON.stringify(checked.notes), at);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return checked;
  }

  /** Takes a module out of the catalog or puts it back. Its versions and zips are kept. */
  setListed(id: string, listed: boolean): boolean {
    return Number(this.db.prepare("update modules set listed = ? where id = ?").run(listed ? 1 : 0, id).changes) > 0;
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

  /** The listed modules at their newest version: all, those for one game (and any game), or those for a personal workspace. */
  index(filter: CatalogFilter = {}): CatalogEntry[] {
    const entries = (this.db.prepare(`${LATEST} order by m.id`).all() as unknown as VersionSql[]).map(entryOf);
    if ("game" in filter) return entries.filter((entry) => entry.games.length === 0 || entry.games.includes(filter.game));
    if ("workspace" in filter) return entries.filter((entry) => entry.workspaces);
    return entries;
  }

  /** A listed module at its newest version, with every version's notes, newest first. */
  module(id: string): { module: CatalogEntry; versions: CatalogVersion[] } | null {
    const row = this.db.prepare(`${LATEST} and m.id = ?`).get(id) as VersionSql | undefined;
    if (!row) return null;
    const versions = (
      this.db.prepare("select version, published_at, notes from versions where module_id = ? order by seq desc").all(id) as unknown as {
        version: string;
        published_at: string;
        notes: string;
      }[]
    ).map((version) => ({ version: version.version, publishedAt: version.published_at, notes: JSON.parse(version.notes) as string[] }));
    return { module: entryOf(row), versions };
  }

  /** A zip of a listed module by its hash, or null. A delisted module's zips are not handed out. */
  zip(sha256: string): Buffer | null {
    if (!SHA256.test(sha256)) return null;
    const listed = this.db.prepare("select 1 from versions v join modules m on m.id = v.module_id where v.sha256 = ? and m.listed = 1").get(sha256);
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
