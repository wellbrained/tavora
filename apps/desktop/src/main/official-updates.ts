// Tavora's own modules (`tavora.*`, shipped in the app) can update from the catalogue without an app release.
// A downloaded copy lives in `<userData>/official-updates/<id>` and runs only while every check passes:
// it is signed by the pinned Tavora publisher key (or a successor in the pinned account), nothing on it
// is blocked or revoked, and it is newer than the shipped copy. Anything else falls back to the shipped
// copy, which always stays in the app. With the pins empty (how they ship until Tavora turns this on)
// none of this runs and nothing is read or written.
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { isModuleId, isOfficialSigner, OFFICIAL_PINS, officialOn, validateManifest, type OfficialPins } from "@tavora/module-schema";
import { MANIFEST_FILE, verifyFiles, ZIP_LIMITS, type ZipFile } from "@tavora/pack";
import { compareModuleVersions } from "../shared/module-version";
import { writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside } from "./json";
import type { SafetyCheck } from "./safety-lists";

export const OFFICIAL_UPDATES_DIR = "official-updates";
export const OFFICIAL_UPDATES_FILE = "official-updates.json";

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * What the installer recorded about a downloaded copy, kept by the host outside the module's folder.
 * `highWater` is the newest version ever installed for the id: it only goes up, so an older signed zip can
 * never be put back, even after the copy was removed.
 */
export interface OfficialRecord {
  id: string;
  version: string;
  /** The zip's hash, so a blocked zip can be stopped. */
  sha256: string;
  /** The key that signed it. */
  signer: string;
  highWater: string;
}

export type OfficialRecords = Record<string, OfficialRecord>;

/**
 * The pins that count. Packaged builds use the ones built in; a development run uses none unless a test names
 * them in TAVORA_OFFICIAL_PINS (`<key>:<account>`), so a developer's environment can never switch it on for users.
 */
export function resolveOfficialPins(packaged: boolean, env: Record<string, string | undefined> = process.env): OfficialPins {
  if (packaged) return { ...OFFICIAL_PINS };
  const [key = "", account = ""] = env.TAVORA_OFFICIAL_PINS?.split(":") ?? [];
  return { key, account };
}

/** Whether a version string is something the records may hold. */
const isVersion = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);

export async function readOfficialRecords(userData: string): Promise<OfficialRecords> {
  const parsed = await readJsonOrSetAside<{ modules?: unknown }>(path.join(userData, OFFICIAL_UPDATES_FILE));
  const records: OfficialRecords = {};
  const modules = parsed?.modules;
  if (typeof modules !== "object" || modules === null) return records;
  for (const [id, value] of Object.entries(modules)) {
    const { version, sha256, signer, highWater } = (value ?? {}) as Record<string, unknown>;
    if (!isModuleId(id) || !isVersion(version) || typeof sha256 !== "string" || !SHA256.test(sha256) || typeof signer !== "string" || !isVersion(highWater)) continue;
    records[id] = { id, version, sha256, signer, highWater: compareModuleVersions(highWater, version) >= 0 ? highWater : version };
  }
  return records;
}

/** What the folder holds: its files (when read) and a stamp that changes when any of them does. */
interface FolderRead {
  files: ZipFile[];
  stamp: string;
}

/**
 * Walks a downloaded copy's folder. Null when it holds a link or odd file (never part of a signed package) or more than a
 * module may. With `read` off no file is opened: only the stamp is made, to see whether the folder changed since it was checked.
 */
async function readFolder(root: string, read: boolean): Promise<FolderRead | null> {
  const files: ZipFile[] = [];
  const stamp: string[] = [];
  let total = 0;
  const walk = async (dir: string, prefix: string): Promise<boolean> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const info = await lstat(full);
      const name = `${prefix}${entry.name}`;
      if (info.isDirectory()) {
        if (!(await walk(full, `${name}/`))) return false;
        continue;
      }
      if (!info.isFile()) return false;
      total += info.size;
      if (stamp.length >= ZIP_LIMITS.maxFiles || total > ZIP_LIMITS.maxUnpackedBytes) return false;
      stamp.push(`${name}\0${info.size}\0${info.mtimeMs}`);
      if (read) files.push({ name, data: await readFile(full) });
    }
    return true;
  };
  try {
    return (await walk(root, "")) ? { files, stamp: stamp.sort().join("\n") } : null;
  } catch {
    return null;
  }
}

/** What the signature check found in a folder. */
interface Verified {
  signer: string;
  id: string;
  version: string;
}

export type OfficialSafety = Pick<SafetyCheck, "blocked" | "revoked"> & {
  /** The first key and account of a key's chain of successions (SafetyLists.firstKeyChain). */
  firstKeyChain(fingerprint: string): { key: string; account: string | null };
};

export interface OfficialUpdatesOptions {
  userData: string;
  pins: OfficialPins;
  safety: OfficialSafety;
}

export class OfficialUpdates {
  private records: OfficialRecords = {};
  /** Folders checked before, by what they held: a folder that did not change is not read and hashed again. */
  private readonly checked = new Map<string, { stamp: string; verified: Verified | null }>();
  /** Ids being installed right now: cleanup leaves their folder alone until the record is saved. */
  private readonly installing = new Set<string>();
  /** Saves run one after another, so two at once cannot drop a record and its high-water mark. */
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly options: OfficialUpdatesOptions) {}

  /** Whether downloaded copies may run at all: both pins are set. */
  get on(): boolean {
    return officialOn(this.options.pins);
  }

  get dir(): string {
    return path.join(this.options.userData, OFFICIAL_UPDATES_DIR);
  }

  /** Reads the records. Without pins nothing is read. */
  async load(): Promise<void> {
    this.records = this.on ? await readOfficialRecords(this.options.userData) : {};
  }

  record(id: string): OfficialRecord | undefined {
    return this.records[id];
  }

  /** The newest version ever installed for an id, even when its copy is gone. */
  highWater(id: string): string | undefined {
    return this.records[id]?.highWater;
  }

  /** Whether a signer may sign Tavora's own modules (the rule shared with the catalogue service, module-schema). */
  signerTrusted(signer: string, sha256: string): boolean {
    const { safety, pins } = this.options;
    return isOfficialSigner(safety.firstKeyChain(signer), safety.revoked(signer, sha256), pins);
  }

  /** Runs an install of `id`; cleanup skips its folder meanwhile. */
  async install<T>(id: string, run: () => Promise<T>): Promise<T> {
    this.installing.add(id);
    try {
      return await run();
    } finally {
      this.installing.delete(id);
    }
  }

  /** Records a copy that was just put in place; the high-water mark only goes up. */
  save(entry: Omit<OfficialRecord, "highWater">): Promise<void> {
    const next = this.saving.then(() => this.write(entry));
    this.saving = next.catch(() => undefined);
    return next;
  }

  private async write(entry: Omit<OfficialRecord, "highWater">): Promise<void> {
    const records = await readOfficialRecords(this.options.userData);
    const before = records[entry.id];
    const highWater = before && compareModuleVersions(before.highWater, entry.version) > 0 ? before.highWater : entry.version;
    this.records = { ...records, [entry.id]: { ...entry, highWater } };
    await writeFileAtomic(path.join(this.options.userData, OFFICIAL_UPDATES_FILE), `${JSON.stringify({ version: 1, modules: this.records }, null, 2)}\n`);
  }

  /**
   * Whether the downloaded copy in `dir` may run as `id`: the host recorded it, its files are exactly what the
   * signature covers, the signer is the recorded one and a trusted Tavora key, and the zip is not blocked or revoked.
   * Any failure means the shipped copy runs instead.
   */
  async trusted(id: string, dir: string): Promise<boolean> {
    if (!this.on) return false;
    const record = this.records[id];
    if (!record || record.id !== id || compareModuleVersions(record.version, record.highWater) < 0 || this.options.safety.blocked(record.sha256) || !this.signerTrusted(record.signer, record.sha256)) return false;
    const verified = await this.verify(dir);
    return verified !== null && verified.id === id && verified.version === record.version && verified.signer === record.signer;
  }

  /** Reads and checks a folder's files, unless it looks as it did when it was last checked. */
  private async verify(dir: string): Promise<Verified | null> {
    const seen = await readFolder(dir, false);
    if (seen === null) {
      this.checked.delete(dir);
      return null;
    }
    const cached = this.checked.get(dir);
    if (cached?.stamp === seen.stamp) return cached.verified;
    const read = await readFolder(dir, true);
    // What was read is what is checked; a folder that changed between the two is checked again next time.
    const verified = read ? verifyFolder(read.files) : null;
    if (read) this.checked.set(dir, { stamp: read.stamp, verified });
    return verified;
  }

  /**
   * Removes downloaded copies that are of no use any more: the shipped copy is equal or newer, the id is no
   * longer shipped, or the zip is blocked or its signer no longer trusted. The records stay, so the high-water
   * mark does. `shipped` maps each shipped id to its version; `unsure` are ids whose shipped copy is there but could
   * not load right now, which are not "gone". Never goes through the module lifecycle: no grant is revoked.
   */
  async cleanup(shipped: ReadonlyMap<string, string>, unsure: ReadonlySet<string> = new Set()): Promise<string[]> {
    if (!this.on) return [];
    const removed: string[] = [];
    for (const entry of await readdir(this.dir, { withFileTypes: true }).catch(() => [])) {
      if (this.installing.has(entry.name)) continue;
      const record = this.records[entry.name];
      const version = shipped.get(entry.name);
      const gone = version === undefined && !unsure.has(entry.name);
      const useless =
        !isModuleId(entry.name) ||
        !record ||
        gone ||
        (version !== undefined && compareModuleVersions(version, record.version) >= 0) ||
        this.options.safety.blocked(record.sha256) !== null ||
        !this.signerTrusted(record.signer, record.sha256);
      if (!useless) continue;
      await rm(path.join(this.dir, entry.name), { recursive: true, force: true }).catch(() => undefined);
      this.checked.delete(path.join(this.dir, entry.name));
      removed.push(entry.name);
    }
    return removed;
  }
}

/** The signer, id and version of a folder whose files are exactly what its signature covers; null otherwise. */
function verifyFolder(files: readonly ZipFile[]): Verified | null {
  const verified = verifyFiles(files);
  if (!verified.ok || !verified.signed) return null;
  const manifest = files.find((file) => file.name === MANIFEST_FILE);
  if (!manifest) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(manifest.data.toString("utf8"));
  } catch {
    return null;
  }
  const result = validateManifest(raw);
  return result.ok ? { signer: verified.owner, id: result.manifest.id, version: result.manifest.version } : null;
}
