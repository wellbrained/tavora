// Folders on this PC a module may read (manifest permissions.folders, the decision log of 2026-11-05). The manifest
// names a folder below Documents, Saved Games or AppData\LocalLow (a game's own folder there, 2026-11-13) and the file
// extensions it may see; the user grants it like any other permission (grants.ts). The module may list it (subfolders
// too), read the files of its `read` extensions, see the files of its `names` extensions by name, and hear about
// changes. It never writes, never follows a link out of the folder and never learns where the folder is: it names the
// folder by its manifest path and every file by its path inside it. When the folder is not where the manifest says, the user can show Tavora where it is, in the system's own
// folder dialog; that choice stays on this PC (outside backups and cloud copies), per publisher and module.

import { realpathSync, watch, type FSWatcher } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { folderKey, isFolderName, isLocalLowGameFolder, KEY_EXTENSIONS, isModuleId, isOwnerId, splitFolderPath, type FolderAccess, type FolderRoot } from "@tavora/module-schema";
import type { FolderChange, FolderEntry, FolderListing, FolderState } from "@tavora/sdk/protocol";
import { readBody } from "./clipboard-http";
import { HostError } from "./errors";
import { writeFileAtomic } from "./fsutil";

export const FOLDER_ACCESS_DIR = "folder-access";
/** Most files one listing holds, and most folders below the granted one it goes into. */
export const MAX_FOLDER_FILES = 20_000;
export const MAX_FOLDER_LEVELS = 8;
/** Most folders one listing looks into, so a huge tree with few matching files can't hold Tavora up. */
export const MAX_FOLDER_DIRECTORIES = 5_000;
/** The biggest file a module may read from a folder. */
export const MAX_FOLDER_READ_BYTES = 50 * 1024 * 1024;
/** How long changes gather before the module hears of them, and most changed paths in one notice. */
const CHANGE_WAIT_MS = 400;
const MAX_CHANGES = 500;
/** A Windows 8.3 short name, such as PASSWO~1.TXT. */
const SHORT_NAME = /^[^.~]{1,6}~[0-9]+(?:\.[^.]{0,3})?$/;
/**
 * Folders that hold a browser's or WebView2's profile, with sign-ins in plain files (site storage, cookies), wherever
 * they are: never listed, read or reported, under any root, as if they weren't there. Lowercase; compared without
 * regard to case. A folder that directly holds a file named PROFILE_MARKER (Chromium's User Data folder) counts too.
 */
export const BROWSER_PROFILE_FOLDERS: readonly string[] = ["ebwebview", "local storage", "session storage", "indexeddb", "user data", "network", "cookies"];
const PROFILE_MARKER = "Local State";
const isProfileName = (name: string) => BROWSER_PROFILE_FOLDERS.includes(name.toLowerCase());

/** Whether a folder directly holds PROFILE_MARKER (anything but a folder by that name). */
async function holdsProfileMarker(dir: string): Promise<boolean> {
  const info = await lstat(path.join(dir, PROFILE_MARKER)).catch(() => null);
  return info !== null && !info.isDirectory();
}

/**
 * Whether a folder on this PC is a browser profile or lies in one: a folder on its path named like one, or it or a
 * folder above it holding PROFILE_MARKER.
 */
export async function isBrowserProfile(folder: string): Promise<boolean> {
  const resolved = path.resolve(folder);
  const { root } = path.parse(resolved);
  if (path.relative(root, resolved).split(path.sep).some(isProfileName)) return true;
  for (let at = resolved; ; ) {
    if (await holdsProfileMarker(at)) return true;
    const up = path.dirname(at);
    if (up === at) return false;
    at = up;
  }
}

/**
 * Whether `folders` below the granted folder `base` lead into a browser profile: a name like one, or PROFILE_MARKER in
 * `base` (it may have come after the folder was found) or a folder on the way.
 */
async function inBrowserProfile(base: string, folders: readonly string[]): Promise<boolean> {
  if (folders.some(isProfileName)) return true;
  for (let depth = 0; depth <= folders.length; depth++) if (await holdsProfileMarker(path.join(base, ...folders.slice(0, depth)))) return true;
  return false;
}

/** Where things are on this PC, for finding and checking folders. */
export interface FolderPlaces {
  /** The folder each root of FOLDER_ROOTS stands for. */
  roots: Record<FolderRoot, string>;
  /** The user's own folder. */
  home: string;
  /** Tavora's data folder. */
  userData: string;
  /** Folders nothing inside may be read from: AppData (Roaming and Local), ProgramData, Windows. */
  closed?: string[];
  /**
   * The user's own known folders (Desktop, Downloads, Pictures, OneDrive...): a folder inside one is fine, the folder
   * itself or one holding it is not, so a pick can't take in more than a manifest could name.
   */
  known?: string[];
  /**
   * Tavora's own folders on this PC, where it saves things for the user and for every module: Documents\Tavora (key
   * files, module zips, every module's saved files), Pictures\Tavora, Downloads\Tavora, the module files folder and
   * the cloud copy's folder. Nothing inside them or holding them may be read. A drive given here counts for nothing.
   */
  own?: string[];
}

const win = process.platform === "win32";
const same = (a: string) => (win ? a.toLowerCase() : a);
/** Whether `inner` is `outer` or inside it. */
function within(inner: string, outer: string): boolean {
  const a = same(path.resolve(inner));
  const b = same(path.resolve(outer));
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

const resolvedPlaces = new Map<string, { forms: string[]; at: number }>();
/**
 * A place as given and with its links resolved (a profile on a junction, a redirected AppData), when that differs. A
 * place that isn't there yet (Documents\Tavora before the first save) resolves through the nearest folder above it
 * that is, so it is the same place once it is made. Kept for a minute, so a folder call doesn't ask the system about
 * every place each time.
 */
function forms(place: string): string[] {
  const kept = resolvedPlaces.get(place);
  if (kept && Date.now() - kept.at < 60_000) return kept.forms;
  let found = [place];
  const given = path.resolve(place);
  const rest: string[] = [];
  for (let at = given; ; ) {
    try {
      const real = path.join(realpathSync.native(at), ...rest);
      if (same(real) !== same(given)) found = [place, real];
      break;
    } catch {
      // Not there: try the folder above, up to the drive, which counts as given.
      const up = path.dirname(at);
      if (up === at) break;
      rest.unshift(path.basename(at));
      at = up;
    }
  }
  if (resolvedPlaces.size > 200) resolvedPlaces.clear();
  resolvedPlaces.set(place, { forms: found, at: Date.now() });
  return found;
}

/**
 * A folder no module may read, whatever the user picks: a network or device path, a drive, the user's own folder or
 * one holding it, another user's folder, a dot-folder of the user's (.ssh, .aws...), anything in AppData, ProgramData
 * or Windows, Tavora's data folder and its own folders such as Documents\Tavora (anything in them or holding them),
 * and the known folders themselves (Documents, Saved Games, Desktop, Downloads...) or one holding them. A folder inside
 * a known folder, such as Documents\My Game, is fine. Every place counts as given and with its links resolved.
 *
 * The one way into AppData is a game's folder in AppData\LocalLow, as a manifest could name it (isLocalLowGameFolder):
 * at least a company and a game folder below it, the company not one of the system's or a browser's. Only the folder
 * really there counts, never LocalLow reached through a link: `folder` is a real path, so a junction from LocalLow into
 * Local or Roaming ends up there and is refused like them.
 */
export function isRefusedFolder(folder: string, full: Partial<FolderPlaces> & Pick<FolderPlaces, "home" | "userData">): boolean {
  const resolved = path.resolve(folder);
  if (win && (resolved.startsWith("\\\\") || resolved.startsWith("//"))) return true;
  const root = same(path.parse(resolved).root);
  if (root === same(resolved) || root === same(resolved + path.sep)) return true;
  const homes = forms(full.home);
  // Below LocalLow (also where it really is, when it is a link), only a game's folder.
  for (const low of homes.flatMap((home) => forms(path.join(home, "AppData", "LocalLow")))) {
    if (within(resolved, low) && !isLocalLowGameFolder(path.relative(low, resolved).split(path.sep))) return true;
  }
  for (const home of homes) {
    if (within(home, resolved)) return true;
    // Another user's folder: inside the folder that holds the user's own (such as Users), but not inside the user's own.
    // Not when the user's folder sits right on a drive, where that would be the whole drive.
    const users = path.dirname(home);
    if (same(path.parse(users).root) !== same(users) && within(resolved, users) && !within(resolved, home)) return true;
    if (within(resolved, home)) {
      const first = path.relative(home, resolved).split(path.sep)[0] ?? "";
      if (first.startsWith(".")) return true;
    }
    if (within(resolved, path.join(home, "AppData")) && !within(resolved, path.join(home, "AppData", "LocalLow"))) return true;
  }
  for (const closed of (full.closed ?? []).flatMap(forms)) if (within(resolved, closed)) return true;
  // A drive as one of Tavora's own folders would shut every folder on it: drives are refused on their own above.
  const own = (full.own ?? []).filter((place) => same(path.parse(path.resolve(place)).root) !== same(path.resolve(place)));
  for (const data of [full.userData, ...own].flatMap(forms)) if (within(resolved, data) || within(data, resolved)) return true;
  const known = [...(full.known ?? []), ...Object.values(full.roots ?? {})].flatMap(forms);
  return known.some((place) => within(place, resolved));
}

/** Where the manifest says the folder is: its root's folder, then the names below it. */
export function defaultFolder(entry: FolderAccess, places: Pick<FolderPlaces, "roots">): string {
  const { root, names } = splitFolderPath(entry.path)!;
  return path.join(places.roots[root], ...names);
}

/** The folder the user showed Tavora for a manifest path, kept per publisher and module, never given to a module. */
export class ChosenFolders {
  private readonly file: string;
  constructor(userData: string, owner: string, moduleId: string) {
    if (!isOwnerId(owner) || !isModuleId(moduleId)) throw Error("Invalid folder scope");
    this.file = path.join(userData, FOLDER_ACCESS_DIR, owner, moduleId, "folders.json");
  }
  private async all(): Promise<Record<string, string>> {
    try {
      const value = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === "string" && path.isAbsolute(pair[1])));
    } catch {
      return {};
    }
  }
  async get(folder: string): Promise<string | undefined> {
    return (await this.all())[folder];
  }
  async set(folder: string, place: string | null): Promise<void> {
    const all = await this.all();
    if (place) all[folder] = place;
    else delete all[folder];
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFileAtomic(this.file, JSON.stringify(all));
  }
}

/**
 * The folder a module reads for an entry, links resolved: the one the user chose, else where the manifest says. Null
 * when it isn't there, isn't a folder or is one no module may read.
 */
export async function findFolder(entry: FolderAccess, chosen: ChosenFolders, places: FolderPlaces): Promise<string | null> {
  const place = (await chosen.get(entry.path)) ?? defaultFolder(entry, places);
  try {
    const real = await realpath(place);
    if (!(await stat(real)).isDirectory() || isRefusedFolder(real, places) || (await isBrowserProfile(real))) return null;
    return real;
  } catch {
    return null;
  }
}

/** What a module may do with a file of this name: read it, see its name, or nothing. */
export function kindOf(name: string, entry: FolderAccess): "read" | "name" | null {
  const extension = path.extname(name).slice(1).toLowerCase();
  if (!extension) return null;
  if (entry.read?.includes(extension)) return KEY_EXTENSIONS.includes(extension) ? "name" : "read";
  if (entry.names?.includes(extension)) return "name";
  return null;
}

/**
 * Lists the files a module may see in a folder, subfolders too (MAX_FOLDER_LEVELS deep), with paths inside it joined
 * by `/`. Links and junctions are left out, so nothing outside the folder shows. Stops at MAX_FOLDER_FILES files or
 * MAX_FOLDER_DIRECTORIES folders, with `truncated`.
 */
export async function listFolder(base: string, entry: FolderAccess): Promise<FolderListing> {
  const files: FolderEntry[] = [];
  const queue: { dir: string; rel: string[] }[] = [{ dir: base, rel: [] }];
  let directories = 0;
  let truncated = false;
  while (queue.length > 0) {
    const { dir, rel } = queue.shift()!;
    if (++directories > MAX_FOLDER_DIRECTORIES) {
      truncated = true;
      break;
    }
    const items = await readdir(dir, { withFileTypes: true }).catch(() => []);
    // A browser profile's folder shows nothing, as if it weren't there.
    if (items.some((item) => !item.isDirectory() && item.name.toLowerCase() === PROFILE_MARKER.toLowerCase())) continue;
    for (const item of items) {
      if (!isInsideName(item.name)) continue;
      let isDirectory = item.isDirectory();
      let isFile = item.isFile();
      if (item.isSymbolicLink()) {
        // A listing calls every reparse point a link, also a cloud file (OneDrive's files on demand); ask the file
        // itself, which says link only for real links and junctions.
        const info = await lstat(path.join(dir, item.name)).catch(() => null);
        if (!info || info.isSymbolicLink()) continue;
        isDirectory = info.isDirectory();
        isFile = info.isFile();
      }
      if (isDirectory) {
        if (rel.length < MAX_FOLDER_LEVELS && !isProfileName(item.name)) queue.push({ dir: path.join(dir, item.name), rel: [...rel, item.name] });
        continue;
      }
      if (!isFile) continue;
      const kind = kindOf(item.name, entry);
      if (!kind) continue;
      if (files.length >= MAX_FOLDER_FILES) {
        truncated = true;
        break;
      }
      const info = await lstat(path.join(dir, item.name)).catch(() => null);
      if (!info?.isFile()) continue;
      files.push({ path: [...rel, item.name].join("/"), size: info.size, modifiedAt: Math.floor(info.mtimeMs), readable: kind === "read" });
    }
    if (truncated) break;
  }
  return { files, truncated };
}

/** A file or folder name inside the folder: like a manifest's folder names (isFolderName), but up to 255 characters. */
function isInsideName(name: string): boolean {
  return isFolderName(name, 255);
}

/** The parts of a path inside the folder a module gave, or null when it can't be one (`..`, a drive, a backslash...). */
export function insidePath(relative: unknown): string[] | null {
  if (typeof relative !== "string" || relative.length === 0 || relative.length > 2600) return null;
  const parts = relative.split("/");
  if (parts.length > MAX_FOLDER_LEVELS + 1 || !parts.every(isInsideName)) return null;
  return parts;
}

/**
 * A path inside the folder as it really is: its real place must be exactly the path asked for (case aside), so a
 * Windows short name (PASSWO~1.TXT for passwords.txtbackup), a link or a junction is never a way to another file.
 * Null when it isn't there or isn't that.
 */
async function exactly(base: string, parts: string[]): Promise<string | null> {
  const full = path.join(base, ...parts);
  const real = await realpath(full).catch(() => null);
  return real && same(real) === same(full) && within(real, base) && same(real) !== same(base) ? real : null;
}

/**
 * What to show in Explorer: the file itself, or (when it is gone) the folder it was in. Always inside the granted
 * folder, apart from the granted folder itself. It is only ever selected in its own folder, never opened.
 */
export interface RevealTarget {
  path: string;
  kind: "file" | "folder";
}

/**
 * Where folders.showInFolder shows a file: the same path and kind rules as a listing (an extension of `read` or `names`,
 * the real place exactly the path asked for, so no `..`, drive, short name, link or junction leads out), and a file that
 * is gone shows the folder it was in, when that is exactly the path it should be and inside the folder. When there is
 * nothing to show (not even that folder) the answer is null, not an error, so the module can't tell by the answer which
 * subfolders exist: the same call, the same `null`, whether Explorer opened or not.
 */
export async function revealTarget(base: string, entry: FolderAccess, relative: unknown): Promise<RevealTarget | null> {
  const parts = insidePath(relative);
  if (!parts) throw new HostError("INVALID_PARAMS", "Not a file in this folder.");
  if (!kindOf(parts.at(-1)!, entry)) throw new HostError("PERMISSION_DENIED", "This module may not see this kind of file.");
  // In a browser profile there is nothing to show, not even its folder.
  if (await inBrowserProfile(base, parts.slice(0, -1))) return null;
  const real = await exactly(base, parts);
  if (real && kindOf(path.basename(real), entry)) {
    const info = await lstat(real).catch(() => null);
    if (info?.isFile()) return { path: real, kind: "file" };
  }
  // Not there (or not that file): its folder, which must itself be exactly where the path says, not a link out.
  const parent = parts.slice(0, -1);
  const folder = parent.length === 0 ? base : await exactly(base, parent);
  if (!folder || !(await stat(folder).catch(() => null))?.isDirectory()) return null;
  return { path: folder, kind: "folder" };
}

const reading = new Map<string, number>();
/** The listing running for each module and folder, shared by every panel of the module. */
const listings = new Map<string, Promise<FolderListing>>();

/**
 * Reads one file a module may read in a folder: an extension of `read`, inside the folder once links are resolved, a
 * file, at most MAX_FOLDER_READ_BYTES, unchanged while it was read. `scope` names the module, so one module can't hold
 * up the others: two reads at a time each.
 */
export async function readFolderFile(base: string, entry: FolderAccess, relative: unknown, scope: string): Promise<Buffer> {
  const parts = insidePath(relative);
  if (!parts) throw new HostError("INVALID_PARAMS", "Not a file in this folder.");
  if (kindOf(parts.at(-1)!, entry) !== "read") throw new HostError("PERMISSION_DENIED", "This module may not read this kind of file.");
  const active = reading.get(scope) ?? 0;
  if (active >= 2) throw new HostError("QUOTA_EXCEEDED", "Files are already being read. Try again.");
  reading.set(scope, active + 1);
  try {
    // Missing, not exactly this file (a short name, a link) or in a browser profile: the same answer, so nothing can be
    // learned from it.
    const real = (await inBrowserProfile(base, parts.slice(0, -1))) ? null : await exactly(base, parts);
    if (!real || kindOf(path.basename(real), entry) !== "read") throw new HostError("BAD_REQUEST", "Can't find this file. It may have moved.");
    const handle = await open(real, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new HostError("INVALID_PARAMS", "Not a file in this folder.");
      // A hard link can be a file outside the folder by another name: such a file is not read.
      if (info.nlink > 1) throw new HostError("BAD_REQUEST", "Can't find this file. It may have moved.");
      if (info.size > MAX_FOLDER_READ_BYTES) throw new HostError("QUOTA_EXCEEDED", "This file is bigger than 50 MB.");
      const bytes = Buffer.alloc(info.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const part = await handle.read(bytes, size, bytes.length - size, size);
        if (!part.bytesRead) break;
        size += part.bytesRead;
      }
      if (size !== info.size || (await handle.stat()).mtimeMs !== info.mtimeMs) throw new HostError("BAD_REQUEST", "The file changed while being read. Try again.");
      return bytes.subarray(0, size);
    } finally {
      await handle.close();
    }
  } finally {
    const left = (reading.get(scope) ?? 1) - 1;
    if (left) reading.set(scope, left);
    else reading.delete(scope);
  }
}

/** Where a folder is and whether a module may read it now, without saying where. */
export function folderState(entry: FolderAccess | null, base: string | null): FolderState {
  if (!entry) return { found: false, reason: "not-granted" };
  return base ? { found: true } : { found: false, reason: "missing" };
}

/**
 * Watches a folder for files the module may see being added, changed or removed, and tells `notify` after a short
 * wait, with paths inside the folder. Paths too deep, of other kinds, or that lead out through a link are left out.
 * When the system can't say which file changed, or too many did, the notice asks the module to list again (`rescan`).
 */
export class FolderWatch {
  private watcher: FSWatcher | undefined;
  private pending = new Set<string>();
  private rescan = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    private readonly folder: string,
    private readonly base: string,
    private readonly entry: FolderAccess,
    private readonly notify: (change: FolderChange) => void,
  ) {
    try {
      this.watcher = watch(base, { recursive: true, persistent: false }, (event, name) => this.saw(event, name ? String(name) : null));
      this.watcher.on("error", () => this.close());
    } catch {
      this.watcher = undefined;
    }
  }

  /** Whether the system watches the folder (it can't on some drives). */
  get watching(): boolean {
    return this.watcher !== undefined && !this.closed;
  }

  private saw(event: string, name: string | null): void {
    if (this.closed) return;
    if (name === null) this.rescan = true;
    else {
      const parts = name.split(/[\\/]/).filter(Boolean);
      if (parts.length === 0) return;
      if (kindOf(parts.at(-1)!, this.entry)) {
        if (parts.length <= MAX_FOLDER_LEVELS + 1) this.pending.add(parts.join("/"));
      } else if (event === "rename" && !path.extname(parts.at(-1)!) && parts.length <= MAX_FOLDER_LEVELS) {
        // A folder added, removed, renamed or moved in may hold files of its own: only a listing finds them. A folder
        // that merely "changed" is the system saying a file in it did, which comes as a notice of its own.
        this.rescan = true;
      }
      if (this.pending.size > MAX_CHANGES) this.rescan = true;
    }
    this.timer ??= setTimeout(() => void this.flush(), CHANGE_WAIT_MS);
  }

  private async flush(): Promise<void> {
    this.timer = undefined;
    const names = [...this.pending];
    const rescan = this.rescan;
    this.pending.clear();
    this.rescan = false;
    if (this.closed) return;
    if (rescan) {
      this.notify({ folder: this.folder, changed: [], removed: [], rescan: true });
      return;
    }
    const changed: FolderEntry[] = [];
    const removed: string[] = [];
    let unsure = false;
    for (const name of names) {
      const parts = insidePath(name);
      if (!parts || (await inBrowserProfile(this.base, parts.slice(0, -1)))) continue;
      const full = path.join(this.base, ...parts);
      const info = await lstat(full).catch(() => null);
      if (!info) {
        // The system can name a file by its short name (PASSWO~1.TXT), which says nothing of what it really was: a
        // listing finds out instead of passing that name on.
        if (parts.some((part) => SHORT_NAME.test(part))) unsure = true;
        else removed.push(name);
        continue;
      }
      if (!info.isFile()) continue;
      // Exactly the file named, of a kind the module may see: never a short name or a link to another one.
      const real = await exactly(this.base, parts);
      const kind = real ? kindOf(path.basename(real), this.entry) : null;
      if (!real || !kind) {
        // A short name of a file that is there may stand for one the module may see: a listing tells.
        if (parts.some((part) => SHORT_NAME.test(part))) unsure = true;
        continue;
      }
      changed.push({ path: name, size: info.size, modifiedAt: Math.floor(info.mtimeMs), readable: kind === "read" });
    }
    if (this.closed) return;
    if (unsure) this.notify({ folder: this.folder, changed: [], removed: [], rescan: true });
    else if (changed.length + removed.length > 0) this.notify({ folder: this.folder, changed, removed, rescan: false });
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.watcher?.close();
    this.watcher = undefined;
  }
}

/** The granted entry of a module for a manifest path, or null: the module asks for it now and the user said yes. */
export function grantedFolder(folders: readonly FolderAccess[] | undefined, allowed: ReadonlySet<string>, folder: unknown): FolderAccess | null {
  if (typeof folder !== "string") return null;
  const entry = (folders ?? []).find((item) => item.path === folder);
  return entry && allowed.has(folderKey(entry)) ? entry : null;
}

/** The folders of one module as Tavora serves them to its pages, the grant asked again on every call. */
export interface FolderHost {
  state(folder: unknown): Promise<FolderState>;
  list(folder: unknown): Promise<FolderListing>;
  read(folder: unknown, relative: unknown): Promise<Buffer>;
  /** What folders.showInFolder shows for a file (revealTarget), the grant asked again; the caller opens it. */
  reveal(folder: unknown, relative: unknown): Promise<RevealTarget | null>;
  /** Starts watching a granted folder that is there; null when it isn't, or the system can't watch it. */
  watch(folder: unknown, notify: (change: FolderChange) => void): Promise<FolderWatch | null>;
  /** Shows the system's folder dialog for a granted folder; true when the user chose one Tavora accepts. */
  choose(folder: unknown): Promise<boolean>;
}

export interface FolderHostOptions {
  /** The module's permissions.folders, as installed now. */
  folders(): readonly FolderAccess[] | undefined;
  /** The folderKeys the user granted and the module still asks for (grants.ts), asked on every call. */
  allowed(): ReadonlySet<string>;
  chosen: ChosenFolders;
  /** Where things are on this PC, looked up when a call needs them. */
  places(): FolderPlaces;
  /** The system's folder dialog, starting at `start`; the folder picked, or undefined when it was closed. */
  pick(start: string | undefined, entry: FolderAccess): Promise<string | undefined>;
  /** Tells the user a folder they picked can't be used (a drive, their own folder, AppData, Tavora's data). */
  refused(): void;
  /** Names the module, for the read limit. */
  scope: string;
}

export function folderHost(options: FolderHostOptions): FolderHost {
  const granted = (folder: unknown) => grantedFolder(options.folders(), options.allowed(), folder);
  const need = (folder: unknown) => {
    const entry = granted(folder);
    if (!entry) throw new HostError("PERMISSION_DENIED", "This folder isn't allowed for this module.", { capability: "folders" });
    return entry;
  };
  const base = async (entry: FolderAccess) => {
    const found = await findFolder(entry, options.chosen, options.places());
    if (!found) throw new HostError("BAD_REQUEST", "Can't find this folder. Show Tavora where it is.");
    return found;
  };
  return {
    state: async (folder) => {
      const entry = granted(folder);
      return folderState(entry, entry ? await findFolder(entry, options.chosen, options.places()) : null);
    },
    list: async (folder) => {
      const entry = need(folder);
      // One listing of a folder at a time per module: calls made meanwhile get the same answer, so a page can't keep
      // the system's file threads busy.
      const key = `${options.scope}|${folderKey(entry)}`;
      const running = listings.get(key);
      if (running) return running;
      const listing = base(entry).then((found) => listFolder(found, entry));
      listings.set(key, listing);
      try {
        return await listing;
      } finally {
        listings.delete(key);
      }
    },
    read: async (folder, relative) => {
      const entry = need(folder);
      return readFolderFile(await base(entry), entry, relative, options.scope);
    },
    reveal: async (folder, relative) => {
      const entry = need(folder);
      const target = await revealTarget(await base(entry), entry, relative);
      // A grant taken back while the folder was looked at shows nothing.
      need(folder);
      return target;
    },
    watch: async (folder, notify) => {
      const entry = need(folder);
      const found = await findFolder(entry, options.chosen, options.places());
      if (!found) return null;
      const watcher = new FolderWatch(entry.path, found, entry, (change) => {
        // A grant taken back, or a folder moved elsewhere, ends the watch at its next change.
        if (granted(entry.path)) notify(change);
        else watcher.close();
      });
      return watcher.watching ? watcher : null;
    },
    choose: async (folder) => {
      const entry = need(folder);
      const start = (await findFolder(entry, options.chosen, options.places())) ?? options.places().roots[splitFolderPath(entry.path)!.root];
      const picked = await options.pick(start, entry);
      if (!picked || !granted(entry.path)) return false;
      const real = await realpath(picked).catch(() => null);
      if (!real || !(await stat(real).catch(() => null))?.isDirectory()) return false;
      if (isRefusedFolder(real, options.places()) || (await isBrowserProfile(real))) {
        options.refused();
        return false;
      }
      await options.chosen.set(entry.path, real);
      return true;
    },
  };
}

/** Answers folders.read from the module's own page: POST `{ folder, path }` as JSON, the file's bytes back. */
export async function serveFolderFile(request: Request, folders: Pick<FolderHost, "read"> | undefined): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" };
  const fail = (code: string, message: string, status: number) => Response.json({ error: { code, message } }, { status, headers });
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  if (!folders) return fail("UNKNOWN_METHOD", "Update Tavora to read folders.", 400);
  let body: { folder?: unknown; path?: unknown };
  try {
    if (!request.body) throw Error();
    const text = (await readBody(request, 8192, "a folder request")).toString("utf8");
    body = JSON.parse(text) as typeof body;
    if (!body || typeof body !== "object") throw Error();
  } catch {
    return fail("INVALID_PARAMS", "Send { folder, path } as JSON.", 400);
  }
  try {
    return new Response(new Uint8Array(await folders.read(body.folder, body.path)), { headers: { ...headers, "Content-Type": "application/octet-stream" } });
  } catch (error) {
    const known = error instanceof HostError;
    return fail(known ? error.code : "INTERNAL", known ? error.message : "Could not read this file.", known && error.code === "BAD_REQUEST" ? 404 : known && error.code === "PERMISSION_DENIED" ? 403 : 400);
  }
}
