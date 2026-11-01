import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "./fsutil";

/**
 * When Tavora last saw each installed game running, kept in one small file on this PC. It only orders the Add a
 * game list ("Played yesterday") and is never sent anywhere. Games are named by `gameKey` (installed-list.ts).
 */

/** The file holds at most this many games; the longest unseen go first. */
const MAX_GAMES = 500;
/** A game running for hours is written down again only this often. */
const WRITE_EVERY_MS = 10 * 60 * 1000;

export class GamesSeen {
  private seen: Record<string, number> = {};
  private loaded: Promise<void> | null = null;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {}

  private load(): Promise<void> {
    this.loaded ??= readFile(this.file, "utf8").then(
      (text) => {
        try {
          const data = JSON.parse(text) as { v?: unknown; seen?: unknown };
          if (data.v !== 1 || typeof data.seen !== "object" || data.seen === null) return;
          for (const [key, at] of Object.entries(data.seen)) if (typeof at === "number" && Number.isFinite(at) && at > 0) this.seen[key] = at;
        } catch {
          // A file this app cannot read is started again.
        }
      },
      () => undefined,
    );
    return this.loaded;
  }

  /** Every game's last-seen time, by key. */
  async all(): Promise<Record<string, number>> {
    await this.load();
    return { ...this.seen };
  }

  /** Notes that these games are running now. */
  async running(keys: Iterable<string>): Promise<void> {
    await this.load();
    const now = this.now();
    let changed = false;
    for (const key of keys) {
      if (now - (this.seen[key] ?? 0) < WRITE_EVERY_MS) continue;
      this.seen[key] = now;
      changed = true;
    }
    if (!changed) return;
    const newest = Object.entries(this.seen).sort((a, b) => b[1] - a[1]).slice(0, MAX_GAMES);
    this.seen = Object.fromEntries(newest);
    await writeFileAtomic(this.file, JSON.stringify({ v: 1, seen: this.seen })).catch(() => undefined);
  }
}
