import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isOwnerId } from "@tavora/module-schema";
import { DATA_DIRS, DATA_FILES, PICTURE_DIRS } from "./backup";
import { copyKeys, open, PART_ID_BYTES, partId, seal, type CopyKeys } from "./copy-crypto";
import type { Encryptor } from "./discord-store";
import { writeFileAtomic } from "./fsutil";
import { OWNER_RECORDS_FILE } from "./installer";
import { FILES_DIR } from "./module-files";

// The cloud copy (decided 2026-10-19): one copy of the player's Tavora data per
// account, the same data as the daily backup, encrypted on this PC so only the
// player can read it (copy-crypto.ts). This is the engine: finding what changed,
// uploading it, downloading a copy into a staging folder and swapping it in.
// When it runs (at start, after changes, at close) and what the player sees is
// decided by the host. The service keeps one version per account and takes a
// new one only when this PC started from the current one, so a PC that missed
// an update gets a conflict instead of overwriting newer work.

/** The most a copy may hold, as the service counts it (apps/api/src/cloud-copy.ts). */
export const COPY_LIMIT = 100 * 1024 * 1024;
/** Files are cut into parts of at most this much, before compression and sealing. */
export const PART_BYTES = 4 * 1024 * 1024;
/** About this much of sealed parts goes in one upload. */
const BATCH_BYTES = 8 * 1024 * 1024;
/** Part ids asked for in one download. */
const ASK_IDS = 2048;
export const COPY_TIMEOUT_MS = 60_000;

/** Where a part of the copy lives on this PC: a data file, or a folder of them. */
export interface CopyRoot {
  /** The name in the copy, the same on every PC ("library.json", "module-data", …). */
  name: string;
  /** Where it is on this PC. */
  path: string;
  dir: boolean;
  /** Pictures are left out first when the copy would be too big. */
  picture: boolean;
  /** For a folder: which top-level entries belong to Tavora (the module files folder may be the player's own). */
  keep?: (name: string) => boolean;
}

/** Installed modules and who publishes them; without them the other PC would drop their panels. */
export const MODULE_ROOTS = { dir: "modules", records: OWNER_RECORDS_FILE } as const;

/**
 * What the copy holds: what the daily backup holds (backup.ts), plus the installed modules, so a
 * layout arrives with the modules its panels need. The module files folder may be anywhere.
 */
export function copyRoots(userData: string, moduleFiles: string): CopyRoot[] {
  return [
    ...[...DATA_FILES, MODULE_ROOTS.records].map((name) => ({ name, path: path.join(userData, name), dir: false, picture: false })),
    ...[...DATA_DIRS, MODULE_ROOTS.dir].map((name) => ({ name, path: path.join(userData, name), dir: true, picture: false })),
    ...PICTURE_DIRS.map((name) =>
      name === FILES_DIR ? { name, path: moduleFiles, dir: true, picture: true, keep: (entry: string) => isOwnerId(entry) } : { name, path: path.join(userData, name), dir: true, picture: true },
    ),
  ];
}

/** One file as this PC last synced it: what it was when read, and the parts it went up as. */
export interface SyncedFile {
  size: number;
  mtimeMs: number;
  sha256: string;
  /** Part ids, hex, in order. */
  parts: string[];
}

/** What this PC knows of the copy: the version it last took or uploaded, and its files then. */
export interface CopyState {
  version: number;
  /** False when that version left the pictures out to fit. */
  pictures: boolean;
  files: Record<string, SyncedFile>;
}

export const EMPTY_STATE: CopyState = { version: 0, pictures: true, files: {} };

/** The manifest, sealed before it leaves: every file's path, size, hash and parts. */
interface Manifest {
  v: 1;
  /** False when pictures were left out to fit; a restore keeps this PC's pictures then. */
  pictures: boolean;
  files: { path: string; size: number; sha256: string; parts: string[] }[];
}

export class CopyError extends Error {
  constructor(
    readonly reason: "signed-out" | "unreachable" | "unavailable" | "too-many" | "damaged" | "failed",
    message: string = reason,
  ) {
    super(message);
  }
}

export type UploadResult =
  | { status: "uploaded"; state: CopyState; pictures: boolean; size: number }
  | { status: "unchanged" }
  /** Another PC saved a newer version (0: the copy was deleted) since this PC last synced. */
  | { status: "conflict"; version: number }
  /** Too big even without pictures. */
  | { status: "too-big"; size: number };

const SAFE_SEGMENT = /^[^\\/:*?"<>|\u0000-\u001f]+$/;

/** A path from a manifest, checked before anything is written: relative, under one of the roots, no "..". */
export function safeCopyPath(value: unknown, roots: CopyRoot[]): string | null {
  if (typeof value !== "string" || value.length > 1024) return null;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || !SAFE_SEGMENT.test(segment))) return null;
  const root = roots.find((candidate) => candidate.name === segments[0]);
  if (!root || root.dir !== segments.length > 1) return null;
  if (root.keep && !root.keep(segments[1]!)) return null;
  return value;
}

interface Found {
  path: string;
  file: string;
  size: number;
  mtimeMs: number;
  picture: boolean;
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

/** Every file the copy would hold right now, by its path in the copy. Temp files of a write in progress are left out. */
export async function scanCopy(roots: CopyRoot[]): Promise<Found[]> {
  const found: Found[] = [];
  const walk = async (root: CopyRoot, dir: string, prefix: string, top: boolean) => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      if (name.endsWith(".tmp") || !SAFE_SEGMENT.test(name)) continue;
      if (top && root.keep && !root.keep(name)) continue;
      const file = path.join(dir, name);
      const info = await stat(file).catch(() => null);
      if (!info) continue;
      if (info.isDirectory()) await walk(root, file, `${prefix}/${name}`, false);
      else if (info.isFile()) found.push({ path: `${prefix}/${name}`, file, size: info.size, mtimeMs: info.mtimeMs, picture: root.picture });
    }
  };
  for (const root of roots) {
    if (root.dir) await walk(root, root.path, root.name, true);
    else {
      const info = await stat(root.path).catch(() => null);
      if (info?.isFile()) found.push({ path: root.name, file: root.path, size: info.size, mtimeMs: info.mtimeMs, picture: false });
    }
  }
  return found;
}

/** Whether anything in the copy's files changed since this PC last synced (by size and date; cheap enough to run often). */
export async function hasLocalChanges(roots: CopyRoot[], state: CopyState): Promise<boolean> {
  // A copy that left the pictures out does not count them as changes.
  return !sameAsSynced((await scanCopy(roots)).filter((file) => state.pictures || !file.picture), state);
}

/** Whether these files are, by size and date, exactly the ones this PC last synced. */
function sameAsSynced(found: Found[], state: CopyState): boolean {
  return (
    state.version > 0 &&
    found.length === Object.keys(state.files).length &&
    found.every((file) => {
      const synced = state.files[file.path];
      return synced !== undefined && synced.size === file.size && synced.mtimeMs === file.mtimeMs;
    })
  );
}

export interface CloudCopyOptions {
  /** The account service, ending in /v1/account. */
  baseUrl: string;
  fetch: typeof fetch;
  /** The sign-in token, or null when signed out. */
  token: () => string | null;
  timeoutMs?: number;
}

/** The copy as the service has it. */
export interface RemoteCopy {
  version: number;
  size: number;
  updatedAt: string;
}

export class CloudCopy {
  constructor(private readonly options: CloudCopyOptions) {}

  private async request(method: string, route: string, body?: Uint8Array): Promise<Response> {
    const token = this.options.token();
    if (!token) throw new CopyError("signed-out");
    let response: Response;
    try {
      response = await this.options.fetch(`${this.options.baseUrl}/copy${route}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/octet-stream" } : {}) },
        ...(body ? { body: Uint8Array.from(body) } : {}),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? COPY_TIMEOUT_MS),
      });
    } catch {
      throw new CopyError("unreachable");
    }
    if (response.status === 401) throw new CopyError("signed-out");
    if (response.status === 429) throw new CopyError("too-many");
    if (response.status === 503) throw new CopyError("unavailable");
    return response;
  }

  private async fail(response: Response): Promise<never> {
    const reason = ((await response.json().catch(() => null)) as { reason?: unknown } | null)?.reason;
    throw new CopyError("failed", `the service answered ${response.status}${typeof reason === "string" ? ` (${reason})` : ""}`);
  }

  async remote(): Promise<RemoteCopy | null> {
    const response = await this.request("GET", "");
    if (!response.ok) return this.fail(response);
    const copy = ((await response.json()) as { copy?: unknown }).copy as Record<string, unknown> | null | undefined;
    if (!copy) return null;
    if (typeof copy.version !== "number" || typeof copy.size !== "number" || typeof copy.updatedAt !== "string") throw new CopyError("failed", "the service's answer was off");
    return { version: copy.version, size: copy.size, updatedAt: copy.updatedAt };
  }

  /** Removes the copy from the service (Delete cloud copy). This PC's data stays. */
  async remove(): Promise<void> {
    const response = await this.request("DELETE", "");
    if (!response.ok) return this.fail(response);
  }

  private async sendParts(parts: { id: Buffer; data: Buffer }[]): Promise<void> {
    if (parts.length === 0) return;
    // Each part: its id, its length (4 bytes, big-endian) and its bytes.
    const body = Buffer.concat(
      parts.flatMap((part) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(part.data.length);
        return [part.id, length, part.data];
      }),
    );
    const response = await this.request("POST", "/parts", body);
    if (response.status === 413) throw new CopyError("failed", "too-big");
    if (!response.ok) return this.fail(response);
  }

  /**
   * Uploads what changed since `state` and makes it the copy's new version. Unchanged files are not read
   * again, and parts the copy already has are not sent again. Returns the state to keep on success.
   * `progress` hears how much of what changed is read and sent so far.
   */
  async upload(copyKey: Uint8Array, roots: CopyRoot[], state: CopyState, progress?: (done: number, total: number) => void): Promise<UploadResult> {
    const keys = copyKeys(copyKey);
    let found = await scanCopy(roots);
    let pictures = true;
    let total = found.reduce((sum, file) => sum + file.size, 0);
    if (total > COPY_LIMIT) {
      found = found.filter((file) => !file.picture);
      pictures = false;
      total = found.reduce((sum, file) => sum + file.size, 0);
      if (total > COPY_LIMIT) return { status: "too-big", size: total };
    }
    if (pictures === state.pictures && sameAsSynced(found, state)) return { status: "unchanged" };

    const attempt = async (known: Set<string>): Promise<UploadResult | "missing-parts"> => {
      const files: Record<string, SyncedFile> = {};
      let batch: { id: Buffer; data: Buffer }[] = [];
      let batchBytes = 0;
      const sent = new Set(known);
      const flush = async () => {
        await this.sendParts(batch);
        batch = [];
        batchBytes = 0;
      };
      const unchanged = (file: Found) => {
        const synced = state.files[file.path];
        return synced !== undefined && synced.size === file.size && synced.mtimeMs === file.mtimeMs && synced.parts.every((id) => known.has(id));
      };
      const work = found.reduce((sum, file) => sum + (unchanged(file) ? 0 : file.size), 0);
      let done = 0;
      progress?.(0, work);
      for (const file of found) {
        if (unchanged(file)) {
          files[file.path] = state.files[file.path]!;
          continue;
        }
        let content: Buffer;
        try {
          content = await readFile(file.file);
        } catch {
          continue; // gone since the scan; the next sync sees it
        }
        const parts: string[] = [];
        // An empty file is one empty part.
        for (let index = 0; index < Math.max(1, Math.ceil(content.length / PART_BYTES)); index++) {
          const plain = content.subarray(index * PART_BYTES, (index + 1) * PART_BYTES);
          const id = partId(keys, plain);
          const hex = id.toString("hex");
          parts.push(hex);
          if (sent.has(hex)) continue;
          sent.add(hex);
          const data = seal(keys, plain);
          batch.push({ id, data });
          batchBytes += data.length;
          if (batchBytes >= BATCH_BYTES) await flush();
        }
        files[file.path] = { size: content.length, mtimeMs: file.mtimeMs, sha256: createHash("sha256").update(content).digest("hex"), parts };
        done += file.size;
        progress?.(Math.min(done, work), work);
      }
      await flush();

      const manifest: Manifest = { v: 1, pictures, files: Object.entries(files).map(([name, file]) => ({ path: name, size: file.size, sha256: file.sha256, parts: file.parts })) };
      const sealed = seal(keys, Buffer.from(JSON.stringify(manifest)));
      const ids = [...new Set(manifest.files.flatMap((file) => file.parts))];
      const body = Buffer.alloc(8 + ids.length * PART_ID_BYTES + sealed.length);
      body.writeUInt32BE(state.version, 0);
      body.writeUInt32BE(ids.length, 4);
      ids.forEach((id, index) => Buffer.from(id, "hex").copy(body, 8 + index * PART_ID_BYTES));
      sealed.copy(body, 8 + ids.length * PART_ID_BYTES);
      const response = await this.request("PUT", "", body);
      const answer = (await response.json().catch(() => null)) as { reason?: unknown; version?: unknown; size?: unknown } | null;
      if (response.ok && typeof answer?.version === "number" && typeof answer.size === "number") {
        return { status: "uploaded", state: { version: answer.version, pictures, files }, pictures, size: answer.size };
      }
      if (response.status === 409 && answer?.reason === "copy-changed" && typeof answer.version === "number") return { status: "conflict", version: answer.version };
      if (response.status === 409 && answer?.reason === "missing-parts") return "missing-parts";
      if (response.status === 413) return { status: "too-big", size: typeof answer?.size === "number" ? answer.size : total };
      return this.fail(response);
    };

    // Parts of the last synced version are on the service; if some went missing anyway, send everything once more.
    const first = await attempt(new Set(Object.values(state.files).flatMap((file) => file.parts)));
    if (first !== "missing-parts") return first;
    const second = await attempt(new Set());
    if (second === "missing-parts") throw new CopyError("failed", "parts went missing twice");
    return second;
  }

  /**
   * Downloads the copy into `staging` (emptied first), checking every part and file against the key and the
   * manifest, and returns its version and the files as they will be synced once swapped in. Nothing outside
   * `staging` is touched; null when there is no copy.
   */
  async download(copyKey: Uint8Array, roots: CopyRoot[], staging: string): Promise<{ version: number; pictures: boolean; files: Record<string, Omit<SyncedFile, "mtimeMs">> } | null> {
    const keys = copyKeys(copyKey);
    const response = await this.request("GET", "/manifest");
    if (response.status === 404) return null;
    if (!response.ok) return this.fail(response);
    const version = Number(response.headers.get("x-copy-version"));
    if (!Number.isInteger(version) || version < 1) throw new CopyError("failed", "the copy has no version");
    let manifest: Manifest;
    try {
      manifest = JSON.parse(open(keys, new Uint8Array(await response.arrayBuffer())).toString("utf8")) as Manifest;
    } catch {
      // Sealed with another key: the recovery key typed in is not this copy's, or the copy was changed.
      throw new CopyError("damaged", "the copy could not be opened with this key");
    }
    if (manifest?.v !== 1 || !Array.isArray(manifest.files)) throw new CopyError("damaged", "the copy's list is off");
    const files = manifest.files.filter(
      (file) =>
        safeCopyPath(file?.path, roots) &&
        Number.isSafeInteger(file.size) &&
        file.size >= 0 &&
        /^[0-9a-f]{64}$/.test(file.sha256) &&
        Array.isArray(file.parts) &&
        file.parts.length > 0 &&
        file.parts.every((id) => typeof id === "string" && /^[0-9a-f]{64}$/.test(id)),
    );
    if (files.length !== manifest.files.length) throw new CopyError("damaged", "the copy's list is off");

    // The parts, checked against their names, then the files, checked against their hashes.
    const wanted = [...new Set(files.flatMap((file) => file.parts))];
    const plain = new Map<string, Buffer>();
    let missing = wanted;
    while (missing.length > 0) {
      const ask = missing.slice(0, ASK_IDS);
      const answer = await this.request("POST", "/parts/get", Buffer.concat(ask.map((id) => Buffer.from(id, "hex"))));
      if (!answer.ok) return this.fail(answer);
      const body = Buffer.from(await answer.arrayBuffer());
      let at = 0;
      let got = 0;
      while (at + PART_ID_BYTES + 4 <= body.length) {
        const id = body.subarray(at, at + PART_ID_BYTES).toString("hex");
        const length = body.readUInt32BE(at + PART_ID_BYTES);
        const data = body.subarray(at + PART_ID_BYTES + 4, at + PART_ID_BYTES + 4 + length);
        at += PART_ID_BYTES + 4 + length;
        let content: Buffer;
        try {
          content = open(keys, data);
        } catch {
          throw new CopyError("damaged", "a part could not be opened");
        }
        if (partId(keys, content).toString("hex") !== id) throw new CopyError("damaged", "a part is not what its name says");
        plain.set(id, content);
        got++;
      }
      if (got === 0) throw new CopyError("damaged", "parts of the copy are missing");
      missing = missing.filter((id) => !plain.has(id));
    }

    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const result: Record<string, Omit<SyncedFile, "mtimeMs">> = {};
    for (const file of files) {
      const content = Buffer.concat(file.parts.map((id) => plain.get(id)!));
      if (content.length !== file.size || createHash("sha256").update(content).digest("hex") !== file.sha256) throw new CopyError("damaged", "a file does not match the copy's list");
      const target = path.join(staging, ...file.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
      result[file.path] = { size: file.size, sha256: file.sha256, parts: file.parts };
    }
    return { version, pictures: manifest.pictures !== false, files: result };
  }
}

/** Moves a file or folder, also from one drive to another (the module files folder may be elsewhere). */
async function move(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}

/**
 * Puts a downloaded copy (in `staging`) in place of this PC's data, after moving what was there into
 * `keepIn`, so the side not kept stays as a local backup. A copy that left out pictures leaves this PC's
 * pictures where they are. Only runs while nothing reads the data (before the games load).
 * Returns the state to keep: the copy's files with their dates on this PC.
 */
export async function swapInCopy(staging: string, roots: CopyRoot[], keepIn: string, copy: { version: number; pictures: boolean; files: Record<string, Omit<SyncedFile, "mtimeMs">> }): Promise<CopyState> {
  const taking = roots.filter((root) => copy.pictures || !root.picture);
  await mkdir(keepIn, { recursive: true });
  for (const root of taking) {
    const staged = path.join(staging, root.name);
    if (root.keep) {
      // Only Tavora's own entries of a folder the player may share (the module files folder).
      for (const name of (await readdir(root.path).catch(() => [] as string[])).filter(root.keep)) await move(path.join(root.path, name), path.join(keepIn, root.name, name));
      for (const name of await readdir(staged).catch(() => [] as string[])) await move(path.join(staged, name), path.join(root.path, name));
      continue;
    }
    if (await exists(root.path)) await move(root.path, path.join(keepIn, root.name));
    if (await exists(staged)) await move(staged, root.path);
  }
  await rm(staging, { recursive: true, force: true });
  const files: Record<string, SyncedFile> = {};
  for (const found of await scanCopy(taking)) {
    const synced = copy.files[found.path];
    if (synced) files[found.path] = { ...synced, mtimeMs: found.mtimeMs };
  }
  return { version: copy.version, pictures: copy.pictures, files };
}

// What this PC keeps about the copy: the state in cloud-copy.json (paths, sizes, hashes and part ids,
// nothing of the content), and the copy key in cloud-copy-key.json, encrypted like the sign-in.

export async function loadCopyState(file: string): Promise<CopyState> {
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as { v?: unknown; version?: unknown; pictures?: unknown; files?: unknown };
    if (saved.v !== 1 || typeof saved.version !== "number" || typeof saved.files !== "object" || saved.files === null) return EMPTY_STATE;
    return { version: saved.version, pictures: saved.pictures !== false, files: saved.files as Record<string, SyncedFile> };
  } catch {
    return EMPTY_STATE;
  }
}

export async function saveCopyState(file: string, state: CopyState): Promise<void> {
  await writeFileAtomic(file, JSON.stringify({ v: 1, version: state.version, pictures: state.pictures, files: state.files }));
}

export async function loadCopyKey(file: string, encryptor: Encryptor): Promise<Buffer | null> {
  if (!encryptor.isAvailable()) return null;
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as { v?: unknown; data?: unknown };
    if (saved.v !== 1 || typeof saved.data !== "string") return null;
    const key = Buffer.from(encryptor.decrypt(Buffer.from(saved.data, "base64")), "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

/** Without the OS key store nothing is saved, so the copy can't be turned on there. */
export async function saveCopyKey(file: string, encryptor: Encryptor, key: Uint8Array | null): Promise<void> {
  if (!key) {
    await rm(file, { force: true });
    return;
  }
  if (!encryptor.isAvailable()) return;
  await writeFileAtomic(file, JSON.stringify({ v: 1, data: encryptor.encrypt(Buffer.from(key).toString("base64")).toString("base64") }));
}
