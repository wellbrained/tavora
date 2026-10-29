import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Plain daily totals (decided 2026-10-26): how often an installer was downloaded, the app and modules
 * were updated and modules installed, per version or module and per UTC day, and once a day how many
 * accounts there are and how many were active. Nothing about a user is kept: no address, no id, no
 * request log, and a user without an account is never counted as a person. A count is a number that
 * goes up by one. Installers downloaded from the GitHub releases are a kind of their own: GitHub only keeps a
 * running total per file, so once an hour the server asks for it and counts what was added since (github-releases.ts).
 */

export const STAT_KINDS = ["app-installer", "app-installer-github", "app-update", "module-install", "module-update"] as const;
export type StatKind = (typeof STAT_KINDS)[number];

/** Most different versions or modules counted per kind and day, so made-up names cannot grow the file. */
const MAX_KEYS_PER_DAY = 500;
const DAY_MS = 24 * 60 * 60_000;
/** Longest range /api/stats answers. */
export const MAX_RANGE_DAYS = 730;
const TAVORA_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

export const isAppVersion = (value: unknown): value is string => typeof value === "string" && TAVORA_VERSION.test(value);

/** The UTC day of a moment, as 2026-10-26. */
export const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

export interface AccountActivity {
  total: number;
  active7: number;
  active30: number;
}

export interface StatSeries {
  /** Every UTC day of the range, oldest first, from `from` to `to`. */
  days: string[];
  /** Per kind, each version or module with its count on every day (zeros included, same order as `days`). */
  counts: Record<StatKind, Record<string, number[]>>;
  /** Per kind, the sum over the range for each version or module. */
  totals: Record<StatKind, Record<string, number>>;
  /** One entry per day, null on days without a snapshot. */
  accounts: ({ total: number; active7: number; active30: number } | null)[];
}

export class StatsStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists daily_counts (day text not null, kind text not null, key text not null, count integer not null, primary key (day, kind, key)) without rowid;
      create table if not exists account_days (day text primary key, total integer not null, active7 integer not null, active30 integer not null);
      create table if not exists github_totals (key text primary key, total integer not null) without rowid;
    `);
  }

  /** Counts one thing (or `amount` of them) on the day of `now`. False when the day already has too many different keys. */
  count(kind: StatKind, key: string, now: number = Date.now(), amount = 1): boolean {
    const day = utcDay(now);
    const known = this.db.prepare("select 1 from daily_counts where day = ? and kind = ? and key = ?").get(day, kind, key);
    if (!known && (this.db.prepare("select count(*) as n from daily_counts where day = ? and kind = ?").get(day, kind) as { n: number }).n >= MAX_KEYS_PER_DAY) return false;
    this.db
      .prepare("insert into daily_counts (day, kind, key, count) values (?, ?, ?, ?) on conflict (day, kind, key) do update set count = count + excluded.count")
      .run(day, kind, key, amount);
    return true;
  }

  /**
   * GitHub's running download totals per version: what was added since the last call is counted on the day of
   * `now`. A version seen for the first time counts its whole total that day. A total that went down (the file
   * was uploaded again) only becomes the new starting point.
   */
  countGithubTotals(totals: Record<string, number>, now: number = Date.now()): void {
    for (const [version, total] of Object.entries(totals)) {
      const seen = (this.db.prepare("select total from github_totals where key = ?").get(version) as { total: number } | undefined)?.total ?? 0;
      if (total > seen && !this.count("app-installer-github", version, now, total - seen)) continue;
      if (total !== seen) this.db.prepare("insert into github_totals (key, total) values (?, ?) on conflict (key) do update set total = excluded.total").run(version, total);
    }
  }

  /** Writes the day's account numbers unless the day already has them. Returns whether it wrote. */
  snapshotAccounts(activity: AccountActivity, now: number = Date.now()): boolean {
    const result = this.db
      .prepare("insert or ignore into account_days (day, total, active7, active30) values (?, ?, ?, ?)")
      .run(utcDay(now), activity.total, activity.active7, activity.active30);
    return Number(result.changes) > 0;
  }

  /** Whether the day of `now` has its account snapshot. */
  hasSnapshot(now: number = Date.now()): boolean {
    return Boolean(this.db.prepare("select 1 from account_days where day = ?").get(utcDay(now)));
  }

  /** The counts of the days `from` to `to` (inclusive, UTC days), shaped for charts. */
  series(from: string, to: string): StatSeries {
    const days: string[] = [];
    for (let at = Date.parse(from); at <= Date.parse(to); at += DAY_MS) days.push(utcDay(at));
    const index = new Map(days.map((day, i) => [day, i]));
    const counts = Object.fromEntries(STAT_KINDS.map((kind) => [kind, {}])) as StatSeries["counts"];
    const totals = Object.fromEntries(STAT_KINDS.map((kind) => [kind, {}])) as StatSeries["totals"];
    const rows = this.db.prepare("select day, kind, key, count from daily_counts where day >= ? and day <= ? order by key").all(from, to) as unknown as { day: string; kind: StatKind; key: string; count: number }[];
    for (const { day, kind, key, count } of rows) {
      (counts[kind][key] ??= days.map(() => 0))[index.get(day)!] = count;
      totals[kind][key] = (totals[kind][key] ?? 0) + count;
    }
    const snapshots = new Map(
      (this.db.prepare("select day, total, active7, active30 from account_days where day >= ? and day <= ?").all(from, to) as unknown as { day: string; total: number; active7: number; active30: number }[]).map((row) => [row.day, row]),
    );
    const accounts = days.map((day) => {
      const row = snapshots.get(day);
      return row ? { total: row.total, active7: row.active7, active30: row.active30 } : null;
    });
    return { days, counts, totals, accounts };
  }

  close(): void {
    this.db.close();
  }
}

/** The range /api/stats asks for: `?days=<1-730>` (default 30) ending today, or `?from=&to=` as UTC days. Null when it makes no sense. */
export function statsRange(query: { days?: string | undefined; from?: string | undefined; to?: string | undefined }, now: number): { from: string; to: string } | null {
  const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && utcDay(Date.parse(value)) === value;
  if (query.from !== undefined || query.to !== undefined) {
    const to = query.to ?? utcDay(now);
    if (query.from === undefined || !isDay(query.from) || !isDay(to) || query.from > to) return null;
    return (Date.parse(to) - Date.parse(query.from)) / DAY_MS < MAX_RANGE_DAYS ? { from: query.from, to } : null;
  }
  const days = query.days === undefined ? 30 : /^\d{1,3}$/.test(query.days) ? Number(query.days) : 0;
  if (days < 1 || days > MAX_RANGE_DAYS) return null;
  return { from: utcDay(now - (days - 1) * DAY_MS), to: utcDay(now) };
}
