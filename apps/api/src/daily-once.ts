import { createHmac, randomBytes } from "node:crypto";
import { utcDay } from "./stats.ts";

/** Marks kept for one UTC day at most; past it, nothing new counts until the day ends (a flood can't grow memory). */
export const DAILY_ONCE_MAX = 200_000;

/**
 * Says yes once per key a UTC day: the public install count goes up at most once per client and module a day (audit L7),
 * so a script can't push a module's count up with repeated calls. It keeps only a keyed hash of the key, in memory, under a
 * random secret made when the service starts and never written anywhere; every mark is dropped when the day changes.
 * A restart forgets them (a key may then count once more that day).
 */
export class DailyOnce {
  private readonly secret = randomBytes(32);
  private day = "";
  private readonly seen = new Set<string>();

  constructor(private readonly now: () => number = Date.now, private readonly max = DAILY_ONCE_MAX) {}

  /** True the first time `key` is asked about today; false after that, and for every new key once today's marks are full. */
  first(key: string): boolean {
    const day = utcDay(this.now());
    if (day !== this.day) {
      this.day = day;
      this.seen.clear();
    }
    const mark = createHmac("sha256", this.secret).update(key).digest("base64url").slice(0, 22);
    if (this.seen.has(mark) || this.seen.size >= this.max) return false;
    this.seen.add(mark);
    return true;
  }
}
