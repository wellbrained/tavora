// Tavora's own modules (`tavora.*`, shipped in the app) can update from the catalogue without an app release.
// A downloaded copy lives in `<userData>/official-updates/<id>` and runs only while every check passes:
// it is signed by the pinned Tavora publisher key (or a successor in the pinned account), nothing on it
// is blocked or revoked, and it is newer than the shipped copy. Anything else falls back to the shipped
// copy, which always stays in the app. With the pins empty (how they ship until Tavora turns this on)
// none of this runs and nothing is read or written.
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { isModuleId, isOfficialSigner, OFFICIAL_PINS, officialOn, type OfficialPins } from "@tavora/module-schema";
import type { SavedRecord } from "./json";
import { FolderChecks, type Verified } from "./module-folder-check";
import { SAVED_FILES, SavedFile } from "./saved-file";
import type { SafetyCheck } from "./safety-lists";
import { compareModuleVersions } from "../shared/module-version";

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
  /** The hash of what its signature covers (signedHash), which a block can name too; records from before have none. */
  signedSha256?: string;
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

const officialFile = (userData: string) => new SavedFile(path.join(userData, OFFICIAL_UPDATES_FILE), SAVED_FILES[OFFICIAL_UPDATES_FILE]);

export async function readOfficialRecords(userData: string): Promise<OfficialRecords> {
  // An unreadable file is set aside (kept, never written over) before the records start again.
  return parseOfficialRecords(await officialFile(userData).read());
}

function parseOfficialRecords(parsed: SavedRecord | null): OfficialRecords {
  const records: OfficialRecords = {};
  const modules = parsed?.modules;
  if (typeof modules !== "object" || modules === null) return records;
  for (const [id, value] of Object.entries(modules)) {
    const { version, sha256, signedSha256, signer, highWater } = (value ?? {}) as Record<string, unknown>;
    if (!isModuleId(id) || !isVersion(version) || typeof sha256 !== "string" || !SHA256.test(sha256) || typeof signer !== "string" || !isVersion(highWater)) continue;
    records[id] = { id, version, sha256, ...(typeof signedSha256 === "string" && SHA256.test(signedSha256) ? { signedSha256 } : {}), signer, highWater: compareModuleVersions(highWater, version) >= 0 ? highWater : version };
  }
  return records;
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
  private readonly checks = new FolderChecks();
  /** Ids being installed right now: cleanup leaves their folder alone until the record is saved. */
  private readonly installing = new Set<string>();

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

  /**
   * Whether a key may sign new Tavora modules at all, before there is a zip: on the pinned chain and not revoked. A
   * revoked key fails even when some of its old zips are still allowed, since nothing new may be signed with it.
   */
  keyTrusted(signer: string): boolean {
    const { safety, pins } = this.options;
    return isOfficialSigner(safety.firstKeyChain(signer), safety.revoked(signer, ""), pins);
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
    // Read and written in one turn of the file, so two saves at once cannot drop a record and its high-water mark.
    return officialFile(this.options.userData).update((saved) => this.merge(parseOfficialRecords(saved), entry));
  }

  private merge(records: OfficialRecords, entry: Omit<OfficialRecord, "highWater">): { modules: OfficialRecords } {
    // The highest seen, on disk or in memory, for every module: a file set aside since this run read it never lowers one.
    const higher = (...seen: (string | undefined)[]) => seen.reduce<string | undefined>((high, one) => (one && (!high || compareModuleVersions(one, high) > 0) ? one : high), undefined);
    const merged = { ...this.records, ...records };
    for (const id of Object.keys(merged)) {
      const highWater = higher(records[id]?.highWater, this.records[id]?.highWater);
      if (highWater) merged[id] = { ...merged[id]!, highWater };
    }
    merged[entry.id] = { ...entry, highWater: higher(entry.version, records[entry.id]?.highWater, this.records[entry.id]?.highWater)! };
    this.records = merged;
    return { modules: this.records };
  }

  /**
   * Whether the downloaded copy in `dir` may run as `id`: the host recorded it, its files are exactly what the
   * signature covers, the signer is the recorded one and a trusted Tavora key, and the zip is not blocked or revoked.
   * Any failure means the shipped copy runs instead.
   */
  async trusted(id: string, dir: string): Promise<boolean> {
    if (!this.on) return false;
    const record = this.records[id];
    if (!record || record.id !== id || compareModuleVersions(record.version, record.highWater) < 0 || this.options.safety.blocked(record.sha256, record.signedSha256) || !this.signerTrusted(record.signer, record.sha256)) return false;
    const verified = await this.verify(dir);
    // The files on disk say what the signature covers, also for a record from before signedSha256.
    return verified !== null && verified.id === id && verified.version === record.version && verified.signer === record.signer && this.options.safety.blocked(record.sha256, verified.signedSha256) === null;
  }

  /** Reads and checks a folder's files, unless it looks as it did when it was last checked. */
  private verify(dir: string): Promise<Verified | null> {
    return this.checks.check(dir);
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
        this.options.safety.blocked(record.sha256, record.signedSha256) !== null ||
        !this.signerTrusted(record.signer, record.sha256);
      if (!useless) continue;
      await rm(path.join(this.dir, entry.name), { recursive: true, force: true }).catch(() => undefined);
      removed.push(entry.name);
    }
    return removed;
  }
}
