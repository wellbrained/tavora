import type { UpdateState } from "../shared/host-api";
import { describeFreshness, unconfirmed, type FeedInfo } from "./update-freshness";
import type { DownloadedUpdate, FeedFreshness, UpdateCheck } from "./update-signature";

/** What electron-updater tells about a version it found, didn't find (the feed's own version) or downloaded. */
export interface UpdateInfoLike extends FeedInfo {
  version: string;
  /** The notes the release put into the feed: one string (one change per line), or one per version, or none. */
  releaseNotes?: string | { version: string; note: string | null }[] | null;
}

/** What electron-updater says it downloaded: the parsed latest.yml (the Tavora signature too) and where it saved the installer. */
export type DownloadedInfoLike = UpdateInfoLike & DownloadedUpdate;

/** The part of electron-updater's `autoUpdater` this module uses, so tests can stand in for it. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  /** On: a feed can't make the updater fetch a second, unsigned package (a web installer). */
  disableWebInstaller?: boolean;
  /** Sent with every request to the update feed. */
  requestHeaders?: Record<string, string> | null;
  on(event: "update-available", listener: (info: UpdateInfoLike) => void): unknown;
  on(event: "update-downloaded", listener: (info: DownloadedInfoLike) => void): unknown;
  /** electron-updater sends the parsed feed along; the preview's end sends nothing. */
  on(event: "update-not-available", listener: (info?: UpdateInfoLike) => void): unknown;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  /** Starts the downloaded installer without quitting: what electron-updater's own quit handler does. */
  install(isSilent?: boolean, isForceRunAfter?: boolean): boolean;
}

export interface Timers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(run: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/**
 * Tells the feed's web server a request is the updater's, not a user downloading the installer, so
 * installer downloads and updates are counted apart. It carries no value about the user.
 */
export const UPDATER_HEADER = "X-Tavora-Update";

/** Right at start, so a new version shows in the rail before the user gets going. */
export const FIRST_CHECK_MS = 0;
/** The feed is one small file, so asking often costs next to nothing. */
export const CHECK_EVERY_MS = 5 * 60 * 1000;
/** A failed download of the same version starts over by itself at most this often, so a broken file isn't fetched every few minutes. */
export const RETRY_EVERY_MS = 60 * 60 * 1000;
/** A line the log already has is written again after this long, so the log still shows that checks run. */
export const LOG_REPEAT_MS = 60 * 60 * 1000;
/** The progress goes to the window at most this often: each change sends the whole state. */
export const PROGRESS_EVERY_MS = 250;
/** The most notes a found version carries; the release's own list is short anyway. */
const MAX_NOTES = 12;

/**
 * The notes of a found version as one line per change. The release writes them as a Markdown list
 * (scripts/release-notes.mjs); a feed with HTML or per-version notes still gives plain lines.
 */
export function readReleaseNotes(notes: UpdateInfoLike["releaseNotes"]): string[] {
  if (!notes) return [];
  const text = typeof notes === "string" ? notes : notes.map((entry) => entry.note ?? "").join("\n");
  return text
    .replace(/<\/(li|p|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, MAX_NOTES);
}

export interface UpdateManagerOptions {
  updater: UpdaterLike;
  /**
   * Whether a downloaded version may be installed: Tavora's signature over its version, file name and SHA-512
   * (update-signature.ts). Only a version that passes becomes ready; nothing else is ever installed.
   */
  verify: (info: DownloadedInfoLike) => Promise<UpdateCheck>;
  /**
   * The feed's second signature (update-freshness.ts), checked on every answer from the feed: whether a pinned key
   * vouched for it lately, for this channel and platform. Without it (dev builds) nothing is checked.
   */
  checkFeed?: (info: UpdateInfoLike) => FeedFreshness;
  /**
   * Off: the feed check is only logged. On (ENFORCE_FEED_FRESHNESS): a feed that can't be confirmed (or expired) makes a check
   * end as idle with failed "unconfirmed", and a downloaded version whose feed is refused (not merely expired) is not
   * installed.
   */
  enforceFeed?: boolean;
  /**
   * Hashes the checked installer again right before it runs (Restart now, or on quit), SHA-512 in base64; throws when it
   * can't be read. A file that changed since its check is refused instead of run (audit L6). Without it (dev builds,
   * whose preview check names no installer) nothing is hashed again.
   */
  rehash?: (file: string) => string;
  /** A downloaded version was refused (the host deletes the file). */
  onRefused?: (info: DownloadedInfoLike) => void;
  /** Whether new versions download by themselves (a Settings switch). */
  autoDownload: boolean;
  onChange: (state: UpdateState) => void;
  /** A new version finished downloading (the host counts it, once, and only with Online features on). */
  onDownloaded?: (version: string) => void;
  log?: (line: string) => void;
  timers?: Timers;
  firstCheckMs?: number;
  everyMs?: number;
  now?: () => Date;
}

/** Less than `ms` has passed; a clock set back (a negative gap) counts as time passed. */
function within(elapsed: number, ms: number): boolean {
  return elapsed >= 0 && elapsed < ms;
}

/**
 * Looks for a new Tavora version right at start and every 5 minutes, downloads it (by itself or when
 * the user asks) and installs it when Tavora quits or the user presses "Restart now" - never in the
 * middle of a session. Errors (offline, server down) are logged; the next check tries again.
 *
 * A downloaded version is installed only once its Tavora signature checked out (`verify`). Until then it shows as
 * downloading; one that fails is refused and waits like a failed download, so Tavora goes on with the version it has
 * and keeps checking. electron-updater never installs by itself (its autoInstallOnAppQuit stays off): Restart now and
 * quitting (installOnQuit) install only a version that is ready, and ready means checked.
 */
export class UpdateManager {
  private current: UpdateState = { status: "idle", checkedAt: null, failed: false };
  private readonly updater: UpdaterLike;
  private readonly verify: (info: DownloadedInfoLike) => Promise<UpdateCheck>;
  private readonly checkFeed: ((info: UpdateInfoLike) => FeedFreshness) | null;
  private readonly enforceFeed: boolean;
  private readonly onRefused: (info: DownloadedInfoLike) => void;
  private readonly rehash: ((file: string) => string) | null;
  /** The version that is ready, as downloaded, and the installer its check hashed (when the check named one). */
  private readyUpdate: { info: DownloadedInfoLike; installer: { file: string; sha512: string } | null } | null = null;
  private readonly onChange: (state: UpdateState) => void;
  private readonly onDownloaded: (version: string) => void;
  private readonly log: (line: string) => void;
  private readonly timers: Timers;
  private readonly firstCheckMs: number;
  private readonly everyMs: number;
  private readonly now: () => Date;
  private first: unknown;
  private every: unknown;
  private progressSentAt = 0;
  /** Whether found versions download by themselves. The updater's own switch stays off: this class starts every download. */
  private autoDownload: boolean;
  /** When a download of the waiting version last failed; it doesn't start over by itself for a while after. */
  private failedAt = 0;
  /** How many "error" events came; a call whose rejection came with one needs no second line. */
  private errorEvents = 0;
  /** Goes up with every downloaded version: a signature check that a newer one overtook changes nothing. */
  private checkTurn = 0;
  /** The installer was started (Restart now, or on quit); it starts once. */
  private installStarted = false;

  constructor(options: UpdateManagerOptions) {
    this.updater = options.updater;
    this.verify = options.verify;
    this.checkFeed = options.checkFeed ?? null;
    this.enforceFeed = options.enforceFeed ?? false;
    this.onRefused = options.onRefused ?? (() => {});
    this.rehash = options.rehash ?? null;
    this.onChange = options.onChange;
    this.onDownloaded = options.onDownloaded ?? (() => {});
    // A check every few minutes says the same thing again and again; the log keeps a line when it changes,
    // and repeats one once an hour so it still shows the checks run.
    const write = options.log ?? (() => {});
    let last = "";
    let lastAt = 0;
    this.log = (line) => {
      const at = this.now().getTime();
      if (line === last && within(at - lastAt, LOG_REPEAT_MS)) return;
      last = line;
      lastAt = at;
      write(line);
    };
    this.timers = options.timers ?? {
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (run, ms) => setInterval(run, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    };
    this.firstCheckMs = options.firstCheckMs ?? FIRST_CHECK_MS;
    this.everyMs = options.everyMs ?? CHECK_EVERY_MS;
    this.now = options.now ?? (() => new Date());

    // electron-updater would download inside the check, so a check could not run without starting a
    // failed download over. The manager starts downloads itself, so only the retry has to wait.
    this.autoDownload = options.autoDownload;
    this.updater.autoDownload = false;
    // A downloaded update still installs when Tavora is closed, but through installOnQuit, which installs only a
    // checked version; electron-updater's own quit handler would install whatever it downloaded.
    this.updater.autoInstallOnAppQuit = false;
    // Tavora ships one full installer; a web installer's package would not be covered by the signature.
    this.updater.disableWebInstaller = true;
    this.updater.requestHeaders = { ...this.updater.requestHeaders, [UPDATER_HEADER]: "1" };
    this.updater.on("update-available", (info) => {
      // A check that answers while the user's download runs (or is done) changes nothing.
      if (this.current.status === "downloading" || this.current.status === "ready") return;
      // Report only here: a downloaded version's feed is checked again, for the file it saved, before it installs.
      this.log(`update ${info.version} available${this.feedNote(this.feed(info))}`);
      const notes = readReleaseNotes(info.releaseNotes);
      // A failed download stays marked as failed until the user tries again, unless a newer version came out.
      const u = this.current;
      const failed = u.status === "available" && u.version === info.version && u.failed;
      // By itself, a failed download starts over at most once an hour; a newer version downloads right away.
      if (this.autoDownload && !(failed && within(this.now().getTime() - this.failedAt, RETRY_EVERY_MS))) {
        return void this.startDownload(info.version, notes);
      }
      this.set({ status: "available", version: info.version, notes, failed });
    });
    this.updater.on("download-progress", (progress) => {
      const u = this.current;
      if (u.status !== "downloading") return;
      const percent = Math.min(100, Math.max(0, Math.floor(progress.percent)));
      const at = this.now().getTime();
      if (percent <= u.percent || at - this.progressSentAt < PROGRESS_EVERY_MS) return;
      this.progressSentAt = at;
      this.set({ ...u, percent });
    });
    this.updater.on("update-downloaded", (info) => void this.downloaded(info));
    this.updater.on("update-not-available", (info) => {
      // The one answer a server holding updates back would give: the feed's second signature says whether it is fresh.
      const feed = info ? this.feed(info) : null;
      this.log(`up to date${this.feedNote(feed)}`);
      this.set(this.idle(this.enforceFeed && feed && unconfirmed(feed) ? "unconfirmed" : false));
    });
    this.updater.on("error", (error) => {
      this.log(`update error: ${error.message}`);
      this.errorEvents += 1;
      // A failed check goes back to idle. A download is never marked failed here: the error may come
      // from a check that ran during the download; the download's own call says when it failed.
      if (this.current.status === "checking") this.set(this.idle("check"));
    });
  }

  get state(): UpdateState {
    return this.current;
  }

  /** Starts the schedule: one check right at start, then one every 5 minutes. */
  start(): void {
    this.first = this.timers.setTimeout(() => void this.check(), this.firstCheckMs);
    this.every = this.timers.setInterval(() => void this.check(), this.everyMs);
  }

  stop(): void {
    if (this.first !== undefined) this.timers.clearTimeout(this.first);
    if (this.every !== undefined) this.timers.clearInterval(this.every);
    this.first = this.every = undefined;
  }

  /**
   * Asks the server whether there is a newer version. Does nothing while one is downloading or ready.
   * A version that waits (or whose download failed) is asked about again: a newer one may be out, and
   * with automatic download on, a failed download starts over once RETRY_EVERY_MS has passed.
   */
  async check(): Promise<void> {
    const u = this.current;
    const waiting = u.status === "available";
    if (u.status !== "idle" && !waiting) return;
    if (!waiting) this.set({ status: "checking" });
    const errorEvents = this.errorEvents;
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.logFailure("check", error, errorEvents);
      if (this.is("checking")) this.set(this.idle("check"));
    }
    // An answer without any event (nothing to compare) still ends the check.
    if (this.is("checking")) this.set(this.idle(false));
  }

  /** The Settings switch: whether found versions download by themselves. Turning it on starts a waiting one. */
  setAutoDownload(enabled: boolean): void {
    this.autoDownload = enabled;
    if (enabled && this.current.status === "available") void this.download();
  }

  /** Starts the download of a found version: one found while automatic download was off, or one whose download failed. */
  async download(): Promise<void> {
    const u = this.current;
    if (u.status !== "available") return;
    await this.startDownload(u.version, u.notes);
  }

  /** Every download starts here, the user's and the automatic ones; a failure keeps the version to try again. */
  private async startDownload(version: string, notes: string[]): Promise<void> {
    this.set(this.downloading(version, notes));
    const errorEvents = this.errorEvents;
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.logFailure("download", error, errorEvents);
      const u = this.current;
      if (u.status === "downloading" && u.version === version) this.set(this.downloadFailed(u));
    }
  }

  /** Quits, installs the downloaded version and starts Tavora again. */
  restartNow(): void {
    if (this.current.status !== "ready" || !this.installerUnchanged()) return;
    this.installStarted = true;
    this.updater.quitAndInstall(true, true);
  }

  /**
   * Whether the ready version's installer is still the file its signature check hashed (audit L6): between the check and
   * the install it sits in the user's cache folder. A changed or unreadable one is refused like a bad signature: the file
   * goes, and the version waits as refused. No installer to compare (no rehash, or a check that named none) passes.
   * While Tavora quits nobody is told: the window and what listens to the state are gone.
   */
  private installerUnchanged({ quitting = false } = {}): boolean {
    const ready = this.readyUpdate;
    if (!this.rehash || !ready?.installer) return true;
    let reason: string;
    try {
      if (this.rehash(ready.installer.file) === ready.installer.sha512) return true;
      reason = "the installer changed after its check";
    } catch (error) {
      reason = `the installer can't be read (${error instanceof Error ? error.message : String(error)})`;
    }
    const { info } = ready;
    this.log(`update ${info.version} refused before it ran: ${reason}`);
    this.readyUpdate = null;
    this.onRefused(info);
    this.failedAt = this.now().getTime();
    const notes = this.current.status === "ready" ? this.current.notes : [];
    const refused: UpdateState = { status: "available", version: info.version, notes, failed: "refused" };
    if (quitting) this.current = refused;
    else this.set(refused);
    return false;
  }

  /**
   * Tavora is quitting (app "quit", with its exit code): a ready version installs now, silently and without starting
   * Tavora again, as electron-updater's own quit handler would. Only a clean quit installs.
   */
  installOnQuit(exitCode: number): void {
    // After Restart now the installer already runs (electron-updater would ignore a second start anyway).
    if (this.current.status !== "ready" || exitCode !== 0 || this.installStarted || !this.installerUnchanged({ quitting: true })) return;
    this.installStarted = true;
    this.log(`installing ${this.current.version} on quit`);
    this.updater.install(true, false);
  }

  /** A version finished downloading: it stays "downloading" (at 100%) while its signature is checked, then is ready or refused. */
  private async downloaded(info: DownloadedInfoLike): Promise<void> {
    const turn = ++this.checkTurn;
    this.log(`update ${info.version} downloaded`);
    const found = readReleaseNotes(info.releaseNotes);
    const notes = found.length ? found : this.notes();
    this.set({ status: "downloading", version: info.version, notes, percent: 100 });
    let check: UpdateCheck;
    try {
      check = await this.verify(info);
    } catch (error) {
      check = { ok: false, reason: `the check failed (${error instanceof Error ? error.message : String(error)})` };
    }
    if (turn !== this.checkTurn) return;
    // The feed's second signature for the file it saved: logged; once enforced, a refused one (not an expired one: a
    // newer signed version always installs) is refused like a bad signature.
    if (check.ok && check.feed && this.enforceFeed && check.feed.status === "refused") {
      check = { ok: false, reason: describeFreshness(check.feed) };
    }
    if (!check.ok) {
      this.log(`update ${info.version} refused: ${check.reason}`);
      this.onRefused(info);
      this.failedAt = this.now().getTime();
      this.set({ status: "available", version: info.version, notes, failed: "refused" });
      return;
    }
    this.log(`update ${info.version} signature checked (${check.key} key)${this.feedNote(check.feed ?? null)}`);
    this.readyUpdate = { info, installer: check.installer ?? null };
    this.set({ status: "ready", version: info.version, notes });
    this.onDownloaded(info.version);
  }

  /** Checks the feed's second signature, if this manager does; a check that throws counts as refused. */
  private feed(info: UpdateInfoLike): FeedFreshness | null {
    if (!this.checkFeed) return null;
    try {
      return this.checkFeed(info);
    } catch (error) {
      return { status: "refused", reason: `the feed check failed (${error instanceof Error ? error.message : String(error)})` };
    }
  }

  /** The feed check's outcome as the end of a log line: one line per answer, so the log's repeat filter still works. */
  private feedNote(feed: FeedFreshness | null): string {
    return feed ? `; ${describeFreshness(feed)}` : "";
  }

  /** Logs a call that failed, unless an "error" event since `errorEvents` already wrote the line. */
  private logFailure(call: "check" | "download", error: unknown, errorEvents: number): void {
    if (this.errorEvents !== errorEvents) return;
    this.log(`update ${call} failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  /** Re-reads the state, which events may have changed while a call was awaited. */
  private is(status: UpdateState["status"]): boolean {
    return this.current.status === status;
  }

  /** The notes of the version on its way, kept when a later event comes without them. */
  private notes(): string[] {
    return "notes" in this.current ? this.current.notes : [];
  }

  private downloading(version: string, notes: string[]): UpdateState {
    this.progressSentAt = 0;
    return { status: "downloading", version, notes, percent: 0 };
  }

  private downloadFailed(u: { version: string; notes: string[] }): UpdateState {
    this.failedAt = this.now().getTime();
    return { status: "available", version: u.version, notes: u.notes, failed: "download" };
  }

  private idle(failed: false | "check" | "unconfirmed"): UpdateState {
    return { status: "idle", checkedAt: this.now().toISOString(), failed };
  }

  private set(state: UpdateState): void {
    this.current = state;
    this.onChange(state);
  }
}

/**
 * Dev builds only: the signature check of the preview's made-up version, which has no file. It passes, or with
 * TAVORA_FAKE_UPDATE_UNSIGNED=1 is refused, so the refused step can be seen.
 */
export function previewCheck(refuse: boolean): () => Promise<UpdateCheck> {
  return async () => (refuse ? { ok: false, reason: "preview: refused on purpose" } : { ok: true, key: "release" });
}

/** Notes the preview's made-up version shows. */
const PREVIEW_NOTES = ["This is a preview of an update.", "Nothing is downloaded or installed.", "Restart now just ends the preview."];

/**
 * Dev builds only: stands in for electron-updater, so the update marker and Settings can be tried in
 * `pnpm dev` (which never looks for real updates). A check always finds the next patch version, a
 * download takes a few seconds, and "Restart now" ends the preview without restarting.
 * TAVORA_FAKE_UPDATE_FAIL=1 makes every download fail halfway.
 */
export class PreviewUpdater implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  requestHeaders: Record<string, string> | null = null;
  private readonly listeners = new Map<string, ((value?: unknown) => void)[]>();
  private readonly version: string;
  private readonly fail: boolean;
  private readonly stepMs: number;

  constructor(currentVersion: string, options: { fail?: boolean; stepMs?: number } = {}) {
    const [major = 0, minor = 0, patch = 0] = currentVersion.split(".").map(Number);
    this.version = `${major}.${minor}.${patch + 1}`;
    this.fail = options.fail ?? false;
    this.stepMs = options.stepMs ?? 150;
  }

  // One list of listeners for every event UpdaterLike knows; each event sends its own kind of value.
  on(event: string, listener: (value: any) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener as (value?: unknown) => void]);
    return this;
  }

  async checkForUpdates(): Promise<void> {
    await this.wait(600);
    this.emit("update-available", this.info());
  }

  async downloadUpdate(): Promise<void> {
    for (let percent = 2; percent <= 100; percent += 2) {
      await this.wait(this.stepMs);
      if (this.fail && percent > 50) {
        const error = new Error("preview: the download failed on purpose");
        this.emit("error", error);
        throw error;
      }
      this.emit("download-progress", { percent });
    }
    this.emit("update-downloaded", this.info());
  }

  quitAndInstall(): void {
    this.emit("update-not-available");
  }

  /** Quitting the preview installs nothing. */
  install(): boolean {
    return false;
  }

  private info(): UpdateInfoLike {
    return { version: this.version, releaseNotes: PREVIEW_NOTES.map((note) => `- ${note}`).join("\n") };
  }

  private emit(event: string, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
