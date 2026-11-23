import { randomInt } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, open, rm, rmdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { CopyError, PART_BYTES, type CopyStorage, type ManifestCheck, type RemoteCopy, type SwapAnswer } from "./cloud-copy";
import { readCopyFile, writeCopyFile } from "./copy-files";
import { look, lookNames, lookStat, type Looked } from "./file-look";
import { PART_ID_BYTES, SEAL_OVERHEAD } from "./copy-crypto";
import { writeFileAtomic } from "./fsutil";

// The cloud copy in a folder the user picks (decided 2026-10-20): usually one their
// OneDrive, Dropbox or Google Drive app syncs, or a NAS or USB stick. Tavora writes the
// same sealed parts and manifests the service would keep; the user's own sync app moves
// them. Nothing goes to Tavora's service and no account is needed.
//
// A sync app is slow and has no version check, so:
// - Every manifest is its own file, named by its version and the version it was saved on
//   top of. Versions count up in the high bits and are random in the low ones, so two PCs
//   saving at once get different versions, and every PC agrees which one is newer. The names
//   only order the manifests and point to them.
// - A PC whose last save lost against another PC's (it is not in the newest version's
//   line, sealed inside that manifest) is told, so the user keeps one side instead of
//   losing that save.
// - Parts that are missing may still be on their way, not lost.
// - Only names Tavora writes are read: "file (1)" copies a sync app makes are left alone.
// - Old manifests and parts no manifest uses are cleaned up after a while, so a PC still
//   catching up finds what it needs. `pairing/` is kept free for approving new PCs.
//
// Anyone who can write the folder (another app, a PC, whoever it is shared with) can't read
// the copy, but can make it fail. Nothing more: what Tavora deletes it learns from inside
// the seal, never from a file's name or header; it reads no file bigger than the format
// allows; and it follows no link or junction in its folder.

/** The folder Tavora makes inside the one the user picks. */
export const FOLDER_NAME = "Tavora";
/** Low bits of a version that are random; the rest counts up. */
const RANDOM_BITS = 2 ** 20;
/** Manifests always kept, newest first, however old: marked ones (Tavora's own, checked with the key) count. */
const KEEP_MANIFESTS = 5;
/** Older manifests are kept this long, so a PC that was away can still tell whether it was left behind. */
const KEEP_MANIFEST_MS = 30 * 24 * 60 * 60_000;
/**
 * Parts no manifest uses are kept this long after this PC first saw them unused, by its own clock: another PC's manifest
 * may still be on its way (a PC that was away gets parts before their manifests). Never by a part's file time, which is
 * the writing PC's and which a sync app keeps.
 */
const KEEP_PART_MS = 7 * 24 * 60 * 60_000;
/**
 * A part used again that was written longer ago than this is written again, not only touched: Dropbox (and likely Google
 * Drive) don't sync a new time alone, and another PC's clean-up goes by the time it sees.
 */
const REWRITE_PART_MS = 24 * 60 * 60_000;
/**
 * The highest version a manifest's name may say. Versions count up by 2^20 a save, so no copy gets near it; one above it
 * was put there, and a save on top of it would get a version no PC can count with (above 2^53): it is junk.
 */
const MAX_VERSION = 2 ** 52;
/**
 * No copy gets this high (2^28 saves): above it are only lists put there, and saves on top of them. A save on top of such a
 * list this PC's key doesn't open doesn't climb on it, as it could be planted just below MAX_VERSION with no room above
 * (makeRoom): the save goes where this PC was before it kept its side over it.
 */
const SANE_VERSION = 2 ** 48;
/** About this much of parts goes back from one read. */
const READ_BYTES = 8 * 1024 * 1024;
/** The most a part file holds: a part, sealed. */
export const MAX_PART_FILE = PART_BYTES + SEAL_OVERHEAD;
/** The most a manifest file holds. A folder's copy has no size limit, but its list of files does: this is far more than any. */
export const MAX_MANIFEST_FILE = 64 * 1024 * 1024;

const MANIFEST_NAME = /^(\d{16})-(\d{16})\.bin$/;
const PART_NAME = /^[0-9a-f]{64}$/;
/** A sync app's copy of a part ("… (1)", "… (Desk's conflicted copy …)", "…-DESK"), or a temp file a write left behind. */
const PART_COPY_NAME = /^[0-9a-f]{64}[^0-9a-f]/;
const SHARD_NAME = /^[0-9a-f]{2}$/;
/**
 * A manifest file: "TVC1", the copy's size (8 bytes), the part count (4 bytes), the part ids, the sealed manifest. The
 * size and ids are outside the seal: an older Tavora reads them, this one checks the ids against the sealed list.
 */
const MAGIC = Buffer.from("TVC1");
const HEADER_BYTES = MAGIC.length + 8 + 4;

interface ManifestFile {
  version: number;
  base: number;
  name: string;
}

const pad = (value: number) => String(value).padStart(16, "0");

/**
 * What a read of the folder found. One that is held (a sync app busy with the file) is a problem with the folder, shown
 * in Settings and tried again: it says nothing about this PC's data, so it never holds it.
 */
function readable<T>(looked: Looked<T>): T | null {
  if (looked.status === "held") throw new CopyError("folder-locked", "something in the cloud copy folder can't be read right now");
  return looked.status === "present" ? looked.value : null;
}

/**
 * What is at a path, without following a link. A link or junction is "other": it may lead out of the folder. lstat, not
 * readdir's file types: on Windows those call every reparse point a link, also a OneDrive file that is online only.
 */
const lookKind = (target: string): Promise<Looked<"dir" | "file" | "other">> =>
  look(async () => {
    const info = await lstat(target);
    return info.isSymbolicLink() ? "other" : info.isDirectory() ? "dir" : info.isFile() ? "file" : "other";
  });

/** A file's own info, or null when it is a link or anything else than a file. */
const lookOwnFile = (target: string): Promise<Looked<Stats | null>> =>
  look(async () => {
    const info = await lstat(target);
    return info.isFile() ? info : null;
  });

/**
 * A file of the copy, read only when it is a file (not a link) of at most `max` bytes: "other" or "too-big" otherwise.
 * Nothing bigger is read in, also when it grows or is swapped for another while being read.
 */
const lookCapped = (file: string, max: number): Promise<Looked<Buffer | "other" | "too-big">> =>
  look(async () => {
    const info = await lstat(file);
    if (!info.isFile()) return "other";
    if (info.size > max) return "too-big";
    const handle = await open(file, "r");
    try {
      const opened = await handle.stat();
      if (opened.ino !== info.ino || opened.dev !== info.dev) return "other";
      if (opened.size > max) return "too-big";
      const buffer = Buffer.alloc(opened.size);
      let at = 0;
      while (at < buffer.length) {
        const { bytesRead } = await handle.read(buffer, at, buffer.length - at, at);
        if (bytesRead === 0) break;
        at += bytesRead;
      }
      return buffer.subarray(0, at);
    } finally {
      await handle.close();
    }
  });

/** The same ids, in any order. */
function sameIds(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}

export interface FolderStorageOptions {
  now?: () => number;
  /**
   * Where this PC notes when it first saw each part no manifest uses (CopySync: in its data folder, never in the copy's
   * folder). In memory only without it.
   */
  unusedFile?: string;
}

/**
 * What `unusedFile` holds: for the folder it is about, how long this PC has seen each part (or sync app copy) unused, and
 * when it last looked. Each look adds the time since the one before, at most three days: a clock that jumps ahead can't
 * make a part old at once, nor one set back keep it longer.
 */
interface UnusedRecord {
  v: 1;
  folder: string;
  last: number;
  waited: Record<string, number>;
}

export interface Unused {
  last: number | null;
  waited: Map<string, number>;
}

/**
 * When this PC first saw each part in `folder` unused, as noted in `file`; none when it is about another folder, or can't
 * be read (copy-files.ts: a damaged one is set aside, and one that can't be read right now isn't written over).
 */
export async function readUnused(file: string, folder: string): Promise<Unused> {
  const found: Unused = { last: null, waited: new Map() };
  try {
    const saved = ((await readCopyFile(file, "unused")) ?? {}) as Partial<UnusedRecord>;
    if (saved.v === 1 && saved.folder === folder && typeof saved.last === "number" && typeof saved.waited === "object" && saved.waited !== null) {
      found.last = saved.last;
      for (const [key, time] of Object.entries(saved.waited)) if (typeof time === "number" && Number.isFinite(time) && time >= 0) found.waited.set(key, time);
    }
  } catch {
    // Can't be read right now: every part counts from now, and the file isn't written over.
  }
  return found;
}

/** The most one look adds to how long a part has waited: a PC that saves every few days still gets there in a week or so. */
const COUNT_AT_MOST_MS = 3 * 24 * 60 * 60_000;

export class FolderStorage implements CopyStorage {
  readonly limit = null;
  readonly arrivesLate = true;
  private readonly root: string;
  /** How long each part has waited unused, as this PC counted it (`unusedFile`), loaded at the first clean-up. */
  private unused: Unused | null = null;

  /** `folder` is the one the user picked; the copy goes in a "Tavora" folder inside it. */
  constructor(
    readonly folder: string,
    private readonly options: FolderStorageOptions = {},
  ) {
    this.root = path.join(folder, FOLDER_NAME);
  }

  private get manifestsDir() {
    return path.join(this.root, "manifests");
  }
  private get partsDir() {
    return path.join(this.root, "parts");
  }
  private partFile(id: string) {
    return path.join(this.partsDir, id.slice(0, 2), id);
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }

  /** The picked folder must be there: an unplugged drive or a folder renamed away is not "no copy". */
  private async reachable(): Promise<void> {
    const info = readable(await lookStat(this.folder));
    if (!info?.isDirectory()) throw new CopyError("no-folder", "the cloud copy folder is not there");
  }

  /**
   * Whether the copy's folders from "Tavora" down to `dir` are all folders, none a link or junction ("other"), or one of
   * them isn't there yet. The picked folder itself may be a link: the user chose it.
   */
  private async kindOf(dir: string): Promise<"dir" | "missing" | "other"> {
    let at = this.root;
    for (const segment of ["", ...path.relative(this.root, dir).split(path.sep).filter(Boolean)]) {
      at = segment ? path.join(at, segment) : at;
      const kind = readable(await lookKind(at));
      if (kind === null) return "missing";
      if (kind !== "dir") return "other";
    }
    return "dir";
  }

  /** Throws when a folder the copy is written into is a link or junction: Tavora writes only in its own folder. */
  private async writableDir(dir: string): Promise<void> {
    if ((await this.kindOf(dir)) === "other") throw new CopyError("folder-locked", "the cloud copy folder holds a link where Tavora keeps its files");
  }

  /** The manifests, newest first. */
  private async manifests(): Promise<ManifestFile[]> {
    await this.reachable();
    // Only a folder that isn't there means no copy. One that is held says nothing about the copy, and "no copy" would
    // turn it off on this PC. A link in its place leads somewhere else: not read, and not "no copy" either.
    const kind = await this.kindOf(this.manifestsDir);
    if (kind === "other") throw new CopyError("folder-locked", "the cloud copy folder holds a link where Tavora keeps its files");
    const names = kind === "dir" ? (readable(await lookNames(this.manifestsDir)) ?? []) : [];
    const found: ManifestFile[] = [];
    for (const name of names) {
      const match = MANIFEST_NAME.exec(name);
      if (!match) continue;
      const version = Number(match[1]);
      const base = Number(match[2]);
      if (!Number.isSafeInteger(version) || version <= 0 || version > MAX_VERSION || base >= version) continue;
      // A link with a manifest's name is not read.
      if (readable(await lookKind(path.join(this.manifestsDir, name))) !== "file") continue;
      found.push({ version, base, name });
    }
    return found.sort((a, b) => b.version - a.version);
  }

  private async readManifest(file: ManifestFile): Promise<{ size: number; ids: string[]; sealed: Uint8Array }> {
    const body = readable(await lookCapped(path.join(this.manifestsDir, file.name), MAX_MANIFEST_FILE));
    if (body === null || body === "other") throw new CopyError("failed", "a manifest in the folder went away");
    if (body === "too-big") throw new CopyError("damaged", "a manifest in the folder is bigger than any can be");
    if (body.length < HEADER_BYTES || !body.subarray(0, MAGIC.length).equals(MAGIC)) throw new CopyError("damaged", "a manifest in the folder is off");
    const size = Number(body.readBigUInt64BE(MAGIC.length));
    const count = body.readUInt32BE(MAGIC.length + 8);
    const start = HEADER_BYTES + count * PART_ID_BYTES;
    if (body.length <= start) throw new CopyError("damaged", "a manifest in the folder is off");
    const ids: string[] = [];
    for (let index = 0; index < count; index++) ids.push(body.subarray(HEADER_BYTES + index * PART_ID_BYTES, HEADER_BYTES + (index + 1) * PART_ID_BYTES).toString("hex"));
    return { size, ids, sealed: body.subarray(start) };
  }

  async remote(): Promise<RemoteCopy | null> {
    const all = await this.manifests();
    const current = all[0];
    if (!current) return null;
    const info = readable(await lookOwnFile(path.join(this.manifestsDir, current.name)));
    if (!info) throw new CopyError("failed", "a manifest in the folder went away");
    // One that isn't a manifest at all (junk, or bigger than any) still is the newest: the copy can't be opened, and the
    // user is asked (CloudCopy.download), rather than the folder failing for good.
    const read = await this.readManifest(current).catch((error: unknown) => {
      if (error instanceof CopyError && error.reason === "damaged") return { size: 0 };
      throw error;
    });
    return { version: current.version, size: read.size, updatedAt: info.mtime.toISOString() };
  }

  async manifest(known = 0): Promise<{ version: number; base: number; sealed: Uint8Array; follows: boolean } | null> {
    const all = await this.manifests();
    const current = all[0];
    if (!current) return null;
    // Not a manifest at all: nothing that opens (CloudCopy.download says what then).
    const read = await this.readManifest(current).catch((error: unknown) => {
      if (error instanceof CopyError && error.reason === "damaged") return { sealed: new Uint8Array(0) };
      throw error;
    });
    return { version: current.version, base: current.base, sealed: read.sealed, follows: follows(all, known) };
  }

  async *lists(): AsyncGenerator<{ version: number; read: () => Promise<Uint8Array | null> }> {
    for (const file of await this.manifests()) yield { version: file.version, read: () => this.readManifest(file).then((read) => read.sealed, () => null) };
  }

  async *earlierManifests(): AsyncGenerator<Uint8Array> {
    for (const file of (await this.manifests()).slice(1)) {
      const read = await this.readManifest(file).catch(() => null);
      if (read) yield read.sealed;
    }
  }

  async putParts(parts: { id: Buffer; data: Buffer }[]): Promise<void> {
    await this.reachable();
    const checked = new Set<string>();
    for (const part of parts) {
      const file = this.partFile(part.id.toString("hex"));
      const shard = path.dirname(file);
      if (!checked.has(shard)) {
        await this.writableDir(shard);
        checked.add(shard);
      }
      // Named by content: one that is there already holds the same. It counts as new again, so another PC's clean-up,
      // which may not have this PC's manifest yet, doesn't take it as one no manifest uses. One written over a day ago
      // is written again (the same content, sealed anew), so every sync app brings the new time; a failure is no harm.
      const there = readable(await lookOwnFile(file));
      if (there) {
        if (this.now() - there.mtimeMs >= REWRITE_PART_MS) await writeInFolder(file, part.data).catch(() => undefined);
        await utimes(file, new Date(this.now()), new Date(this.now())).catch(() => undefined);
        continue;
      }
      // A link or anything else with a part's name: left alone, and the part not written through it.
      if (readable(await lookKind(file)) !== null) continue;
      await writeInFolder(file, part.data);
    }
  }

  async missingParts(ids: string[]): Promise<string[]> {
    await this.reachable();
    const missing: string[] = [];
    for (const id of ids) {
      if (!PART_NAME.test(id)) continue;
      const there = (await this.kindOf(path.dirname(this.partFile(id)))) === "dir" && readable(await lookOwnFile(this.partFile(id)));
      if (!there) missing.push(id);
    }
    return missing;
  }

  async getParts(ids: string[]): Promise<{ id: string; data: Uint8Array }[]> {
    await this.reachable();
    const found: { id: string; data: Uint8Array }[] = [];
    const shards = new Map<string, boolean>();
    let total = 0;
    for (const id of ids) {
      if (!PART_NAME.test(id)) continue;
      const file = this.partFile(id);
      const shard = path.dirname(file);
      if (!shards.has(shard)) shards.set(shard, (await this.kindOf(shard)) === "dir");
      // Under a link, or a link itself: not one of the copy's parts.
      if (!shards.get(shard)) continue;
      const data = readable(await lookCapped(file, MAX_PART_FILE));
      if (data === null || data === "other") continue;
      if (data === "too-big") throw new CopyError("damaged", "a part in the folder is bigger than any can be");
      found.push({ id, data });
      total += data.length;
      if (total >= READ_BYTES) break;
    }
    return found;
  }

  /**
   * The version to save on top of instead of `base`, or null when this PC has to be asked first ("conflict"). Only for a
   * `base` above SANE_VERSION that `check` doesn't open: a list put there, which the user kept this PC's side over. It may
   * be numbered just below MAX_VERSION, with no room for any save above it, so the save doesn't climb on it. Every list
   * above SANE_VERSION that was read and doesn't open with the key goes (never one by its name alone, nor one that can't
   * be read right now); when the newest left is `followed`, the version this PC had before it kept its side over it, the
   * save goes on top of that. Anything else there (another PC saved meanwhile) is for the user to choose.
   */
  async makeRoom(base: number, followed: number | undefined, check: ManifestCheck): Promise<number | null> {
    // Only when this PC kept its side over that list does it know why a list goes: otherwise (a start over, an older
    // Tavora's state) nothing is removed. The save goes on top as ever, while there is room above it: with none (a list
    // put there just below MAX_VERSION), no save could be read, and the user is asked instead.
    if (base <= SANE_VERSION) return base;
    if (followed === undefined) return (Math.floor(base / RANDOM_BITS) + 2) * RANDOM_BITS - 1 <= MAX_VERSION ? base : null;
    const all = await this.manifests();
    /** "yes" opens with the key; "no" was read and doesn't; "unknown" can't be read right now. */
    const opens = async (file: ManifestFile): Promise<"yes" | "no" | "unknown"> => {
      try {
        return check((await this.readManifest(file)).sealed) ? "yes" : "no";
      } catch (error) {
        return error instanceof CopyError && error.reason === "damaged" ? "no" : "unknown";
      }
    };
    const at = all.find((file) => file.version === base);
    // This PC's own line up there (it took a copy there, or saved on top of a list below SANE_VERSION): it climbs on.
    if (at && (await opens(at)) !== "no") return base;
    for (const file of all) if (file.version > SANE_VERSION && (await opens(file)) === "no") await rm(path.join(this.manifestsDir, file.name), { force: true });
    const newest = (await this.manifests())[0]?.version ?? 0;
    return newest === followed ? followed : null;
  }

  nextVersion(base: number): number {
    return (Math.floor(base / RANDOM_BITS) + 1) * RANDOM_BITS + randomInt(RANDOM_BITS);
  }

  async swap(base: number, picked: number | null, ids: string[], sealed: Uint8Array, check?: ManifestCheck): Promise<SwapAnswer> {
    const version = picked ?? this.nextVersion(base);
    const all = await this.manifests();
    const current = all[0]?.version ?? 0;
    if (current !== base) return { status: "conflict", version: current };
    let size = sealed.length;
    for (const id of ids) {
      const info = PART_NAME.test(id) && (await this.kindOf(path.dirname(this.partFile(id)))) === "dir" ? readable(await lookOwnFile(this.partFile(id))) : null;
      if (!info) return { status: "missing-parts" };
      size += info.size;
    }
    const length = HEADER_BYTES + ids.length * PART_ID_BYTES + sealed.length;
    // Not written when no Tavora would read it.
    if (length > MAX_MANIFEST_FILE) return { status: "too-big", size };
    const body = Buffer.alloc(length);
    MAGIC.copy(body, 0);
    body.writeBigUInt64BE(BigInt(size), MAGIC.length);
    body.writeUInt32BE(ids.length, MAGIC.length + 8);
    ids.forEach((id, index) => Buffer.from(id, "hex").copy(body, HEADER_BYTES + index * PART_ID_BYTES));
    Buffer.from(sealed).copy(body, HEADER_BYTES + ids.length * PART_ID_BYTES);
    await this.writableDir(this.manifestsDir);
    await writeInFolder(path.join(this.manifestsDir, `${pad(version)}-${pad(base)}.bin`), body);
    // Without the key nothing is known for sure, so nothing is deleted.
    if (check) await this.cleanUp(check).catch(() => undefined);
    // Saved only when it is there to be read: one no PC reads would leave the copy where it was. One held right now (a
    // sync app or a virus scan busy with it) is there.
    const saved = (await this.manifests()).find((file) => file.version === version);
    if (!saved) throw new CopyError("failed", "the saved manifest isn't in the folder");
    await this.readManifest(saved).catch((error: unknown) => {
      if (!(error instanceof CopyError && error.reason === "folder-locked")) throw error;
    });
    return { status: "saved", version, size };
  }

  /**
   * Drops old manifests, then parts no manifest left uses, once both are old enough. It goes by what each manifest says
   * inside its seal (`check`), never by its name or header alone.
   * - A manifest goes only with five newer marked ones (Tavora's own: none can be made without the key) and once it is a
   *   month old. One without a mark (an older Tavora's, or a part put there) never counts for those five, but its parts
   *   are kept while it is.
   * - One that was read and can't be checked (junk, sealed with another key, or saying something else than its name or
   *   header) stops it while it is among those kept: nothing is deleted this time. Past them it goes. One numbered above
   *   every real one blocks every save, until the user keeps this PC's side over it (CopySync.keep): below 2^48 the save
   *   goes on top and it sinks; above, the save doesn't climb on it, and it is removed (makeRoom).
   * - One that can't be read right now (busy, online only, gone) stops it, wherever it is: it may come right.
   * - One whose name says a version above MAX_VERSION isn't one: it goes.
   * - A part no kept manifest uses goes once this PC has counted it unused for a week (KEEP_PART_MS, noted in
   *   `unusedFile`; each clean-up counts at most three days), when no manifest has used it since. A sync app's copy of a part
   *   (Tavora never reads one) likewise.
   */
  private async cleanUp(check: ManifestCheck): Promise<void> {
    const now = this.now();
    const lists: { file: ManifestFile; drop: boolean; parts: string[] }[] = [];
    const junk: ManifestFile[] = [];
    let newerMarked = 0;
    for (const name of readable(await lookNames(this.manifestsDir)) ?? []) {
      const match = MANIFEST_NAME.exec(name);
      if (match && Number(match[1]) > MAX_VERSION && readable(await lookKind(path.join(this.manifestsDir, name))) === "file") await rm(path.join(this.manifestsDir, name), { force: true });
    }
    for (const file of await this.manifests()) {
      const looked = await lookOwnFile(path.join(this.manifestsDir, file.name));
      // One that is held may be in use: nothing is cleaned up this time.
      if (looked.status === "held") return;
      if (looked.status === "missing" || looked.value === null) continue;
      const past = newerMarked >= KEEP_MANIFESTS && now - looked.value.mtimeMs >= KEEP_MANIFEST_MS;
      let read: Awaited<ReturnType<FolderStorage["readManifest"]>> | null;
      try {
        read = await this.readManifest(file);
      } catch (error) {
        // Only what was read and isn't a manifest counts as junk.
        if (!(error instanceof CopyError && error.reason === "damaged")) return;
        read = null;
      }
      const opened = read ? check(read.sealed) : null;
      // Its name has to say what it says inside. A list of a long-gone Tavora that has no version inside can't be placed
      // by its name: it stays.
      const fits =
        read !== null &&
        opened !== null &&
        sameIds(read.ids, opened.parts) &&
        (opened.version === undefined || opened.version === file.version) &&
        (!opened.marked || opened.parent === file.base);
      if (!fits) {
        if (!past) return;
        junk.push(file);
        continue;
      }
      lists.push({ file, drop: past && opened.version !== undefined, parts: opened.parts });
      if (opened.marked) newerMarked++;
    }
    for (const file of junk) await rm(path.join(this.manifestsDir, file.name), { force: true });
    const used = new Set<string>();
    for (const list of lists) {
      if (list.drop) await rm(path.join(this.manifestsDir, list.file.name), { force: true });
      else for (const id of list.parts) used.add(id);
    }
    if ((await this.kindOf(this.partsDir)) !== "dir") return;
    const before = await this.loadUnused();
    const step = before.last === null ? 0 : Math.max(0, Math.min(now - before.last, COUNT_AT_MOST_MS));
    const waited = new Map<string, number>();
    const shards = await lookNames(this.partsDir);
    for (const shard of shards.status === "present" ? shards.value : []) {
      if (!SHARD_NAME.test(shard)) continue;
      const shardDir = path.join(this.partsDir, shard);
      // A link where a shard should be leads out of the copy: nothing in it is the copy's.
      const kind = await lookKind(shardDir);
      if (kind.status !== "present" || kind.value !== "dir") continue;
      const parts = await lookNames(shardDir);
      for (const name of parts.status === "present" ? parts.value : []) {
        // Only parts and a sync app's copies of them: anything else there isn't Tavora's to delete.
        if (PART_NAME.test(name) ? used.has(name) : !PART_COPY_NAME.test(name)) continue;
        const target = path.join(shardDir, name);
        const info = await lookOwnFile(target);
        if (info.status !== "present" || info.value === null) continue;
        const key = `${shard}/${name}`;
        // First seen now: it starts at nothing.
        const time = before.waited.has(key) ? before.waited.get(key)! + step : 0;
        if (time >= KEEP_PART_MS) await rm(target, { force: true });
        else waited.set(key, time);
      }
    }
    await this.saveUnused({ last: now, waited });
  }

  /** When this PC first saw each part unused, for this folder: loaded once. */
  private async loadUnused(): Promise<Unused> {
    if (this.unused) return this.unused;
    const file = this.options.unusedFile;
    return (this.unused = file ? await readUnused(file, this.folder) : { last: null, waited: new Map() });
  }

  /**
   * Keeps the list for the next clean-up. One that can't be written (or read, so it isn't written over) only means parts
   * count from now next time.
   */
  private async saveUnused(unused: Unused): Promise<void> {
    this.unused = unused;
    const file = this.options.unusedFile;
    if (!file) return;
    const record: Omit<UnusedRecord, "v"> = { folder: this.folder, last: unused.last ?? 0, waited: Object.fromEntries(unused.waited) };
    await writeCopyFile(file, "unused", record).catch(() => undefined);
  }

  /** Deletes the copy's parts and manifests. Anything else in the folder stays; a link in their place goes, not what it leads to. */
  async remove(): Promise<void> {
    await this.reachable();
    await rm(this.manifestsDir, { recursive: true, force: true });
    await rm(this.partsDir, { recursive: true, force: true });
    await rmdir(this.root).catch(() => undefined);
  }
}

/**
 * Only for a newest manifest of an older Tavora, which has no line inside (CloudCopy.download), and only until this PC has
 * seen one that has, or the folder holds one: whoever can write the folder can change file names, and clean-up takes
 * manifests away. Whether the newest manifest grew out of version `known`: following each manifest back to the one it was
 * saved on top of reaches it. When the line goes below `known` without reaching it, another PC's save won over it, or
 * the folder was put back to an earlier day and another PC saved since: also when `known`'s own manifest is gone. Only
 * when the line breaks off where a save on top of `known` could be, and `known`'s own manifest is gone too (older
 * manifests cleaned up), there is nothing to tell, and it counts as followed.
 */
export function follows(newestFirst: { version: number; base: number }[], known: number): boolean {
  if (known === 0 || newestFirst.length === 0) return true;
  const byVersion = new Map(newestFirst.map((file) => [file.version, file]));
  let at = newestFirst[0]!.version;
  while (at > known) {
    const file = byVersion.get(at);
    // The line breaks off at a manifest that is gone. Every save on top of `known` is numbered from the next block up, so
    // one below that is another PC's, saved beside `known`. Above it, it may be cleaned up; but when `known`'s own manifest
    // is still there, it would be in the line too.
    if (!file) return at >= firstAbove(known) && !byVersion.has(known);
    at = file.base;
  }
  return at === known;
}

/** The lowest version a save on top of `version` can get (FolderStorage.nextVersion). */
const firstAbove = (version: number) => (Math.floor(version / RANDOM_BITS) + 1) * RANDOM_BITS;

/**
 * Writes a file of the copy in the picked folder. One that can't be written because the folder's drive is full, read-only
 * or not Tavora's to write is the folder's problem ("folder-locked"): the user may pick another folder. Said here, as the
 * error itself rarely names the file.
 */
async function writeInFolder(file: string, data: Uint8Array): Promise<void> {
  try {
    await writeFileAtomic(file, data);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOSPC" || code === "EACCES" || code === "EPERM" || code === "EROFS") throw new CopyError("folder-locked", "can't write in the cloud copy folder");
    throw error;
  }
}

/** Writes a file in the picked folder to see that Tavora may; throws "no-folder" when it is not there and "folder-locked" when Tavora may not write in it. */
export async function checkFolder(folder: string): Promise<void> {
  const info = readable(await lookStat(folder));
  if (!info?.isDirectory()) throw new CopyError("no-folder", "the folder is not there");
  const probe = path.join(folder, FOLDER_NAME, `.tavora-check-${process.pid}`);
  try {
    await mkdir(path.dirname(probe), { recursive: true });
    await writeFile(probe, "");
    await rm(probe, { force: true });
  } catch {
    throw new CopyError("folder-locked", "can't write in the folder");
  }
}
