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
import { checkFeedFreshness, UPDATE_SIGNATURE2_FIELD, type FeedFreshness, type UpdateChannel } from "./update-signature";

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

/** The saved newest issue time from the file's text, or null for anything else (missing, damaged, another shape). */
export function readNewestIssuedAt(text: string | null): string | null {
  if (!text) return null;
  try {
    const value = (JSON.parse(text) as { newestIssuedAt?: unknown } | null)?.newestIssuedAt;
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
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
 * Checks feeds and keeps the newest issue time a verified statement had, so an older one served again shows. The
 * file is one small JSON object; a newer Tavora may add fields, which this one keeps.
 */
export class FeedFreshnessCheck {
  private newest: string | null = null;
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
    const text = await readFile(this.file, "utf8").catch(() => null);
    this.newest = readNewestIssuedAt(text);
    try {
      const parsed: unknown = text ? JSON.parse(text) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.saved = parsed as Record<string, unknown>;
    } catch {}
  }

  get newestIssuedAt(): string | null {
    return this.newest;
  }

  /**
   * Checks a feed for the installer it names (`installer`: from the feed for a check, the downloaded file's name and
   * hash for a download) and remembers a newer verified issue time.
   */
  check(info: FeedInfo, installer: { file: unknown; sha512: unknown } = feedInstaller(info)): FeedFreshness {
    const result = checkFeedFreshness(
      { version: info.version, ...installer, signature2: info[UPDATE_SIGNATURE2_FIELD] },
      { pinned: this.pinned, channel: FEED_CHANNEL, platform: this.platform, newestIssuedAt: this.newest, now: this.now() },
    );
    if (result.status !== "refused" && (this.newest === null || Date.parse(result.statement.issuedAt) > Date.parse(this.newest))) {
      this.newest = result.statement.issuedAt;
      this.save();
    }
    return result;
  }

  /** Resolves once the last save is on disk (for tests). */
  flushed(): Promise<void> {
    return this.writing;
  }

  private save(): void {
    const body = `${JSON.stringify({ ...this.saved, newestIssuedAt: this.newest }, null, 2)}\n`;
    this.writing = this.writing.then(() => writeFileAtomic(this.file, body)).catch(() => undefined);
  }
}
