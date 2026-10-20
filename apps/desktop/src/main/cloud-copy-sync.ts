import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { CloudCopyProblem, CloudCopyView } from "../shared/host-api";
import { backupsDir } from "./backup";
import {
  CloudCopy,
  CopyError,
  copyRoots,
  EMPTY_STATE,
  hasLocalChanges,
  loadCopyKey,
  loadCopyState,
  saveCopyKey,
  saveCopyState,
  swapInCopy,
  type CopyRoot,
  type CopyState,
  type CopyStorage,
  type SyncedFile,
} from "./cloud-copy";
import { newCopyKey, parseRecoveryKey, recoveryKey } from "./copy-crypto";
import { checkFolder, FolderStorage } from "./copy-folder";
import type { Encryptor } from "./discord-store";
import { writeFileAtomic } from "./fsutil";
import { PlayerError } from "./messages";

// When the cloud copy syncs (decided 2026-10-19), using the engine in cloud-copy.ts:
// - At start, before anything reads the data, a newer copy is taken when this PC has
//   not changed since it last synced. It may take a few seconds; a copy that takes
//   longer finishes in the background and waits for a restart.
// - While Tavora runs, what changed goes up every few minutes.
// - At close, what is left goes up first; after a few seconds the player sees it and
//   may close anyway.
// - When both this PC and the copy changed, the player keeps one side; the other is
//   kept as a local backup. Settings can also upload or restore by hand.
// - The copy is kept on Tavora's service (needs a sign-in) or in a folder the player
//   picks (decided 2026-10-20; no sign-in). Signing out only turns off the first.

/** How often changes are looked for and uploaded while Tavora runs. */
export const SYNC_EVERY_MS = 3 * 60_000;
/** How long the start waits for a newer copy before the games load without it. */
export const START_BUDGET_MS = 6_000;
/** How long closing waits quietly before it shows that it is still uploading. */
export const CLOSE_QUIET_MS = 3_000;
/** Local backups made when a side was replaced, kept in the backups folder. */
const KEEP_BACKUPS = 3;

/** Library settings that belong to this PC: a copy from another PC never changes them. */
const PC_SETTINGS = ["moduleFilesFolder", "developmentFolders", "dialogFolders", "steamProfile"] as const;

/** A downloaded copy waiting in the staging folder: taken at the next start. */
interface Staged {
  v: 1;
  version: number;
  pictures: boolean;
  files: Record<string, Omit<SyncedFile, "mtimeMs">>;
  /** The player chose it (restore, or keeping the copy's side): taken even though this PC changed. */
  take: boolean;
}

export interface CopySyncOptions {
  userData: string;
  /** False in release builds until accounts go live: the copy never runs. */
  enabled: boolean;
  /** The folder modules keep pictures in, which may be anywhere. */
  moduleFiles: () => string;
  /** The copy on Tavora's service. */
  service: CopyStorage;
  /** The copy in a folder the player picked; FolderStorage unless a test says otherwise. */
  folderStorage?: (folder: string) => CopyStorage;
  encryptor: Encryptor;
  /** Writes what Tavora still holds in memory (library, layout) to disk. */
  flush: () => Promise<void>;
  restart: () => void;
  onChange: (view: CloudCopyView) => void;
  now?: () => Date;
  log?: (line: string) => void;
}

export class CopySync {
  private key: Buffer | null = null;
  /** The folder the copy is kept in, or null for Tavora's service. */
  private folder: string | null = null;
  private cloud: CloudCopy;
  private state: CopyState = EMPTY_STATE;
  private busy: CloudCopyView["busy"] = null;
  private progress: CloudCopyView["progress"] = null;
  private copy: CloudCopyView["copy"] = null;
  private shownKey: string | null = null;
  private askKey = false;
  private conflict = false;
  private restartToTake = false;
  private closing = false;
  private problem: CloudCopyProblem | null = null;
  /** One thing at a time: an upload, a download, a check. */
  private running: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Closing may go on: the last upload is done, or the player closed anyway. */
  private mayClose = false;
  private closeStarted = false;

  constructor(private readonly options: CopySyncOptions) {
    this.cloud = new CloudCopy(options.service);
  }

  /** Where the copy is kept from now on: a folder, or null for the service. */
  private use(folder: string | null): void {
    this.folder = folder;
    this.cloud = new CloudCopy(folder === null ? this.options.service : (this.options.folderStorage ?? ((picked) => new FolderStorage(picked)))(folder));
  }

  private get stateFile() {
    return path.join(this.options.userData, "cloud-copy.json");
  }
  private get keyFile() {
    return path.join(this.options.userData, "cloud-copy-key.json");
  }
  private get placeFile() {
    return path.join(this.options.userData, "cloud-copy-place.json");
  }
  private get stagingDir() {
    return path.join(this.options.userData, "cloud-copy-staging");
  }
  private get stagedData() {
    return path.join(this.stagingDir, "data");
  }
  private get stagedFile() {
    return path.join(this.stagingDir, "staged.json");
  }
  private roots(): CopyRoot[] {
    return copyRoots(this.options.userData, this.options.moduleFiles());
  }
  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
  private log(line: string): void {
    this.options.log?.(line);
  }

  get on(): boolean {
    return this.key !== null;
  }

  view(): CloudCopyView {
    return {
      canKeepKey: this.options.encryptor.isAvailable(),
      on: this.on,
      busy: this.busy,
      progress: this.progress,
      copy: this.copy,
      folder: this.folder,
      limit: this.cloud.storage.limit,
      pictures: this.state.pictures,
      recoveryKey: this.shownKey,
      askKey: this.askKey,
      conflict: this.conflict,
      restartToTake: this.restartToTake,
      closing: this.closing,
      problem: this.problem,
    };
  }

  private changed(): void {
    this.options.onChange(this.view());
  }

  /** Runs one thing after the one before it, showing what it does. */
  private exclusive<T>(busy: NonNullable<CloudCopyView["busy"]>, work: () => Promise<T>): Promise<T> {
    const next = this.running.then(async () => {
      this.busy = busy;
      this.changed();
      try {
        return await work();
      } finally {
        this.busy = null;
        this.progress = null;
        this.changed();
      }
    });
    this.running = next.catch(() => undefined);
    return next;
  }

  /** What went wrong, for the settings page; a quiet run (in the background) keeps it there instead of throwing. */
  private noteProblem(error: unknown): CloudCopyProblem {
    const reason = error instanceof CopyError ? error.reason : "failed";
    this.problem =
      reason === "unreachable" || reason === "unavailable" || reason === "too-many" ? "offline" : reason === "signed-out" || reason === "no-folder" || reason === "not-arrived" ? reason : "failed";
    if (!(error instanceof CopyError) || reason === "failed" || reason === "damaged") this.log(`cloud copy: ${error instanceof Error ? error.message : String(error)}`);
    return this.problem;
  }

  private static playerError(problem: CloudCopyProblem): PlayerError {
    return new PlayerError(`cloudCopy.error.${problem}`);
  }

  // ── Start ──────────────────────────────────────────────────────────

  /**
   * Before anything reads the data: takes a copy waiting from the last run, or a newer one from the
   * service when this PC has not changed since it last synced. Never throws; offline starts as usual.
   */
  async beforeLoad(budgetMs = START_BUDGET_MS): Promise<void> {
    if (!this.options.enabled) return;
    try {
      this.key = await loadCopyKey(this.keyFile, this.options.encryptor);
      this.state = this.key ? await loadCopyState(this.stateFile) : EMPTY_STATE;
      if (this.key) this.use(await loadPlace(this.placeFile));
      if (await this.takeStaged()) return;
      if (!this.key) return;
      let late = false;
      const check = this.fetchNewer().then(async (staged) => {
        if (!staged) return;
        if (!late && (await this.takeStaged())) return;
        // Finished after the games loaded: it waits for a restart.
        this.restartToTake = true;
        this.changed();
      });
      const timer = new Promise<"late">((resolve) => setTimeout(() => resolve("late"), budgetMs).unref?.());
      if ((await Promise.race([check.then(() => "done" as const), timer])) === "late") {
        late = true;
        this.running = check.catch((error: unknown) => void this.noteProblem(error));
      }
    } catch (error) {
      this.noteProblem(error);
    }
  }

  /**
   * Reads the copy's version; when it is newer and this PC has not changed, downloads it into the
   * staging folder. True when a copy is staged. A changed PC gets the keep-which-side question instead.
   */
  private async fetchNewer(): Promise<boolean> {
    const remote = await this.cloud.remote(this.state.version);
    if (!remote) {
      // The copy was deleted (on another PC): it is off here too.
      if (this.state.version > 0) await this.forget("deleted");
      return false;
    }
    this.copy = { size: remote.size, savedAt: remote.updatedAt };
    if (remote.version === this.state.version) return false;
    // Changed here, or this PC's last save lost against another PC's (in a synced folder): the player chooses.
    if (remote.follows === false || (await hasLocalChanges(this.roots(), this.state))) {
      this.conflict = true;
      this.changed();
      return false;
    }
    await this.stage(false);
    return true;
  }

  /** Downloads the copy into the staging folder, to be taken at the next start. */
  private async stage(take: boolean): Promise<Staged | null> {
    await rm(this.stagingDir, { recursive: true, force: true });
    const copy = await this.cloud.download(this.key!, this.roots(), this.stagedData);
    if (!copy) return null;
    const staged: Staged = { v: 1, ...copy, take };
    await writeFileAtomic(this.stagedFile, JSON.stringify(staged));
    return staged;
  }

  /** The copy as it is now in the staging folder: the one staged already when it is still current, else downloaded. */
  private async stageCurrent(take: boolean): Promise<Staged | null> {
    const staged = await this.readStaged();
    const remote = staged ? await this.cloud.remote() : null;
    if (!staged || !remote || remote.version !== staged.version) return this.stage(take);
    if (staged.take !== take) await writeFileAtomic(this.stagedFile, JSON.stringify({ ...staged, take }));
    return { ...staged, take };
  }

  private async readStaged(): Promise<Staged | null> {
    try {
      const staged = JSON.parse(await readFile(this.stagedFile, "utf8")) as Staged;
      return staged.v === 1 && typeof staged.version === "number" && typeof staged.files === "object" ? staged : null;
    } catch {
      return null;
    }
  }

  /** Swaps a staged copy in: when the player chose it, or when this PC has not changed since it last synced. */
  private async takeStaged(): Promise<boolean> {
    const staged = await this.readStaged();
    if (!staged) return false;
    if (!this.key || staged.version <= this.state.version) {
      await rm(this.stagingDir, { recursive: true, force: true });
      return false;
    }
    if (!staged.take && (await hasLocalChanges(this.roots(), this.state))) {
      this.conflict = true;
      return false;
    }
    const library = path.join(this.options.userData, "library.json");
    const ownSettings = await readJson(library);
    const keepIn = await this.backupFolder("this-pc");
    const roots = this.roots();
    this.state = await swapInCopy(this.stagedData, roots, keepIn, staged);
    await rm(this.stagingDir, { recursive: true, force: true });
    await keepPcSettings(library, ownSettings, this.state);
    await saveCopyState(this.stateFile, this.state);
    this.problem = null;
    this.log(`cloud copy: took version ${staged.version}; this PC's data is in ${keepIn}`);
    return true;
  }

  /** A new folder under backups/ for the side that is replaced, keeping the last few. */
  private async backupFolder(side: "this-pc" | "cloud"): Promise<string> {
    const root = backupsDir(this.options.userData);
    await mkdir(root, { recursive: true });
    const old = (await readdir(root)).filter((name) => name.startsWith("cloud-copy-")).sort();
    for (const name of old.slice(0, Math.max(0, old.length - (KEEP_BACKUPS - 1)))) await rm(path.join(root, name), { recursive: true, force: true });
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    return path.join(root, `cloud-copy-${stamp}-${side}`);
  }

  // ── While running ──────────────────────────────────────────────────

  /** After the window shows: syncs every few minutes, and once now. */
  start(): void {
    if (!this.options.enabled) return;
    this.timer = setInterval(() => void this.sync().catch(() => undefined), SYNC_EVERY_MS);
    this.timer.unref?.();
    if (this.on) void this.sync().catch(() => undefined);
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  /** Whether syncing waits on the player (a question, or a restart). */
  private get waiting(): boolean {
    return this.conflict || this.restartToTake || this.askKey;
  }

  /** Uploads what changed. Quiet: problems show in Settings. `loud` throws them for a button. */
  async sync(loud = false): Promise<void> {
    if (!this.on || (this.waiting && !loud)) return;
    if (this.conflict) throw new PlayerError("cloudCopy.error.conflict");
    await this.exclusive("uploading", async () => {
      // What ran before (a download at start) may have left a question.
      if (!this.on || (this.waiting && !loud)) return;
      await this.options.flush();
      try {
        const result = await this.cloud.upload(this.key!, this.roots(), this.state, (done, total) => {
          this.progress = { done, total };
          this.changed();
        });
        if (result.status === "uploaded") {
          this.state = result.state;
          await saveCopyState(this.stateFile, this.state);
          this.copy = { size: result.size, savedAt: this.now().toISOString() };
          this.problem = null;
        } else if (result.status === "unchanged") {
          this.problem = null;
        } else if (result.status === "too-big") {
          this.problem = "too-big";
        } else if (result.version === 0) {
          await this.forget("deleted");
        } else {
          this.conflict = true;
        }
      } catch (error) {
        const problem = this.noteProblem(error);
        if (loud) throw CopySync.playerError(problem);
        return;
      }
      if (loud && this.problem) throw CopySync.playerError(this.problem);
    });
  }

  // ── Settings ───────────────────────────────────────────────────────

  /**
   * Turns the copy on, on the service or in `folder`: a new key when there is no copy there yet, else the
   * copy's recovery key is asked for.
   */
  async turnOn(folder: string | null = null): Promise<void> {
    if (this.on) return;
    if (!this.options.encryptor.isAvailable()) throw new PlayerError("cloudCopy.error.cantKeep");
    this.use(folder);
    const remote = await this.exclusive("checking", async () => {
      if (folder !== null) await checkFolder(folder);
      return this.cloud.remote();
    }).catch((error: unknown) => {
      this.use(null);
      throw CopySync.playerError(this.noteProblem(error));
    });
    if (remote) {
      this.copy = { size: remote.size, savedAt: remote.updatedAt };
      this.askKey = true;
      this.changed();
      return;
    }
    const key = newCopyKey();
    await saveCopyKey(this.keyFile, this.options.encryptor, key);
    await savePlace(this.placeFile, this.folder);
    this.key = key;
    this.state = EMPTY_STATE;
    this.shownKey = recoveryKey(key);
    this.problem = null;
    this.changed();
    await this.sync(true);
  }

  /** The recovery key typed in for a copy that exists: checked by downloading it, then the player keeps one side. */
  async enterKey(text: string): Promise<void> {
    const key = parseRecoveryKey(text);
    if (!key) throw new PlayerError("cloudCopy.error.badKey");
    this.key = key;
    try {
      const staged = await this.exclusive("downloading", () => this.stage(false));
      if (!staged) {
        // Deleted in the meantime: start a new copy instead.
        this.key = null;
        this.askKey = false;
        return await this.turnOn(this.folder);
      }
    } catch (error) {
      this.key = null;
      if (error instanceof CopyError && error.reason === "damaged") throw new PlayerError("cloudCopy.error.wrongKey");
      throw CopySync.playerError(this.noteProblem(error));
    }
    await saveCopyKey(this.keyFile, this.options.encryptor, key);
    await savePlace(this.placeFile, this.folder);
    this.state = EMPTY_STATE;
    await saveCopyState(this.stateFile, this.state);
    this.askKey = false;
    this.problem = null;
    // This PC has its own data too: the player keeps one side.
    this.conflict = true;
    this.changed();
  }

  cancelKey(): void {
    this.askKey = false;
    this.use(null);
    this.copy = null;
    this.changed();
  }

  showKey(): void {
    if (this.key) this.shownKey = recoveryKey(this.key);
    this.changed();
  }

  keySaved(): void {
    this.shownKey = null;
    this.changed();
  }

  /** Takes the copy in place of this PC's data: downloaded now, swapped in at the restart. */
  async restore(): Promise<void> {
    if (!this.on) return;
    await this.takeCopy();
  }

  /** Keeps one side when both changed. The other side is kept as a local backup. */
  async keep(side: "pc" | "cloud"): Promise<void> {
    if (!this.on) return;
    if (side === "cloud") return this.takeCopy();
    await this.exclusive("downloading", async () => {
      try {
        const staged = await this.stageCurrent(false);
        if (staged) {
          await rename(this.stagedData, await this.backupFolder("cloud")).catch(() => undefined);
          // The parts of this PC's last sync may be gone from the service; the upload sends what is missing.
          this.state = { ...this.state, version: staged.version };
        } else {
          this.state = EMPTY_STATE;
        }
        await rm(this.stagingDir, { recursive: true, force: true });
        await saveCopyState(this.stateFile, this.state);
      } catch (error) {
        throw CopySync.playerError(this.noteProblem(error));
      }
    });
    this.conflict = false;
    this.restartToTake = false;
    await this.sync(true);
  }

  private async takeCopy(): Promise<void> {
    await this.exclusive("downloading", async () => {
      try {
        if (!(await this.stageCurrent(true))) throw new PlayerError("cloudCopy.error.noCopy");
      } catch (error) {
        if (error instanceof PlayerError) throw error;
        throw CopySync.playerError(this.noteProblem(error));
      }
    });
    this.restart();
  }

  /** Restarts Tavora without uploading first: the staged copy is taken at the start. */
  restart(): void {
    this.mayClose = true;
    this.options.restart();
  }

  /** Off on this PC: the key and what it knew are forgotten; the copy stays for the other PCs. */
  async turnOff(): Promise<void> {
    await this.forget(null);
  }

  /** Deletes the copy where it is kept and turns it off here. */
  async remove(): Promise<void> {
    await this.exclusive("checking", () => this.cloud.remove()).catch((error: unknown) => {
      throw CopySync.playerError(this.noteProblem(error));
    });
    await this.forget(null);
    this.copy = null;
    this.changed();
  }

  /** Signed out: a copy on the service belongs to the account, so it is off here until turned on again. A folder's stays on. */
  async signedOut(): Promise<void> {
    if (this.folder === null && (this.on || this.askKey)) await this.forget(null);
  }

  private async forget(problem: CloudCopyProblem | null): Promise<void> {
    this.key = null;
    this.state = EMPTY_STATE;
    this.shownKey = null;
    this.askKey = false;
    this.conflict = false;
    this.restartToTake = false;
    this.problem = problem;
    await saveCopyKey(this.keyFile, this.options.encryptor, null);
    await rm(this.stateFile, { force: true });
    await rm(this.placeFile, { force: true });
    this.use(null);
    await rm(this.stagingDir, { recursive: true, force: true });
    this.changed();
  }

  // ── Close ──────────────────────────────────────────────────────────

  /**
   * Called when the window is about to close. True while the last upload runs: the close waits, and
   * `close` is called once it is done (or the player closes anyway).
   */
  holdClose(close: () => void): boolean {
    if (this.mayClose || !this.on || this.waiting) return false;
    if (this.closeStarted) return true;
    this.closeStarted = true;
    const shown = setTimeout(() => {
      this.closing = true;
      this.changed();
    }, CLOSE_QUIET_MS);
    void this.sync()
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(shown);
        this.closeAnyway(close);
      });
    return true;
  }

  closeAnyway(close: () => void): void {
    if (this.mayClose) return;
    this.mayClose = true;
    this.closing = false;
    close();
  }
}

/** Where the copy is kept: a folder, or null for the service. */
async function loadPlace(file: string): Promise<string | null> {
  const saved = await readJson(file);
  return saved?.v === 1 && typeof saved.folder === "string" && path.isAbsolute(saved.folder) ? saved.folder : null;
}

async function savePlace(file: string, folder: string | null): Promise<void> {
  if (folder === null) await rm(file, { force: true });
  else await writeFileAtomic(file, JSON.stringify({ v: 1, folder }));
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Puts this PC's own settings (its module files folder, development folders, …) back into the library a
 * copy brought. The synced state keeps the copy's hash, so this alone is not a change to upload.
 */
async function keepPcSettings(file: string, own: Record<string, unknown> | null, state: CopyState): Promise<void> {
  const taken = await readJson(file);
  if (!taken) return;
  let changed = false;
  for (const name of PC_SETTINGS) {
    const value = own?.[name];
    if (JSON.stringify(taken[name]) === JSON.stringify(value)) continue;
    if (value === undefined) delete taken[name];
    else taken[name] = value;
    changed = true;
  }
  if (!changed) return;
  await writeFileAtomic(file, JSON.stringify(taken, null, 2));
  const synced = state.files["library.json"];
  const info = await stat(file);
  if (synced) state.files["library.json"] = { ...synced, size: info.size, mtimeMs: info.mtimeMs };
}
