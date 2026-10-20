import { randomInt } from "node:crypto";
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CopyError, type CopyStorage, type RemoteCopy, type SwapAnswer } from "./cloud-copy";
import { PART_ID_BYTES } from "./copy-crypto";
import { writeFileAtomic } from "./fsutil";

// The cloud copy in a folder the player picks (decided 2026-10-20): usually one their
// OneDrive, Dropbox or Google Drive app syncs, or a NAS or USB stick. Tavora writes the
// same sealed parts and manifests the service would keep; the player's own sync app moves
// them. Nothing goes to Tavora's service and no account is needed.
//
// A sync app is slow and has no version check, so:
// - Every manifest is its own file, named by its version and the version it was saved on
//   top of. Versions count up in the high bits and are random in the low ones, so two PCs
//   saving at once get different versions, and every PC agrees which one is newer.
// - A PC whose last save lost against another PC's (it is not in the newest version's
//   line) is told, so the player keeps one side instead of losing that save.
// - Parts that are missing may still be on their way, not lost.
// - Only names Tavora writes are read: "file (1)" copies a sync app makes are left alone.
// - Old manifests and parts no manifest uses are cleaned up after a while, so a PC still
//   catching up finds what it needs. `pairing/` is kept free for approving new PCs.

/** The folder Tavora makes inside the one the player picks. */
export const FOLDER_NAME = "Tavora";
/** Low bits of a version that are random; the rest counts up. */
const RANDOM_BITS = 2 ** 20;
/** Manifests always kept, newest first, however old. */
const KEEP_MANIFESTS = 5;
/** Older manifests are kept this long, so a PC that was away can still tell whether it was left behind. */
const KEEP_MANIFEST_MS = 30 * 24 * 60 * 60_000;
/** Parts no manifest uses are kept this long: another PC's manifest may still be on its way. */
const KEEP_PART_MS = 7 * 24 * 60 * 60_000;
/** About this much of parts goes back from one read. */
const READ_BYTES = 8 * 1024 * 1024;

const MANIFEST_NAME = /^(\d{16})-(\d{16})\.bin$/;
const PART_NAME = /^[0-9a-f]{64}$/;
const SHARD_NAME = /^[0-9a-f]{2}$/;
/** A manifest file: "TVC1", the copy's size (8 bytes), the part count (4 bytes), the part ids, the sealed manifest. */
const MAGIC = Buffer.from("TVC1");
const HEADER_BYTES = MAGIC.length + 8 + 4;

interface ManifestFile {
  version: number;
  base: number;
  name: string;
}

const pad = (value: number) => String(value).padStart(16, "0");

export interface FolderStorageOptions {
  now?: () => number;
}

export class FolderStorage implements CopyStorage {
  readonly limit = null;
  readonly arrivesLate = true;
  private readonly root: string;

  /** `folder` is the one the player picked; the copy goes in a "Tavora" folder inside it. */
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
    const info = await stat(this.folder).catch(() => null);
    if (!info?.isDirectory()) throw new CopyError("no-folder", "the cloud copy folder is not there");
  }

  /** The manifests, newest first. */
  private async manifests(): Promise<ManifestFile[]> {
    await this.reachable();
    const names = await readdir(this.manifestsDir).catch(() => [] as string[]);
    const found: ManifestFile[] = [];
    for (const name of names) {
      const match = MANIFEST_NAME.exec(name);
      if (!match) continue;
      const version = Number(match[1]);
      const base = Number(match[2]);
      if (Number.isSafeInteger(version) && version > 0 && base < version) found.push({ version, base, name });
    }
    return found.sort((a, b) => b.version - a.version);
  }

  private async readManifest(file: ManifestFile): Promise<{ size: number; ids: string[]; sealed: Uint8Array }> {
    const body = await readFile(path.join(this.manifestsDir, file.name));
    if (body.length < HEADER_BYTES || !body.subarray(0, MAGIC.length).equals(MAGIC)) throw new CopyError("damaged", "a manifest in the folder is off");
    const size = Number(body.readBigUInt64BE(MAGIC.length));
    const count = body.readUInt32BE(MAGIC.length + 8);
    const start = HEADER_BYTES + count * PART_ID_BYTES;
    if (body.length <= start) throw new CopyError("damaged", "a manifest in the folder is off");
    const ids: string[] = [];
    for (let index = 0; index < count; index++) ids.push(body.subarray(HEADER_BYTES + index * PART_ID_BYTES, HEADER_BYTES + (index + 1) * PART_ID_BYTES).toString("hex"));
    return { size, ids, sealed: body.subarray(start) };
  }

  async remote(known = 0): Promise<RemoteCopy | null> {
    const all = await this.manifests();
    const current = all[0];
    if (!current) return null;
    const info = await stat(path.join(this.manifestsDir, current.name));
    const { size } = await this.readManifest(current);
    return { version: current.version, size, updatedAt: info.mtime.toISOString(), follows: follows(all, known) };
  }

  async manifest(): Promise<{ version: number; sealed: Uint8Array } | null> {
    const current = (await this.manifests())[0];
    if (!current) return null;
    return { version: current.version, sealed: (await this.readManifest(current)).sealed };
  }

  async putParts(parts: { id: Buffer; data: Buffer }[]): Promise<void> {
    await this.reachable();
    for (const part of parts) {
      const file = this.partFile(part.id.toString("hex"));
      // Named by content: one that is there already holds the same.
      if (await stat(file).catch(() => null)) continue;
      await writeFileAtomic(file, part.data);
    }
  }

  async getParts(ids: string[]): Promise<{ id: string; data: Uint8Array }[]> {
    await this.reachable();
    const found: { id: string; data: Uint8Array }[] = [];
    let total = 0;
    for (const id of ids) {
      if (!PART_NAME.test(id)) continue;
      const data = await readFile(this.partFile(id)).catch(() => null);
      if (!data) continue;
      found.push({ id, data });
      total += data.length;
      if (total >= READ_BYTES) break;
    }
    return found;
  }

  nextVersion(base: number): number {
    return (Math.floor(base / RANDOM_BITS) + 1) * RANDOM_BITS + randomInt(RANDOM_BITS);
  }

  async swap(base: number, version: number, ids: string[], sealed: Uint8Array): Promise<SwapAnswer> {
    const all = await this.manifests();
    const current = all[0]?.version ?? 0;
    if (current !== base) return { status: "conflict", version: current };
    let size = sealed.length;
    for (const id of ids) {
      const info = await stat(this.partFile(id)).catch(() => null);
      if (!info) return { status: "missing-parts" };
      size += info.size;
    }
    const body = Buffer.alloc(HEADER_BYTES + ids.length * PART_ID_BYTES + sealed.length);
    MAGIC.copy(body, 0);
    body.writeBigUInt64BE(BigInt(size), MAGIC.length);
    body.writeUInt32BE(ids.length, MAGIC.length + 8);
    ids.forEach((id, index) => Buffer.from(id, "hex").copy(body, HEADER_BYTES + index * PART_ID_BYTES));
    Buffer.from(sealed).copy(body, HEADER_BYTES + ids.length * PART_ID_BYTES);
    await writeFileAtomic(path.join(this.manifestsDir, `${pad(version)}-${pad(base)}.bin`), body);
    await this.cleanUp().catch(() => undefined);
    return { status: "saved", version, size };
  }

  /** Drops old manifests, then parts no manifest left uses, once both are old enough. */
  private async cleanUp(): Promise<void> {
    const now = this.now();
    const all = await this.manifests();
    const kept: ManifestFile[] = [];
    for (const [index, file] of all.entries()) {
      const target = path.join(this.manifestsDir, file.name);
      const info = await stat(target).catch(() => null);
      if (!info) continue;
      if (index < KEEP_MANIFESTS || now - info.mtimeMs < KEEP_MANIFEST_MS) kept.push(file);
      else await rm(target, { force: true });
    }
    const used = new Set<string>();
    for (const file of kept) {
      const read = await this.readManifest(file).catch(() => null);
      // A manifest that can't be read may be half synced: keep every part then.
      if (!read) return;
      for (const id of read.ids) used.add(id);
    }
    for (const shard of await readdir(this.partsDir).catch(() => [] as string[])) {
      if (!SHARD_NAME.test(shard)) continue;
      for (const name of await readdir(path.join(this.partsDir, shard)).catch(() => [] as string[])) {
        if (!PART_NAME.test(name) || used.has(name)) continue;
        const target = path.join(this.partsDir, shard, name);
        const info = await stat(target).catch(() => null);
        if (info && now - info.mtimeMs >= KEEP_PART_MS) await rm(target, { force: true });
      }
    }
  }

  /** Deletes the copy's parts and manifests. Anything else in the folder stays. */
  async remove(): Promise<void> {
    await this.reachable();
    await rm(this.manifestsDir, { recursive: true, force: true });
    await rm(this.partsDir, { recursive: true, force: true });
    await rmdir(this.root).catch(() => undefined);
  }
}

/**
 * Whether the newest manifest grew out of version `known`: following each manifest back to the one it was
 * saved on top of reaches it. When `known`'s own manifest is there but not in that line, another PC's save
 * won over it. When it is gone (cleaned up), there is nothing to tell, and it counts as followed.
 */
export function follows(newestFirst: { version: number; base: number }[], known: number): boolean {
  if (known === 0 || newestFirst.length === 0) return true;
  const byVersion = new Map(newestFirst.map((file) => [file.version, file]));
  let at: number | undefined = newestFirst[0]!.version;
  while (at !== undefined && at > known) at = byVersion.get(at)?.base;
  return at === known || !byVersion.has(known);
}

/** Writes a file in the picked folder to see that Tavora may; throws "no-folder" when it can't. */
export async function checkFolder(folder: string): Promise<void> {
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new CopyError("no-folder", "the folder is not there");
  const probe = path.join(folder, FOLDER_NAME, `.tavora-check-${process.pid}`);
  try {
    await mkdir(path.dirname(probe), { recursive: true });
    await writeFile(probe, "");
    await rm(probe, { force: true });
  } catch {
    throw new CopyError("no-folder", "can't write in the folder");
  }
}
