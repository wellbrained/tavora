import { DatabaseSync } from "node:sqlite";
import { isLeaderboardId, isModuleId, type LeaderboardBoard } from "@tavora/module-schema";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Account, AccountStore } from "./account-store.ts";
import { newLabel } from "./conversations.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { checkReviewText } from "./review-filter.ts";

/**
 * Leaderboards (decided 2026-10-28, "Puzzle games: leaderboards and names"): a host feature any module can use. A module
 * declares its boards in its manifest; Tavora sends what the user played, through the user's account, and reads the
 * boards back. Two kinds:
 *
 * - `streak`: won and lost results. A user's line has their current and best winning streak, ranked by the best, then
 *   the current one. On a `daily` board each result belongs to a calendar day, one per day, and a missed day ends the
 *   streak. A daily result counts only when it ended within its day as some time zone on earth saw it (dayWindow), so
 *   replaying an old puzzle from an archive never counts.
 * - `score`: one number per result. A user's line has their best, the highest or the lowest by the board's `order`.
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
  /** A score's size, either way. */
  maxValue: 1e12,
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
/** Module ids of development copies (module-schema's LOCAL_OWNER): test boards, no allowing needed. */
export const DEV_PREFIX = "local.";

export type Rejection = "invalid" | "time" | "archive" | "day-taken" | "full";

/** How a board works out its lines; a standing worked out another way (the declaration changed) is not shown. */
export type Shape = "streak" | "streak-daily" | "score-high" | "score-low";

export const shapeOf = (board: LeaderboardBoard): Shape =>
  board.kind === "streak" ? (board.daily ? "streak-daily" : "streak") : board.order === "low" ? "score-low" : "score-high";

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
 * in the latest one (UTC−12). A daily result outside it was played on another day: from an archive.
 */
export function dayWindow(day: string): { from: number; to: number } {
  const start = dayStart(day);
  return { from: start - 14 * HOUR, to: start + DAY + 12 * HOUR };
}

export interface Played {
  id: string;
  outcome: "won" | "lost";
  at: number;
  day: string | null;
}

/** A result as it is kept: `outcome` and `day` for streaks, `value` for scores. */
interface Checked {
  id: string;
  at: number;
  outcome: "won" | "lost" | null;
  value: number | null;
  day: string | null;
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
  const streak = shape === "streak" || shape === "streak-daily";
  if (streak && raw.outcome !== "won" && raw.outcome !== "lost") return { id, reason: "invalid" };
  if (!streak && (typeof raw.value !== "number" || !Number.isFinite(raw.value) || Math.abs(raw.value) > LIMITS.maxValue)) return { id, reason: "invalid" };
  if (shape === "streak-daily" && !isDay(raw.day)) return { id, reason: "invalid" };
  if (at > now + LIMITS.futureMs || at < now - LIMITS.oldestMs) return { id, reason: "time" };
  const day = shape === "streak-daily" ? (raw.day as string) : null;
  if (day !== null) {
    const window = dayWindow(day);
    if (at < window.from || at >= window.to) return { id, reason: "archive" };
  }
  return {
    ok: {
      id: id.toLowerCase(),
      at,
      outcome: streak ? (raw.outcome as "won" | "lost") : null,
      value: streak ? null : (raw.value as number),
      day,
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
  best: number;
  /** Streak boards: the current streak, 0 once it ended. */
  current: number | null;
}

interface StandingSql {
  account_id: string;
  label: string;
  best: number;
  current: number;
  last_day: string | null;
}

/** The leaderboards: members, results, standings, allowed modules and hidden names, in `leaderboards.sqlite` of the state directory. */
export class LeaderboardStore {
  private readonly db: DatabaseSync;
  /** Results kept per account and module (LIMITS.storedResults; tests use fewer). */
  private readonly storedResults: number;

  constructor(path: string, storedResults = LIMITS.storedResults) {
    this.storedResults = storedResults;
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma journal_mode = wal;
      pragma foreign_keys = on;
      -- One row per account and module once the account asked: its pseudonym label, and when it agreed to be shown (null: not shown).
      create table if not exists members (
        account_id text not null, module_id text not null, label text not null, shown_at integer,
        primary key (account_id, module_id)
      );
      create table if not exists results (
        account_id text not null, module_id text not null, board text not null, id text not null,
        outcome text, value real, day text, at integer not null,
        primary key (account_id, module_id, board, id)
      );
      create unique index if not exists results_day on results (account_id, module_id, board, day) where day is not null;
      -- Each account's line on a board, worked out from its results when they change.
      create table if not exists standings (
        account_id text not null, module_id text not null, board text not null, shape text not null,
        best real not null, reached_at integer not null, current integer not null, last_day text,
        primary key (account_id, module_id, board)
      );
      create index if not exists standings_board on standings (module_id, board, shape);
      create table if not exists allowed_modules (module_id text primary key, allowed_at integer not null);
      create table if not exists hidden_names (account_id text primary key, hidden_at integer not null);
    `);
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
   * Keeps the results of a shown member on one board, each on its own, and works out the account's line again. A
   * result id the board has already counts as taken, whatever it holds now, so sending again is safe.
   */
  submit(accountId: string, moduleId: string, board: string, shape: Shape, input: readonly unknown[], now: number): { accepted: string[]; rejected: { id: string; reason: Rejection }[] } {
    const accepted: string[] = [];
    const rejected: { id: string; reason: Rejection }[] = [];
    const has = this.db.prepare("select 1 from results where account_id = ? and module_id = ? and board = ? and id = ?");
    const dayTaken = this.db.prepare("select 1 from results where account_id = ? and module_id = ? and board = ? and day = ?");
    const insert = this.db.prepare("insert into results (account_id, module_id, board, id, outcome, value, day, at) values (?, ?, ?, ?, ?, ?, ?, ?)");
    let stored = (this.db.prepare("select count(*) as n from results where account_id = ? and module_id = ?").get(accountId, moduleId) as { n: number }).n;
    let changed = false;
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
        if (stored >= this.storedResults) rejected.push({ id: sent, reason: "full" });
        else if (result.day !== null && dayTaken.get(accountId, moduleId, board, result.day)) rejected.push({ id: sent, reason: "day-taken" });
        else {
          insert.run(accountId, moduleId, board, result.id, result.outcome, result.value, result.day, result.at);
          stored++;
          changed = true;
          accepted.push(sent);
        }
      }
      const standing = this.db.prepare("select shape from standings where account_id = ? and module_id = ? and board = ?").get(accountId, moduleId, board) as { shape: string } | undefined;
      if (changed || (standing && standing.shape !== shape)) this.workOut(accountId, moduleId, board, shape);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return { accepted, rejected };
  }

  /** The account's line on a board from all its results there. */
  private workOut(accountId: string, moduleId: string, board: string, shape: Shape): void {
    let line: { best: number; reachedAt: number; current: number; lastDay: string | null } | null = null;
    if (shape === "streak" || shape === "streak-daily") {
      const results = this.db
        .prepare("select id, outcome, at, day from results where account_id = ? and module_id = ? and board = ? and outcome is not null")
        .all(accountId, moduleId, board) as unknown as Played[];
      const daily = shape === "streak-daily";
      if (results.length > 0) line = streakOf(daily ? results.filter((result) => result.day !== null) : results, daily);
    } else {
      const row = this.db
        .prepare(`select value, at from results where account_id = ? and module_id = ? and board = ? and value is not null order by value ${shape === "score-low" ? "asc" : "desc"}, at asc limit 1`)
        .get(accountId, moduleId, board) as { value: number; at: number } | undefined;
      if (row) line = { best: row.value, reachedAt: row.at, current: 0, lastDay: null };
    }
    if (!line) {
      this.db.prepare("delete from standings where account_id = ? and module_id = ? and board = ?").run(accountId, moduleId, board);
      return;
    }
    this.db
      .prepare(
        `insert into standings (account_id, module_id, board, shape, best, reached_at, current, last_day) values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (account_id, module_id, board) do update set shape = excluded.shape, best = excluded.best, reached_at = excluded.reached_at, current = excluded.current, last_day = excluded.last_day`,
      )
      .run(accountId, moduleId, board, shape, line.best, line.reachedAt, line.current, line.lastDay);
  }

  /**
   * The best lines of a board, ranked (equal lines share a rank), leaving out `skip` (suspended and banned accounts).
   * With `viewer` on the board further down, their line comes last. `only` keeps one account's line alone (test
   * boards). `today` decides which daily streaks still run.
   */
  top(moduleId: string, board: string, shape: Shape, options: { limit: number; today: string; viewer: string | null; only?: string; skip: ReadonlySet<string> }): BoardLine[] {
    const streak = shape === "streak" || shape === "streak-daily";
    // A daily streak whose last day is before yesterday has ended: it counts as 0 for the order too.
    const live = shape === "streak-daily" ? "case when s.last_day >= ? then s.current else 0 end" : "s.current";
    const order = streak ? `s.best desc, live desc, s.reached_at asc` : `s.best ${shape === "score-low" ? "asc" : "desc"}, s.reached_at asc`;
    const params: (string | number)[] = [];
    if (shape === "streak-daily") params.push(dayBefore(options.today));
    params.push(moduleId, board, shape);
    if (options.only) params.push(options.only);
    const rows = this.db
      .prepare(
        `select s.account_id, m.label, s.best, ${live} as live, s.last_day from standings s
         join members m on m.account_id = s.account_id and m.module_id = s.module_id and m.shown_at is not null
         where s.module_id = ? and s.board = ? and s.shape = ?${options.only ? " and s.account_id = ?" : ""}
         order by ${order}, s.account_id limit ${LIMITS.scanRows}`,
      )
      .iterate(...params) as Iterable<Omit<StandingSql, "current"> & { live: number }>;
    const lines: BoardLine[] = [];
    let place = 0;
    let rank = 0;
    let previous: string | null = null;
    let viewerSeen = options.viewer === null;
    for (const row of rows) {
      if (options.skip.has(row.account_id)) continue;
      place++;
      const key = streak ? `${row.best}:${row.live}` : String(row.best);
      if (key !== previous) rank = place;
      previous = key;
      const mine = row.account_id === options.viewer;
      if (lines.length < options.limit || mine) {
        lines.push({ accountId: row.account_id, rank, label: row.label, best: row.best, current: streak ? row.live : null });
        if (mine) viewerSeen = true;
      }
      if (lines.length >= options.limit && viewerSeen) break;
    }
    return lines;
  }
}

type Env = { Variables: { account: Account | null } };

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
  if (input.kind === "streak") return { id, kind: "streak", daily: input.daily === true || input.daily === "1" };
  if (input.kind === "score") return input.order === "low" ? { id, kind: "score", order: "low" } : { id, kind: "score" };
  return null;
}

/**
 * The leaderboard routes under /v1/leaderboards. Reading a board and the status need no sign-in (signed in, they know
 * which line is the reader's); everything else does. Errors carry a `reason` the app reads.
 */
export function leaderboardRoutes({ leaderboards, accounts, boards, clientKey, writeRateLimiter, readRateLimiter, now = Date.now }: LeaderboardOptions) {
  const writeLimiter = writeRateLimiter ?? createRateLimiter({ limit: 60, windowMs: 60_000 });
  const readLimiter = readRateLimiter ?? createRateLimiter({ limit: 120, windowMs: 60_000 });
  const app = new Hono<Env>();
  const fail = (context: Context, status: 400 | 401 | 403 | 404 | 429, reason: string, error: string) => context.json({ error, reason }, status);

  // Who asks: a valid sign-in, nobody, or a sign-in the service no longer knows (401, so the app forgets it).
  app.use("*", async (context, next) => {
    const wait = readLimiter.check(clientKey(context.req.raw));
    if (wait > 0) {
      context.header("Retry-After", String(wait));
      return fail(context, 429, "too-many", "Too many requests.");
    }
    const header = context.req.header("authorization");
    if (header === undefined) context.set("account", null);
    else {
      const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header);
      const session = match ? accounts.sessionByToken(match[1]!, now()) : null;
      const account = session ? accounts.account(session.accountId) : null;
      if (!account) return fail(context, 401, "signed-out", "Sign in again.");
      context.set("account", account);
    }
    context.header("Cache-Control", "no-store");
    await next();
  });

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
  const writeAllowed = (context: Context<Env>, accountId: string, moduleId: string) => {
    const wait = writeLimiter.check(`${accountId}:${moduleId}`);
    if (wait > 0) context.header("Retry-After", String(wait));
    return wait === 0;
  };
  /** A signed-in user's status; a module without boards makes no member, so nobody fills the file with made-up ids. */
  const status = (accountId: string, moduleId: string) => {
    const name = boardName(accounts.profileName(accountId), leaderboards.isNameHidden(accountId));
    if (!leaderboards.isAvailable(moduleId, accountId)) return { available: false, shown: false, name, label: null };
    const member = leaderboards.member(accountId, moduleId);
    return { available: true, shown: member.shown, name, label: member.label };
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
    if (!account) return fail(context, 401, "signed-out", "Sign in to show your results.");
    if (!leaderboards.isAvailable(moduleId, account.id)) return fail(context, 403, "not-allowed", "This module has no leaderboards yet.");
    if (!writeAllowed(context, account.id, moduleId)) return fail(context, 429, "too-many", "Too many requests.");
    leaderboards.show(account.id, moduleId, now());
    return context.json(status(account.id, moduleId));
  });

  app.delete("/:module/shown", (context) => {
    const moduleId = moduleOf(context);
    const account = signedIn(context);
    if (!moduleId) return fail(context, 404, "not-found", "Not found.");
    if (!account) return fail(context, 401, "signed-out", "Sign in first.");
    if (!writeAllowed(context, account.id, moduleId)) return fail(context, 429, "too-many", "Too many requests.");
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
      if (!account) return fail(context, 401, "signed-out", "Sign in to send results.");
      if (!leaderboards.isAvailable(moduleId, account.id)) return fail(context, 403, "not-allowed", "This module has no leaderboards yet.");
      if (!leaderboards.member(account.id, moduleId).shown) return fail(context, 403, "not-shown", "Show your results first.");
      if (!writeAllowed(context, account.id, moduleId)) return fail(context, 429, "too-many", "Too many requests.");
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
    const account = signedIn(context);
    const dev = moduleId.startsWith(DEV_PREFIX);
    // Test boards show their developer's own line only; nobody else's, and nothing signed out.
    if (!leaderboards.isAvailable(moduleId, account?.id ?? null) || (dev && !account)) return context.json({ rows: [] });
    const limit = Number(context.req.query("limit") ?? LIMITS.defaultRows);
    const asked = context.req.query("day");
    const today = dayOf(now());
    // The reader's own day, within a day of the server's (time zones); anything else reads as today.
    const day = isDay(asked) && Math.abs(dayStart(asked) - dayStart(today)) <= DAY ? asked : today;
    const hidden = new Set(leaderboards.hiddenNames().map((entry) => entry.accountId));
    const lines = leaderboards.top(moduleId, board.id, shapeOf(board), {
      limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 1), LIMITS.maxRows) : LIMITS.defaultRows,
      today: day,
      viewer: account?.id ?? null,
      ...(dev ? { only: account!.id } : {}),
      skip: accounts.suspendedOrBanned(),
    });
    const rows = lines.map((line) => {
      const name = boardName(accounts.profileName(line.accountId), hidden.has(line.accountId));
      const self = line.accountId === account?.id;
      return {
        rank: line.rank,
        ...(name === null ? { name: null, label: line.label } : { name }),
        self,
        ...(board.kind === "streak" ? { current: line.current, best: line.best } : { value: line.best }),
      };
    });
    return context.json({ rows });
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
