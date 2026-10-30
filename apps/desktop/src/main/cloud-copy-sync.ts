import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { CloudCopyProblem, CloudCopyView } from "../shared/host-api";
import { backupsDir } from "./backup";
import {
  CloudCopy,
  ServiceStorage,
  CopyError,
  copyRoots,
  EMPTY_STATE,
  hasLocalChanges,
  loadCopyState,
  saveCopyState,
  swapInCopy,
  type CopyRoot,
  type CopyState,
  type CopyStorage,
  type SyncedFile,
} from "./cloud-copy";
import { AccountKey } from "./account-key";
import type { Encryptor } from "./discord-store";
import { checkFolder, FolderStorage } from "./copy-folder";
import { writeFileAtomic } from "./fsutil";
import { UserError } from "./messages";
import { LIBRARY_FILE, libraryFile, PC_SETTINGS } from "./saved-data";

// When the cloud copy syncs (decided 2026-10-19), using the engine in cloud-copy.ts:
// - At start, before anything reads the data, a newer copy is taken when this PC has
//   not changed since it last synced. It may take a few seconds; a copy that takes
//   longer finishes in the background and waits for a restart.
// - While Tavora runs, what changed goes up every few minutes.
// - At close, what is left goes up first; after a few seconds the user sees it and
//   may close anyway.
// - When both this PC and the copy changed, the user keeps one side; the other is
//   kept as a local backup. Settings can also upload or restore by hand.
// - The copy is kept on Tavora's service (needs a sign-in) or in a folder the user
//   picks (decided 2026-10-20; works signed out too). Signing out turns off only the first,
//   and a folder's copy keeps the key on this PC.

/** How often changes are looked for and uploaded while Tavora runs. */
export const SYNC_EVERY_MS = 3 * 60_000;
/** How long the start waits for a newer copy before the workspaces load without it. */
export const START_BUDGET_MS = 6_000;
/** How long closing waits quietly before it shows that it is still uploading. */
export const CLOSE_QUIET_MS = 3_000;
/** Local backups made when a side was replaced, kept in the backups folder. */
const KEEP_BACKUPS = 3;

/** A downloaded copy waiting in the staging folder: taken at the next start. */
interface Staged {
  v: 1;
  version: number;
  pictures: boolean;
  files: Record<string, Omit<SyncedFile, "mtimeMs">>;
  /** The user chose it (restore, or keeping the copy's side): taken even though this PC changed. */
  take: boolean;
}

export interface CopySyncOptions {
  userData: string;
  /** False in release builds until accounts go live: the copy never runs. */
  enabled: boolean;
  /** A development run in its own desktop-dev folder: the UI asks before turning the copy on. */
  devData?: boolean;
  /** The folder modules keep pictures in, which may be anywhere. */
  files: { root(): string };
  /** The account: its sign-in token seals nothing, but lets the copy and the key reach Tavora's service. */
  account: { token(): string | null };
  /** The account service, ending in /v1/account. */
  serviceUrl: string;
  fetch?: typeof fetch;
  /** The system's key store, which keeps the account's key on this PC. */
  encryptor: Encryptor;
  /** The copy in a folder the user picked; FolderStorage unless a test says otherwise. */
  folderStorage?: (folder: string) => CopyStorage;
  restart: () => void;
  now?: () => Date;
  log?: (line: string) => void;
}

/** What the window around the copy answers to; given once it exists (the copy starts before it does). */
export interface CopyHooks {
  /** Writes what Tavora still holds in memory (library, layout) to disk. */
  flush: () => Promise<void>;
  onChange: (view: CloudCopyView) => void;
}

export class CopySync {
  /** On for this PC: cloud-copy.json is there. Syncing also needs the account's key. */
  private copyOn = false;
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
  /** Closing may go on: the last upload is done, or the user closed anyway. */
  private mayClose = false;
  private closeStarted = false;

  /** The copy on Tavora's service. */
  private readonly service: CopyStorage;
  /** The account's key, which seals the copy; this PC may have it with the copy off. */
  private readonly accountKeys: AccountKey;
  /** Given by `attach`; until then the copy tells no one and flushes nothing. */
  private hooks: CopyHooks | null = null;

  constructor(private readonly options: CopySyncOptions) {
    const service = { baseUrl: options.serviceUrl, fetch: options.fetch ?? ((input, init) => fetch(input, init)), token: () => options.account.token() };
    this.service = new ServiceStorage(service);
    this.accountKeys = new AccountKey({
      file: path.join(options.userData, "account-key.json"),
      legacyFile: path.join(options.userData, "cloud-copy-key.json"),
      cacheFile: path.join(options.userData, "account-vault.bin"),
      encryptor: options.encryptor,
      ...service,
    });
    this.cloud = new CloudCopy(this.service);
  }

  /** Whoever owns the window and the saved data listens from now on. */
  attach(hooks: CopyHooks): void {
    this.hooks = hooks;
  }

  /** Where the copy is kept from now on: a folder, or null for the service. */
  private use(folder: string | null): void {
    this.folder = folder;
    this.cloud = new CloudCopy(this.storageFor(folder));
  }

  private storageFor(folder: string | null): CopyStorage {
    return folder === null ? this.service : (this.options.folderStorage ?? ((picked) => new FolderStorage(picked)))(folder);
  }

  /** Signed out with the copy in a folder: the key stays on this PC, without the account's vault. */
  private get keyHere(): boolean {
    return this.folder !== null && !this.accountKeys.signedIn;
  }

  private get stateFile() {
    return path.join(this.options.userData, "cloud-copy.json");
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
    return copyRoots(this.options.userData, this.options.files.root());
  }
  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
  private log(line: string): void {
    this.options.log?.(line);
  }

  private get key(): Buffer | null {
    return this.accountKeys.get();
  }

  /** The folder the copy is kept in (or is being turned on in), or null for the service. */
  get place(): string | null {
    return this.folder;
  }

  /** The account's key, which the publisher keys use too (developer-keys.ts). */
  get accountKey(): AccountKey {
    return this.accountKeys;
  }

  get on(): boolean {
    return this.copyOn && this.key !== null;
  }

  view(): CloudCopyView {
    return {
      canKeepKey: this.accountKeys.canKeep,
      devData: this.options.devData === true,
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
    this.hooks?.onChange(this.view());
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
    // A folder that turned read-only (or full) after it was picked fails as a plain file error.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    const reason = error instanceof CopyError ? error.reason : this.folder !== null && (code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ENOSPC") ? "folder-locked" : "failed";
    this.problem =
      reason === "unreachable" || reason === "unavailable" || reason === "too-many"
        ? "offline"
        : reason === "signed-out" || reason === "no-folder" || reason === "folder-locked" || reason === "not-arrived"
          ? reason
          : "failed";
    if (!(error instanceof CopyError) || reason === "failed" || reason === "damaged") this.log(`cloud copy: ${error instanceof Error ? error.message : String(error)}`);
    return this.problem;
  }

  private static userError(problem: CloudCopyProblem): UserError {
    return new UserError(`cloudCopy.error.${problem}`);
  }

  // ── Start ──────────────────────────────────────────────────────────

  /**
   * Before anything reads the data: takes a copy waiting from the last run, or a newer one from the
   * service when this PC has not changed since it last synced. Never throws; offline starts as usual.
   */
  async beforeLoad(budgetMs = START_BUDGET_MS): Promise<void> {
    if (!this.options.enabled) return;
    try {
      await this.accountKeys.load();
      this.copyOn = await stat(this.stateFile).then(
        () => true,
        () => false,
      );
      this.state = this.on ? await loadCopyState(this.stateFile) : EMPTY_STATE;
      if (this.copyOn) this.use(await loadPlace(this.placeFile));
      if (await this.takeStaged()) return;
      if (!this.on) return;
      let late = false;
      const check = this.fetchNewer().then(async (staged) => {
        if (!staged) return;
        if (!late && (await this.takeStaged())) return;
        // Finished after the workspaces loaded: it waits for a restart.
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
    // Changed here, or this PC's last save lost against another PC's (in a synced folder): the user chooses.
    if (remote.follows === false || (await hasLocalChanges(this.roots(), this.state))) {
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
      copy = await this.cloud.download(this.key!, this.roots(), this.stagedData);
    } catch (error) {
      // Another PC started over with a new key: this one's key and copy are forgotten, and turning on asks for the new key.
      if (error instanceof CopyError && error.reason === "damaged" && !this.keyHere && !(await this.accountKeys.fits())) {
        await this.forget("new-key");
        await this.accountKeys.forget();
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

  /** Swaps a staged copy in: when the user chose it, or when this PC has not changed since it last synced. */
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
    const library = libraryFile(this.options.userData);
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
    if (this.keyHere) {
      void this.sync().catch(() => undefined);
      return;
    }
    // A key from before the account kept a vault gets one, so other PCs ask for it instead of making their own.
    // A key the account no longer has (another PC started over) stops the copy here before anything goes up.
    void this.accountKeys
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

  /** Whether syncing waits on the user (a question, or a restart). */
  private get waiting(): boolean {
    return this.conflict || this.restartToTake || this.askKey;
  }

  /** Uploads what changed. Quiet: problems show in Settings. `loud` throws them for a button. */
  async sync(loud = false): Promise<void> {
    if (!this.on || (this.waiting && !loud)) return;
    if (this.conflict) throw new UserError("cloudCopy.error.conflict");
    await this.exclusive("uploading", async () => {
      // What ran before (a download at start) may have left a question.
      if (!this.on || (this.waiting && !loud)) return;
      await this.hooks?.flush();
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
        if (loud) throw CopySync.userError(problem);
        return;
      }
      if (loud && this.problem) throw CopySync.userError(this.problem);
    });
  }

  // ── Settings ───────────────────────────────────────────────────────

  /**
   * Turns the copy on, on the service or in `folder`. The account's key comes first: made here when the account has none (its recovery
   * key is shown then), or asked for when another PC made it. Then a copy that exists is downloaded and
   * the user keeps one side; without one, this PC's data goes up as the first version.
   */
  async turnOn(folder: string | null = null): Promise<void> {
    if (this.on) return;
    if (!this.accountKeys.canKeep) throw new UserError("cloudCopy.error.cantKeep");
    this.use(folder);
    const setUp = await this.exclusive("checking", async () => {
      if (folder !== null) await checkFolder(folder);
      // Signed out, a folder's copy keeps its key here; signed in, the key is the account's.
      return this.keyHere ? this.accountKeys.setUpHere((await this.cloud.remote()) !== null) : this.accountKeys.setUp();
    }).catch((error: unknown) => {
      this.use(null);
      if (error instanceof UserError) throw error;
      throw CopySync.userError(this.noteProblem(error));
    });
    if (setUp.status === "ask") {
      this.askKey = true;
      this.changed();
      return;
    }
    if (setUp.created) this.shownKey = this.accountKeys.recoveryKey();
    await this.startCopy();
  }

  /** The recovery key typed in when another PC made the account's key: checked against the account, then the copy goes on. */
  async enterKey(text: string): Promise<void> {
    const here = this.keyHere;
    await this.exclusive("checking", () => (here ? this.accountKeys.enterHere(text) : this.accountKeys.enter(text))).catch((error: unknown) => {
      if (error instanceof UserError) throw error;
      throw CopySync.userError(this.noteProblem(error));
    });
    await this.goOnWithKey(here);
  }

  /** Another PC sent the account's key (pairing.ts), and it is kept: a copy that waited for it goes on. */
  async keyArrived(): Promise<void> {
    if (this.askKey) await this.goOnWithKey(this.keyHere);
  }

  private async goOnWithKey(here: boolean): Promise<void> {
    this.askKey = false;
    try {
      await this.startCopy();
    } catch (error) {
      // Signed out, the folder's copy is the only check: a key that doesn't open it is not kept.
      if (here && error instanceof UserError && error.key === "cloudCopy.error.wrongKey") {
        await this.accountKeys.forget();
        this.askKey = true;
        this.changed();
      }
      throw error;
    }
  }

  /**
   * A lost recovery key: the account gets a new key, made here and shown now, and this PC's data replaces
   * the copy as its next version, so other PCs see a newer copy their old key can't open and ask for the
   * new key. The data on every PC stays.
   */
  async startOver(): Promise<void> {
    const base = await this.exclusive("checking", async () => {
      const remote = await this.cloud.remote();
      await (this.keyHere ? this.accountKeys.startOverHere() : this.accountKeys.startOver());
      return remote?.version ?? 0;
    }).catch((error: unknown) => {
      if (error instanceof UserError) throw error;
      throw CopySync.userError(this.noteProblem(error));
    });
    const folder = this.folder;
    await this.forget(null);
    this.use(folder);
    await savePlace(this.placeFile, folder);
    this.shownKey = this.accountKeys.recoveryKey();
    this.copyOn = true;
    // Nothing of the old copy is reused: every file goes up again under the new key.
    this.state = { ...EMPTY_STATE, version: base };
    await saveCopyState(this.stateFile, this.state);
    this.changed();
    await this.sync(true);
  }

  /** With the account's key here: takes up a copy that exists (the user keeps one side), or starts a new one. */
  private async startCopy(): Promise<void> {
    let staged: Staged | null = null;
    try {
      staged = await this.exclusive("downloading", async () => {
        const remote = await this.cloud.remote();
        if (!remote) return null;
        this.copy = { size: remote.size, savedAt: remote.updatedAt };
        return this.stage(false);
      });
    } catch (error) {
      // Sealed with another key: a copy from before the account had its key.
      if (error instanceof CopyError && error.reason === "damaged") throw new UserError("cloudCopy.error.wrongKey");
      throw CopySync.userError(this.noteProblem(error));
    }
    this.copyOn = true;
    this.state = EMPTY_STATE;
    await saveCopyState(this.stateFile, this.state);
    await savePlace(this.placeFile, this.folder);
    this.problem = null;
    if (staged) {
      // This PC has its own data too: the user keeps one side.
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
    this.use(null);
    this.copy = null;
    this.changed();
  }

  showKey(): void {
    this.shownKey = this.accountKeys.recoveryKey();
    this.changed();
  }

  keySaved(): void {
    this.shownKey = null;
    this.changed();
  }

  /**
   * Moves the copy to `folder` (null: the service), keeping its key: all of it goes up there, then the copy
   * where it was is deleted, so the other PCs turn it off and are turned on again where it is now. A place
   * that has a copy already is left alone.
   */
  async move(folder: string | null): Promise<void> {
    if (!this.on || folder === this.folder) return;
    if (this.waiting) throw new UserError("cloudCopy.error.conflict");
    const from = this.cloud;
    const problem = this.problem;
    await this.exclusive("uploading", async () => {
      try {
        await this.hooks?.flush();
        if (folder !== null) await checkFolder(folder);
        const to = new CloudCopy(this.storageFor(folder));
        if (await to.remote()) throw new UserError("cloudCopy.error.moveTaken");
        const result = await to.upload(this.key!, this.roots(), EMPTY_STATE, (done, total) => {
          this.progress = { done, total };
          this.changed();
        });
        if (result.status === "too-big") throw new UserError("cloudCopy.error.too-big");
        if (result.status !== "uploaded") throw new UserError("cloudCopy.error.moveTaken");
        await savePlace(this.placeFile, folder);
        this.use(folder);
        this.state = result.state;
        await saveCopyState(this.stateFile, this.state);
        this.copy = { size: result.size, savedAt: this.now().toISOString() };
        this.problem = null;
      } catch (error) {
        if (error instanceof UserError) throw error;
        const failed = this.noteProblem(error);
        // The copy where it is now is fine: this was only the move.
        this.problem = problem;
        throw CopySync.userError(failed);
      }
    });
    await from.remove().catch((error: unknown) => this.log(`cloud copy: the old copy was not deleted: ${error instanceof Error ? error.message : String(error)}`));
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
        throw CopySync.userError(this.noteProblem(error));
      }
    });
    this.conflict = false;
    this.restartToTake = false;
    await this.sync(true);
  }

  private async takeCopy(): Promise<void> {
    await this.exclusive("downloading", async () => {
      try {
        if (!(await this.stageCurrent(true))) throw new UserError("cloudCopy.error.noCopy");
      } catch (error) {
        if (error instanceof KeyChanged) throw CopySync.userError(this.noteProblem(error));
        if (error instanceof UserError) throw error;
        throw CopySync.userError(this.noteProblem(error));
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
    await this.exclusive("checking", () => this.cloud.remove()).catch((error: unknown) => {
      throw CopySync.userError(this.noteProblem(error));
    });
    await this.forget(null);
    this.copy = null;
    this.changed();
  }

  /**
   * Signed out: the copy on the service and the key belong to the account, so both are gone from this PC
   * until signed in again. A copy in a folder stays on.
   */
  async signedOut(): Promise<void> {
    // A copy in the user's own folder needs no account: it stays on, with its key.
    if (this.folder !== null && (this.copyOn || this.askKey)) return;
    if (this.copyOn || this.askKey) await this.forget(null);
    await this.accountKeys.forget();
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
    await rm(this.placeFile, { force: true });
    await rm(this.stagingDir, { recursive: true, force: true });
    this.use(null);
    this.changed();
  }

  // ── Close ──────────────────────────────────────────────────────────

  /**
   * Called when the window is about to close. True while the last upload runs: the close waits, and
   * `close` is called once it is done (or the user closes anyway).
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
  const synced = state.files[LIBRARY_FILE];
  const info = await stat(file);
  if (synced) state.files[LIBRARY_FILE] = { ...synced, size: info.size, mtimeMs: info.mtimeMs };
}

/** The copy was sealed with a key the account no longer has: another PC started over. */
class KeyChanged extends Error {}

/** Where the copy is kept: a folder, or null for the service. */
async function loadPlace(file: string): Promise<string | null> {
  const saved = await readJson(file);
  return saved?.v === 1 && typeof saved.folder === "string" && path.isAbsolute(saved.folder) ? saved.folder : null;
}

async function savePlace(file: string, folder: string | null): Promise<void> {
  if (folder === null) await rm(file, { force: true });
  else await writeFileAtomic(file, JSON.stringify({ v: 1, folder }));
}
