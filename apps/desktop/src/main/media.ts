/**
 * The media connector: what plays on this PC, as Windows' media controls (the volume flyout) show it, and play/pause,
 * next and previous, for modules the player granted it. One MediaConnector serves every panel. Windows is read by a
 * small helper program of Tavora's own (packages/media-helper, tavora-media.exe), which waits for Windows' change
 * events and tells them over stdio, so nothing polls and a crash of it never takes Tavora down. It runs only while a
 * panel watches, and ends a minute after the last one stops. Nothing leaves the PC; a module gets the texts, the
 * position and a small cover, never a path.
 */
import type { MediaAction, MediaSession, MediaState } from "@tavora/sdk/protocol";
import { appName, MAX_COVER_BASE64, parseHelperLine, type HelperMessage, type HelperSession } from "./media-parse";

/** A running helper, as the connector sees it (tests use a fake one). */
export interface MediaHelper {
  /** Called with each line the helper writes. */
  onLine(fn: (line: string) => void): void;
  /** Called once when the helper is gone, for whatever reason. */
  onExit(fn: () => void): void;
  write(line: string): void;
  kill(): void;
}

export interface MediaDeps {
  /** Starts the helper, or null when this PC or this build has none (not Windows, or built without it). */
  start(): MediaHelper | null;
  /** Turns a cover from the helper into a JPEG data URL of at most 300 px a side, or null when it isn't a picture. */
  cover(bytes: Buffer, mime: string): string | null;
  log(message: string, error?: unknown): void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
  now?: () => number;
}

/** One panel's hold on the connector. */
export interface MediaSubscription {
  /** What plays now. */
  state(): MediaState;
  /** Asks a session's app to play or pause, skip or go back; true when it took it. */
  control(session: string, action: MediaAction): Promise<boolean>;
  close(): void;
}

/** How long the helper keeps running after the last panel stopped watching. */
export const IDLE_MS = 60_000;
/** How long the helper may take to say it's ready. */
export const START_TIMEOUT_MS = 10_000;
/** How long an app may take to answer a control. */
export const CONTROL_TIMEOUT_MS = 5_000;
/** Restarts after a crash within RESTART_WINDOW_MS; one more crash, and the connector gives up until a panel watches again. */
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 5 * 60_000;
/** Covers kept, for every session together. */
const MAX_COVERS = 16;

export class MediaConnector {
  private readonly listeners = new Set<(state: MediaState) => void>();
  private helper: MediaHelper | null = null;
  private status: MediaState["state"] = "starting";
  private sessions: HelperSession[] = [];
  /** Covers by session id and song; the newest last. */
  private readonly covers = new Map<string, string>();
  private readonly pending = new Map<number, (ok: boolean) => void>();
  private nextReq = 1;
  private crashes: number[] = [];
  private idleTimer: unknown;
  private startTimer: unknown;
  private disposed = false;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly now: () => number;

  constructor(private readonly deps: MediaDeps) {
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.now = deps.now ?? Date.now;
  }

  /** Starts watching for one panel; `changed` hears every change until close. */
  subscribe(changed: (state: MediaState) => void): MediaSubscription {
    if (this.disposed) throw new Error("the media connector is closed");
    this.listeners.add(changed);
    this.clearTimer(this.idleTimer);
    this.idleTimer = undefined;
    // A connector that gave up tries again for a panel that starts watching.
    if (this.status === "failed") {
      this.crashes = [];
      this.status = "starting";
      this.emit();
    }
    if (!this.helper && this.status !== "unavailable") this.launch();
    let open = true;
    return {
      state: () => this.state(),
      control: (session, action) => (open ? this.control(session, action) : Promise.resolve(false)),
      close: () => {
        if (!open) return;
        open = false;
        this.listeners.delete(changed);
        if (this.listeners.size === 0 && this.helper) this.idleTimer = this.setTimer(() => this.stop(), IDLE_MS);
      },
    };
  }

  /** What plays now, as modules get it. */
  state(): MediaState {
    if (this.status !== "ready") return { state: this.status, sessions: [] };
    return { state: "ready", sessions: this.sessions.map((s) => this.toSession(s)) };
  }

  /** Whether the helper runs now (for tests and the performance check). */
  get running(): boolean {
    return this.helper !== null;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.stop();
  }

  private toSession(s: HelperSession): MediaSession {
    return {
      id: s.id,
      app: { id: s.app, name: appName(s.app) },
      current: s.current,
      title: s.title,
      artist: s.artist,
      album: s.album,
      status: s.status,
      positionMs: s.positionMs,
      positionAt: s.positionAt,
      durationMs: s.durationMs,
      cover: s.coverKey === null ? null : (this.covers.get(coverId(s.id, s.coverKey)) ?? null),
      can: { playPause: s.canPlayPause, next: s.canNext, previous: s.canPrevious },
    };
  }

  private emit(): void {
    const state = this.state();
    for (const listener of [...this.listeners]) {
      try {
        listener(state);
      } catch (error) {
        this.deps.log("a media listener failed", error);
      }
    }
  }

  private launch(): void {
    let helper: MediaHelper | null;
    try {
      helper = this.deps.start();
    } catch (error) {
      this.deps.log("the media helper did not start", error);
      helper = null;
      this.crashed();
      return;
    }
    if (!helper) {
      this.status = "unavailable";
      this.emit();
      return;
    }
    this.helper = helper;
    this.status = "starting";
    const mine = helper;
    this.startTimer = this.setTimer(() => {
      if (this.helper !== mine || this.status !== "starting") return;
      this.deps.log("the media helper did not get ready in time");
      mine.kill();
    }, START_TIMEOUT_MS);
    helper.onLine((line) => {
      if (this.helper === mine) this.receive(parseHelperLine(line));
    });
    helper.onExit(() => {
      if (this.helper !== mine) return;
      this.helper = null;
      this.clearTimer(this.startTimer);
      this.settlePending();
      if (this.listeners.size > 0 && !this.disposed) this.crashed();
      else this.reset();
    });
  }

  private receive(message: HelperMessage | null): void {
    if (!message) return;
    switch (message.type) {
      case "ready":
        this.clearTimer(this.startTimer);
        return;
      case "sessions":
        this.clearTimer(this.startTimer);
        this.sessions = message.sessions;
        this.status = "ready";
        this.dropOldCovers();
        this.emit();
        return;
      case "cover": {
        if (!this.sessions.some((s) => s.id === message.id && s.coverKey === message.key)) return;
        let url: string | null = null;
        if (message.data.length <= MAX_COVER_BASE64) {
          try {
            url = this.deps.cover(Buffer.from(message.data, "base64"), message.mime);
          } catch (error) {
            this.deps.log("a cover could not be read", error);
          }
        }
        if (!url) return;
        const id = coverId(message.id, message.key);
        this.covers.delete(id);
        this.covers.set(id, url);
        while (this.covers.size > MAX_COVERS) this.covers.delete(this.covers.keys().next().value!);
        this.emit();
        return;
      }
      case "result":
        this.pending.get(message.req)?.(message.ok);
        return;
      case "error":
        this.deps.log(`the media helper says: ${message.message}`);
        return;
    }
  }

  /** Forgets covers of songs no session plays any more. */
  private dropOldCovers(): void {
    const keep = new Set(this.sessions.filter((s) => s.coverKey !== null).map((s) => coverId(s.id, s.coverKey!)));
    for (const id of [...this.covers.keys()]) if (!keep.has(id)) this.covers.delete(id);
  }

  private control(session: string, action: MediaAction): Promise<boolean> {
    const helper = this.helper;
    if (!helper || this.status !== "ready" || !this.sessions.some((s) => s.id === session)) return Promise.resolve(false);
    const req = this.nextReq++;
    return new Promise<boolean>((resolve) => {
      const timer = this.setTimer(() => finish(false), CONTROL_TIMEOUT_MS);
      const finish = (ok: boolean) => {
        if (!this.pending.has(req)) return;
        this.pending.delete(req);
        this.clearTimer(timer);
        resolve(ok);
      };
      this.pending.set(req, finish);
      try {
        helper.write(`${JSON.stringify({ req, cmd: "control", id: session, action })}\n`);
      } catch {
        finish(false);
      }
    });
  }

  private settlePending(): void {
    for (const finish of [...this.pending.values()]) finish(false);
  }

  /** The helper went away while panels watch: start it again, unless it keeps crashing. */
  private crashed(): void {
    const now = this.now();
    this.crashes = [...this.crashes.filter((at) => now - at < RESTART_WINDOW_MS), now];
    this.sessions = [];
    this.covers.clear();
    if (this.crashes.length > MAX_RESTARTS) {
      this.deps.log("the media helper keeps stopping; trying again when a panel starts watching");
      this.status = "failed";
      this.emit();
      return;
    }
    this.status = "starting";
    this.emit();
    this.launch();
  }

  private stop(): void {
    this.clearTimer(this.idleTimer);
    this.idleTimer = undefined;
    const helper = this.helper;
    this.helper = null;
    this.clearTimer(this.startTimer);
    this.settlePending();
    helper?.kill();
    this.reset();
  }

  private reset(): void {
    this.sessions = [];
    this.covers.clear();
    if (this.status !== "unavailable") this.status = "starting";
  }
}

function coverId(session: string, key: string): string {
  return `${session}\u0000${key}`;
}
