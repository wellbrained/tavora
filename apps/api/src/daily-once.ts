import { createHmac, randomBytes } from "node:crypto";
import { utcDay } from "./stats.ts";

/**
 * The most marks kept at once. Past it the oldest goes (its key may then count once more that day), so a flood can't
 * grow memory, and can't stop everyone else's installs from counting either.
 */
export const DAILY_ONCE_MAX = 200_000;

/**
 * Says yes once per key a UTC day: the public install count goes up at most once per client and module a day (audit L7),
 * so a script can't push a module's count up with repeated calls. It keeps only a keyed hash of the key, in memory, under a
 * random secret made when the service starts and never written anywhere; every mark is dropped at the
 * first question of the next day.
 * A restart forgets them (a key may then count once more that day).
 */
export class DailyOnce {
  private readonly secret = randomBytes(32);
  private day = "";
  /** In the order they were made. */
  private readonly seen = new Set<string>();
  private readonly now: () => number;
  private readonly max: number;

  constructor(now: () => number = Date.now, max = DAILY_ONCE_MAX) {
    this.now = now;
    this.max = max;
  }

  /** True the first time `key` is asked about today, false after that. */
  first(key: string): boolean {
    const day = utcDay(this.now());
    if (day !== this.day) {
      this.day = day;
      this.seen.clear();
    }
    const mark = createHmac("sha256", this.secret).update(key).digest("base64url").slice(0, 22);
    if (this.seen.has(mark)) return false;
    if (this.seen.size >= this.max) {
      const [oldest] = this.seen;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.add(mark);
    return true;
  }
}
