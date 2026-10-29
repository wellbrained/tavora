import { DatabaseSync } from "node:sqlite";
import {
  isLeaderboardId,
  isLeaderboardPeriod,
  isModuleId,
  LEADERBOARD_MIN_GAMES,
  LEADERBOARD_PERIODS,
  MAX_LEADERBOARD_BOARDS,
  type LeaderboardBoard,
  type LeaderboardKind,
  type LeaderboardPeriod,
} from "@tavora/module-schema";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AccountStore } from "./account-store.ts";
import { newLabel } from "./conversations.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { fail, optionalSignIn, signedOut, tooMany, type MaybeSignedInEnv } from "./sign-in.ts";
import { checkReviewText } from "./review-filter.ts";

/**
 * Leaderboards (decided 2026-10-28, "Puzzle games: leaderboards and names"): a host feature any module can use. A module
 * declares its boards in its manifest; Tavora sends what the user played, through the user's account, and reads the
 * boards back. Five kinds (the manifest's LeaderboardBoard):
 *
 * - `streak`: won and lost results. A user's line has their current and best winning streak, ranked by the best, then
 *   the current one. On a `daily` board each result belongs to a calendar day, one per day, and a missed day ends the
 *   streak.
 * - `score`: one number per result. A user's line has their best, the highest or the lowest by the board's `order`.
 * - `total`: one number per result, 0 or more. The line is their sum, highest first, and how many results made it.
 * - `average`: one number per result. The line is their mean, highest or lowest by `order`; on the board only from
 *   `minGames` results, so one lucky game doesn't top it.
 * - `rate`: won and lost results. The line is the share won (0 to 100), on the board only from `minGames` results.
 *
 * Every result carries the `day` the user played it on (their local day) and counts only when it ended within that day
 * as some time zone on earth saw it (dayWindow), so replaying an old puzzle from an archive never counts. Every board
 * can be read per period (day, week, month, year, all): a result lands in the period that holds its `day`, and the
 * server keeps one standing per user and period, worked out from that period's results alone. Results are kept, so
 * past periods stay readable.
 *
 * The server keeps every result (idempotent by the module's UUID) and works the lines out from them, so a result sent
 * twice or late still lands right. Each result is taken or refused on its own: one bad result never blocks the rest.
 *
 * Who may use it: a catalog module only once the maintainer allows it (Tavora Admin), and its boards are the ones its
 * newest listed manifest declares. A development copy (`local.*`) needs no allowing and sends its own declaration; its
 * boards are test boards, each user sees only their own line there.
 *
 * Names: a board shows the user's Tavora profile name, and only after the user agreed for that module (`shown`), which
 * Tavora asks in the module's panel. A name the word filter (review-filter.ts) refuses, a name the maintainer hid, or no
 * name at all shows as a pseudonym ("User · K7", a label per account and module, like conversations'); the account
 * keeps its name. Switching it off deletes the account's results for that module. Suspended and banned accounts are left
 * off every board; deleting an account deletes everything here.
 *
 * Limits: LIMITS below, and the per-account-and-module request limit in the routes.
 */

export const LIMITS = {
  /** Results one request may send. */
  resultsPerRequest: 50,
  /** Results kept per account and module; more are refused as `full`. */
  storedResults: 10_000,
  /** Lines one board read gives at most, and by default. */
  maxRows: 100,
  defaultRows: 20,
  /** Development copies' test boards one account may keep, so made-up ids can't fill the service. */
  testModules: 10,
  /** Lines a board read looks through to find the reader's own line further down. */
  scanRows: 10_000,
  /** How far in the past and the future a result's time may be. */
  oldestMs: 365 * 24 * 3_600_000,
  futureMs: 5 * 60_000,
  /** A value's size, either way (a total's must be 0 or more). */
  maxValue: 1e12,
  /** Boards one `mine` read may ask about. */
  maxMineBoards: MAX_LEADERBOARD_BOARDS,
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
/** Module ids of development copies (module-schema's LOCAL_OWNER): test boards, no allowing needed. */
export const DEV_PREFIX = "local.";
/** The version of the tables below; an older file is dropped and rebuilt (the service held no real data then). */
const SCHEMA_VERSION = 2;

export type Rejection = "invalid" | "time" | "archive" | "day-taken" | "full";

/**
 * How a board works out its lines; a standing worked out another way (the declaration changed) is rebuilt. `minGames`
 * is not part of it: it only decides who is shown.
 */
export type Shape = "streak" | "streak-daily" | "score-high" | "score-low" | "total" | "average-high" | "average-low" | "rate";

export const shapeOf = (board: LeaderboardBoard): Shape => {
  switch (board.kind) {
    case "streak":
      return board.daily ? "streak-daily" : "streak";
    case "score":
      return board.order === "low" ? "score-low" : "score-high";
    case "total":
      return "total";
    case "average":
      return board.order === "low" ? "average-low" : "average-high";
    case "rate":
      return "rate";
  }
};

/** Results of won and lost, against results with a number. */
const isOutcomeShape = (shape: Shape) => shape === "streak" || shape === "streak-daily" || shape === "rate";
const isStreakShape = (shape: Shape) => shape === "streak" || shape === "streak-daily";
const isLowShape = (shape: Shape) => shape === "score-low" || shape === "average-low";
const isMeanShape = (shape: Shape) => shape === "average-high" || shape === "average-low";
/** Shapes whose lines show only from `minGames` results. */
const isMinGamesShape = (shape: Shape) => isMeanShape(shape) || shape === "rate";

/** How many results a user needs to be on the board: only average and rate boards ask for any. */
export const minGamesOf = (board: LeaderboardBoard): number => (board.kind === "average" || board.kind === "rate" ? (board.minGames ?? LEADERBOARD_MIN_GAMES.default) : 1);

/** Whether a YYYY-MM-DD text names a real day. */
export function isDay(value: unknown): value is string {
  return typeof value === "string" && DAY_TEXT.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);
const nextDay = (day: string) => dayOf(dayStart(day) + DAY);
const dayBefore = (day: string) => dayOf(dayStart(day) - DAY);

/**
 * When a game of `day` may have ended: from that day's midnight in the earliest time zone (UTC+14) to the next midnight
 * in the latest one (UTC−12). A result outside it was played on another day: from an archive.
 */
export function dayWindow(day: string): { from: number; to: number } {
  const start = dayStart(day);
  return { from: start - 14 * HOUR, to: start + DAY + 12 * HOUR };
}

/** The Monday of the week a day is in. */
function mondayOf(day: string): string {
  const weekday = new Date(dayStart(day)).getUTCDay();
  return dayOf(dayStart(day) - ((weekday + 6) % 7) * DAY);
}

/** The key of the period of a kind that holds a day: the day, the week's Monday, YYYY-MM, YYYY, or "" for all. */
export function periodKey(period: LeaderboardPeriod, day: string): string {
  switch (period) {
    case "day":
      return day;
    case "week":
      return mondayOf(day);
    case "month":
      return day.slice(0, 7);
    case "year":
      return day.slice(0, 4);
    case "all":
      return "";
  }
}

/** The first and last day (both inclusive) a period key covers; null for `all`, which covers everything. */
export function periodRange(period: LeaderboardPeriod, key: string): { from: string; to: string } | null {
  switch (period) {
    case "day":
      return { from: key, to: key };
    case "week":
      return { from: key, to: dayOf(dayStart(key) + 6 * DAY) };
    case "month": {
      const month = Number(key.slice(5, 7));
      const next = month === 12 ? `${String(Number(key.slice(0, 4)) + 1).padStart(4, "0")}-01` : `${key.slice(0, 4)}-${String(month + 1).padStart(2, "0")}`;
      return { from: `${key}-01`, to: dayBefore(`${next}-01`) };
    }
    case "year":
      return { from: `${key}-01-01`, to: `${key}-12-31` };
    case "all":
      return null;
  }
}

/** The periods a board of this shape keeps standings for: a streak needs more than one day, so it has no `day`. */
const periodsOf = (shape: Shape) => LEADERBOARD_PERIODS.filter((period) => !(period === "day" && isStreakShape(shape)));

export interface Played {
  id: string;
  outcome: "won" | "lost";
  at: number;
  day: string | null;
}

/** A result as it is kept: `outcome` for streaks and rates, `value` for the rest; `day` for all. */
interface Checked {
  id: string;
  at: number;
  outcome: "won" | "lost" | null;
  value: number | null;
  day: string;
}

/**
 * One result as the module sent it, checked for its board: what to keep, or why not. A result without a string id
 * can't be named in the answer and comes back as null; the caller skips it.
 */
export function checkResult(input: unknown, shape: Shape, now: number): { ok: Checked } | { id: string; reason: Rejection } | null {
  const raw = record(input);
  if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 100) return null;
  const id = raw.id;
  const at = raw.at;
  if (!UUID.test(id) || typeof at !== "number" || !Number.isSafeInteger(at)) return { id, reason: "invalid" };
  const outcomes = isOutcomeShape(shape);
  if (outcomes && raw.outcome !== "won" && raw.outcome !== "lost") return { id, reason: "invalid" };
  if (!outcomes && (typeof raw.value !== "number" || !Number.isFinite(raw.value) || Math.abs(raw.value) > LIMITS.maxValue)) return { id, reason: "invalid" };
  // A total only adds up: a negative number would let a module (or a bug) take points away.
  if (shape === "total" && (raw.value as number) < 0) return { id, reason: "invalid" };
  if (!isDay(raw.day)) return { id, reason: "invalid" };
  if (at > now + LIMITS.futureMs || at < now - LIMITS.oldestMs) return { id, reason: "time" };
  const window = dayWindow(raw.day);
  if (at < window.from || at >= window.to) return { id, reason: "archive" };
  return {
    ok: {
      id: id.toLowerCase(),
      at,
      outcome: outcomes ? (raw.outcome as "won" | "lost") : null,
      value: outcomes ? null : (raw.value as number),
      day: raw.day,
    },
  };
}

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/**
 * A user's streaks from all their results on one board: `best` and when it was reached, `current` as of their last
 * result, and that result's day on a daily board. Daily results go by day, a gap between two days ends the streak; the
 * others go by when they ended.
 */
export function streakOf(results: readonly Played[], daily: boolean): { best: number; reachedAt: number; current: number; lastDay: string | null } {
  const sorted = [...results].sort((a, b) => (daily ? a.day!.localeCompare(b.day!) : a.at - b.at) || a.id.localeCompare(b.id));
  let current = 0;
  let best = 0;
  let reachedAt = 0;
  let lastDay: string | null = null;
  for (const result of sorted) {
    if (daily && lastDay !== null && result.day !== nextDay(lastDay)) current = 0;
    current = result.outcome === "won" ? current + 1 : 0;
    if (current > best) {
      best = current;
      reachedAt = result.at;
    }
    lastDay = result.day;
  }
  return { best, reachedAt, current, lastDay };
}

/** A daily streak still runs while its last day is today or yesterday (the user may not have played today yet). */
export function liveStreak(current: number, lastDay: string | null, today: string): number {
  return lastDay !== null && lastDay >= dayBefore(today) ? current : 0;
}

/** The name a board shows for an account: its profile name, or null for its pseudonym (no name, filtered or hidden). */
export function boardName(profileName: string | null, hidden: boolean): string | null {
  const name = profileName?.trim() ?? "";
  return name && !hidden && checkReviewText(name) === "ok" ? name : null;
}

export interface BoardLine {
  accountId: string;
  rank: number;
  /** The pseudonym's label for this account and module ("K7"). */
  label: string;
  /** The number the board ranks by: the best streak, the best, the sum, the mean or the share won. */
  value: number;
  /** Streak boards: the current streak, 0 once it ended. */
  current: number;
  games: number;
  wins: number;
}

/** What a user's results in one period come to, before it is stored as a standing. */
interface Line {
  value: number;
  reachedAt: number;
  current: number;
  lastDay: string | null;
  games: number;
  wins: number;
}

interface ResultRow {
  id: string;
  outcome: "won" | "lost" | null;
  value: number | null;
  at: number;
  day: string;
  daily_day: string | null;
}

/** The line a set of results comes to on a board of this shape, or null when none of them counts for it. */
function lineOf(shape: Shape, rows: readonly ResultRow[]): Line | null {
  const latest = (list: readonly ResultRow[]) => list.reduce((at, row) => Math.max(at, row.at), 0);
  if (isOutcomeShape(shape)) {
    const played = rows.filter((row) => row.outcome !== null && (shape !== "streak-daily" || row.daily_day !== null));
    if (played.length === 0) return null;
    const wins = played.filter((row) => row.outcome === "won").length;
    if (shape === "rate") return { value: Math.round((wins / played.length) * 1000) / 10, reachedAt: latest(played), current: 0, lastDay: null, games: played.length, wins };
    const daily = shape === "streak-daily";
    const streak = streakOf(
      played.map((row) => ({ id: row.id, outcome: row.outcome!, at: row.at, day: daily ? row.daily_day : row.day })),
      daily,
    );
    return { value: streak.best, reachedAt: streak.reachedAt, current: streak.current, lastDay: streak.lastDay, games: played.length, wins };
  }
  const valued = rows.filter((row) => row.value !== null);
  if (valued.length === 0) return null;
  const base = { current: 0, lastDay: null, games: valued.length, wins: 0 };
  if (shape === "total") {
    // The sum was last changed by the newest result that added anything.
    const adding = valued.filter((row) => row.value! > 0);
    return { ...base, value: valued.reduce((sum, row) => sum + row.value!, 0), reachedAt: latest(adding.length > 0 ? adding : valued) };
  }
  // A mean is reached by the newest game: the one that made it what it is.
  if (isMeanShape(shape)) return { ...base, value: valued.reduce((sum, row) => sum + row.value!, 0) / valued.length, reachedAt: latest(valued) };
  const low = isLowShape(shape);
  const best = valued.reduce((a, b) => (b.value! === a.value! ? (b.at < a.at ? b : a) : (b.value! < a.value!) === low ? b : a));
  return { ...base, value: best.value!, reachedAt: best.at };
}

interface StandingSql {
  account_id: string;
  label: string;
  value: number;
  live: number;
  games: number;
  wins: number;
}

/** The leaderboards: members, results, standings, allowed modules and hidden names, in `leaderboards.sqlite` of the state directory. */
export class LeaderboardStore {
  private readonly db: DatabaseSync;
  /** Results kept per account and module (LIMITS.storedResults; tests use fewer). */
  private readonly storedResults: number;

  constructor(path: string, storedResults = LIMITS.storedResults) {
    this.storedResults = storedResults;
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    // The tables changed shape before anything was deployed: an older file is rebuilt, not migrated.
    const version = (this.db.prepare("pragma user_version").get() as { user_version: number }).user_version;
    if (version < SCHEMA_VERSION) this.db.exec("drop table if exists results; drop table if exists standings;");
    this.db.exec(`
      -- One row per account and module once the account asked: its pseudonym label, and when it agreed to be shown (null: not shown).
      create table if not exists members (
        account_id text not null, module_id text not null, label text not null, shown_at integer,
        primary key (account_id, module_id)
      );
      -- \`day\` is the user's local day of every result; \`daily_day\` repeats it for a daily streak's results only, which
      -- may be one a day.
      create table if not exists results (
        account_id text not null, module_id text not null, board text not null, id text not null,
        outcome text, value real, day text not null, daily_day text, at integer not null,
        primary key (account_id, module_id, board, id)
      );
      create unique index if not exists results_daily on results (account_id, module_id, board, daily_day) where daily_day is not null;
      create index if not exists results_by_day on results (account_id, module_id, board, day);
      -- Each account's line on a board in one period (period_key: the day, the week's Monday, YYYY-MM, YYYY or ""),
      -- worked out from that period's results when they change. \`value\` is what the board ranks by.
      create table if not exists standings (
        account_id text not null, module_id text not null, board text not null, period text not null, period_key text not null,
        shape text not null, value real not null, reached_at integer not null, current integer not null, last_day text,
        games integer not null, wins integer not null,
        primary key (account_id, module_id, board, period, period_key)
      );
      create index if not exists standings_board on standings (module_id, board, period, period_key, shape);
      create table if not exists allowed_modules (module_id text primary key, allowed_at integer not null);
      create table if not exists hidden_names (account_id text primary key, hidden_at integer not null);
    `);
    if (version < SCHEMA_VERSION) this.db.exec(`pragma user_version = ${SCHEMA_VERSION}`);
  }

  close(): void {
    this.db.close();
  }

  // ── Allowed modules and hidden names (Tavora Admin) ────────────────────

  /**
   * Whether a module's boards run: a catalog module once allowed; a development copy for an account that has its test
   * boards already or fewer than LIMITS.testModules of them (without an account, the test boards just answer empty).
   */
  isAvailable(moduleId: string, accountId: string | null = null): boolean {
    if (!moduleId.startsWith(DEV_PREFIX)) return this.db.prepare("select 1 from allowed_modules where module_id = ?").get(moduleId) !== undefined;
    if (accountId === null || this.db.prepare("select 1 from members where account_id = ? and module_id = ?").get(accountId, moduleId)) return true;
    const count = this.db.prepare("select count(*) as n from members where account_id = ? and module_id like 'local.%'").get(accountId) as { n: number };
    return count.n < LIMITS.testModules;
  }

  /** Allows a catalog module's boards, or stops them (its results stay, for allowing it again). Whether anything changed. */
  setAllowed(moduleId: string, allowed: boolean, now: number): boolean {
    const result = allowed
      ? this.db.prepare("insert into allowed_modules (module_id, allowed_at) values (?, ?) on conflict (module_id) do nothing").run(moduleId, now)
      : this.db.prepare("delete from allowed_modules where module_id = ?").run(moduleId);
    return Number(result.changes) > 0;
  }

  allowedModules(): { moduleId: string; allowedAt: number }[] {
    const rows = this.db.prepare("select module_id, allowed_at from allowed_modules order by module_id").all() as { module_id: string; allowed_at: number }[];
    return rows.map((row) => ({ moduleId: row.module_id, allowedAt: row.allowed_at }));
  }

  isNameHidden(accountId: string): boolean {
    return this.db.prepare("select 1 from hidden_names where account_id = ?").get(accountId) !== undefined;
  }

  /** Hides an account's name on every board (its pseudonym shows instead), or shows it again. Whether anything changed. */
  setNameHidden(accountId: string, hidden: boolean, now: number): boolean {
    const result = hidden
      ? this.db.prepare("insert into hidden_names (account_id, hidden_at) values (?, ?) on conflict (account_id) do nothing").run(accountId, now)
      : this.db.prepare("delete from hidden_names where account_id = ?").run(accountId);
    return Number(result.changes) > 0;
  }

  hiddenNames(): { accountId: string; hiddenAt: number }[] {
    const rows = this.db.prepare("select account_id, hidden_at from hidden_names order by hidden_at desc").all() as { account_id: string; hidden_at: number }[];
    return rows.map((row) => ({ accountId: row.account_id, hiddenAt: row.hidden_at }));
  }

  /** The accounts that agreed to be shown on some board, newest first: how many modules each is on, and since when. */
  shownAccounts(): { accountId: string; modules: number; since: number }[] {
    const rows = this.db
      .prepare("select account_id, count(*) as modules, min(shown_at) as since from members where shown_at is not null group by account_id order by since desc, account_id")
      .all() as { account_id: string; modules: number; since: number }[];
    return rows.map((row) => ({ accountId: row.account_id, modules: row.modules, since: row.since }));
  }

  // ── Members ────────────────────────────────────────────────────────────

  /** An account's membership of a module's boards, made on first ask so its pseudonym label stays the same. */
  member(accountId: string, moduleId: string): { label: string; shown: boolean } {
    this.db.prepare("insert into members (account_id, module_id, label) values (?, ?, ?) on conflict do nothing").run(accountId, moduleId, newLabel());
    const row = this.db.prepare("select label, shown_at from members where account_id = ? and module_id = ?").get(accountId, moduleId) as { label: string; shown_at: number | null };
    return { label: row.label, shown: row.shown_at !== null };
  }

  /** The user agreed to show their name and results on the module's boards. */
  show(accountId: string, moduleId: string, now: number): void {
    this.member(accountId, moduleId);
    this.db.prepare("update members set shown_at = coalesce(shown_at, ?) where account_id = ? and module_id = ?").run(now, accountId, moduleId);
  }

  /** The user switched it off: off the boards, and their results for the module are deleted. */
  hide(accountId: string, moduleId: string): void {
    this.db.exec("begin");
    try {
      this.db.prepare("update members set shown_at = null where account_id = ? and module_id = ?").run(accountId, moduleId);
      this.db.prepare("delete from results where account_id = ? and module_id = ?").run(accountId, moduleId);
      this.db.prepare("delete from standings where account_id = ? and module_id = ?").run(accountId, moduleId);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  /** The account was deleted: everything about it goes. */
  forget(accountId: string): void {
    this.db.exec("begin");
    try {
      for (const table of ["members", "results", "standings", "hidden_names"]) this.db.prepare(`delete from ${table} where account_id = ?`).run(accountId);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  // ── Results ────────────────────────────────────────────────────────────

  /**
   * Keeps the results of a shown member on one board, each on its own, and works out the account's standings again,
   * one for every period the new results touch. A result id the board has already counts as taken, whatever it holds
   * now, so sending again is safe.
   */
  submit(accountId: string, moduleId: string, board: string, shape: Shape, input: readonly unknown[], now: number): { accepted: string[]; rejected: { id: string; reason: Rejection }[] } {
    const accepted: string[] = [];
    const rejected: { id: string; reason: Rejection }[] = [];
    const has = this.db.prepare("select 1 from results where account_id = ? and module_id = ? and board = ? and id = ?");
    const dayTaken = this.db.prepare("select 1 from results where account_id = ? and module_id = ? and board = ? and daily_day = ?");
    const insert = this.db.prepare("insert into results (account_id, module_id, board, id, outcome, value, day, daily_day, at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    let stored = (this.db.prepare("select count(*) as n from results where account_id = ? and module_id = ?").get(accountId, moduleId) as { n: number }).n;
    const touched = new Map<string, { period: LeaderboardPeriod; key: string }>();
    this.db.exec("begin");
    try {
      for (const item of input) {
        // A result the board has already is taken as it is, even when sent again too late to count now.
        const id = record(item).id;
        if (typeof id === "string" && UUID.test(id) && has.get(accountId, moduleId, board, id.toLowerCase())) {
          accepted.push(id);
          continue;
        }
        const checked = checkResult(item, shape, now);
        if (!checked) continue;
        if (!("ok" in checked)) {
          rejected.push(checked);
          continue;
        }
        const sent = id as string;
        const result = checked.ok;
        const dailyDay = shape === "streak-daily" ? result.day : null;
        if (stored >= this.storedResults) rejected.push({ id: sent, reason: "full" });
        else if (dailyDay !== null && dayTaken.get(accountId, moduleId, board, dailyDay)) rejected.push({ id: sent, reason: "day-taken" });
        else {
          insert.run(accountId, moduleId, board, result.id, result.outcome, result.value, result.day, dailyDay, result.at);
          stored++;
          for (const period of periodsOf(shape)) {
            const key = periodKey(period, result.day);
            touched.set(`${period}:${key}`, { period, key });
          }
          accepted.push(sent);
        }
      }
      // A declaration that changed the shape leaves standings worked out another way: all of them are made again.
      const stale = this.db.prepare("select 1 from standings where account_id = ? and module_id = ? and board = ? and shape <> ?").get(accountId, moduleId, board, shape);
      if (stale) {
        this.db.prepare("delete from standings where account_id = ? and module_id = ? and board = ?").run(accountId, moduleId, board);
        const days = this.db.prepare("select distinct day from results where account_id = ? and module_id = ? and board = ?").all(accountId, moduleId, board) as { day: string }[];
        for (const { day } of days) {
          for (const period of periodsOf(shape)) {
            const key = periodKey(period, day);
            touched.set(`${period}:${key}`, { period, key });
          }
        }
        touched.set("all:", { period: "all", key: "" });
      }
      for (const { period, key } of touched.values()) this.workOut(accountId, moduleId, board, shape, period, key);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return { accepted, rejected };
  }

  /** The account's line on a board in one period, from all its results there. */
  private workOut(accountId: string, moduleId: string, board: string, shape: Shape, period: LeaderboardPeriod, key: string): void {
    const range = periodRange(period, key);
    const rows = this.db
      .prepare(`select id, outcome, value, at, day, daily_day from results where account_id = ? and module_id = ? and board = ?${range ? " and day between ? and ?" : ""}`)
      .all(accountId, moduleId, board, ...(range ? [range.from, range.to] : [])) as unknown as ResultRow[];
    const line = lineOf(shape, rows);
    if (!line) {
      this.db.prepare("delete from standings where account_id = ? and module_id = ? and board = ? and period = ? and period_key = ?").run(accountId, moduleId, board, period, key);
      return;
    }
    this.db
      .prepare(
        `insert into standings (account_id, module_id, board, period, period_key, shape, value, reached_at, current, last_day, games, wins) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (account_id, module_id, board, period, period_key) do update set shape = excluded.shape, value = excluded.value, reached_at = excluded.reached_at,
           current = excluded.current, last_day = excluded.last_day, games = excluded.games, wins = excluded.wins`,
      )
      .run(accountId, moduleId, board, period, key, shape, line.value, line.reachedAt, line.current, line.lastDay, line.games, line.wins);
  }

  /**
   * The best lines of a board in one period (`period` and the `key` of the one asked, all by default), ranked (equal
   * lines share a rank), leaving out `skip` (suspended and banned accounts) and, on average and rate boards, users
   * under `minGames`. With `viewer` on the board further down, their line comes last (limit 0 gives only theirs).
   * `only` keeps one account's line alone (test boards). `today` decides which daily streaks still run. `of` is how
   * many users the board has in that period.
   */
  top(
    moduleId: string,
    board: string,
    shape: Shape,
    options: { limit: number; today: string; viewer: string | null; only?: string; skip: ReadonlySet<string>; period?: LeaderboardPeriod; key?: string; minGames?: number },
  ): { lines: BoardLine[]; of: number } {
    const streak = isStreakShape(shape);
    const mean = isMeanShape(shape) || shape === "rate";
    // A daily streak whose last day is before yesterday has ended: it counts as 0 for the order too.
    const live = shape === "streak-daily" ? "case when s.last_day >= ? then s.current else 0 end" : "s.current";
    const direction = isLowShape(shape) ? "asc" : "desc";
    const order = streak ? "s.value desc, live desc, s.reached_at asc" : mean ? `s.value ${direction}, s.games desc, s.reached_at asc` : `s.value ${direction}, s.reached_at asc`;
    const params: (string | number)[] = [];
    if (shape === "streak-daily") params.push(dayBefore(options.today));
    params.push(moduleId, board, shape, options.period ?? "all", options.key ?? "");
    const minimum = isMinGamesShape(shape);
    if (minimum) params.push(options.minGames ?? LEADERBOARD_MIN_GAMES.default);
    if (options.only) params.push(options.only);
    const rows = this.db
      .prepare(
        `select s.account_id, m.label, s.value, ${live} as live, s.games, s.wins from standings s
         join members m on m.account_id = s.account_id and m.module_id = s.module_id and m.shown_at is not null
         where s.module_id = ? and s.board = ? and s.shape = ? and s.period = ? and s.period_key = ?${minimum ? " and s.games >= ?" : ""}${options.only ? " and s.account_id = ?" : ""}
         order by ${order}, s.account_id limit ${LIMITS.scanRows}`,
      )
      .iterate(...params) as Iterable<StandingSql>;
    const lines: BoardLine[] = [];
    let place = 0;
    let rank = 0;
    let previous: string | null = null;
    for (const row of rows) {
      if (options.skip.has(row.account_id)) continue;
      place++;
      const key = streak ? `${row.value}:${row.live}` : mean ? `${row.value}:${row.games}` : String(row.value);
      if (key !== previous) rank = place;
      previous = key;
      if (lines.length < options.limit || row.account_id === options.viewer) {
        lines.push({ accountId: row.account_id, rank, label: row.label, value: row.value, current: streak ? row.live : 0, games: row.games, wins: row.wins });
      }
    }
    return { lines, of: place };
  }

  /** One account's standing on a board in a period (rank among `of` users), or null when it has none there. */
  standing(accountId: string, moduleId: string, board: string, shape: Shape, options: { period: LeaderboardPeriod; key: string; today: string; only?: boolean; skip: ReadonlySet<string>; minGames: number }): (BoardLine & { of: number }) | null {
    // Most users have no line in most periods: look before walking the board.
    const has = this.db
      .prepare("select 1 from standings where account_id = ? and module_id = ? and board = ? and period = ? and period_key = ? and shape = ?")
      .get(accountId, moduleId, board, options.period, options.key, shape);
    if (!has) return null;
    const { lines, of } = this.top(moduleId, board, shape, { limit: 0, today: options.today, viewer: accountId, ...(options.only ? { only: accountId } : {}), skip: options.skip, period: options.period, key: options.key, minGames: options.minGames });
    const line = lines.find((entry) => entry.accountId === accountId);
    return line ? { ...line, of } : null;
  }
}

type Env = MaybeSignedInEnv;

export interface LeaderboardOptions {
  leaderboards: LeaderboardStore;
  accounts: AccountStore;
  /** The boards a catalog module's newest listed manifest declares; null for a module the catalog doesn't have. */
  boards: (moduleId: string) => readonly LeaderboardBoard[] | null;
  clientKey: (request: Request) => string;
  /** Writes per account and module: 60 a minute by default. */
  writeRateLimiter?: RateLimiter;
  /** Reads per client: 120 a minute by default. */
  readRateLimiter?: RateLimiter;
  now?: () => number;
}

/** A board declaration as a development copy's Tavora sends it (its manifest's), or null when it is off. */
function sentBoard(id: string, input: Record<string, unknown>): LeaderboardBoard | null {
  // From a query string a number arrives as text; anything but a whole number in range reads as "not set".
  const asked = typeof input.minGames === "string" && /^\d{1,4}$/.test(input.minGames) ? Number(input.minGames) : input.minGames;
  const minGames = Number.isInteger(asked) && (asked as number) >= 1 && (asked as number) <= LEADERBOARD_MIN_GAMES.max ? { minGames: asked as number } : {};
  const order = input.order === "low" ? ({ order: "low" } as const) : {};
  // The name is for the people who read the board; a test board is read by its developer only, who knows the id.
  switch (input.kind) {
    case "streak":
      return { id, name: id, kind: "streak", daily: input.daily === true || input.daily === "1" };
    case "score":
      return { id, name: id, kind: "score", ...order };
    case "total":
      return { id, name: id, kind: "total" };
    case "average":
      return { id, name: id, kind: "average", ...order, ...minGames };
    case "rate":
      return { id, name: id, kind: "rate", ...minGames };
    default:
      return null;
  }
}

/** The numbers a line shows for a board of this kind. */
function numbers(kind: LeaderboardKind, line: BoardLine): Record<string, number> {
  switch (kind) {
    case "streak":
      return { current: line.current, best: line.value };
    case "score":
      return { value: line.value };
    case "total":
    case "average":
      return { value: line.value, games: line.games };
    case "rate":
      return { value: line.value, games: line.games, wins: line.wins };
  }
}

/**
 * The leaderboard routes under /v1/leaderboards. Reading a board, the status and the reader's own standings need no
 * sign-in (signed in, they know which line is the reader's); everything else does. Errors carry a `reason` the app reads.
 */
export function leaderboardRoutes({ leaderboards, accounts, boards, clientKey, writeRateLimiter, readRateLimiter, now = Date.now }: LeaderboardOptions) {
  const writeLimiter = writeRateLimiter ?? createRateLimiter({ limit: 60, windowMs: 60_000 });
  const readLimiter = readRateLimiter ?? createRateLimiter({ limit: 120, windowMs: 60_000 });
  const app = new Hono<Env>();

  // Who asks: a valid sign-in, nobody, or a sign-in the service no longer knows (401, so the app forgets it).
  app.use("*", async (context, next) => {
    const wait = readLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    await next();
  });
  app.use("*", optionalSignIn(accounts, now));

  /** The module id from the path, or null when it isn't one. */
  const moduleOf = (context: Context) => {
    const id = context.req.param("module");
    return isModuleId(id) ? id : null;
  };
  /** The board a request is about: the catalog's declaration, or the sent one for a development copy. */
  const boardOf = (moduleId: string, id: string, sent: Record<string, unknown>): LeaderboardBoard | null => {
    if (!isLeaderboardId(id)) return null;
    if (moduleId.startsWith(DEV_PREFIX)) return sentBoard(id, sent);
    return boards(moduleId)?.find((board) => board.id === id) ?? null;
  };
  const signedIn = (context: Context<Env>) => context.get("account");
  /** Seconds to wait before this account writes to this module's boards again; 0 when it may now. */
  const writeWait = (accountId: string, moduleId: string) => writeLimiter.check(`${accountId}:${moduleId}`);
  /** A signed-in user's status; a module without boards makes no member, so nobody fills the file with made-up ids. */
  const status = (accountId: string, moduleId: string) => {
    const name = boardName(accounts.profileName(accountId), leaderboards.isNameHidden(accountId));
    if (!leaderboards.isAvailable(moduleId, accountId)) return { available: false, shown: false, name, label: null };
    const member = leaderboards.member(accountId, moduleId);
    return { available: true, shown: member.shown, name, label: member.label };
  };
  /**
   * The day a read is about (`day`, the server's today by default), which picks the period that holds it, and the day
   * daily streaks are judged on: the asked one within a day of the server's today (time zones), else today. Null for a
   * day that isn't one or is later than tomorrow.
   */
  const dayOfRead = (context: Context): { day: string; live: string } | null => {
    const today = dayOf(now());
    const asked = context.req.query("day");
    if (asked === undefined) return { day: today, live: today };
    if (!isDay(asked) || dayStart(asked) > dayStart(today) + DAY) return null;
    return { day: asked, live: Math.abs(dayStart(asked) - dayStart(today)) <= DAY ? asked : today };
  };

  app.get("/:module", (context) => {
    const moduleId = moduleOf(context);
    if (!moduleId) return fail(context, 404, "not-found", "Not found.");
    const account = signedIn(context);
    if (!account) return context.json({ available: leaderboards.isAvailable(moduleId), shown: false, name: null, label: null });
    return context.json(status(account.id, moduleId));
  });

  app.put("/:module/shown", (context) => {
    const moduleId = moduleOf(context);
    const account = signedIn(context);
    if (!moduleId) return fail(context, 404, "not-found", "Not found.");
    if (!account) return signedOut(context);
    if (!leaderboards.isAvailable(moduleId, account.id)) return fail(context, 403, "not-allowed", "This module has no leaderboards yet.");
    const wait = writeWait(account.id, moduleId);
    if (wait > 0) return tooMany(context, wait);
    leaderboards.show(account.id, moduleId, now());
    return context.json(status(account.id, moduleId));
  });

  app.delete("/:module/shown", (context) => {
    const moduleId = moduleOf(context);
    const account = signedIn(context);
    if (!moduleId) return fail(context, 404, "not-found", "Not found.");
    if (!account) return signedOut(context);
    const wait = writeWait(account.id, moduleId);
    if (wait > 0) return tooMany(context, wait);
    leaderboards.hide(account.id, moduleId);
    return context.json(status(account.id, moduleId));
  });

  app.post(
    "/:module/boards/:board",
    bodyLimit({ maxSize: 32_000, onError: (context) => fail(context, 400, "bad-request", "Too big.") }),
    async (context) => {
      const moduleId = moduleOf(context);
      const account = signedIn(context);
      if (!moduleId) return fail(context, 404, "not-found", "Not found.");
      if (!account) return signedOut(context);
      if (!leaderboards.isAvailable(moduleId, account.id)) return fail(context, 403, "not-allowed", "This module has no leaderboards yet.");
      if (!leaderboards.member(account.id, moduleId).shown) return fail(context, 403, "not-shown", "Show your results first.");
      const wait = writeWait(account.id, moduleId);
      if (wait > 0) return tooMany(context, wait);
      const body = (await context.req.json().catch(() => null)) as { board?: unknown; results?: unknown } | null;
      const results = body?.results;
      if (!Array.isArray(results) || results.length === 0 || results.length > LIMITS.resultsPerRequest) {
        return fail(context, 400, "bad-request", `Send { results } with 1 to ${LIMITS.resultsPerRequest} results.`);
      }
      const sent = typeof body?.board === "object" && body.board !== null ? (body.board as Record<string, unknown>) : {};
      const board = boardOf(moduleId, context.req.param("board"), sent);
      if (!board) return fail(context, 404, "unknown-board", "This board isn't live yet.");
      return context.json(leaderboards.submit(account.id, moduleId, board.id, shapeOf(board), results, now()));
    },
  );

  app.get("/:module/boards/:board", (context) => {
    const moduleId = moduleOf(context);
    if (!moduleId) return fail(context, 404, "not-found", "Not found.");
    const board = boardOf(moduleId, context.req.param("board"), context.req.query());
    if (!board) return fail(context, 404, "unknown-board", "This board isn't live yet.");
    const period = context.req.query("period") ?? "all";
    if (!isLeaderboardPeriod(period)) return fail(context, 400, "bad-request", `period is one of ${LEADERBOARD_PERIODS.join(", ")}.`);
    const read = dayOfRead(context);
    if (!read) return fail(context, 400, "bad-request", "day is a day (YYYY-MM-DD) no later than tomorrow.");
    const account = signedIn(context);
    const dev = moduleId.startsWith(DEV_PREFIX);
    const shape = shapeOf(board);
    // Test boards show their developer's own line only; nobody else's, and nothing signed out.
    if (!leaderboards.isAvailable(moduleId, account?.id ?? null) || (dev && !account) || !periodsOf(shape).includes(period)) return context.json({ rows: [] });
    const limit = Number(context.req.query("limit") ?? LIMITS.defaultRows);
    const hidden = new Set(leaderboards.hiddenNames().map((entry) => entry.accountId));
    const { lines, of } = leaderboards.top(moduleId, board.id, shape, {
      limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 1), LIMITS.maxRows) : LIMITS.defaultRows,
      today: read.live,
      viewer: account?.id ?? null,
      ...(dev ? { only: account!.id } : {}),
      skip: accounts.suspendedOrBanned(),
      period,
      key: periodKey(period, read.day),
      minGames: minGamesOf(board),
    });
    const rows = lines.map((line) => {
      const name = boardName(accounts.profileName(line.accountId), hidden.has(line.accountId));
      return {
        rank: line.rank,
        of,
        ...(name === null ? { name: null, label: line.label } : { name }),
        self: line.accountId === account?.id,
        ...numbers(board.kind, line),
      };
    });
    return context.json({ rows });
  });

  // The reader's own standing on each board of a module, in every period. A development copy's Tavora sends its
  // manifest's boards in `boards` (a JSON list of declarations), a catalog module's come from its listing.
  app.get("/:module/mine", (context) => {
    const moduleId = moduleOf(context);
    if (!moduleId) return fail(context, 404, "not-found", "Not found.");
    const read = dayOfRead(context);
    if (!read) return fail(context, 400, "bad-request", "day is a day (YYYY-MM-DD) no later than tomorrow.");
    const dev = moduleId.startsWith(DEV_PREFIX);
    let list: readonly LeaderboardBoard[] = [];
    if (!dev) list = boards(moduleId) ?? [];
    else {
      const text = context.req.query("boards");
      let sent: unknown = [];
      try {
        if (text !== undefined) sent = JSON.parse(text);
      } catch {
        sent = null;
      }
      if (!Array.isArray(sent) || sent.length > LIMITS.maxMineBoards) return fail(context, 400, "bad-request", `boards is a JSON list of at most ${LIMITS.maxMineBoards} board declarations.`);
      list = sent.flatMap((entry) => {
        const declaration = record(entry);
        const board = isLeaderboardId(declaration.id) ? sentBoard(declaration.id, declaration) : null;
        return board ? [board] : [];
      });
    }
    const account = signedIn(context);
    const live = account !== null && leaderboards.isAvailable(moduleId, account.id);
    const skip = live ? accounts.suspendedOrBanned() : new Set<string>();
    return context.json({
      boards: list.map((board) => {
        const shape = shapeOf(board);
        const periods = Object.fromEntries(
          LEADERBOARD_PERIODS.map((period) => {
            const line =
              live && periodsOf(shape).includes(period)
                ? leaderboards.standing(account.id, moduleId, board.id, shape, { period, key: periodKey(period, read.day), today: read.live, only: dev, skip, minGames: minGamesOf(board) })
                : null;
            return [period, line ? { rank: line.rank, of: line.of, ...numbers(board.kind, line) } : null];
          }),
        );
        return { id: board.id, periods };
      }),
    });
  });

  return app;
}

/**
 * Tavora Admin's leaderboard routes, under `/api/leaderboards` of the admin app (the token check there covers them):
 * which catalog modules may use leaderboards, and the names hidden on every board.
 */
export function leaderboardsAdminRoutes({ leaderboards, accounts, now = Date.now }: { leaderboards: LeaderboardStore; accounts: AccountStore; now?: (() => number) | undefined }) {
  const app = new Hono();
  const json = async (request: Request): Promise<Record<string, unknown>> => {
    try {
      const body = JSON.parse(await request.text()) as unknown;
      return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const iso = (at: number) => new Date(at).toISOString();

  app.get("/modules", (context) => context.json({ modules: leaderboards.allowedModules().map((entry) => ({ id: entry.moduleId, allowedAt: iso(entry.allowedAt) })) }));
  // { id, allowed }: allows a catalog module's leaderboards or stops them. Development copies (local.*) need none.
  app.post("/modules", async (context) => {
    const body = await json(context.req.raw);
    if (!isModuleId(body.id) || body.id.startsWith(DEV_PREFIX) || typeof body.allowed !== "boolean") return context.json({ error: "Send { id, allowed } for a catalog module." }, 400);
    return context.json({ changed: leaderboards.setAllowed(body.id, body.allowed, now()) });
  });

  // The names users show on boards (accounts left off for a suspension or ban are not listed), with what the boards do with each:
  // shown, held back by the word filter, or hidden by the maintainer. ?q= searches the profile name; at most 200 come back.
  app.get("/names", (context) => {
    const needle = (context.req.query("q") ?? "").trim().toLowerCase();
    const hidden = new Set(leaderboards.hiddenNames().map((entry) => entry.accountId));
    const left = accounts.suspendedOrBanned();
    const names = leaderboards.shownAccounts().flatMap((entry) => {
      const name = accounts.profileName(entry.accountId)?.trim() ?? "";
      if (!name || left.has(entry.accountId) || (needle && !name.toLowerCase().includes(needle))) return [];
      const state = hidden.has(entry.accountId) ? "hidden" : boardName(name, false) === null ? "filtered" : "shown";
      return [{ accountId: entry.accountId, name, state, modules: entry.modules, since: iso(entry.since) }];
    });
    const count = (state: string) => names.filter((entry) => entry.state === state).length;
    return context.json({ names: names.slice(0, 200), counts: { all: names.length, filtered: count("filtered"), hidden: count("hidden") } });
  });

  app.get("/hidden-names", (context) =>
    context.json({
      names: leaderboards.hiddenNames().map((entry) => ({ accountId: entry.accountId, name: accounts.profileName(entry.accountId), hiddenAt: iso(entry.hiddenAt) })),
    }),
  );
  // { accountId, hidden }: hides an account's profile name on every board (its pseudonym shows), or shows it again.
  app.post("/hidden-names", async (context) => {
    const body = await json(context.req.raw);
    if (typeof body.accountId !== "string" || typeof body.hidden !== "boolean") return context.json({ error: "Send { accountId, hidden }." }, 400);
    if (!accounts.account(body.accountId)) return context.json({ error: "Not found." }, 404);
    return context.json({ changed: leaderboards.setNameHidden(body.accountId, body.hidden, now()) });
  });

  return app;
}
