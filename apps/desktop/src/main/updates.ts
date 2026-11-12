import type { UpdateState } from "../shared/host-api";

/** What electron-updater tells about a version it found or downloaded. */
export interface UpdateInfoLike {
  version: string;
  /** The notes the release put into the feed: one string (one change per line), or one per version, or none. */
  releaseNotes?: string | { version: string; note: string | null }[] | null;
}

/** The part of electron-updater's `autoUpdater` this module uses, so tests can stand in for it. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  /** Sent with every request to the update feed. */
  requestHeaders?: Record<string, string> | null;
  on(event: "update-available" | "update-downloaded", listener: (info: UpdateInfoLike) => void): unknown;
  on(event: "update-not-available" | "checking-for-update", listener: () => void): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
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
/** A download that failed by itself starts over at most this often, so a broken file isn't fetched every few minutes. */
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

/**
 * Looks for a new Tavora version right at start and every 5 minutes, downloads it (by itself or when
 * the user asks) and installs it when Tavora quits or the user presses "Restart now" - never in the
 * middle of a session. Errors (offline, server down) are logged; the next check tries again.
 */
/** Less than `ms` has passed; a clock set back (a negative gap) counts as time passed. */
function within(elapsed: number, ms: number): boolean {
  return elapsed >= 0 && elapsed < ms;
}

export class UpdateManager {
  private current: UpdateState = { status: "idle", checkedAt: null, failed: false };
  private readonly updater: UpdaterLike;
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
  /** When a download of the waiting version last failed; checks leave it alone for a while after. */
  private failedAt = 0;
  /** The updater sent an "error" during the running call, so its rejection needs no second line. */
  private errorLogged = false;

  constructor(options: UpdateManagerOptions) {
    this.updater = options.updater;
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

    this.updater.autoDownload = options.autoDownload;
    // A downloaded update installs by itself when Tavora is closed.
    this.updater.autoInstallOnAppQuit = true;
    this.updater.requestHeaders = { ...this.updater.requestHeaders, [UPDATER_HEADER]: "1" };
    this.updater.on("update-available", (info) => {
      // A check that answers while the user's download runs (or is done) changes nothing.
      if (this.current.status === "downloading" || this.current.status === "ready") return;
      this.log(`update ${info.version} available`);
      const notes = readReleaseNotes(info.releaseNotes);
      if (this.updater.autoDownload) return this.set(this.downloading(info.version, notes));
      // A failed download stays marked as failed until the user tries again, unless a newer version came out.
      const u = this.current;
      const failed = u.status === "available" && u.version === info.version && u.failed;
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
    this.updater.on("update-downloaded", (info) => {
      this.log(`update ${info.version} downloaded`);
      const notes = readReleaseNotes(info.releaseNotes);
      this.set({ status: "ready", version: info.version, notes: notes.length ? notes : this.notes() });
      this.onDownloaded(info.version);
    });
    this.updater.on("update-not-available", () => {
      this.log("up to date");
      this.set(this.idle(false));
    });
    this.updater.on("error", (error) => {
      this.log(`update error: ${error.message}`);
      this.errorLogged = true;
      // A failed check goes back to idle; a failed download keeps the version so it can be tried again.
      if (this.current.status === "checking") this.set(this.idle(true));
      else if (this.current.status === "downloading") this.set(this.downloadFailed(this.current));
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
   * with automatic download on, the download starts over. After a failed download that waits an hour
   * (RETRY_EVERY_MS), since the check itself would download again; a newer version is then found late.
   */
  async check(): Promise<void> {
    const u = this.current;
    const waiting = u.status === "available";
    if (u.status !== "idle" && !waiting) return;
    // With automatic download on, a check starts the download over: after a failure, wait a while first.
    if (waiting && u.failed && this.updater.autoDownload && within(this.now().getTime() - this.failedAt, RETRY_EVERY_MS)) return;
    if (!waiting) this.set({ status: "checking" });
    this.errorLogged = false;
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      if (!this.errorLogged) this.log(`update check failed: ${error instanceof Error ? error.message : String(error)}`);
      if (this.is("checking")) this.set(this.idle(true));
    }
    // An answer without any event (nothing to compare) still ends the check.
    if (this.is("checking")) this.set(this.idle(false));
  }

  /** The Settings switch: whether found versions download by themselves. Turning it on starts a waiting one. */
  setAutoDownload(enabled: boolean): void {
    this.updater.autoDownload = enabled;
    if (enabled && this.current.status === "available") void this.download();
  }

  /** Starts the download of a found version: one found while automatic download was off, or one whose download failed. */
  async download(): Promise<void> {
    const u = this.current;
    if (u.status !== "available") return;
    this.set(this.downloading(u.version, u.notes));
    this.errorLogged = false;
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      if (!this.errorLogged) this.log(`update download failed: ${error instanceof Error ? error.message : String(error)}`);
      if (this.current.status === "downloading") this.set(this.downloadFailed(this.current));
    }
  }

  /** Quits, installs the downloaded version and starts Tavora again. */
  restartNow(): void {
    if (this.current.status !== "ready") return;
    this.updater.quitAndInstall(true, true);
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
    return { status: "available", version: u.version, notes: u.notes, failed: true };
  }

  private idle(failed: boolean): UpdateState {
    return { status: "idle", checkedAt: this.now().toISOString(), failed };
  }

  private set(state: UpdateState): void {
    this.current = state;
    this.onChange(state);
  }
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
  autoDownload = true;
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
    if (this.autoDownload) void this.downloadUpdate().catch(() => undefined);
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
