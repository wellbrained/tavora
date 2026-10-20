import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { CloudCopyProblem, CloudCopyView } from "../shared/host-api";
import { backupsDir } from "./backup";
import {
  CloudCopy,
  COPY_LIMIT,
  CopyError,
  copyRoots,
  EMPTY_STATE,
  hasLocalChanges,
  loadCopyState,
  saveCopyState,
  swapInCopy,
  type CopyRoot,
  type CopyState,
  type SyncedFile,
} from "./cloud-copy";
import type { AccountKey } from "./account-key";
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
  cloud: CloudCopy;
  /** The account's key, which seals the copy; this PC may have it with the copy off. */
  accountKey: AccountKey;
  /** Writes what Tavora still holds in memory (library, layout) to disk. */
  flush: () => Promise<void>;
  restart: () => void;
  onChange: (view: CloudCopyView) => void;
  now?: () => Date;
  log?: (line: string) => void;
}

export class CopySync {
  /** On for this PC: cloud-copy.json is there. Syncing also needs the account's key. */
  private copyOn = false;
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

  constructor(private readonly options: CopySyncOptions) {}

  private get stateFile() {
    return path.join(this.options.userData, "cloud-copy.json");
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

  private get key(): Buffer | null {
    return this.options.accountKey.get();
  }

  /** The account's key, which the publisher keys use too (developer-keys.ts). */
  get accountKey(): AccountKey {
    return this.options.accountKey;
  }

  get on(): boolean {
    return this.copyOn && this.key !== null;
  }

  view(): CloudCopyView {
    return {
      canKeepKey: this.options.accountKey.canKeep,
      on: this.on,
      busy: this.busy,
      progress: this.progress,
      copy: this.copy,
      limit: COPY_LIMIT,
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
    if (error instanceof KeyChanged) return (this.problem = "new-key");
    const reason = error instanceof CopyError ? error.reason : "failed";
    this.problem = reason === "unreachable" || reason === "unavailable" || reason === "too-many" ? "offline" : reason === "signed-out" ? "signed-out" : "failed";
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
      await this.options.accountKey.load();
      this.copyOn = await stat(this.stateFile).then(
        () => true,
        () => false,
      );
      this.state = this.on ? await loadCopyState(this.stateFile) : EMPTY_STATE;
      if (await this.takeStaged()) return;
      if (!this.on) return;
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
    const remote = await this.options.cloud.remote();
    if (!remote) {
      // The copy was deleted (on another PC): it is off here too.
      if (this.state.version > 0) await this.forget("deleted");
      return false;
    }
    this.copy = { size: remote.size, savedAt: remote.updatedAt };
    if (remote.version === this.state.version) return false;
    if (await hasLocalChanges(this.roots(), this.state)) {
      this.conflict = true;
      this.changed();
      return false;
    }
    return (await this.stage(false)) !== null;
  }

  /** Downloads the copy into the staging folder, to be taken at the next start. */
  private async stage(take: boolean): Promise<Staged | null> {
    await rm(this.stagingDir, { recursive: true, force: true });
    let copy: Awaited<ReturnType<CloudCopy["download"]>>;
    try {
      copy = await this.options.cloud.download(this.key!, this.roots(), this.stagedData);
    } catch (error) {
      // Another PC started over with a new key: this one's key and copy are forgotten, and turning on asks for the new key.
      if (error instanceof CopyError && error.reason === "damaged" && !(await this.options.accountKey.fits())) {
        await this.forget("new-key");
        await this.options.accountKey.forget();
        throw new KeyChanged();
      }
      throw error;
    }
    if (!copy) return null;
    const staged: Staged = { v: 1, ...copy, take };
    await writeFileAtomic(this.stagedFile, JSON.stringify(staged));
    return staged;
  }

  /** The copy as it is now in the staging folder: the one staged already when it is still current, else downloaded. */
  private async stageCurrent(take: boolean): Promise<Staged | null> {
    const staged = await this.readStaged();
    const remote = staged ? await this.options.cloud.remote() : null;
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
    if (!this.on || staged.version <= this.state.version) {
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
    if (!this.on) return;
    // A key from before the account kept a vault gets one, so other PCs ask for it instead of making their own.
    // A key the account no longer has (another PC started over) stops the copy here before anything goes up.
    void this.options.accountKey
      .setUp()
      .then(async (setUp) => {
        if (setUp.status === "ask") return this.forget("new-key");
        await this.sync();
      })
      .catch((error: unknown) => {
        this.noteProblem(error);
        this.changed();
      });
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
        const result = await this.options.cloud.upload(this.key!, this.roots(), this.state, (done, total) => {
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
   * Turns the copy on. The account's key comes first: made here when the account has none (its recovery
   * key is shown then), or asked for when another PC made it. Then a copy that exists is downloaded and
   * the player keeps one side; without one, this PC's data goes up as the first version.
   */
  async turnOn(): Promise<void> {
    if (this.on) return;
    if (!this.options.accountKey.canKeep) throw new PlayerError("cloudCopy.error.cantKeep");
    const setUp = await this.exclusive("checking", () => this.options.accountKey.setUp()).catch((error: unknown) => {
      if (error instanceof PlayerError) throw error;
      throw CopySync.playerError(this.noteProblem(error));
    });
    if (setUp.status === "ask") {
      this.askKey = true;
      this.changed();
      return;
    }
    if (setUp.created) this.shownKey = this.options.accountKey.recoveryKey();
    await this.startCopy();
  }

  /** The recovery key typed in when another PC made the account's key: checked against the account, then the copy goes on. */
  async enterKey(text: string): Promise<void> {
    await this.exclusive("checking", () => this.options.accountKey.enter(text)).catch((error: unknown) => {
      if (error instanceof PlayerError) throw error;
      throw CopySync.playerError(this.noteProblem(error));
    });
    this.askKey = false;
    await this.startCopy();
  }

  /**
   * A lost recovery key: the account gets a new key, made here and shown now, and this PC's data replaces
   * the copy as its next version, so other PCs see a newer copy their old key can't open and ask for the
   * new key. The data on every PC stays.
   */
  async startOver(): Promise<void> {
    const base = await this.exclusive("checking", async () => {
      const remote = await this.options.cloud.remote();
      await this.options.accountKey.startOver();
      return remote?.version ?? 0;
    }).catch((error: unknown) => {
      if (error instanceof PlayerError) throw error;
      throw CopySync.playerError(this.noteProblem(error));
    });
    await this.forget(null);
    this.shownKey = this.options.accountKey.recoveryKey();
    this.copyOn = true;
    // Nothing of the old copy is reused: every file goes up again under the new key.
    this.state = { ...EMPTY_STATE, version: base };
    await saveCopyState(this.stateFile, this.state);
    this.changed();
    await this.sync(true);
  }

  /** With the account's key here: takes up a copy that exists (the player keeps one side), or starts a new one. */
  private async startCopy(): Promise<void> {
    let staged: Staged | null = null;
    try {
      staged = await this.exclusive("downloading", async () => {
        const remote = await this.options.cloud.remote();
        if (!remote) return null;
        this.copy = { size: remote.size, savedAt: remote.updatedAt };
        return this.stage(false);
      });
    } catch (error) {
      // Sealed with another key: a copy from before the account had its key.
      if (error instanceof CopyError && error.reason === "damaged") throw new PlayerError("cloudCopy.error.wrongKey");
      throw CopySync.playerError(this.noteProblem(error));
    }
    this.copyOn = true;
    this.state = EMPTY_STATE;
    await saveCopyState(this.stateFile, this.state);
    this.problem = null;
    if (staged) {
      // This PC has its own data too: the player keeps one side.
      this.conflict = true;
      this.changed();
      return;
    }
    this.copy = null;
    this.changed();
    await this.sync(true);
  }

  cancelKey(): void {
    this.askKey = false;
    this.changed();
  }

  showKey(): void {
    this.shownKey = this.options.accountKey.recoveryKey();
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
        if (error instanceof KeyChanged) throw CopySync.playerError(this.noteProblem(error));
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

  /** Off on this PC: what it knew of the copy is forgotten; the copy stays for the other PCs, and the account's key stays here. */
  async turnOff(): Promise<void> {
    await this.forget(null);
  }

  /** Deletes the copy on the service and turns it off here. */
  async remove(): Promise<void> {
    await this.exclusive("checking", () => this.options.cloud.remove()).catch((error: unknown) => {
      throw CopySync.playerError(this.noteProblem(error));
    });
    await this.forget(null);
    this.copy = null;
    this.changed();
  }

  /** Signed out: the copy and its key belong to the account, so both are gone from this PC until signed in again. */
  async signedOut(): Promise<void> {
    if (this.copyOn || this.askKey) await this.forget(null);
    await this.options.accountKey.forget();
    this.changed();
  }

  private async forget(problem: CloudCopyProblem | null): Promise<void> {
    this.copyOn = false;
    this.state = EMPTY_STATE;
    this.shownKey = null;
    this.askKey = false;
    this.conflict = false;
    this.restartToTake = false;
    this.problem = problem;
    await rm(this.stateFile, { force: true });
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

/** The copy was sealed with a key the account no longer has: another PC started over. */
class KeyChanged extends Error {}
