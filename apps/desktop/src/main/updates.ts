import type { UpdateState } from "../shared/host-api";

/** The part of electron-updater's `autoUpdater` this module uses, so tests can stand in for it. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: "update-available" | "update-downloaded", listener: (info: { version: string }) => void): unknown;
  on(event: "update-not-available" | "checking-for-update", listener: () => void): unknown;
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

export const FIRST_CHECK_MS = 60 * 1000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface UpdateManagerOptions {
  updater: UpdaterLike;
  /** Whether new versions download by themselves (a Settings switch). */
  autoDownload: boolean;
  onChange: (state: UpdateState) => void;
  log?: (line: string) => void;
  timers?: Timers;
  firstCheckMs?: number;
  everyMs?: number;
}

/**
 * Looks for a new Tavora version shortly after start and every few hours,
 * downloads it in the background and installs it when Tavora quits or the
 * player presses "Restart now" - never in the middle of a session. Errors
 * (offline, server down) are logged and ignored; the next check tries again.
 */
export class UpdateManager {
  private current: UpdateState = { status: "idle" };
  private readonly updater: UpdaterLike;
  private readonly onChange: (state: UpdateState) => void;
  private readonly log: (line: string) => void;
  private readonly timers: Timers;
  private readonly firstCheckMs: number;
  private readonly everyMs: number;
  private first: unknown;
  private every: unknown;

  constructor(options: UpdateManagerOptions) {
    this.updater = options.updater;
    this.onChange = options.onChange;
    this.log = options.log ?? (() => {});
    this.timers = options.timers ?? {
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (run, ms) => setInterval(run, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    };
    this.firstCheckMs = options.firstCheckMs ?? FIRST_CHECK_MS;
    this.everyMs = options.everyMs ?? CHECK_EVERY_MS;

    this.updater.autoDownload = options.autoDownload;
    // A downloaded update installs by itself when Tavora is closed.
    this.updater.autoInstallOnAppQuit = true;
    this.updater.on("update-available", (info) => {
      this.log(`update ${info.version} available`);
      this.set(this.updater.autoDownload ? { status: "downloading", version: info.version } : { status: "available", version: info.version });
    });
    this.updater.on("update-downloaded", (info) => {
      this.log(`update ${info.version} downloaded`);
      this.set({ status: "ready", version: info.version });
    });
    this.updater.on("update-not-available", () => this.log("up to date"));
    this.updater.on("error", (error) => {
      this.log(`update error: ${error.message}`);
      // A failed download goes back to "found it"; the next check starts it again.
      if (this.current.status === "downloading") this.set({ status: "idle" });
    });
  }

  get state(): UpdateState {
    return this.current;
  }

  /** Starts the schedule: one check shortly after start, then one every few hours. */
  start(): void {
    this.first = this.timers.setTimeout(() => void this.check(), this.firstCheckMs);
    this.every = this.timers.setInterval(() => void this.check(), this.everyMs);
  }

  stop(): void {
    if (this.first !== undefined) this.timers.clearTimeout(this.first);
    if (this.every !== undefined) this.timers.clearInterval(this.every);
    this.first = this.every = undefined;
  }

  /** Asks the server whether there is a newer version. Does nothing while one is already on its way. */
  async check(): Promise<void> {
    if (this.current.status !== "idle" && this.current.status !== "available") return;
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.log(`update check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The Settings switch: whether found versions download by themselves. Turning it on starts a waiting one. */
  setAutoDownload(enabled: boolean): void {
    this.updater.autoDownload = enabled;
    if (enabled && this.current.status === "available") void this.download();
  }

  /** Starts the download of a version that was found while automatic download was off. */
  async download(): Promise<void> {
    if (this.current.status !== "available") return;
    this.set({ status: "downloading", version: this.current.version });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.log(`update download failed: ${error instanceof Error ? error.message : String(error)}`);
      this.set({ status: "idle" });
    }
  }

  /** Quits, installs the downloaded version and starts Tavora again. */
  restartNow(): void {
    if (this.current.status !== "ready") return;
    this.updater.quitAndInstall(true, true);
  }

  private set(state: UpdateState): void {
    this.current = state;
    this.onChange(state);
  }
}
