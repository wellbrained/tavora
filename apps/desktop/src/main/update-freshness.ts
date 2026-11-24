// Whether the update feed Tavora sees is fresh: its second signature (tavoraSignature2, update-signature.ts) must hold
// for this channel and platform, must not be older than the newest one this install has seen, and its expiry is
// compared with the clock. The vault's Github/Tavora/docs/update-signature-binding.md has the design and the rollout.
//
// This release only reports: the outcome goes to the update log, and nothing is refused or shown
// (ENFORCE_FEED_FRESHNESS). The release that enforces it turns the switch on: then a feed that doesn't check out, or
// has expired, makes "Check for updates" say Tavora can't confirm it is up to date (UpdateState idle, failed
// "unconfirmed"), and a downloaded update whose feed doesn't check out is refused. An expired feed never stops a
// newer signed version from installing.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./fsutil";
import { checkFeedFreshness, FEED_CLOCK_LEEWAY_MS, UPDATE_SIGNATURE2_FIELD, type FeedFreshness, type UpdateChannel } from "./update-signature";

/** Off in this release: the outcome is only logged. The enforcing release turns it on (and nothing else). */
export const ENFORCE_FEED_FRESHNESS = false;
/** Tavora has one channel: latest.yml, the stable one. */
export const FEED_CHANNEL: UpdateChannel = "stable";
/** Where the newest issue time is kept, in the app's data folder (not in backups or the cloud copy: a restore must never take it back). */
export const FEED_STATE_FILE = "update-feed.json";

/** The platform name the feed signs for this build (win-x64 for Tavora's Windows installer). */
export function feedPlatform(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform === "win32" ? "win" : platform}-${arch}`;
}

/** The fields of a parsed latest.yml the check reads: the installer the feed names and the second signature. */
export interface FeedInfo {
  version?: unknown;
  path?: unknown;
  sha512?: unknown;
  files?: unknown;
  [UPDATE_SIGNATURE2_FIELD]?: unknown;
}

/** The installer the feed names: its first `files` entry (what electron-updater downloads), else `path` and `sha512`. */
export function feedInstaller(info: FeedInfo): { file: unknown; sha512: unknown } {
  const first = Array.isArray(info.files) ? (info.files[0] as { url?: unknown; sha512?: unknown } | undefined) : undefined;
  if (first && typeof first === "object") return { file: first.url, sha512: first.sha512 };
  return { file: info.path, sha512: info.sha512 };
}

const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** The saved file as an object, or {} for anything unreadable (missing, damaged, another shape). */
function readState(text: string | null): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The saved time of each channel: `channels`, and the first form's one `newestIssuedAt` as the stable channel's. */
function readChannels(state: Record<string, unknown>): Record<string, string> {
  const channels: Record<string, string> = {};
  if (isTime(state.newestIssuedAt)) channels.stable = state.newestIssuedAt;
  const saved = state.channels;
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    for (const [channel, time] of Object.entries(saved)) if (isTime(time)) channels[channel] = time;
  }
  return channels;
}

/**
 * The newest issue time saved for `channel`, or null. The file keeps one per channel (`channels`); `newestIssuedAt`
 * is the stable channel's, the form this file first had, which is still written and read.
 */
export function readNewestIssuedAt(text: string | null, channel: string): string | null {
  return readChannels(readState(text))[channel] ?? null;
}

/** One line for the update log. */
export function describeFreshness(result: FeedFreshness): string {
  if (result.status === "refused") return `feed can't be confirmed: ${result.reason}`;
  const { issuedAt, expiresAt } = result.statement;
  if (result.status === "expired") return `feed expired: signed ${issuedAt}, good until ${expiresAt} (${result.key} key)`;
  if (result.status === "clock-behind") return `feed signed ${issuedAt}, after this PC's clock; good until ${expiresAt} (${result.key} key)`;
  return `feed fresh: signed ${issuedAt}, good until ${expiresAt} (${result.key} key)`;
}

/** Whether a result means Tavora can't confirm it is up to date (once enforced). */
export function unconfirmed(result: FeedFreshness): boolean {
  return result.status === "refused" || result.status === "expired";
}

export interface FeedFreshnessOptions {
  /** The app's data folder. */
  userData: string;
  pinned: unknown;
  platform?: string;
  now?: () => Date;
}

/**
 * Checks feeds and keeps the newest issue time a verified statement had, per channel, so an older one served again
 * shows. The file is one small JSON object; a newer Tavora may add fields, which this one keeps. A statement dated
 * further ahead of this PC's clock than FEED_CLOCK_LEEWAY_MS (`clock-behind`) is never kept: one such genuine statement
 * served once (a dry run on a PC whose clock ran a year ahead) would otherwise make every real feed after it a replay.
 */
export class FeedFreshnessCheck {
  private channels: Record<string, string> = {};
  private saved: Record<string, unknown> = {};
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;
  private readonly pinned: unknown;
  private readonly platform: string;
  private readonly now: () => Date;

  constructor(options: FeedFreshnessOptions) {
    this.file = path.join(options.userData, FEED_STATE_FILE);
    this.pinned = options.pinned;
    this.platform = options.platform ?? feedPlatform();
    this.now = options.now ?? (() => new Date());
  }

  /** Reads the saved state; anything unreadable counts as nothing seen yet. */
  async load(): Promise<void> {
    this.saved = readState(await readFile(this.file, "utf8").catch(() => null));
    this.channels = readChannels(this.saved);
  }

  /** The newest issue time kept for this app's channel. */
  get newestIssuedAt(): string | null {
    return this.channels[FEED_CHANNEL] ?? null;
  }

  /**
   * Checks a feed for the installer it names (`installer`: from the feed for a check, the downloaded file's name and
   * hash for a download) and remembers a newer verified issue time.
   */
  check(info: FeedInfo, installer: { file: unknown; sha512: unknown } = feedInstaller(info)): FeedFreshness {
    const now = this.now();
    const result = checkFeedFreshness(
      { version: info.version, ...installer, signature2: info[UPDATE_SIGNATURE2_FIELD] },
      { pinned: this.pinned, channel: FEED_CHANNEL, platform: this.platform, newestIssuedAt: this.newestIssuedAt, now },
    );
    if (result.status === "refused" || result.status === "clock-behind") return result;
    const { channel, issuedAt } = result.statement;
    const newest = this.channels[channel];
    // Never later than this PC's clock allows (clock-behind is that already; the check here says it outright).
    if (Date.parse(issuedAt) > now.getTime() + FEED_CLOCK_LEEWAY_MS) return result;
    if (newest === undefined || Date.parse(issuedAt) > Date.parse(newest)) {
      this.channels[channel] = issuedAt;
      this.save();
    }
    return result;
  }

  /** Resolves once the last save is on disk (for tests). */
  flushed(): Promise<void> {
    return this.writing;
  }

  private save(): void {
    // `newestIssuedAt` stays the stable channel's, the first form of this file; `channels` holds every channel's.
    const stable = this.channels.stable;
    this.saved = { ...this.saved, channels: { ...this.channels }, ...(stable ? { newestIssuedAt: stable } : {}) };
    const body = `${JSON.stringify(this.saved, null, 2)}\n`;
    this.writing = this.writing.then(() => writeFileAtomic(this.file, body)).catch(() => undefined);
  }
}
