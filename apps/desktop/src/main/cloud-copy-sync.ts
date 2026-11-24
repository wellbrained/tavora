import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { assertNever } from "../shared/assert-never";
import type { CloudCopyActivity, CloudCopyProblem, CloudCopyView } from "../shared/host-api";
import { backupsDir } from "./backup";
import {
  CloudCopy,
  ServiceStorage,
  CopyError,
  copyRoots,
  EMPTY_STATE,
  hasLocalChanges,
  saveCopyState,
  emptyPlaces,
  emptyPlacesSince,
  fileSha256,
  filledPlaces,
  lookCopyState,
  NewestUnreadable,
  removeCopyState,
  openManifest,
  sortWrittenSince,
  swapInCopy,
  undoSwap,
  WRITTEN_SINCE,
  placesPutIn,
  type CopyRoot,
  type CopyState,
  type EarlierCopies,
  type CopyStorage,
  type SyncedFile,
} from "./cloud-copy";
import { AccountKey } from "./account-key";
import type { Encryptor } from "./discord-store";
import { copyKeys, parseRecoveryKey, recoveryKey } from "./copy-crypto";
import { checkFolder, FolderStorage } from "./copy-folder";
import { lookCopyFile, removeCopyFile, writeCopyFile } from "./copy-files";
import { writeFileAtomic } from "./fsutil";
import { COPY_STATUS_FILE, lookSwapPlan, lookSwapStatus, stepSwap, SWAP_IDLE, writeFlushed, writeSwapStatus, type SwapEvent, type SwapPlan, type SwapStatus } from "./cloud-copy-swap";
import { DamagedFile, HeldError, isDamaged, look, lookJson, lookNames, lookStat, unlessHeld, type Looked } from "./file-look";
import { renameHeld } from "./rename-held";
import { wasSetAside, type SavedRecord } from "./json";
import { UserError } from "./messages";
import { DATA_FILES, LIBRARY_FILE, libraryFile, PC_SETTINGS } from "./saved-data";

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
export interface Staged {
  v: 1;
  version: number;
  pictures: boolean;
  files: Record<string, Omit<SyncedFile, "mtimeMs">>;
  /** Its manifest sealed its version (a list from an older Tavora has none: not sealed). */
  sealed?: boolean;
  /** Its manifest carried its mark (one from an older Tavora has none). */
  marked?: boolean;
  /** Its manifest carried its line (one from an older Tavora has none). */
  listed?: boolean;
  /** In a `staged.json` an older Tavora left: the user chose it. Now that is the status `chosen`. */
  take?: boolean;
}

export interface CopySyncOptions {
  userData: string;
  /** False in release builds until accounts go live: the copy never runs. */
  enabled: boolean;
  /** A development run in its own desktop-dev folder: the UI asks before turning the copy on. */
  devData?: boolean;
  /**
   * The folder modules keep pictures in, which may be anywhere: the one the library on disk names. `defaultRoot` is the
   * one a library without a folder of its own uses.
   */
  files: { root(): string; defaultRoot?(): string };
  /** The account: its sign-in token seals nothing, but lets the copy and the key reach Tavora's service. */
  account: {
    token(): string | null;
    /** The account signed in (sign-in.ts accountIdOf): the account's key is only ever used for its own. */
    id(): string | null;
  };
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

/**
 * Where closing the window stands: open; held while the last upload runs (`shown` once it took long enough to tell the
 * user, `timer` until then); or released, when the window may close (the upload is done, the user closed anyway, or a
 * restart takes a downloaded copy).
 */
type Closing = { phase: "open" } | { phase: "holding"; shown: boolean; timer: ReturnType<typeof setTimeout> } | { phase: "released" };

/**
 * What syncing can wait on the user for: the recovery key (another PC made the account's key), which side to keep (both
 * changed), or a restart (a newer copy finished downloading after the workspaces loaded). Any mix can be open at once.
 */
export type Question = "askKey" | "conflict" | "restartToTake";

/** The questions as Settings reads them: one flag each. */
export function questionsView(questions: ReadonlySet<Question>): Pick<CloudCopyView, Question> {
  const view = { askKey: false, conflict: false, restartToTake: false };
  for (const question of questions) {
    switch (question) {
      case "askKey":
        view.askKey = true;
        break;
      case "conflict":
        view.conflict = true;
        break;
      case "restartToTake":
        view.restartToTake = true;
        break;
      default:
        assertNever(question);
    }
  }
  return view;
}

/** What the window around the copy answers to; given once it exists (the copy starts before it does). */
export interface CopyHooks {
  /** Writes what Tavora still holds in memory (library, layout) to disk. */
  flush: () => Promise<void>;
  onChange: (view: CloudCopyView) => void;
}

export class CopySync {
  /** On for this PC: cloud-copy.json is there, or its parked state during a swap. Syncing also needs the account's key. */
  private copyOn = false;
  /** The folder the copy is kept in, or null for Tavora's service. */
  private folder: string | null = null;
  private cloud: CloudCopy;
  private state: CopyState = EMPTY_STATE;
  private activity: CloudCopyActivity = { phase: "idle" };
  private copy: CloudCopyView["copy"] = null;
  private shownKey: string | null = null;
  /** The account signed in as last told (accountChanged); undefined before the first. */
  private account: string | null | undefined = undefined;
  /** The questions syncing waits on. They can be open together (a key asked for while a conflict stands), so it is a set. */
  private questions: ReadonlySet<Question> = new Set();
  /** The newest list in the folder doesn't open with this key, though earlier ones do: the question says so (NewestUnreadable). */
  private unreadable = false;
  private closing: Closing = { phase: "open" };
  private problem: CloudCopyProblem | null = null;
  /** Where putting a copy in place stands (cloud-copy-swap.ts); on disk, except `held`. */
  private swap: SwapStatus = SWAP_IDLE;
  /** The backup holding what was written while a swap waited, when this start settled one: the user is told. */
  private keptAside: string | null = null;
  /** The backup holding this PC's data from before a swap an older Tavora settled, when this start found one: the user is told. */
  private dataAside: string | null = null;
  /** One thing at a time: an upload, a download, a check. */
  private running: Promise<unknown> = Promise.resolve();
  /**
   * Raised each time the copy is forgotten here (turned off, signed out, deleted elsewhere). Work that started under an
   * older turn (an upload, a move, a download) writes nothing when it ends, so it can't turn the copy back on.
   */
  private turn = 0;
  /**
   * The forgets under way, until each has written its status and raised `turn` (or failed to). One asked while an answer
   * writes the status writes its own right after (a file's writes go one at a time, copy-files.ts): the answer waits for
   * it to settle (goesOn) before it goes on or stops.
   */
  private readonly forgetting = new Set<Promise<void>>();
  /** How many turn-offs failed so far: an answer that waited for one sees it move (`goesOnUnlessOffFailed`). */
  private offFailures = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

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
      seenFile: path.join(options.userData, "account-vault-seen"),
      encryptor: options.encryptor,
      ...service,
      account: () => options.account.id(),
      ...(options.log ? { log: options.log } : {}),
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
    return folder === null
      ? this.service
      : (this.options.folderStorage ?? ((picked) => new FolderStorage(picked, { unusedFile: path.join(this.options.userData, "cloud-copy-unused.json") })))(folder);
  }

  /** Signed out with the copy in a folder: the key stays on this PC, without the account's vault. */
  private get keyHere(): boolean {
    return this.folder !== null && !this.accountKeys.signedIn;
  }

  private get stateFile() {
    return path.join(this.options.userData, "cloud-copy.json");
  }
  /**
   * Where the state is while a swap goes on. Older Tavoras know only cloud-copy.json, so to them the copy is off then: they
   * neither ask nor upload what is half in place.
   */
  private get parkedFile() {
    return path.join(this.options.userData, "cloud-copy-swapping.json");
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
  /** The staged copy's list, under a name older Tavoras don't read: they would act on it halfway through a swap. */
  private get listFile() {
    return path.join(this.stagingDir, "copy-list.json");
  }
  /** Where an older Tavora left it. */
  private get oldListFile() {
    return path.join(this.stagingDir, "staged.json");
  }
  private get statusFile() {
    return path.join(this.options.userData, COPY_STATUS_FILE);
  }
  /** The swap's plan, next to the staged copy: written first, so a damaged status can't hide that a swap began. */
  private get planFile() {
    return path.join(this.stagingDir, "swap-plan.json");
  }
  /** Data files lost at a start that was held, for the next start to record (settleSwap). */
  private get lostNoteFile() {
    return path.join(this.options.userData, "cloud-copy-lost.json");
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

  /** The key the copy is sealed with: off while another account than the copy's is signed in (account-key.ts). */
  private get key(): Buffer | null {
    return this.accountKeys.copyKey();
  }

  /**
   * The key this PC may show or hand to another PC: signed in, the account's own; signed out, a key of no account, or an
   * account's only while a copy in a folder is on with it (never one that merely waits for its account, also not while
   * a copy is still being turned on).
   */
  shareableKey(): Buffer | null {
    if (this.accountKeys.signedIn) return this.accountKeys.get();
    const key = this.accountKeys.copyKey();
    if (!key) return null;
    return this.accountKeys.copyIsOf(null) || (this.copyOn && this.folder !== null) ? key : null;
  }

  /** The recovery key to show (shareableKey). */
  private keyToShow(): string | null {
    const key = this.shareableKey();
    return key ? recoveryKey(key) : null;
  }

  /** Signed in as another account, or signed out: a recovery key shown for the one before goes. */
  accountChanged(account: string | null): void {
    if (account === this.account) return;
    const first = this.account === undefined;
    this.account = account;
    if (first || this.shownKey === null) return;
    this.shownKey = null;
    this.changed();
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
      keyBlocked: this.accountKeys.keyBlocked,
      devData: this.options.devData === true,
      on: this.on,
      ...activityView(this.activity),
      copy: this.copy,
      folder: this.folder,
      limit: this.cloud.storage.limit,
      pictures: this.state.pictures,
      recoveryKey: this.shownKey,
      ...questionsView(this.questions),
      conflictKind: this.conflictKind(),
      closing: this.closing.phase === "holding" && this.closing.shown,
      problem: this.problem,
    };
  }

  /** Why the question which side to keep stands, when it isn't that both changed (CloudCopyView). */
  private conflictKind(): CloudCopyView["conflictKind"] {
    switch (this.swap.phase) {
      case "swapping":
      case "undoing":
        return "unfinished";
      case "held":
        return this.swap.open ? "unfinished" : null;
      case "asking":
        return this.swap.why === "lost" ? "lost" : null;
      case "chosen":
        // Only when another account is signed in: that is what the question says.
        return !this.on && this.accountKeys.signedIn && !this.accountKeys.copyIsOf(this.options.account.id()) ? "waiting" : null;
      case "idle":
        return this.unreadable ? "unreadable" : null;
      default:
        return assertNever(this.swap);
    }
  }

  private changed(): void {
    this.hooks?.onChange(this.view());
  }

  private asked(question: Question): boolean {
    return this.questions.has(question);
  }

  private ask(question: Question): void {
    this.questions = new Set(this.questions).add(question);
  }

  private clear(question: Question): void {
    const next = new Set(this.questions);
    next.delete(question);
    this.questions = next;
  }

  /** Runs one thing after the one before it, showing what it does. */
  private exclusive<T>(phase: Exclude<CloudCopyActivity["phase"], "idle">, work: () => Promise<T>): Promise<T> {
    const next = this.running.then(async () => {
      this.activity = phase === "uploading" ? { phase, progress: null } : { phase };
      this.changed();
      try {
        return await work();
      } finally {
        this.activity = { phase: "idle" };
        this.changed();
      }
    });
    this.running = next.catch(() => undefined);
    return next;
  }

  /** How far the upload running now got. */
  private uploaded(done: number, total: number): void {
    if (this.activity.phase !== "uploading") return;
    this.activity = { phase: "uploading", progress: { done, total } };
    this.changed();
  }

  /** What went wrong, for the settings page; a quiet run (in the background) keeps it there instead of throwing. */
  private noteProblem(error: unknown): CloudCopyProblem {
    if (error instanceof KeyChanged) return (this.problem = "new-key");
    // A folder that turned read-only (or full) after it was picked fails as a plain file error.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    // A full drive under the copy's folder is told by FolderStorage itself ("folder-locked", where another folder can be
    // picked): one that comes here as it is was this PC's own disk.
    const reason =
      error instanceof CopyError ? error.reason : code === "ENOSPC" ? "disk-full" : this.folder !== null && (code === "EACCES" || code === "EPERM" || code === "EROFS") ? "folder-locked" : "failed";
    this.problem =
      reason === "unreachable" || reason === "unavailable" || reason === "too-many"
        ? "offline"
        : reason === "signed-out" || reason === "no-folder" || reason === "folder-locked" || reason === "not-arrived" || reason === "disk-full"
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
   * Before anything reads the data: settles a swap from an earlier start, takes a copy waiting from the last run, or a
   * newer one from the service when this PC has not changed since it last synced. Never throws; offline starts as usual.
   */
  async beforeLoad(budgetMs = START_BUDGET_MS): Promise<void> {
    if (!this.options.enabled) return;
    try {
      await this.accountKeys.load();
      const saved = await this.lookState();
      // A state file that is held still says the copy is on.
      this.copyOn = saved.status !== "missing";
      this.state = this.on && saved.status === "present" ? saved.value : EMPTY_STATE;
      // First of all, whatever else can't be read: nothing may start on half-swapped data.
      let settled = false;
      try {
        if (saved.status === "held") throw new HeldError(saved.error);
        settled = await this.settleSwap();
      } catch (error) {
        await this.hold(error);
      }
      if (this.copyOn) {
        const place = await loadPlace(this.placeFile);
        // Where the copy is kept can't be told: it stays off this run rather than going to the wrong place.
        if (place === undefined) {
          this.copyOn = false;
          this.log("cloud copy: where it is kept can't be read; it is off until the next start");
          return;
        }
        this.use(place);
      }
      if (settled || this.swap.phase === "held") return;
      // Data lost, or a copy the user went back from, and not decided yet: nothing moves until they choose a side. A chosen
      // copy still here couldn't go in (the copy is off this run, or another account is signed in): it holds the data as
      // well, so the user is asked too, and Keep this PC's lets go of it.
      if (this.swap.phase === "asking" || this.swap.phase === "chosen") this.ask("conflict");
      if (!this.on) return;
      let late = false;
      let swapping = false;
      const turn = this.turn;
      const check = this.fetchNewer(turn).then(async (staged) => {
        // Turned off while it looked: nothing waits for a restart.
        if (!staged || turn !== this.turn) return;
        if (!late) {
          swapping = true;
          if (await this.takeStaged()) return;
          // Not taken without the user: they choose a side.
          if (this.asked("conflict")) return void this.changed();
        }
        // Finished after the workspaces loaded: it waits for a restart.
        this.ask("restartToTake");
        this.changed();
      });
      const timer = new Promise<"late">((resolve) => setTimeout(() => resolve("late"), budgetMs).unref?.());
      if ((await Promise.race([check.then(() => "done" as const), timer])) === "late") {
        // Already swapping files in: the start waits for it, so nothing reads the data halfway.
        if (swapping) await check;
        else {
          late = true;
          this.running = check.catch(async (error: unknown) => {
            if (error instanceof HeldError) await this.hold(error);
            else this.noteProblem(error);
            this.changed();
          });
        }
      }
    } catch (error) {
      if (error instanceof HeldError || this.swap.phase === "swapping" || this.swap.phase === "undoing" || this.swap.phase === "chosen") await this.hold(error);
      else this.noteProblem(error);
    }
  }

  /**
   * This start couldn't read or settle what is there: nothing goes up or is cleared. The dialog asks only when a swap may
   * be half done or something is damaged, which waiting won't fix. A file that is merely busy is a problem note.
   */
  private async hold(error: unknown): Promise<void> {
    this.noteProblem(error);
    const disk = await lookSwapStatus(this.statusFile, backupsDir(this.options.userData));
    const phase = disk.status === "present" ? disk.value.phase : null;
    const damaged = error instanceof HeldError && error.reason instanceof DamagedFile;
    const open = damaged || disk.status !== "present" || phase === "swapping" || phase === "undoing" || phase === "chosen";
    this.swap = { phase: "held", open };
    this.log("cloud copy: something can't be read or put in place right now; nothing changes until the next start");
    if (open || phase === "asking") this.ask("conflict");
  }

  /** Writes the next status, before the step that depends on it. */
  private async moveTo(event: SwapEvent): Promise<void> {
    await this.moveFrom(this.swap, event);
  }

  /** The same from a status read for an answer: memory changes only once the disk has it. */
  private async moveFrom(from: SwapStatus, event: SwapEvent): Promise<void> {
    const next = stepSwap(from, event);
    await writeSwapStatus(this.statusFile, next);
    this.swap = next;
  }

  /** A swap stopped halfway, or this start couldn't tell. */
  private get swapOpen(): boolean {
    return this.swap.phase === "swapping" || this.swap.phase === "undoing" || this.swap.phase === "held";
  }

  /** The backup folder with what was written while a swap waited, when this start settled one. */
  get changesKeptIn(): string | null {
    return this.keptAside;
  }

  /** The backup folder with this PC's data from before a swap that an older Tavora settled, when this start found one. */
  get dataKeptIn(): string | null {
    return this.dataAside;
  }

  /** What this start tells the user about the backups it made (startNotice). */
  get notice(): StartNotice | null {
    return startNotice(this.keptAside, this.dataAside);
  }

  /**
   * The data here can't be trusted yet: a file was lost, a chosen copy is still to go in, a swap stopped halfway, or this
   * start couldn't read what is there. Nothing uploads, and the host holds what would act on the data as if it were
   * whole (the start's sweep, the trash purge, the daily backup, dropping panels).
   */
  get dataHeld(): boolean {
    return this.swapOpen || this.swap.phase === "chosen" || (this.swap.phase === "asking" && this.swap.why === "lost");
  }

  /**
   * Once the data files were read, before anything writes them: one that was unreadable (set aside) or that this PC
   * synced and is gone now would go up as empty and replace the good copy on every PC. It is noted (across restarts
   * too) and the user chooses: the copy brings it back, or this PC's side goes up as it is. Never throws.
   */
  async checkDataFiles(): Promise<void> {
    // During a swap, files are missing because the swap moved them.
    if (!this.options.enabled || this.swap.phase === "swapping" || this.swap.phase === "undoing" || this.swap.phase === "chosen") return;
    try {
      // Off this run only (its key or where it is kept can't be read now), the copy is still on: the next start judges.
      if (!this.copyOn && !(await this.stateOnDisk())) return;
      const setAside: string[] = [];
      const missing: string[] = [];
      for (const name of DATA_FILES) {
        const file = path.join(this.options.userData, name);
        // Only a file that isn't there is gone: one held for a moment (a virus scan) is still there.
        if ((await lookStat(file)).status !== "missing") continue;
        (wasSetAside(file) ? setAside : missing).push(name);
      }
      if (this.swap.phase === "held" || !this.on) return await this.noteLostWhileHeld(setAside, missing);
      const lost = [...setAside, ...missing.filter((name) => this.state.files[name] !== undefined)];
      if (lost.length === 0) return;
      await this.parkForQuestion();
      await this.moveTo({ type: "lost", files: lost });
      this.log(`cloud copy: ${lost.join(", ")} can't be read here; nothing goes up until the user chooses a side`);
      this.ask("conflict");
      this.changed();
    } catch (error) {
      await this.hold(error);
      this.changed();
    }
  }

  /**
   * A held start (or one with the copy off for the run) can't tell what was synced, and the app is about to save fresh
   * files over what it lost. So what is gone is written down now, for the next start to record once it can read the state,
   * together with what an earlier such start wrote down. A swap's own moves don't count.
   */
  private async noteLostWhileHeld(setAside: string[], missing: string[]): Promise<void> {
    if (setAside.length === 0 && missing.length === 0) return;
    const disk = await lookSwapStatus(this.statusFile, backupsDir(this.options.userData));
    if (disk.status === "present" && (disk.value.phase === "swapping" || disk.value.phase === "undoing" || disk.value.phase === "chosen")) return;
    const earlier = await lookJson(this.lostNoteFile);
    if (earlier.status === "held" && !isDamaged(earlier)) throw new HeldError(earlier.error);
    // A damaged note said something was lost: the library, as recordLostNote reads it.
    const before = earlier.status === "present" ? { setAside: namesIn(earlier.value.setAside), missing: namesIn(earlier.value.missing) } : { setAside: earlier.status === "held" ? [LIBRARY_FILE] : [], missing: [] };
    await writeFlushed(this.lostNoteFile, { setAside: [...new Set([...before.setAside, ...setAside])], missing: [...new Set([...before.missing, ...missing])] });
  }

  /**
   * What a held start wrote down: lost now, unless a copy has just brought it all back. Without the state (the copy off this
   * run) it waits for a start that can tell what was synced.
   */
  private async recordLostNote(taken: boolean): Promise<void> {
    const note = await lookJson(this.lostNoteFile);
    if (note.status === "missing" || this.swap.phase === "chosen" || !this.on) return;
    if (note.status === "held" && !isDamaged(note)) throw new HeldError(note.error);
    if (!taken && (this.swap.phase === "idle" || this.swap.phase === "asking")) {
      const files = note.status === "present" ? [...namesIn(note.value.setAside), ...namesIn(note.value.missing).filter((name) => this.state.files[name] !== undefined)] : [LIBRARY_FILE];
      if (files.length > 0) {
        await this.parkForQuestion();
        await this.moveTo({ type: "lost", files });
      }
    }
    await rm(this.lostNoteFile, { force: true });
  }

  /**
   * Reads the copy's version; when it is newer and this PC has not changed, downloads it into the
   * staging folder. True when a copy is staged. A changed PC gets the keep-which-side question instead.
   */
  private async fetchNewer(turn: number): Promise<boolean> {
    const remote = await this.cloud.remote();
    if (turn !== this.turn) return false;
    if (!remote) {
      // The copy was deleted (on another PC): it is off here too.
      if (this.state.version > 0) await this.forget("deleted");
      return false;
    }
    this.copy = { size: remote.size, savedAt: remote.updatedAt };
    if (remote.version === this.state.version) {
      // Parts of this PC's own last save that went missing go back, or every other PC waits for them.
      if (this.cloud.storage.arrivesLate) {
        const put = await this.cloud.heal(this.key!, this.roots(), this.state, () => turn === this.turn).catch((error: unknown) => {
          this.log(`cloud copy: missing parts not put back: ${error instanceof Error ? error.message : String(error)}`);
          return 0;
        });
        if (put > 0) this.log(`cloud copy: put back ${put} missing part(s) of this PC's last save`);
      }
      return false;
    }
    // Changed here: the user chooses. So they do when this PC's last save lost against another PC's (in a synced folder),
    // which the newest list tells once it is open (CloudCopy.download: "older").
    if (this.swap.phase === "asking" || (await hasLocalChanges(this.roots(), this.state))) {
      if (turn !== this.turn) return false;
      this.unreadable = false;
      this.ask("conflict");
      this.changed();
      return false;
    }
    try {
      return (await this.stage(this.state.version)) !== null;
    } catch (error) {
      // Saved on top of an older version than this PC has: made anew after a delete, or an old copy served as a newer
      // one. It isn't taken without the user: they choose, as when both changed.
      if (!(error instanceof CopyError) || error.reason !== "older") throw error;
      if (turn !== this.turn) return false;
      this.unreadable = error instanceof NewestUnreadable;
      this.ask("conflict");
      this.changed();
      return false;
    }
  }

  /**
   * Downloads the copy into the staging folder, to be taken at the next start. A copy saved on top of an older
   * version than `since` is refused ("older"); only the check at start passes one. One that looks older or unmarked is
   * refused too (CloudCopy.download), unless the user `chosen` it: their own choices take any.
   */
  private async stage(since = 0, chosen = false): Promise<Staged | null> {
    this.refuseDuringSwap();
    const turn = this.turn;
    await rm(this.stagingDir, { recursive: true, force: true });
    let copy: Awaited<ReturnType<CloudCopy["download"]>>;
    try {
      copy = await this.cloud.download(this.key!, this.roots(), this.stagedData, since, { sealed: this.state.sealed === true, marked: this.state.marked === true, listed: this.state.listed === true, chosen }, () => turn === this.turn);
    } catch (error) {
      // The account's vault doesn't open with this PC's key either (another PC started over with a new key, or the
      // service sent something else): the copy goes off here, and turning it on asks for the new key. The key and the
      // vault this PC last read stay until a key that opens the account's is typed in (account-key.ts).
      if (error instanceof CopyError && (error.reason === "damaged" || error instanceof NewestUnreadable) && !this.keyHere && !(await this.accountKeys.fits())) {
        await this.forget("new-key");
        throw new KeyChanged();
      }
      throw error;
    }
    // Turned off while it came down: nothing of it stays.
    if (turn !== this.turn) {
      if (!this.swapOpen) await rm(this.stagingDir, { recursive: true, force: true });
      return null;
    }
    if (!copy) return null;
    const staged: Staged = { v: 1, ...copy };
    await writeCopyFile(this.listFile, "list", staged);
    return staged;
  }

  /** The copy as it is now in the staging folder: the one staged already when it is still current and whole, else downloaded. */
  private async stageCurrent(): Promise<Staged | null> {
    this.refuseDuringSwap();
    const list = await this.lookList();
    const staged = list.status === "present" ? list.value : null;
    const remote = staged ? await this.cloud.remote() : null;
    if (!staged || !remote || remote.version !== staged.version) return this.stage(0, true);
    // Held counts as not whole here: the user asked for this copy, so it simply comes down again.
    const whole = await look(() => this.stagedWhole(staged));
    return whole.status === "present" && whole.value ? staged : this.stage(0, true);
  }

  /** The staged copy's list, also one an older Tavora left. A list that makes no sense is damaged, so held. */
  private async lookList(): Promise<Looked<Staged>> {
    for (const file of [this.listFile, this.oldListFile]) {
      const looked = await lookStagedList(file);
      if (looked.status !== "missing") return looked;
    }
    return { status: "missing" };
  }

  private async dropList(): Promise<void> {
    await removeCopyFile(this.listFile, "list");
    await removeCopyFile(this.oldListFile, "list");
  }

  /**
   * Whether every file the staged list names is there with the content it names: a crash can leave the list without
   * them, and a power cut can leave them full of zeros. One that is held stops the work, so the copy stays staged.
   */
  private async stagedWhole(staged: Staged): Promise<boolean> {
    for (const [name, file] of Object.entries(staged.files)) {
      const target = path.join(this.stagedData, ...name.split("/"));
      const info = unlessHeld(await lookStat(target));
      if (info?.size !== file.size) return false;
      if (unlessHeld(await look(() => fileSha256(target))) !== file.sha256) return false;
    }
    return true;
  }

  private refuseDuringSwap(): void {
    if (this.swap.phase === "swapping" || this.swap.phase === "undoing") throw new CopyError("failed", "a copy is still being put in place");
  }

  /**
   * Whether a copy not chosen by the user would take every workspace away: this PC lists some and the copy none of
   * them. That is what a library lost on another PC looks like, and taking it would delete their browser data here.
   * A library that is held stops the work: the copy stays staged for the next start.
   */
  private async copyDropsWorkspaces(): Promise<boolean> {
    const ids = (library: Record<string, unknown> | null) => {
      const workspaces = library?.workspaces;
      return typeof workspaces === "object" && workspaces !== null ? Object.keys(workspaces) : [];
    };
    const here = ids(await libraryIfReadable(libraryFile(this.options.userData)));
    if (here.length === 0) return false;
    const taken = new Set(ids(await libraryIfReadable(path.join(this.stagedData, LIBRARY_FILE))));
    return !here.some((id) => taken.has(id));
  }

  /** Settles what an earlier start left, by its status. True when a copy went in. */
  private async settleSwap(): Promise<boolean> {
    const disk = unlessHeld(await lookSwapStatus(this.statusFile, backupsDir(this.options.userData))) ?? SWAP_IDLE;
    const swap = await this.afterOlder(disk);
    this.swap = disk;
    if (swap !== disk) {
      await writeSwapStatus(this.statusFile, swap);
      this.swap = swap;
      if (swap.phase === "idle") {
        await removeCopyFile(this.listFile, "list");
        this.log("cloud copy: an older Tavora took the copy up again during a swap; what it did stands");
      } else this.log("cloud copy: an older Tavora turned the copy on during a swap and uploaded nothing; the swap is taken back");
    }
    if (this.swap.phase !== "swapping" && this.swap.phase !== "undoing") await this.dropSwapLeftovers();
    let taken = false;
    switch (this.swap.phase) {
      case "idle":
      case "chosen":
        taken = await this.takeStaged();
        break;
      case "swapping": {
        const staged = unlessHeld(await this.lookList());
        if (!staged) throw new CopyError("failed", "the list of a copy going in is gone");
        await this.putIn(staged, this.swap.plan, true);
        taken = true;
        break;
      }
      case "undoing":
        await this.takeBack(this.swap.plan);
        break;
      case "asking":
      case "held":
        break;
      default:
        assertNever(this.swap);
    }
    await this.recordLostNote(taken);
    return taken;
  }

  /**
   * A swap's status after what an older Tavora did. One that doesn't know the status found the copy off (the state is
   * parked), and the user turned it on again there, which wrote cloud-copy.json: this Tavora never has that file while a
   * swap goes on. With only that done (the empty state a turn-on writes, and no copy chosen there), nothing went up: the
   * swap is taken back, so this PC's data is in place when the user is asked. Once the older one went on from there
   * (uploaded, or took a copy), what it did stands and the status is idle; finishing or taking the swap back would undo
   * that work. This PC's data from before the swap may then be only in the swap's backup: it is kept whole, and the user
   * is told. A state that can't be read says nothing of who wrote it: the swap stays.
   */
  private async afterOlder(status: SwapStatus): Promise<SwapStatus> {
    if (status.phase !== "swapping" && status.phase !== "undoing") return status;
    const saved = await lookCopyState(this.stateFile);
    if (saved.status === "held" && !isDamaged(saved)) throw new HeldError(saved.error);
    if (saved.status !== "present") return status;
    if (await this.olderOnlyTurnedOn(saved.value)) return status.phase === "undoing" ? status : stepSwap(status, { type: "go-back" });
    if (await this.keepWhole(status.plan.keepIn)) this.dataAside = status.plan.keepIn;
    return SWAP_IDLE;
  }

  /** The state an older Tavora writes when the copy is turned on there, with the question which side to keep not answered. */
  private async olderOnlyTurnedOn(state: CopyState): Promise<boolean> {
    if (state.version !== 0 || Object.keys(state.files).length > 0 || state.kept === true) return false;
    // The user chose the copy there: it goes in at this start.
    const list = await lookCopyFile(this.oldListFile, "list", (saved) => saved);
    if (list.status === "held" && !isDamaged(list)) throw new HeldError(list.error);
    return !(list.status === "present" && list.value.take === true);
  }

  /** Marks one of this PC's backups so pruning leaves it whole (backupFolder). False when it isn't there. */
  private async keepWhole(dir: string): Promise<boolean> {
    if (unlessHeld(await lookStat(dir)) === null) return false;
    await writeFileAtomic(path.join(dir, KEEP_WHOLE), "");
    return true;
  }

  /**
   * With no swap going on, what one leaves behind goes: its plan, which a status that can't be read would otherwise be
   * taken for, and the parked state, which goes back to cloud-copy.json unless that is there (then that one is newer).
   * While the user is asked about lost data, or a copy they chose waits, the state stays parked.
   */
  private async dropSwapLeftovers(): Promise<void> {
    await rm(this.planFile, { force: true });
    if (parksState(this.swap)) await this.parkForQuestion();
    else await this.unparkState(null);
  }

  /** The state where it is: cloud-copy.json, or the parked one during a swap. */
  private async lookState(): Promise<Looked<CopyState>> {
    const saved = await lookCopyState(this.stateFile);
    return saved.status === "missing" ? lookCopyState(this.parkedFile) : saved;
  }

  /** Whether the state is on disk, also when it can't be read now. */
  private async stateOnDisk(): Promise<boolean> {
    return (await lookStat(this.stateFile)).status !== "missing" || (await lookStat(this.parkedFile)).status !== "missing";
  }

  /**
   * Before the user is asked about lost data, or once they chose a copy: the state is parked as during a swap, or an older
   * Tavora would find the copy on and upload what is here (the fresh files the app saves in place of what was lost) over
   * the copy. A cloud-copy.json that is there is the newest.
   */
  private async parkForQuestion(): Promise<void> {
    if (unlessHeld(await lookStat(this.stateFile)) !== null) await renameHeld(this.stateFile, this.parkedFile);
  }

  /** Before a swap begins: the state goes where older Tavoras don't look, written there before cloud-copy.json goes. */
  private async parkState(): Promise<void> {
    await saveCopyState(this.parkedFile, this.state);
    await removeCopyState(this.stateFile);
  }

  /**
   * Once the status says no swap goes on: the state is back in cloud-copy.json (`state`, or the parked one as it is), then
   * the parked file goes. A cloud-copy.json that is there already is newer and stays.
   */
  private async unparkState(state: CopyState | null): Promise<void> {
    if (state) await saveCopyState(this.stateFile, state);
    else if ((await lookStat(this.parkedFile)).status === "missing") return;
    else if (unlessHeld(await lookStat(this.stateFile)) === null) await renameHeld(this.parkedFile, this.stateFile);
    await removeCopyState(this.parkedFile);
  }

  /**
   * Takes a swap back: this PC's data goes back in place, and going back sticks. The status moves on before the staged
   * copy goes, so a crash in between can't leave a whole copy that the next start would take.
   */
  private async takeBack(plan: SwapPlan): Promise<void> {
    const list = await this.lookList();
    // Busy is tried again next start. A damaged list only says what else came: what was kept goes back without it.
    if (list.status === "held" && !isDamaged(list)) throw new HeldError(list.error);
    const copy = list.status === "present" ? list.value : { version: 0, pictures: true, files: {} };
    await undoSwap(this.stagedData, copyRoots(this.options.userData, plan.moduleFiles), plan.keepIn, copy, plan.empty);
    if (await sortWrittenSince(plan.keepIn, copy, this.state, await this.earlier(plan))) this.keptAside = plan.keepIn;
    // Written before the status moves on: once it says the swap went back, the parked state is no longer read.
    const state = await this.sealedBeside(plan);
    if (state) {
      await saveCopyState(this.stateFile, state);
      if (this.on) this.state = state;
    }
    await this.moveTo({ type: "went-back", copyOn: this.copyOn });
    await this.unparkState(state);
    await this.dropList();
    await rm(this.stagingDir, { recursive: true, force: true });
    this.log("cloud copy: a copy that didn't finish was taken back; this PC's data is in place");
  }

  /**
   * Going back after an older Tavora turned the copy on during the swap: its cloud-copy.json beside the parked state is
   * newer and wins, but it never knows `sealed`, `marked` or `listed`. When the copy is still kept where the swap's copy
   * came from, this PC has seen a sealed (or marked, or listed) one there, and keeps that: an unsealed (or unmarked) list
   * there stays refused, and one without a line is judged as `listed` says. Where is the place and the
   * account signed in (the service keeps one copy per account). Null to leave it as it is.
   */
  private async sealedBeside(plan: SwapPlan): Promise<CopyState | null> {
    if (plan.place === undefined || plan.account === undefined || plan.account !== this.options.account.id()) return null;
    if (plan.place !== (await loadPlace(this.placeFile))) return null;
    const parked = await lookCopyState(this.parkedFile);
    const beside = await lookCopyState(this.stateFile);
    if (parked.status !== "present" || beside.status !== "present") return null;
    // The same goes for a marked one, and one with a line.
    const sealed = parked.value.sealed === true && beside.value.sealed !== true;
    const marked = parked.value.marked === true && beside.value.marked !== true;
    const listed = parked.value.listed === true && beside.value.listed !== true;
    if (!sealed && !marked && !listed) return null;
    return {
      ...beside.value,
      ...(parked.value.sealed === true ? { sealed: true } : {}),
      ...(parked.value.marked === true ? { marked: true } : {}),
      ...(parked.value.listed === true ? { listed: true } : {}),
    };
  }

  /**
   * What earlier copies of this swap put in (sortWrittenSince): their lists, and the places the plan says they put in, as
   * long as that still holds: what was there before is still in the backup, or there was nothing. A later step may have
   * put this PC's own back in such a place (a copy without pictures takes the pictures back), and then a file there that
   * looks like an earlier copy's is this PC's own.
   */
  private async earlier(plan: SwapPlan): Promise<EarlierCopies> {
    if (!plan.earlierIn?.length) return { lists: [], places: [] };
    const roots = copyRoots(this.options.userData, plan.moduleFiles);
    const places: string[] = [];
    for (const name of plan.earlierIn) {
      const [rootName, ...rest] = name.split("/");
      const root = roots.find((candidate) => candidate.name === rootName);
      if (!root) continue;
      const place = path.join(root.path, ...rest);
      if (plan.empty.includes(place) || unlessHeld(await lookStat(path.join(plan.keepIn, ...name.split("/")))) !== null) places.push(name);
    }
    return { lists: places.length > 0 ? await this.earlierLists(plan.keepIn) : [], places };
  }

  /** The lists of every copy this swap has put in so far (INCOMING_LISTS); none when they can't be read. */
  private earlierLists(keepIn: string): Promise<Staged[]> {
    return readIncomingLists(keepIn);
  }

  /** Swaps a staged copy in: when the user chose it, or when this PC has not changed since it last synced. */
  private async takeStaged(): Promise<boolean> {
    if (this.swap.phase !== "idle" && this.swap.phase !== "chosen") return false;
    const staged = unlessHeld(await this.lookList());
    // A list an older Tavora left as the user's choice: on disk as that first, so a broken one can't let uploads through.
    if (staged?.take === true && this.swap.phase === "idle") {
      // Parked first, as when the user chooses here.
      await this.parkForQuestion();
      await this.moveTo({ type: "chosen" });
    }
    const chosen = this.swap.phase === "chosen";
    if (!staged) {
      if (chosen) await this.moveTo({ type: "copy-gone" });
      return false;
    }
    if (!this.on) {
      if (!chosen) await rm(this.stagingDir, { recursive: true, force: true });
      return false;
    }
    // One the user chose is taken at any version: restoring the version this PC already has is how lost data comes back.
    if (!chosen && staged.version <= this.state.version) {
      await rm(this.stagingDir, { recursive: true, force: true });
      return false;
    }
    if (!(await this.stagedWhole(staged))) {
      await rm(this.stagingDir, { recursive: true, force: true });
      if (chosen) await this.moveTo({ type: "copy-gone" });
      return false;
    }
    if (!chosen && ((await hasLocalChanges(this.roots(), this.state)) || (await this.copyDropsWorkspaces()))) {
      this.ask("conflict");
      return false;
    }
    const moduleFiles = this.options.files.root();
    // Held stops here, with nothing moved: read as "no library" it would wipe this PC's own settings.
    const own = pcSettingsOf(await libraryIfReadable(libraryFile(this.options.userData)));
    const keepIn = await this.backupFolder("this-pc");
    const empty = await emptyPlaces(this.stagedData, copyRoots(this.options.userData, moduleFiles), keepIn, staged);
    // Read from the disk: at a start's settling, `folder` isn't loaded yet.
    const place = await loadPlace(this.placeFile);
    const plan: SwapPlan = { keepIn, moduleFiles, own, empty, ...(place === undefined ? {} : { place, account: this.options.account.id() }) };
    await writeFlushed(this.planFile, plan);
    await this.parkState();
    await this.moveTo({ type: "begin", plan });
    // A second copy of the list, with the backup: if the staged one is lost, what this copy put in place is still known.
    // Once the swap has begun, so a start that stops before leaves no backup folder with nothing else in it.
    await mkdir(keepIn, { recursive: true });
    await writeCopyFile(path.join(keepIn, INCOMING_LISTS), "incoming", { lists: [staged] });
    await this.putIn(staged, plan, false);
    return true;
  }

  /** The swap itself. The status goes back to idle last, once the state says the copy is in. */
  private async putIn(staged: Staged, plan: SwapPlan, resumed: boolean): Promise<void> {
    const before = this.state;
    const roots = copyRoots(this.options.userData, plan.moduleFiles);
    // A copy without pictures leaves this PC's where they are. One that came down in place of a lost list may follow a
    // copy with pictures, which had begun to move them: those places are taken back first.
    if (resumed && !staged.pictures) await undoSwap(this.stagedData, roots.filter((root) => root.picture), plan.keepIn, { version: 0, pictures: true, files: {} }, plan.empty);
    const taken = await swapInCopy(this.stagedData, roots, plan.keepIn, staged, resumed);
    // Once seen, a sealed (or marked, or listed) copy stays seen, also after taking an older Tavora's copy.
    const state = { ...taken, ...(before.sealed === true ? { sealed: true } : {}), ...(before.marked === true ? { marked: true } : {}), ...(before.listed === true ? { listed: true } : {}) };
    await keepPcSettings(libraryFile(this.options.userData), plan.own, state);
    if (await sortWrittenSince(plan.keepIn, staged, before, await this.earlier(plan))) this.keptAside = plan.keepIn;
    // Turned off before the cut: the files are finished, and the copy stays off.
    if (this.copyOn) {
      this.state = state;
      await saveCopyState(this.parkedFile, state);
    }
    await this.moveTo({ type: "finished" });
    await this.unparkState(this.copyOn ? state : null);
    await this.dropList();
    await rm(this.stagingDir, { recursive: true, force: true });
    this.problem = null;
    this.log(`cloud copy: took version ${staged.version}; this PC's data is in ${plan.keepIn}`);
  }

  /**
   * A new folder under backups/ for the side that is replaced, keeping the last few whole. Of an older one, only what the
   * user wrote while a swap waited stays (`written-since`): it may be the only place that work is.
   */
  private async backupFolder(side: "this-pc" | "cloud"): Promise<string> {
    const root = backupsDir(this.options.userData);
    await mkdir(root, { recursive: true });
    const whole: string[] = [];
    for (const name of (unlessHeld(await lookNames(root)) ?? []).filter((item) => item.startsWith("cloud-copy-")).sort()) {
      const inside = await lookNames(path.join(root, name));
      if (inside.status === "present" && inside.value.includes(KEEP_WHOLE)) continue;
      if (inside.status !== "present" || inside.value.some((item) => item !== WRITTEN_SINCE)) whole.push(name);
    }
    for (const name of whole.slice(0, Math.max(0, whole.length - (KEEP_BACKUPS - 1)))) await this.pruneBackup(path.join(root, name));
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    return path.join(root, `cloud-copy-${stamp}-${side}`);
  }

  /** Empties an old backup, except real work. One that can't be read stays as it is. */
  private async pruneBackup(dir: string): Promise<void> {
    const work = await lookStat(path.join(dir, WRITTEN_SINCE));
    if (work.status === "held") return;
    if (work.status === "missing") return rm(dir, { recursive: true, force: true });
    const names = await lookNames(dir);
    if (names.status !== "present") return;
    for (const name of names.value) if (name !== WRITTEN_SINCE) await rm(path.join(dir, name), { recursive: true, force: true });
  }

  // ── While running ──────────────────────────────────────────────────

  /** After the window shows: syncs every few minutes, and once now. */
  start(): void {
    if (!this.options.enabled) return;
    this.timer = setInterval(() => void this.sync().catch(() => undefined), SYNC_EVERY_MS);
    this.timer.unref?.();
    if (!this.on) {
      // Its key file can't be opened right now: the copy stays on and waits for it (sync reads it again), and says why.
      if (this.keyBlocked()) this.changed();
      return;
    }
    if (this.keyHere) {
      void this.sync().catch(() => undefined);
      return;
    }
    // A key from before the account kept a vault gets one, so other PCs ask for it instead of making their own.
    // A key that doesn't open the account's vault (another PC started over) stops the copy here before anything goes
    // up; the key stays (account-key.ts).
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
    return this.questions.size > 0 || this.swap.phase !== "idle";
  }

  /**
   * The copy is on but its key file on this PC can't be opened (held, or sealed by another user): it waits for it,
   * nothing of it goes, and Settings says why ("key-blocked"). Notes the problem; whether it is so.
   */
  private keyBlocked(): boolean {
    if (!this.copyOn || this.key !== null || !this.accountKeys.keyBlocked) return false;
    this.problem = "key-blocked";
    return true;
  }

  /** Uploads what changed. Quiet: problems show in Settings. `loud` throws them for a button. */
  async sync(loud = false): Promise<void> {
    if (this.keyBlocked()) {
      // Read again (only that file): it may open now.
      await this.accountKeys.openAgainNow();
      if (this.keyBlocked()) return this.changed();
      if (this.problem === "key-blocked") this.problem = null;
      this.changed();
    }
    if (!this.on || (this.waiting && !loud)) return;
    if (this.asked("conflict") || this.dataHeld) throw new UserError("cloudCopy.error.conflict");
    await this.exclusive("uploading", async () => {
      // What ran before (a download at start) may have left a question.
      if (!this.on || (this.waiting && !loud) || this.dataHeld) return;
      const turn = this.turn;
      await this.hooks?.flush();
      // Turned off while the panels saved.
      if (turn !== this.turn) return;
      try {
        const result = await this.cloud.upload(this.key!, this.roots(), this.state, (done, total) => this.uploaded(done, total));
        // Turned off while it went up: what it knew is forgotten, and stays so.
        if (turn !== this.turn) return;
        if (result.status === "uploaded") {
          this.state = result.state;
          if (!(await this.keepState(turn))) return;
          this.copy = { size: result.size, savedAt: this.now().toISOString() };
          this.problem = null;
        } else if (result.status === "unchanged") {
          this.problem = null;
        } else if (result.status === "too-big") {
          this.problem = "too-big";
        } else if (result.version === 0) {
          await this.forget("deleted");
        } else {
          // Which kind it is shows once the user answers (keep).
          this.unreadable = false;
          this.ask("conflict");
        }
      } catch (error) {
        if (turn !== this.turn) return;
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
    if (this.swapOpen && !(this.swap.phase === "held" && !this.swap.open)) throw new UserError("cloudCopy.error.restartFirst");
    if (!this.accountKeys.canKeep) throw new UserError("cloudCopy.error.cantKeep");
    // Turned off or signed out from here on, it stays off.
    const turn = this.turn;
    this.use(folder);
    const setUp = await this.exclusive("checking", async () => {
      if (folder !== null) await checkFolder(folder);
      // Signed out, a folder's copy keeps its key here; signed in, the key is the account's.
      if (this.keyHere) return this.accountKeys.setUpHere((await this.cloud.remote()) !== null);
      const setUp = await this.accountKeys.setUp();
      // The account's key seals the copy from now on (a key of another account's copy waits for it).
      if (setUp.status === "ready") await this.accountKeys.useForCopy();
      return setUp;
    }).catch((error: unknown) => {
      this.use(null);
      if (error instanceof UserError) throw error;
      throw CopySync.userError(this.noteProblem(error));
    });
    if (turn !== this.turn) return;
    if (setUp.status === "ask") {
      this.ask("askKey");
      this.changed();
      return;
    }
    if (setUp.created) this.shownKey = this.keyToShow();
    await this.startCopy(turn);
  }

  /** The recovery key typed in when another PC made the account's key: checked against the account, then the copy goes on. */
  async enterKey(text: string): Promise<void> {
    const here = this.keyHere;
    const turn = this.turn;
    await this.exclusive("checking", () => (here ? this.accountKeys.enterHere(text) : this.accountKeys.enter(text))).catch((error: unknown) => {
      if (error instanceof UserError) throw error;
      throw CopySync.userError(this.noteProblem(error));
    });
    if (turn !== this.turn) return;
    await this.goOnWithKey(here, turn);
  }

  /** Another PC sent the account's key (pairing.ts), and it is kept: a copy that waited for it goes on. */
  async keyArrived(): Promise<void> {
    if (this.asked("askKey")) await this.goOnWithKey(this.keyHere, this.turn);
  }

  private async goOnWithKey(here: boolean, turn: number): Promise<void> {
    this.clear("askKey");
    try {
      if (!here) await this.accountKeys.useForCopy();
      await this.startCopy(turn);
    } catch (error) {
      if (turn !== this.turn) return;
      // Signed out, the folder's copy is the only check: a key that doesn't open it is not kept.
      if (here && error instanceof UserError && error.key === "cloudCopy.error.wrongKey") {
        await this.accountKeys.forget(null);
        this.ask("askKey");
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
    // It would replace the copy with what is left here.
    if (this.dataHeld) throw new UserError("cloudCopy.error.conflict");
    const turn = this.turn;
    const base = await this.exclusive("checking", async () => {
      const remote = await this.cloud.remote();
      if (this.keyHere) await this.accountKeys.startOverHere();
      else {
        await this.accountKeys.startOver();
        await this.accountKeys.useForCopy();
      }
      return remote?.version ?? 0;
    }).catch((error: unknown) => {
      if (error instanceof UserError) throw error;
      throw CopySync.userError(this.noteProblem(error));
    });
    // Turned off or signed out meanwhile: it stays off.
    if (turn !== this.turn) return;
    const folder = this.folder;
    await this.forget(null);
    const mine = this.turn;
    this.use(folder);
    if (!(await this.keepPlace(mine, folder))) return;
    this.shownKey = this.keyToShow();
    this.copyOn = true;
    // Nothing of the old copy is reused: every file goes up again under the new key.
    this.state = { ...EMPTY_STATE, version: base };
    if (!(await this.keepState(mine))) return;
    this.changed();
    await this.sync(true);
  }

  /** With the account's key here: takes up a copy that exists (the user keeps one side), or starts a new one. */
  private async startCopy(turn: number): Promise<void> {
    if (this.swapOpen) throw new UserError("cloudCopy.error.restartFirst");
    let staged: Staged | null = null;
    // A copy that isn't taken without asking (an unmarked list where marked ones are): nothing comes down before the
    // user chooses, as for any copy that is there.
    let asks = false;
    try {
      staged = await this.exclusive("downloading", async () => {
        const remote = await this.cloud.remote();
        if (!remote) return null;
        this.copy = { size: remote.size, savedAt: remote.updatedAt };
        return this.stage();
      });
    } catch (error) {
      // Turned off meanwhile: nothing to say about a turn-on that no longer counts.
      if (turn !== this.turn) return;
      if (error instanceof CopyError && error.reason === "older") {
        asks = true;
        this.unreadable = error instanceof NewestUnreadable;
      }
      else {
        // Sealed with another key: a copy from before the account had its key.
        if (error instanceof CopyError && error.reason === "damaged") throw new UserError("cloudCopy.error.wrongKey");
        throw CopySync.userError(this.noteProblem(error));
      }
    }
    // Turned off (or signed out) while it looked: it stays off.
    if (turn !== this.turn) return;
    this.copyOn = true;
    this.state = EMPTY_STATE;
    if (!(await this.keepState(turn)) || !(await this.keepPlace(turn, this.folder))) return;
    this.problem = null;
    if (staged || asks) {
      // This PC has its own data too: the user keeps one side.
      this.ask("conflict");
      this.changed();
      return;
    }
    this.copy = null;
    this.changed();
    await this.sync(true);
  }

  cancelKey(): void {
    this.clear("askKey");
    this.use(null);
    this.copy = null;
    this.changed();
  }

  showKey(): void {
    this.shownKey = this.keyToShow();
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
    // A copy on the service is its account's: signed out, it can't go into a folder (sealed with that account's key).
    if (this.folder === null && !this.accountKeys.signedIn) throw CopySync.userError("signed-out");
    const from = this.cloud;
    const problem = this.problem;
    const turn = this.turn;
    let moved = false;
    let to: CloudCopy | null = null;
    /** Something of this move went up to the new place (it held no copy before): only then it may be removed there. */
    let ours = false;
    const dropNew = async () => {
      if (!ours || !to) return;
      await to.remove().catch((error: unknown) => this.log(`cloud copy: the moved copy was not deleted: ${error instanceof Error ? error.message : String(error)}`));
    };
    await this.exclusive("uploading", async () => {
      try {
        if (turn !== this.turn) return;
        await this.hooks?.flush();
        if (folder !== null) await checkFolder(folder);
        to = new CloudCopy(this.storageFor(folder));
        if (await to.remote()) throw new UserError("cloudCopy.error.moveTaken");
        ours = true;
        const result = await to.upload(this.key!, this.roots(), EMPTY_STATE, (done, total) => this.uploaded(done, total));
        // Another PC's copy came first, or nothing went up: not this move's to remove.
        if (result.status !== "uploaded") ours = false;
        if (result.status === "too-big") throw new UserError("cloudCopy.error.too-big");
        if (result.status !== "uploaded") throw new UserError("cloudCopy.error.moveTaken");
        // Turned off while it went up: the new place is not taken up here and loses what went up, and the old copy
        // stays for the other PCs.
        if (!(await this.keepPlace(turn, folder))) return void (await dropNew());
        this.use(folder);
        this.state = result.state;
        if (!(await this.keepState(turn))) return void (await dropNew());
        moved = true;
        this.copy = { size: result.size, savedAt: this.now().toISOString() };
        this.problem = null;
      } catch (error) {
        // Turned off meanwhile (signed out: the key went too): nothing to say about a move that no longer counts, and
        // what went up to the new place goes.
        if (turn !== this.turn) return void (await dropNew());
        if (error instanceof UserError) throw error;
        const failed = this.noteProblem(error);
        // The copy where it is now is fine: this was only the move.
        this.problem = problem;
        throw CopySync.userError(failed);
      }
    });
    if (!moved) return;
    await from.remove().catch((error: unknown) => this.log(`cloud copy: the old copy was not deleted: ${error instanceof Error ? error.message : String(error)}`));
  }

  /** Takes the copy in place of this PC's data: downloaded now, swapped in at the restart. */
  async restore(): Promise<void> {
    if (!this.on) return;
    await this.takeCopy(await this.swapForAnswer());
  }

  /**
   * The status to answer the user from, without changing anything: memory moves only once the answer is on disk. A start
   * that was held looks again now. If the status can't be read, the swap's plan says whether one began, and with the plan
   * damaged too, this PC's newest backup does; a busy file with nothing to go by can't be answered yet.
   */
  private async swapForAnswer(): Promise<SwapStatus> {
    if (this.swap.phase !== "held") return this.swap;
    const backups = backupsDir(this.options.userData);
    const status = await lookSwapStatus(this.statusFile, backups);
    let swap: SwapStatus;
    try {
      if (status.status === "present") swap = await this.afterOlder(status.value);
      else {
        const plan = await lookSwapPlan(this.planFile, backups);
        if (plan.status === "present") swap = { phase: "swapping", plan: plan.value };
        else if (plan.status === "missing" && isDamaged(status)) swap = SWAP_IDLE;
        else if (isDamaged(plan) && isDamaged(status)) swap = await this.swapFromBackup();
        else throw CopySync.userError("failed");
      }
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw CopySync.userError("failed");
    }
    if (this.copyOn) {
      const saved = await this.lookState();
      if (saved.status === "held" && !isDamaged(saved)) throw CopySync.userError("failed");
      if (this.on && saved.status === "present") this.state = saved.value;
    }
    return swap;
  }

  /**
   * A swap whose status and plan are both damaged (or name a data folder that has moved since). What was here went into
   * the backup made just before the plan was written: the newest of this PC's backups from then. With none, nothing moved
   * yet. The plan is made again from it, so every answer has a way out.
   */
  private async swapFromBackup(): Promise<SwapStatus> {
    const written = unlessHeld(await lookStat(this.planFile))?.mtimeMs;
    if (written === undefined) return SWAP_IDLE;
    const backups = backupsDir(this.options.userData);
    const near = (unlessHeld(await lookNames(backups)) ?? [])
      .map((name) => ({ name, at: backupTime(name) }))
      .filter((backup): backup is { name: string; at: number } => backup.at !== null && Math.abs(backup.at - written) <= PLAN_AFTER_BACKUP_MS)
      .sort((x, y) => x.at - y.at);
    const newest = near.at(-1);
    if (!newest) return SWAP_IDLE;
    const keepIn = path.join(backups, newest.name);
    const kept = await libraryIfReadable(path.join(keepIn, LIBRARY_FILE));
    const own = pcSettingsOf(kept ?? (await libraryIfReadable(libraryFile(this.options.userData))));
    const list = await this.lookList();
    if (list.status === "held" && !isDamaged(list)) throw new HeldError(list.error);
    // With this PC's library in the backup, the one in place is the copy's, which may name another PC's module files folder.
    // So it is when the copy's library is no longer staged and none of this PC's is in the backup: this PC had none of its
    // own (or one that couldn't be read), and its pictures were in the default folder. A folder is read as library.ts does.
    const named = kept?.moduleFilesFolder;
    const copyHasLibrary = list.status !== "present" || list.value.files[LIBRARY_FILE] !== undefined;
    const copysInPlace = copyHasLibrary && unlessHeld(await lookStat(path.join(this.stagedData, LIBRARY_FILE))) === null;
    const defaultRoot = this.options.files.defaultRoot?.() ?? this.options.files.root();
    const moduleFiles = kept ? (typeof named === "string" && named.length <= MAX_FOLDER_PATH && path.isAbsolute(named) ? named : defaultRoot) : copysInPlace ? defaultRoot : this.options.files.root();
    // The places the copy filled that held nothing before are told from what is left, so going back empties them again.
    const empty = list.status === "present" ? await filledPlaces(this.stagedData, copyRoots(this.options.userData, moduleFiles), keepIn, list.value) : [];
    return { phase: "swapping", plan: { keepIn, moduleFiles, own, empty } };
  }

  /**
   * The user answered with a damaged state file: it starts over, so the next start can settle what they chose. During a
   * swap the state is parked, and a cloud-copy.json beside it is no one's. Otherwise the state is parked while the answer
   * keeps it so (a chosen copy, or lost data still asked about), and back in cloud-copy.json once it doesn't.
   */
  private async repairState(duringSwap: boolean, turn = this.turn): Promise<void> {
    // Forgotten meanwhile (turned off): the state files are gone, and a repair would bring one back.
    if (turn !== this.turn) return;
    if (!duringSwap) {
      const parked = parksState(this.swap);
      if (parked) await this.parkForQuestion();
      else await this.unparkState(null);
      const file = parked ? this.parkedFile : this.stateFile;
      if (isDamaged(await lookCopyState(file)) && turn === this.turn) await saveCopyState(file, EMPTY_STATE);
      return;
    }
    const parked = await lookCopyState(this.parkedFile);
    const beside = isDamaged(await lookCopyState(this.stateFile));
    if (turn !== this.turn) return;
    if (isDamaged(parked) || (parked.status === "missing" && beside)) await saveCopyState(this.parkedFile, EMPTY_STATE);
    if (beside) await removeCopyState(this.stateFile);
  }

  /**
   * Keeps one side when both changed. The other side is kept as a local backup. Over a newest list this PC's key doesn't
   * open (NewestUnreadable) nothing can be kept of the other side, and another PC that started over with a new key couldn't
   * open this PC's side either: only with `replace` (the user confirmed that) does this PC's side go on top. Without it, the
   * question says so (`conflictKind` "unreadable") and nothing changes.
   */
  async keep(side: "pc" | "cloud", replace = false): Promise<void> {
    // A swap that stopped halfway is settled at a start, when nothing reads the data: finished, or taken back. Also with
    // the copy off, where this is the only way out of it.
    const swap = await this.swapForAnswer();
    if (swap.phase === "swapping" || swap.phase === "undoing") {
      if (side === "cloud") return this.takeCopy(swap);
      const turn = this.turn;
      const failures = this.offFailures;
      const back = stepSwap(swap, { type: "go-back" });
      if (!(await this.writeStatusFor(turn, back))) return;
      this.swap = back;
      await this.repairState(true, turn);
      if (!(await this.goesOnUnlessOffFailed(turn, failures))) return;
      return this.restart();
    }
    if (!this.on) {
      // The copy can't be reached from here (off, or another account): this PC's side can still be the answer. A status or
      // state that is damaged is written again as it was read, or the next start would hold once more.
      if (swap.phase === "asking" || swap.phase === "chosen") {
        if (side === "cloud") throw this.offError();
        // This PC's side over a chosen copy: marked as kept first, so a start with its account doesn't take the copy
        // without asking; then the copy goes into a backup, as when this PC's side is kept with the copy on.
        if (swap.phase === "chosen") await this.markKept();
        await this.moveFrom(swap, { type: "answered" });
        if (swap.phase === "chosen") await this.setStagedAside();
      } else if (this.swap.phase === "held") {
        await writeSwapStatus(this.statusFile, swap);
        this.swap = swap;
      }
      if (this.copyOn) await this.repairState(false);
      this.clear("conflict");
      return this.changed();
    }
    if (side === "cloud") return this.takeCopy(swap);
    const turn = this.turn;
    let unconfirmed = false;
    await this.exclusive("downloading", async () => {
      try {
        // The newest list doesn't open with this key (NewestUnreadable): nothing of it can come down or be kept, and this
        // PC's side goes on top of it, once the user confirmed it replaces another PC's newer copy.
        let over: number | null = null;
        const staged = await this.stageCurrent().catch((error: unknown) => {
          if (!(error instanceof NewestUnreadable)) throw error;
          over = error.version;
          return null;
        });
        if (turn !== this.turn) return;
        if (over !== null && !replace) {
          unconfirmed = true;
          await rm(this.stagingDir, { recursive: true, force: true });
          return;
        }
        if (over !== null) {
          await rm(this.stagingDir, { recursive: true, force: true });
          // Where it was before: if that list can't be saved on top of, the save goes there (FolderStorage.makeRoom). Kept
          // over the same list again (the save before had to ask), still where it was the first time.
          this.state = { ...this.state, version: over, kept: true, keptFrom: this.state.keptFrom ?? this.state.version };
        } else if (staged) {
          // The list goes first: a crash can't leave it naming files that moved. The upload below replaces the copy, so
          // it doesn't run unless the copy's side is safe in the backup.
          const backup = await this.backupFolder("cloud");
          await this.dropList();
          await renameHeld(this.stagedData, backup);
          // The parts of this PC's last sync may be gone from the service; the upload sends what is missing.
          // This PC's side goes up on top of the copy, even when nothing changed here since its last sync (the copy was
          // older, or made anew). Marked on disk, so it counts as changed until an upload succeeds, also across a restart;
          // the files keep their dates and parts, so a retry reads only what really changed.
          const { keptFrom: _, ...rest } = this.state;
          this.state = { ...rest, version: staged.version, kept: true };
        } else {
          this.state = EMPTY_STATE;
        }
        this.unreadable = false;
        await rm(this.stagingDir, { recursive: true, force: true });
        await this.keepState(turn);
        // Choosing this PC's side also answers for data it lost: what is here now is what the user wants up.
        await this.moveFrom(swap, { type: "answered" });
        await this.unparkState(null);
      } catch (error) {
        throw CopySync.userError(this.noteProblem(error));
      }
    });
    if (turn !== this.turn) return;
    if (unconfirmed) {
      this.unreadable = true;
      return this.changed();
    }
    this.clear("conflict");
    this.clear("restartToTake");
    await this.sync(true);
  }

  /**
   * Signed out, the newest list in the folder doesn't open with this PC's key: the recovery key of another PC that started
   * over is typed in. Only a key that opens that list is taken (one that doesn't leaves everything as it was, so a mistyped
   * key never costs this PC the key it has), and only once its copy came down whole: parts a sync app hasn't brought yet
   * ("not-arrived") leave everything as it was too, to try again later. That copy stays staged, and the user keeps one
   * side as when turning the copy on (a newer list by then is downloaded and checked again when they answer).
   */
  async enterOtherKey(text: string): Promise<void> {
    if (!this.on || !this.keyHere || !this.unreadable) throw new UserError("cloudCopy.error.wrongKey");
    const key = parseRecoveryKey(text);
    if (!key) throw new UserError("cloudCopy.error.badKey");
    const turn = this.turn;
    const opens = await this.exclusive("checking", async () => {
      const current = await this.cloud.storage.manifest();
      if (!current) return false;
      try {
        openManifest(copyKeys(key), current.sealed);
        return true;
      } catch {
        return false;
      }
    }).catch((error: unknown) => {
      throw CopySync.userError(this.noteProblem(error));
    });
    if (turn !== this.turn) return;
    if (!opens) throw new UserError("cloudCopy.error.wrongKey");
    await rm(this.stagingDir, { recursive: true, force: true });
    const came = await this.exclusive("downloading", () => this.cloud.download(key, this.roots(), this.stagedData, 0, { chosen: true }, () => turn === this.turn)).catch(
      async (error: unknown) => {
        await rm(this.stagingDir, { recursive: true, force: true });
        if (turn !== this.turn) return null;
        throw CopySync.userError(this.noteProblem(error));
      },
    );
    if (turn !== this.turn) return;
    if (!came) {
      // The folder's copy went away meanwhile: nothing changes, and the user hears so.
      await rm(this.stagingDir, { recursive: true, force: true });
      throw new UserError("cloudCopy.error.noCopy");
    }
    // Nothing of what this PC synced under the old key counts any more, as at turn-on: written before the key changes, so a
    // crash in between never leaves the old key's parts noted under the new one (that is harmless the other way round).
    // Not written (a full disk): this PC stays as it was, in memory too, with nothing staged.
    const before = this.state;
    this.state = EMPTY_STATE;
    const written = await this.keepState(turn).catch((error: unknown) => {
      this.state = before;
      return rm(this.stagingDir, { recursive: true, force: true }).then(() => {
        throw CopySync.userError(this.noteProblem(error));
      });
    });
    if (!written) {
      if (turn === this.turn) this.state = before;
      await rm(this.stagingDir, { recursive: true, force: true });
      return;
    }
    // The key, then the copy's list: a list staged under a key this PC doesn't have would be damaged at the next start.
    await this.accountKeys.takeHere(key);
    const staged: Staged = { v: 1, ...came };
    await writeCopyFile(this.listFile, "list", staged);
    this.unreadable = false;
    this.problem = null;
    this.ask("conflict");
    this.changed();
  }

  /** This PC's side counts as changed until an upload succeeds (CopyState `kept`), wherever the state is now. */
  private async markKept(): Promise<void> {
    for (const file of [this.parkedFile, this.stateFile]) {
      const saved = await lookCopyState(file);
      if (saved.status === "present" && saved.value.kept !== true) await saveCopyState(file, { ...saved.value, kept: true });
    }
  }

  /** The staged copy goes into a backup, its list first, so a crash can't leave the list naming files that moved. */
  private async setStagedAside(): Promise<void> {
    if (unlessHeld(await lookStat(this.stagedData)) !== null) {
      const backup = await this.backupFolder("cloud");
      await this.dropList();
      await renameHeld(this.stagedData, backup);
    }
    await this.dropList();
    await rm(this.stagingDir, { recursive: true, force: true });
  }

  private async takeCopy(swap: SwapStatus): Promise<void> {
    if (swap.phase === "swapping" || swap.phase === "undoing") {
      const turn = this.turn;
      const failures = this.offFailures;
      const from = swap.phase === "swapping" ? await this.restageForSwap(swap) : swap;
      // Turned off while the copy came down again (or at any point here): the forgetting stands, and nothing restarts.
      if (!from) return;
      const next = stepSwap(from, { type: "try-again" });
      if (!(await this.writeStatusFor(turn, next))) return;
      this.swap = next;
      await this.repairState(true, turn);
      if (!(await this.goesOnUnlessOffFailed(turn, failures))) return;
      return this.restart();
    }
    const turn = this.turn;
    const failures = this.offFailures;
    await this.exclusive("downloading", async () => {
      try {
        if (!(await this.stageCurrent()) && turn === this.turn) throw new UserError("cloudCopy.error.noCopy");
        // From here on nothing goes up until this copy is in, also if it can't go in at the next start. The state is parked
        // first: cut off before the status says chosen, the next start puts it back.
        if (turn === this.turn) {
          await this.parkForQuestion();
          const chosen = stepSwap(swap, { type: "chosen" });
          if (await this.writeStatusFor(turn, chosen)) {
            this.swap = chosen;
            await this.repairState(false, turn);
          }
        }
      } catch (error) {
        if (error instanceof KeyChanged) throw CopySync.userError(this.noteProblem(error));
        if (error instanceof UserError) throw error;
        // Nothing of it opens: only this PC's side can be the answer, and the question now says so.
        if (error instanceof NewestUnreadable) {
          this.unreadable = true;
          this.changed();
          throw new UserError("cloudCopy.error.unreadable");
        }
        throw CopySync.userError(this.noteProblem(error));
      }
    });
    // Turned off while it downloaded: no restart; the start drops what was staged, as the copy is off.
    if (!(await this.goesOnUnlessOffFailed(turn, failures))) return;
    this.restart();
  }

  /**
   * Writes a status for work started under `turn`, unless the copy was forgotten since: forgotten while it wrote, the
   * status is written again as forgetting leaves it (stepSwap's `forgotten`), so the next start doesn't finish a swap with
   * the copy off. A forget asked meanwhile is waited for: once it failed, the copy is still on and the answer goes on.
   * False when it was forgotten.
   */
  private async writeStatusFor(turn: number, status: SwapStatus): Promise<boolean> {
    if (!(await this.goesOn(turn))) return false;
    await writeSwapStatus(this.statusFile, status);
    if (await this.goesOn(turn)) return true;
    const forgotten = stepSwap(status, { type: "forgotten" });
    await writeSwapStatus(this.statusFile, forgotten);
    this.swap = forgotten;
    return false;
  }

  /**
   * Whether work started under `turn` goes on: the copy wasn't forgotten since. A forget under way is waited for first
   * (never from inside a write of the status, which it waits for in turn): one that failed leaves the copy on.
   */
  private async goesOn(turn: number): Promise<boolean> {
    while (this.forgetting.size > 0) await Promise.allSettled([...this.forgetting]);
    return turn === this.turn;
  }

  /**
   * `goesOn`, and for an answer that ends in a restart: a turn-off asked meanwhile that failed (`offFailures` moved since
   * `failures`) leaves the copy on, and the restart would only hide its message. So the answer stops here, standing on disk,
   * and says so; the next press restarts.
   */
  private async goesOnUnlessOffFailed(turn: number, failures: number): Promise<boolean> {
    if (!(await this.goesOn(turn))) return false;
    if (this.offFailures !== failures) throw new UserError("cloudCopy.error.offFailed");
    return true;
  }

  /** Why the copy can't be reached from here right now, for an answer that needs it. */
  private offError(): UserError {
    if (!this.accountKeys.signedIn) return CopySync.userError("signed-out");
    if (!this.accountKeys.copyIsOf(this.options.account.id())) return new UserError("cloudCopy.error.otherAccount");
    return CopySync.userError("failed");
  }

  /**
   * A stopped swap whose list of the incoming copy is gone or damaged can't go on at the next start, so Use the cloud copy
   * would only restart into the same stop. The copy comes down again now, and takes the place of what is staged; the swap
   * goes on with it at the next start. The plan learns what this copy fills that held nothing before, and the backup keeps
   * its list beside the first one, so going back empties those places too and the earlier copy's files in place count as
   * no one's work (sortWrittenSince). A copy without pictures has the pictures moved so far taken back (putIn). Written
   * in that order, the list last: cut off at any point, it is still missing, and answering again does it all again. Null
   * when the copy was turned off meanwhile; the swap as it is when the list is there.
   */
  private async restageForSwap(swap: Extract<SwapStatus, { phase: "swapping" }>): Promise<SwapStatus | null> {
    const list = await this.lookList();
    if (list.status === "present") return swap;
    if (list.status === "held" && !isDamaged(list)) throw CopySync.userError("failed");
    if (!this.on) throw this.offError();
    const { plan } = swap;
    const roots = copyRoots(this.options.userData, plan.moduleFiles);
    const turn = this.turn;
    const incoming = path.join(this.stagingDir, "incoming");
    return this.exclusive("downloading", async () => {
      let copy: Awaited<ReturnType<CloudCopy["download"]>>;
      try {
        copy = await this.cloud.download(this.key!, roots, incoming, 0, { sealed: this.state.sealed === true, marked: this.state.marked === true, listed: this.state.listed === true, chosen: true }, () => turn === this.turn);
      } catch (error) {
        await rm(incoming, { recursive: true, force: true });
        if (turn !== this.turn) return null;
        throw CopySync.userError(this.noteProblem(error));
      }
      if (turn !== this.turn) {
        await rm(incoming, { recursive: true, force: true });
        return null;
      }
      if (!copy) throw new UserError("cloudCopy.error.noCopy");
      const staged: Staged = { v: 1, ...copy };
      try {
        // What the copies before put in, told from what is staged of them before it goes: only there do their files count
        // as no one's work.
        const lists = await this.earlierLists(plan.keepIn);
        const putIn = new Set(plan.earlierIn ?? []);
        for (const list of lists) for (const name of await placesPutIn(this.stagedData, roots, plan.keepIn, list, plan.empty)) putIn.add(name);
        const next: SwapStatus = { phase: "swapping", plan: { ...plan, empty: await emptyPlacesSince(incoming, roots, plan.keepIn, copy, plan.empty), earlierIn: [...putIn] } };
        await mkdir(plan.keepIn, { recursive: true });
        await writeCopyFile(path.join(plan.keepIn, INCOMING_LISTS), "incoming", { lists: [...lists, staged] });
        // Turned off, or asked to be and not landed yet: the plan is not written then, and the status says undoing now. A
        // turn-off asked after this check goes through writeStatusFor below.
        if (!(await this.goesOn(turn))) return null;
        await writeFlushed(this.planFile, next.plan);
        if (!(await this.writeStatusFor(turn, next))) return null;
        await rm(this.stagedData, { recursive: true, force: true });
        await renameHeld(incoming, this.stagedData);
        await removeCopyFile(this.oldListFile, "list");
        await writeCopyFile(this.listFile, "list", staged);
        this.log(`cloud copy: the list of the copy going in was gone; version ${copy.version} came down again`);
        return next;
      } catch (error) {
        throw CopySync.userError(this.noteProblem(error));
      }
    });
  }

  /** Restarts Tavora without uploading first: the staged copy is taken at the start. */
  restart(): void {
    this.release();
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
   * `account` signed out (read before the sign-in was forgotten): the copy on the service and the key belong to the
   * account, so both are gone from this PC until signed in again. A copy in a folder stays on. A copy sealed with
   * another account's key (one that signed out by itself earlier) is that account's: it stays as it is, with its key.
   */
  async signedOut(account: string | null): Promise<void> {
    this.shownKey = null;
    if (!this.accountKeys.copyIsOf(account)) {
      await this.accountKeys.forget(account);
      this.changed();
      return;
    }
    // A copy in the user's own folder needs no account: it stays on, with its key (still the account's). The account's
    // vault as last read, with its publisher keys, goes.
    if (this.folder !== null && (this.copyOn || this.asked("askKey"))) {
      await this.accountKeys.forgetVault(account);
      this.changed();
      return;
    }
    // Signing out always forgets the key below, also when the copy can't be forgotten right now.
    if (this.copyOn || this.asked("askKey")) await this.forget(null).catch((error: unknown) => this.log(`cloud copy: not forgotten at sign-out: ${error instanceof Error ? error.message : String(error)}`));
    else {
      // Not on yet: a turn-on on its way (checking the key, looking for a copy) stops too, and forgets where it was going.
      this.turn++;
      this.use(null);
      this.copy = null;
      this.shownKey = null;
    }
    await this.accountKeys.forget(account);
    this.changed();
  }

  /**
   * Writes what this PC knows of the copy, unless it was forgotten since `turn`: forgotten while it wrote, the file goes
   * again, so the next start doesn't find the copy on. False when it was forgotten.
   */
  private async keepState(turn: number): Promise<boolean> {
    if (turn !== this.turn) return false;
    await saveCopyState(this.stateFile, this.state);
    if (turn === this.turn) return true;
    await removeCopyState(this.stateFile);
    return false;
  }

  /** Writes where the copy is, as `keepState` does. */
  private async keepPlace(turn: number, folder: string | null): Promise<boolean> {
    if (turn !== this.turn) return false;
    await savePlace(this.placeFile, folder);
    if (turn === this.turn) return true;
    await removeCopyFile(this.placeFile, "place");
    return false;
  }

  /** The status as forgetting leaves it, on disk, then `turn` raised: from then on, work started before writes nothing. */
  private async noteForgotten(): Promise<void> {
    try {
      await this.moveFrom(await this.swapForAnswer(), { type: "forgotten" });
    } catch (error) {
      this.log(`cloud copy: can't note what to do with the unfinished copy: ${error instanceof Error ? error.message : String(error)}`);
      throw CopySync.userError("failed");
    }
    this.turn++;
  }

  private async forget(problem: CloudCopyProblem | null): Promise<void> {
    // Written first. A swap stopped halfway is taken back at the next start; if that can't be noted, nothing is forgotten,
    // as the next start would finish the swap over this PC's data.
    const noted = this.noteForgotten();
    this.forgetting.add(noted);
    try {
      await noted;
    } catch (error) {
      this.offFailures++;
      throw error;
    } finally {
      this.forgetting.delete(noted);
    }
    this.copyOn = false;
    this.state = EMPTY_STATE;
    this.shownKey = null;
    this.unreadable = false;
    this.clear("askKey");
    this.clear("conflict");
    this.clear("restartToTake");
    this.problem = problem;
    await removeCopyState(this.stateFile);
    await removeCopyState(this.parkedFile);
    await removeCopyFile(this.placeFile, "place");
    // Files lost at a start that couldn't judge are no one's question with the copy off.
    await rm(this.lostNoteFile, { force: true });
    if (this.swap.phase !== "undoing") await rm(this.stagingDir, { recursive: true, force: true });
    this.use(null);
    this.changed();
  }

  // ── Close ──────────────────────────────────────────────────────────

  /**
   * Called when the window is about to close. True while the last upload runs: the close waits, and
   * `close` is called once it is done (or the user closes anyway).
   */
  holdClose(close: () => void): boolean {
    const phase = this.closing.phase;
    switch (phase) {
      case "released":
        return false;
      case "holding":
        // The copy stopped waiting to go up meanwhile (turned off, or a question came up): this close goes on, and the
        // upload ending later doesn't close the window a second time.
        if (!this.on || this.waiting) {
          this.release();
          return false;
        }
        return true;
      case "open":
        break;
      default:
        assertNever(phase);
    }
    if (!this.on || this.waiting) return false;
    const timer = setTimeout(() => {
      if (this.closing.phase !== "holding") return;
      this.closing = { ...this.closing, shown: true };
      this.changed();
    }, CLOSE_QUIET_MS);
    this.closing = { phase: "holding", shown: false, timer };
    void this.sync()
      .catch(() => undefined)
      .finally(() => this.closeAnyway(close));
    return true;
  }

  closeAnyway(close: () => void): void {
    if (this.closing.phase === "released") return;
    this.release();
    close();
  }

  /** The window may close from now on; a close held so far stops waiting (and its notice never shows). */
  private release(): void {
    if (this.closing.phase === "holding") clearTimeout(this.closing.timer);
    this.closing = { phase: "released" };
  }
}

/** A message for the user once the window shows, by its key in the locales. */
export interface StartNotice {
  key: "cloudCopy.notice.keptAside" | "cloudCopy.notice.dataKeptAside" | "cloudCopy.notice.bothKeptAside";
  params: Record<string, string>;
}

/**
 * Where a start put what the user may look for: what they changed while a swap waited (`changes`), and this PC's data from
 * before a swap an older Tavora settled (`data`). Both can come from one start: then one message names both.
 */
export function startNotice(changes: string | null, data: string | null): StartNotice | null {
  if (changes && data && changes !== data) return { key: "cloudCopy.notice.bothKeptAside", params: { changes, data } };
  if (changes) return { key: "cloudCopy.notice.keptAside", params: { folder: changes } };
  if (data) return { key: "cloudCopy.notice.dataKeptAside", params: { folder: data } };
  return null;
}

/** The activity as Settings reads it. */
function activityView(activity: CloudCopyActivity): Pick<CloudCopyView, "busy" | "progress"> {
  switch (activity.phase) {
    case "idle":
      return { busy: null, progress: null };
    case "checking":
    case "downloading":
      return { busy: activity.phase, progress: null };
    case "uploading":
      return { busy: activity.phase, progress: activity.progress };
    default:
      return assertNever(activity);
  }
}

/** The names in a note's list. */
function namesIn(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}

/**
 * Whether the state is parked while the swap has this status: during a swap, while the user is asked about lost data, and
 * while a copy they chose waits for the restart (an older Tavora would upload what is here over it).
 */
function parksState(status: SwapStatus): boolean {
  return status.phase === "swapping" || status.phase === "undoing" || status.phase === "chosen" || (status.phase === "asking" && status.why === "lost");
}

/** A staged copy's list as saved; null for one that makes no sense (damaged), or a newer Tavora's. */
function parseList(saved: SavedRecord): Staged | null {
  const { v, version, files } = saved;
  return v === 1 && typeof version === "number" && typeof files === "object" && files !== null ? (saved as unknown as Staged) : null;
}

/** A staged copy's list (copy-list.json, or staged.json where an older Tavora kept it): held when busy or damaged. */
export function lookStagedList(file: string): Promise<Looked<Staged>> {
  return lookCopyFile(file, "list", parseList);
}

/** The lists of every copy a swap has put in so far, kept in its backup (INCOMING_LISTS); none when they can't be read. */
export async function readIncomingLists(keepIn: string): Promise<Staged[]> {
  const looked = await lookCopyFile(path.join(keepIn, INCOMING_LISTS), "incoming", (saved) => (Array.isArray(saved.lists) ? (saved.lists as unknown[]) : null));
  const lists = looked.status === "present" ? looked.value : [];
  return lists.filter((item): item is Staged => typeof item === "object" && item !== null && typeof (item as Staged).version === "number" && typeof (item as Staged).files === "object" && (item as Staged).files !== null);
}

/** In one of this PC's backups: pruning leaves it whole (it holds this PC's data from before a swap an older Tavora settled). */
const KEEP_WHOLE = "keep-whole";

/**
 * In a swap's backup: the lists of the copies it put in, the first one and any that came down again in place of a lost
 * list. Not a name of anything the copy holds.
 */
const INCOMING_LISTS = "incoming-lists.json";

/** The longest folder path a library keeps (library.ts). */
const MAX_FOLDER_PATH = 500;

/** How far apart a swap's plan and the backup it names are written, at most (the plan follows right after). */
const PLAN_AFTER_BACKUP_MS = 60_000;

/** When one of this PC's backups of a swap was made (backupFolder), from its name; null for any other folder. */
function backupTime(name: string): number | null {
  const parts = /^cloud-copy-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-this-pc$/.exec(name);
  if (!parts) return null;
  const time = Date.parse(`${parts[1]}T${parts[2]}:${parts[3]}:${parts[4]}.${parts[5]}Z`);
  return Number.isNaN(time) ? null : time;
}

/** A library file: null when it isn't there or isn't a library. One that is busy stops the work. */
async function libraryIfReadable(file: string): Promise<Record<string, unknown> | null> {
  const looked = await lookJson(file);
  return isDamaged(looked) ? null : unlessHeld(looked);
}

/** Only this PC's own settings of a library, for the swap's plan. */
function pcSettingsOf(library: Record<string, unknown> | null): Record<string, unknown> | null {
  return library && Object.fromEntries(PC_SETTINGS.filter((name) => name in library).map((name) => [name, library[name]]));
}

/**
 * Puts this PC's own settings (its module files folder, development folders, …) back into the library a
 * copy brought. The synced state keeps the copy's hash, so this alone is not a change to upload. A swap finished
 * after being cut off may find them back already; the state still gets the file's size and date.
 */
async function keepPcSettings(file: string, own: Record<string, unknown> | null, state: CopyState): Promise<void> {
  // A copy whose library isn't JSON has no settings to merge into: the host sets it aside when it reads it, and that
  // loss is recorded then (checkDataFiles). Busy stops here, as the merge still has to happen.
  const taken = await libraryIfReadable(file);
  if (!taken) return;
  let changed = false;
  for (const name of PC_SETTINGS) {
    const value = own?.[name];
    if (JSON.stringify(taken[name]) === JSON.stringify(value)) continue;
    if (value === undefined) delete taken[name];
    else taken[name] = value;
    changed = true;
  }
  if (changed) await writeFileAtomic(file, JSON.stringify(taken, null, 2));
  const synced = state.files[LIBRARY_FILE];
  // Changed since it arrived (a swap finished late): it stays a change to send.
  if (!synced || synced.mtimeMs < 0) return;
  const info = unlessHeld(await lookStat(file));
  if (info) state.files[LIBRARY_FILE] = { ...synced, size: info.size, mtimeMs: info.mtimeMs };
}

/** The copy was sealed with a key that doesn't open the account's vault: another PC started over, or the service changed it. */
class KeyChanged extends Error {}

/**
 * Where the copy is kept: a folder, null for the service (no file), or undefined when that can't be told: the file
 * can't be read right now, or it is damaged (copied aside, left where it is, and the user told; copy-files.ts). A newer
 * Tavora's file is read too, so a folder is never mistaken for the service.
 */
export async function loadPlace(file: string): Promise<string | null | undefined> {
  const looked = await lookCopyFile(file, "place", (saved) => (typeof saved.v === "number" && saved.v >= 1 && typeof saved.folder === "string" && path.isAbsolute(saved.folder) ? saved.folder : null));
  if (looked.status === "missing") return null;
  return looked.status === "present" ? looked.value : undefined;
}

async function savePlace(file: string, folder: string | null): Promise<void> {
  if (folder === null) await removeCopyFile(file, "place");
  else await writeCopyFile(file, "place", { folder });
}
