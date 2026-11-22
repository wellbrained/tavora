import { apiReason } from "@tavora/module-schema";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, open as openFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isOwnerId } from "@tavora/module-schema";
import { DATA_DIRS, PICTURE_DIRS } from "./backup";
import { copyKeys, open, PART_ID_BYTES, partId, seal } from "./copy-crypto";
import { writeFileAtomic } from "./fsutil";
import { DamagedFile, look, lookBytes, lookNames, lookStat, unlessHeld, type Looked } from "./file-look";
import { renameHeld } from "./rename-held";
import { checkSavedFile } from "./json";
import { STORE_VERSIONS } from "./saved-versions";
import { OWNER_RECORDS_FILE } from "./installer";
import { FILES_DIR } from "./module-files";
import { DATA_FILES } from "./saved-data";

// The cloud copy (decided 2026-10-19): one copy of the user's Tavora data per
// account, the same data as the daily backup, encrypted on this PC so only the
// user can read it (copy-crypto.ts). This is the engine: finding what changed,
// uploading it, downloading a copy into a staging folder and swapping it in.
// When it runs (at start, after changes, at close) and what the user sees is
// decided by the host. Where the copy is kept is a CopyStorage: Tavora's service
// (ServiceStorage, one copy per account) or a folder the user picks
// (copy-folder.ts, decided 2026-10-20). Either takes a new version only when this
// PC started from the current one, so a PC that missed an update gets a conflict
// instead of overwriting newer work.

/** The most a copy on the service may hold, as the service counts it (apps/api/src/cloud-copy.ts). A folder has no limit. */
export const COPY_LIMIT = 100 * 1024 * 1024;
/** Files are cut into parts of at most this much, before compression and sealing. */
export const PART_BYTES = 4 * 1024 * 1024;
/** The most one upload of sealed parts holds, with each part's id and length. The service takes a little more. */
export const BATCH_BYTES = 8 * 1024 * 1024;
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
  /** For a folder: which top-level entries belong to Tavora (the module files folder may be the user's own). */
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
  /**
   * The user kept this PC's side over the copy (`version` is the copy's then): it counts as changed until an upload
   * succeeds, also when no file changed here. An older Tavora ignores it.
   */
  kept?: boolean;
  /**
   * This PC has seen a copy whose manifest seals its version (`version` or `base`): one uploaded from here or taken. From
   * then on, a manifest without either is an old one served again, not a copy of an older Tavora, and the check at
   * start treats it as older. An older Tavora ignores it (and drops it when it saves; then the check is as before).
   */
  sealed?: boolean;
}

export const EMPTY_STATE: CopyState = { version: 0, pictures: true, files: {} };

/** The manifest, sealed before it leaves: every file's path, size, hash and parts. */
interface Manifest {
  v: 1;
  /** The version it was saved as, where the PC picks it (a folder); the service numbers its own. */
  version?: number;
  /**
   * Where the service numbers versions: the version it was saved on top of, so an older manifest can't pose as
   * a newer one there either. Copies saved before Tavora sealed it have none.
   */
  base?: number;
  /** False when pictures were left out to fit; a restore keeps this PC's pictures then. */
  pictures: boolean;
  files: { path: string; size: number; sha256: string; parts: string[] }[];
}

export class CopyError extends Error {
  constructor(
    readonly reason: "signed-out" | "unreachable" | "unavailable" | "too-many" | "damaged" | "failed" | "no-folder" | "folder-locked" | "not-arrived" | "older",
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

/** Whether a file is there. One that is held stops the work (file-look.ts). */
async function exists(target: string): Promise<boolean> {
  return unlessHeld(await lookStat(target)) !== null;
}

/** A folder's names; empty when it isn't there. One that is held stops the work. */
async function namesIn(dir: string): Promise<string[]> {
  return unlessHeld(await lookNames(dir)) ?? [];
}

/** A file's SHA-256, read a piece at a time. */
export async function fileSha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Every file the copy would hold right now, by its path in the copy. Temp files of a write in progress are left out. */
export async function scanCopy(roots: CopyRoot[]): Promise<Found[]> {
  const found: Found[] = [];
  const walk = async (root: CopyRoot, dir: string, prefix: string, top: boolean) => {
    // What can't be read right now stops the scan: left out, it would be gone from the copy on every PC.
    for (const name of (await namesIn(dir)).sort()) {
      if (name.endsWith(".tmp") || !SAFE_SEGMENT.test(name)) continue;
      if (top && root.keep && !root.keep(name)) continue;
      const file = path.join(dir, name);
      const info = unlessHeld(await lookStat(file));
      if (!info) continue;
      if (info.isDirectory()) await walk(root, file, `${prefix}/${name}`, false);
      else if (info.isFile()) found.push({ path: `${prefix}/${name}`, file, size: info.size, mtimeMs: info.mtimeMs, picture: root.picture });
    }
  };
  for (const root of roots) {
    if (root.dir) await walk(root, root.path, root.name, true);
    else {
      const info = unlessHeld(await lookStat(root.path));
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
    state.kept !== true &&
    found.length === Object.keys(state.files).length &&
    found.every((file) => {
      const synced = state.files[file.path];
      return synced !== undefined && synced.size === file.size && synced.mtimeMs === file.mtimeMs;
    })
  );
}

/** The copy as its storage has it. */
export interface RemoteCopy {
  version: number;
  size: number;
  updatedAt: string;
  /**
   * False when the copy did not grow out of the version this PC last synced: two PCs saved at once into a
   * synced folder, and the other one won. This PC's last save is not in the copy then.
   */
  follows?: boolean;
}

export type SwapAnswer =
  | { status: "saved"; version: number; size: number }
  | { status: "conflict"; version: number }
  | { status: "missing-parts" }
  | { status: "too-big"; size?: number };

/**
 * Where the copy is kept: Tavora's service (ServiceStorage) or a folder the user picks (copy-folder.ts).
 * It only ever holds sealed parts and a sealed manifest; everything else happens in CloudCopy.
 */
export interface CopyStorage {
  /** The most a copy may hold here, or null for no limit. Pictures are left out first to fit. */
  readonly limit: number | null;
  /** Parts that are missing may still be on their way (a synced folder), rather than lost. */
  readonly arrivesLate: boolean;
  /** The current copy, or null when there is none. `known` is the version this PC last synced. */
  remote(known?: number): Promise<RemoteCopy | null>;
  /** The current version and its sealed manifest, or null when there is none. */
  manifest(): Promise<{ version: number; sealed: Uint8Array } | null>;
  /** Stores parts it does not have yet. */
  putParts(parts: { id: Buffer; data: Buffer }[]): Promise<void>;
  /** Some of the asked parts, at least one when any of them is there. */
  getParts(ids: string[]): Promise<{ id: string; data: Uint8Array }[]>;
  /**
   * The version a new manifest gets when saved on top of `base`, sealed into it; null when the storage
   * numbers versions itself (the service), so the manifest can't know its own.
   */
  nextVersion(base: number): number | null;
  /** Makes the manifest with these parts the new version, if the copy is still at `base`. */
  swap(base: number, version: number | null, ids: string[], sealed: Uint8Array): Promise<SwapAnswer>;
  /** Deletes the copy. */
  remove(): Promise<void>;
}

export interface ServiceStorageOptions {
  /** The account service, ending in /v1/account. */
  baseUrl: string;
  fetch: typeof fetch;
  /** The sign-in token, or null when signed out. */
  token: () => string | null;
  timeoutMs?: number;
}

/** The copy on Tavora's service, one per account (apps/api/src/cloud-copy.ts). */
export class ServiceStorage implements CopyStorage {
  readonly limit = COPY_LIMIT;
  readonly arrivesLate = false;

  constructor(private readonly options: ServiceStorageOptions) {}

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

  async manifest(): Promise<{ version: number; sealed: Uint8Array } | null> {
    const response = await this.request("GET", "/manifest");
    if (response.status === 404) return null;
    if (!response.ok) return this.fail(response);
    const version = Number(response.headers.get("x-copy-version"));
    if (!Number.isInteger(version) || version < 1) throw new CopyError("failed", "the copy has no version");
    return { version, sealed: new Uint8Array(await response.arrayBuffer()) };
  }

  async putParts(parts: { id: Buffer; data: Buffer }[]): Promise<void> {
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

  async getParts(ids: string[]): Promise<{ id: string; data: Uint8Array }[]> {
    const answer = await this.request("POST", "/parts/get", Buffer.concat(ids.map((id) => Buffer.from(id, "hex"))));
    if (!answer.ok) return this.fail(answer);
    const body = Buffer.from(await answer.arrayBuffer());
    const parts: { id: string; data: Uint8Array }[] = [];
    let at = 0;
    while (at + PART_ID_BYTES + 4 <= body.length) {
      const id = body.subarray(at, at + PART_ID_BYTES).toString("hex");
      const length = body.readUInt32BE(at + PART_ID_BYTES);
      parts.push({ id, data: body.subarray(at + PART_ID_BYTES + 4, at + PART_ID_BYTES + 4 + length) });
      at += PART_ID_BYTES + 4 + length;
    }
    return parts;
  }

  /** The service numbers versions itself (never reusing one after a delete). */
  nextVersion(): null {
    return null;
  }

  async swap(base: number, _version: number | null, ids: string[], sealed: Uint8Array): Promise<SwapAnswer> {
    const body = Buffer.alloc(8 + ids.length * PART_ID_BYTES + sealed.length);
    body.writeUInt32BE(base, 0);
    body.writeUInt32BE(ids.length, 4);
    ids.forEach((id, index) => Buffer.from(id, "hex").copy(body, 8 + index * PART_ID_BYTES));
    Buffer.from(sealed).copy(body, 8 + ids.length * PART_ID_BYTES);
    const response = await this.request("PUT", "", body);
    const answer = (await response.json().catch(() => null)) as { reason?: unknown; version?: unknown; size?: unknown } | null;
    const reason = apiReason(answer);
    if (response.ok && typeof answer?.version === "number" && typeof answer.size === "number") return { status: "saved", version: answer.version, size: answer.size };
    if (response.status === 409 && answer && reason === "copy-changed" && typeof answer.version === "number") return { status: "conflict", version: answer.version };
    if (response.status === 409 && reason === "missing-parts") return { status: "missing-parts" };
    if (response.status === 413) return { status: "too-big", ...(typeof answer?.size === "number" ? { size: answer.size } : {}) };
    return this.fail(response);
  }

  /** Removes the copy from the service (Delete cloud copy). This PC's data stays. */
  async remove(): Promise<void> {
    const response = await this.request("DELETE", "");
    if (!response.ok) return this.fail(response);
  }
}

/** The engine: what changed goes up sealed, a copy comes down checked. Where it is kept is up to the storage. */
export class CloudCopy {
  constructor(readonly storage: CopyStorage) {}

  remote(known?: number): Promise<RemoteCopy | null> {
    return this.storage.remote(known);
  }

  /** Removes the copy (Delete cloud copy). This PC's data stays. */
  remove(): Promise<void> {
    return this.storage.remove();
  }

  /**
   * Uploads what changed since `state` and makes it the copy's new version. Unchanged files are not read
   * again, and parts the copy already has are not sent again. Returns the state to keep on success.
   * `progress` hears how much of what changed is read and sent so far.
   */
  async upload(copyKey: Uint8Array, roots: CopyRoot[], state: CopyState, progress?: (done: number, total: number) => void): Promise<UploadResult> {
    const keys = copyKeys(copyKey);
    const limit = this.storage.limit;
    let found = await scanCopy(roots);
    let pictures = true;
    let total = found.reduce((sum, file) => sum + file.size, 0);
    if (limit !== null && total > limit) {
      found = found.filter((file) => !file.picture);
      pictures = false;
      total = found.reduce((sum, file) => sum + file.size, 0);
      if (total > limit) return { status: "too-big", size: total };
    }
    if (pictures === state.pictures && sameAsSynced(found, state)) return { status: "unchanged" };

    const attempt = async (known: Set<string>): Promise<UploadResult | "missing-parts"> => {
      const files: Record<string, SyncedFile> = {};
      let batch: { id: Buffer; data: Buffer }[] = [];
      let batchBytes = 0;
      const sent = new Set(known);
      const flush = async () => {
        await this.storage.putParts(batch);
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
        const content = unlessHeld(await lookBytes(file.file));
        if (content === null) continue; // gone since the scan; the next sync sees it
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
          // Sent before this part would take the upload past what the service accepts.
          const framed = PART_ID_BYTES + 4 + data.length;
          if (batch.length > 0 && batchBytes + framed > BATCH_BYTES) await flush();
          batch.push({ id, data });
          batchBytes += framed;
        }
        files[file.path] = { size: content.length, mtimeMs: file.mtimeMs, sha256: createHash("sha256").update(content).digest("hex"), parts };
        done += file.size;
        progress?.(Math.min(done, work), work);
      }
      await flush();

      // Where the PC picks the version, it goes inside the sealed manifest too, so an older manifest can't pose as a newer one.
      // Where the service picks it, the version this one follows goes in instead.
      const version = this.storage.nextVersion(state.version);
      const manifest: Manifest = { v: 1, ...(version !== null ? { version } : { base: state.version }), pictures, files: Object.entries(files).map(([name, file]) => ({ path: name, size: file.size, sha256: file.sha256, parts: file.parts })) };
      const sealed = seal(keys, Buffer.from(JSON.stringify(manifest)));
      const ids = [...new Set(manifest.files.flatMap((file) => file.parts))];
      const answer = await this.storage.swap(state.version, version, ids, sealed);
      if (answer.status === "saved") return { status: "uploaded", state: { version: answer.version, pictures, files, sealed: true }, pictures, size: answer.size };
      if (answer.status === "conflict") return { status: "conflict", version: answer.version };
      if (answer.status === "too-big") return { status: "too-big", size: answer.size ?? total };
      return "missing-parts";
    };

    // Parts of the last synced version are in the copy; if some went missing anyway, send everything once more.
    const first = await attempt(new Set(Object.values(state.files).flatMap((file) => file.parts)));
    if (first !== "missing-parts") return first;
    const second = await attempt(new Set());
    if (second === "missing-parts") throw new CopyError("failed", "parts went missing twice");
    return second;
  }

  /**
   * Downloads the copy into `staging` (emptied first), checking every part and file against the key and the
   * manifest, and returns its version and the files as they will be synced once swapped in. Nothing outside
   * `staging` is touched; null when there is no copy. `synced` is the version this PC last synced: a copy the
   * service saved on top of an older one is refused ("older"), and so is one without a sealed version once this PC has
   * seen a sealed one (`sealedSeen`): a list from before Tavora sealed it can only be an old one served again. Once
   * `wanted` says no (the copy was turned off meanwhile) it stops writing and answers null.
   */
  async download(copyKey: Uint8Array, roots: CopyRoot[], staging: string, synced = 0, sealedSeen = false, wanted: () => boolean = () => true): Promise<DownloadedCopy | null> {
    const keys = copyKeys(copyKey);
    const current = await this.storage.manifest();
    if (!current || !wanted()) return null;
    const { version } = current;
    let manifest: Manifest;
    try {
      manifest = JSON.parse(open(keys, current.sealed).toString("utf8")) as Manifest;
    } catch {
      // Sealed with another key: the recovery key typed in is not this copy's, or the copy was changed.
      throw new CopyError("damaged", "the copy could not be opened with this key");
    }
    if (manifest?.v !== 1 || !Array.isArray(manifest.files)) throw new CopyError("damaged", "the copy's list is off");
    if (manifest.version !== undefined && manifest.version !== version) throw new CopyError("damaged", "the copy's list belongs to another version");
    if (manifest.base !== undefined && (!Number.isSafeInteger(manifest.base) || manifest.base < 0 || manifest.base >= version)) throw new CopyError("damaged", "the copy's list belongs to another version");
    // Saved on top of an older version than this PC has: an old copy served as a new one, or a copy made anew after a
    // delete. The two look the same, so the caller asks instead of taking it. Not "damaged", which can mean a new key.
    if (manifest.base !== undefined && manifest.base < synced) throw new CopyError("older", "the copy was saved on top of an older version than this PC has");
    const sealed = manifest.version !== undefined || manifest.base !== undefined;
    if (!sealed && sealedSeen && synced > 0) throw new CopyError("older", "the copy's list has no sealed version, though this PC has seen one that has");
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

    // The parts, checked against their names, then the files, checked against their hashes. Parts wait on disk, next to
    // the staging folder: a copy in a folder has no size limit, so it may not fit in memory.
    const partsDir = `${staging}.parts`;
    await rm(partsDir, { recursive: true, force: true });
    await mkdir(partsDir, { recursive: true });
    try {
      let missing = [...new Set(files.flatMap((file) => file.parts))];
      while (missing.length > 0) {
        const asked = new Set(missing.slice(0, ASK_IDS));
        const got = new Set<string>();
        const answer = await this.storage.getParts([...asked]);
        if (!wanted()) return null;
        for (const { id, data } of answer) {
          if (!asked.has(id) || got.has(id)) continue;
          let content: Buffer;
          try {
            content = open(keys, data);
          } catch {
            throw new CopyError("damaged", "a part could not be opened");
          }
          if (partId(keys, content).toString("hex") !== id) throw new CopyError("damaged", "a part is not what its name says");
          await writeFile(path.join(partsDir, id), content);
          got.add(id);
        }
        // In a synced folder the manifest may arrive before its parts: they come later.
        if (got.size === 0) throw this.storage.arrivesLate ? new CopyError("not-arrived", "parts of the copy are not here yet") : new CopyError("damaged", "parts of the copy are missing");
        missing = missing.filter((id) => !got.has(id));
      }

      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      const result: Record<string, Omit<SyncedFile, "mtimeMs">> = {};
      for (const file of files) {
        if (!wanted()) return null;
        const target = path.join(staging, ...file.path.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await joinParts(partsDir, file, target);
        result[file.path] = { size: file.size, sha256: file.sha256, parts: file.parts };
      }
      return { version, pictures: manifest.pictures !== false, files: result, ...(sealed ? { sealed: true } : {}) };
    } finally {
      await rm(partsDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Writes a file from its parts, one part in memory at a time, and checks it against the copy's list. */
async function joinParts(partsDir: string, file: { size: number; sha256: string; parts: string[] }, target: string): Promise<void> {
  const hash = createHash("sha256");
  let size = 0;
  const out = await openFile(target, "w");
  try {
    for (const id of file.parts) {
      const content = unlessHeld(await lookBytes(path.join(partsDir, id)));
      if (content === null) throw new CopyError("damaged", "a part of the copy is gone");
      size += content.length;
      if (size > file.size) break;
      hash.update(content);
      await out.writeFile(content);
    }
    // On the disk before its list says it is there: a power cut can't leave a file of the right size full of zeros.
    await out.sync();
  } finally {
    await out.close();
  }
  if (size !== file.size || hash.digest("hex") !== file.sha256) throw new CopyError("damaged", "a file does not match the copy's list");
}

/** A copy downloaded into the staging folder: its version, and its files as they will be synced once swapped in. */
export interface DownloadedCopy {
  version: number;
  pictures: boolean;
  files: Record<string, Omit<SyncedFile, "mtimeMs">>;
  /** Its manifest sealed its version. */
  sealed?: boolean;
}

/**
 * Moves a file or folder, also from one drive to another (the module files folder may be elsewhere). Across drives
 * `to` appears only once it is whole, and `from` is renamed away before it is deleted, so a move cut off at any point
 * leaves one whole side to go on from (swapOne).
 */
async function move(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  // A rename would silently replace a file that is there, and a backup is never written over.
  if (await exists(to)) throw new Error(`${to} is already there`);
  try {
    await renameHeld(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    const part = `${to}.part`;
    await rm(part, { recursive: true, force: true });
    await cp(from, part, { recursive: true });
    await renameHeld(part, to);
    const done = `${from}.moved`;
    await renameHeld(from, done);
    await rm(done, { recursive: true, force: true });
  }
}

/** `target`, or with a number after it when that name is taken. */
async function freePath(target: string): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? target : `${target}.${n}`;
    if (!(await exists(candidate))) return candidate;
  }
}

/** Where a swap's backup keeps what was written in a place after the swap began (the app ran on a swap that failed). */
export const WRITTEN_SINCE = "written-since";

/** After a name in `written-since`: what the copy or the app had put in a place when a swap was taken back. */
const UNDONE = ".undone";

/** A place's name in `written-since` without what freePath or a swap taken back added to it. */
const plainName = (name: string) => name.replace(/(\.undone)?(\.\d+)?$/, "");

/** The date of a synced file that was changed after it arrived: no real file has it, so it counts as changed. */
const CHANGED_SINCE = -1;

/** Where one root (or one entry of a root) is during a swap. */
interface SwapPlace {
  place: string;
  staged: string;
  kept: string;
  /** Where something written since the swap began goes. */
  since: string;
  inCopy: boolean;
}

/** Every root the copy replaces, or for a folder the user may share each of Tavora's entries in it. */
async function swapPlaces(staging: string, roots: CopyRoot[], keepIn: string, copy: DownloadedCopy): Promise<SwapPlace[]> {
  // What the copy holds, by root and by a root's top-level entry.
  const held = new Set<string>();
  for (const file of Object.keys(copy.files)) {
    const [root, entry] = file.split("/");
    held.add(root!);
    if (entry !== undefined) held.add(`${root}/${entry}`);
  }
  const places: SwapPlace[] = [];
  for (const root of roots.filter((candidate) => copy.pictures || !candidate.picture)) {
    const staged = path.join(staging, root.name);
    const kept = path.join(keepIn, root.name);
    const since = path.join(keepIn, WRITTEN_SINCE, root.name);
    if (!root.keep) {
      places.push({ place: root.path, staged, kept, since, inCopy: held.has(root.name) });
      continue;
    }
    // Only Tavora's own entries of a folder the user may share (the module files folder). One a later start moved into
    // `written-since` may be nowhere else.
    const here = (await namesIn(root.path)).filter(root.keep);
    const movedSince = (await namesIn(since)).map(plainName).filter(root.keep);
    const names = new Set([...here, ...(await namesIn(staged)), ...(await namesIn(kept)), ...movedSince]);
    for (const name of names) places.push({ place: path.join(root.path, name), staged: path.join(staged, name), kept: path.join(kept, name), since: path.join(since, name), inCopy: held.has(`${root.name}/${name}`) });
  }
  return places;
}

/**
 * Puts one root (or one entry of a root) of the copy in place. Safe to run again after being cut off at any point:
 * something the copy holds whose staged side is gone is in place already and stays. Once what was here is kept, whatever
 * is here now (a half-finished arrival, or what the app wrote after a swap failed) goes aside, never over the backup.
 */
async function swapOne({ place, staged, kept, since, inCopy }: SwapPlace, resumed: boolean): Promise<void> {
  await rm(`${place}.moved`, { recursive: true, force: true });
  const waiting = await exists(staged);
  if (!waiting && inCopy) return;
  // A swap going on from an earlier start: the app may have run on this place since, so it counts as written since
  // until sortWrittenSince has told what really changed.
  if (await exists(place)) await move(place, resumed || (await exists(kept)) ? await freePath(since) : kept);
  if (waiting) await move(staged, place);
}

/**
 * Sorts what a settled swap put in `written-since`, so only real work stays there. A file with the copy's content, or with
 * that of an `earlier` copy this swap was putting in before its list was lost, is no one's work and goes; one as this PC
 * last synced it (`before`) is an ordinary backup and joins the rest. What can't be read stays, as it may be work. True
 * when anything is left: the user is told, and pruning keeps it.
 */
export async function sortWrittenSince(keepIn: string, copy: DownloadedCopy, before: CopyState, earlier: readonly DownloadedCopy[] = []): Promise<boolean> {
  const root = path.join(keepIn, WRITTEN_SINCE);
  const walk = async (dir: string, name: string): Promise<void> => {
    const names = await lookNames(dir);
    if (names.status !== "present") return;
    for (const entry of names.value) {
      const file = path.join(dir, entry);
      // A place's own name may carry what freePath or a swap taken back added to it; below that, names are as they were.
      const plain = name.split("/").length < 2 ? plainName(entry) : entry;
      const inCopy = name ? `${name}/${plain}` : plain;
      const info = await lookStat(file);
      if (info.status !== "present") continue;
      if (info.value.isDirectory()) {
        await walk(file, inCopy);
        await rmdir(file).catch(() => undefined);
        continue;
      }
      const sha = await look(() => fileSha256(file));
      if (sha.status !== "present") continue;
      if (copy.files[inCopy]?.sha256 === sha.value || earlier.some((other) => other.files[inCopy]?.sha256 === sha.value)) {
        await rm(file, { force: true }).catch(() => undefined);
      } else if (before.files[inCopy]?.sha256 === sha.value) {
        const kept = path.join(keepIn, ...inCopy.split("/"));
        const there = await lookStat(kept);
        if (there.status === "missing") await move(file, kept).catch(() => undefined);
        else if (there.status === "present") {
          const same = await look(() => fileSha256(kept));
          if (same.status === "present" && same.value === sha.value) await rm(file, { force: true }).catch(() => undefined);
        }
      }
    }
  };
  await walk(root, "");
  await rmdir(root).catch(() => undefined);
  return (await lookStat(root)).status !== "missing";
}

/** The places a copy will fill that hold nothing now, noted before a swap so taking it back can empty them again. */
export async function emptyPlaces(staging: string, roots: CopyRoot[], keepIn: string, copy: DownloadedCopy): Promise<string[]> {
  const empty: string[] = [];
  for (const { place, inCopy } of await swapPlaces(staging, roots, keepIn, copy)) if (inCopy && !(await exists(place))) empty.push(place);
  return empty;
}

/**
 * The same for another copy once a swap has begun (its list was lost, and a newer copy takes its place): what was empty
 * before (`before`), and a place the new copy holds with nothing in it, in the backup or in `written-since`.
 */
export async function emptyPlacesSince(staging: string, roots: CopyRoot[], keepIn: string, copy: DownloadedCopy, before: readonly string[]): Promise<string[]> {
  const empty = new Set(before);
  for (const { place, kept, since, inCopy } of await swapPlaces(staging, roots, keepIn, copy)) {
    if (!inCopy || (await exists(place)) || (await exists(kept))) continue;
    if ((await namesIn(path.dirname(since))).some((name) => plainName(name) === path.basename(since))) continue;
    empty.add(place);
  }
  return [...empty];
}

/**
 * The same, told afterwards when the swap's plan is lost: a place the copy holds that has nothing in the backup, in
 * `written-since` or still waiting in the staging folder held nothing before the swap.
 */
export async function filledPlaces(staging: string, roots: CopyRoot[], keepIn: string, copy: DownloadedCopy): Promise<string[]> {
  const empty: string[] = [];
  for (const { place, staged, kept, since, inCopy } of await swapPlaces(staging, roots, keepIn, copy)) {
    if (!inCopy || (await exists(staged)) || (await exists(kept))) continue;
    if ((await namesIn(path.dirname(since))).some((name) => plainName(name) === path.basename(since))) continue;
    empty.push(place);
  }
  return empty;
}

/**
 * Takes back a swap that didn't finish, when the user would rather have this PC's data. What was here goes back in its
 * place: from the backup, or from `written-since` when a later start moved it there. What the copy or the app put in the
 * place goes aside as `.undone`, which is never taken for the original, so running this again changes nothing. Going back
 * to the backup sets what `written-since` holds for the place aside first, so a second run can't take that for the
 * original either. A place that was `empty` before is emptied again. The caller clears the staging.
 */
export async function undoSwap(staging: string, roots: CopyRoot[], keepIn: string, copy: DownloadedCopy, empty: readonly string[]): Promise<void> {
  for (const { place, kept, since } of await swapPlaces(staging, roots, keepIn, copy)) {
    await rm(`${place}.moved`, { recursive: true, force: true });
    const isThere = await exists(place);
    const wasEmpty = empty.includes(place);
    const original = (await exists(kept)) ? kept : !wasEmpty && (await exists(since)) ? since : null;
    if (original) {
      if (original === kept && (await exists(since))) await move(since, await freePath(`${since}${UNDONE}`));
      if (isThere) await move(place, await freePath(`${since}${UNDONE}`));
      await move(original, place);
    } else if (isThere && wasEmpty) {
      await move(place, await freePath(`${since}${UNDONE}`));
    }
  }
}

/**
 * Puts a downloaded copy (in `staging`) in place of this PC's data, after moving what was there into
 * `keepIn`, so the side not kept stays as a local backup. A copy that left out pictures leaves this PC's
 * pictures where they are. Only runs while nothing reads the data (before the workspaces load). Cut off, it
 * is run again with the same `keepIn` and `resumed`, and goes on where it stopped (swapOne); a file the app changed
 * in place meanwhile then counts as changed, so it goes up instead of passing for what the copy holds.
 * Returns the state to keep: the copy's files with their dates on this PC.
 */
export async function swapInCopy(staging: string, roots: CopyRoot[], keepIn: string, copy: DownloadedCopy, resumed = false): Promise<CopyState> {
  const taking = roots.filter((root) => copy.pictures || !root.picture);
  await mkdir(keepIn, { recursive: true });
  for (const place of await swapPlaces(staging, roots, keepIn, copy)) await swapOne(place, resumed);
  await rm(staging, { recursive: true, force: true });
  const files: Record<string, SyncedFile> = {};
  for (const found of await scanCopy(taking)) {
    const synced = copy.files[found.path];
    if (!synced) continue;
    const same = !resumed || (found.size === synced.size && (await fileSha256(found.file)) === synced.sha256);
    files[found.path] = { ...synced, mtimeMs: same ? found.mtimeMs : CHANGED_SINCE };
  }
  return { version: copy.version, pictures: copy.pictures, files, ...(copy.sealed ? { sealed: true } : {}) };
}

// What this PC keeps about the copy: the state in cloud-copy.json (paths, sizes, hashes and part ids,
// nothing of the content). The key is the account's (account-key.ts).

/**
 * The state as saved, or held when it is busy or damaged (a damaged one is also copied aside and left where it is, as
 * its being there says the copy is on; the user isn't told, as nothing of theirs is in it). One a newer Tavora wrote is
 * copied aside and counts as empty.
 */
export async function lookCopyState(file: string): Promise<Looked<CopyState>> {
  const bytes = await lookBytes(file);
  if (bytes.status !== "present") return bytes;
  const read = await look(() => checkSavedFile(file, bytes.value, { version: STORE_VERSIONS.cloudCopy, versionKey: "v", notice: false, leaveInPlace: true }));
  if (read.status === "held") return read;
  const saved = read.status === "present" ? read.value : null;
  const damaged: Looked<CopyState> = { status: "held", error: new DamagedFile(`${file} is damaged`) };
  if (saved === null) return damaged;
  if (typeof saved.v === "number" && saved.v > STORE_VERSIONS.cloudCopy) return { status: "present", value: EMPTY_STATE };
  if (saved.v !== STORE_VERSIONS.cloudCopy) return damaged;
  if (typeof saved.version !== "number" || typeof saved.files !== "object" || saved.files === null) return damaged;
  return { status: "present", value: { version: saved.version, pictures: saved.pictures !== false, files: saved.files as Record<string, SyncedFile>, ...(saved.kept === true ? { kept: true } : {}), ...(saved.sealed === true ? { sealed: true } : {}) } };
}

/** The state as saved, or the empty one when it can't be used. */
export async function loadCopyState(file: string): Promise<CopyState> {
  const looked = await lookCopyState(file);
  return looked.status === "present" ? looked.value : EMPTY_STATE;
}

/** Writes the state. During a swap it goes to another file than cloud-copy.json (CopySync.parkState). */
export async function saveCopyState(file: string, state: CopyState): Promise<void> {
  await writeFileAtomic(file, JSON.stringify({ v: STORE_VERSIONS.cloudCopy, version: state.version, pictures: state.pictures, files: state.files, ...(state.kept ? { kept: true } : {}), ...(state.sealed ? { sealed: true } : {}) }));
}
