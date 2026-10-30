// The run store: the played games of a daily-puzzle module (a "run" is one played game).
//
// Runs live in `storage.app`, shared by every workspace and panel. Every change to a run is a compare-and-set on its
// own key, so a move made in one panel is never overwritten by another panel showing the same run. The parts that
// differ per game (how a run is checked, how keys are grouped, which runs still wait for a leaderboard) are options.
// Client-side state only (see ADR-0002).

import { TavoraError, type JsonValue, type TavoraSDK } from "./index.js";
import { MAX_SAVE_ATTEMPTS } from "./store.js";

export type RunMode = "daily" | "unlimited";
export type RunOutcome = "playing" | "won" | "lost";

/** What the run store needs to know about a run; a game's own run type adds the rest. */
export interface RunBase {
  id: string;
  mode: RunMode;
  /** The calendar day of a daily puzzle; for an unlimited game, the day it started. */
  date: string;
  ranked: boolean;
  startedAt: number;
  /** When a ranked unlimited game is lost on time; null without a countdown. */
  deadline: number | null;
  status: RunOutcome;
  finishedAt: number | null;
  /** How a ranked game counts on the leaderboard. Set once, when it ends or turns casual. */
  rankedOutcome: "won" | "lost" | null;
  rankedAt: number | null;
}

export interface RunStatistics {
  played: number;
  wins: number;
  current: number;
  best: number;
}

/** Unlimited games folded into numbers, so old games don't fill the storage: everything that ended up to `through`. */
export interface RunSummary extends RunStatistics {
  through: number;
}

/** The storage keys of a run store. `group` is the game's own split of runs, such as a difficulty; "" for none. */
export interface RunKeys {
  daily(date: string, group: string): string;
  run(id: string): string;
  /** The unlimited run being played now in a group, if any. */
  active(group: string): string;
  summary(group: string): string;
  /** Keys that start with one of these hold runs. */
  prefixes: readonly string[];
}

/** `daily:<date>[:<group>]`, `run:<id>`, `unlimited:active[:<group>]`, `unlimited:summary[:<group>]`. */
export const defaultRunKeys: RunKeys = {
  daily: (date, group) => (group ? `daily:${date}:${group}` : `daily:${date}`),
  run: (id) => `run:${id}`,
  active: (group) => (group ? `unlimited:active:${group}` : "unlimited:active"),
  summary: (group) => (group ? `unlimited:summary:${group}` : "unlimited:summary"),
  prefixes: ["daily:", "run:"],
};

/** Finished unlimited runs kept one by one per group; older ones are folded into the summary. */
export const KEEP_RUNS = 100;

export interface OpenRunsOptions<R extends RunBase> {
  /** Whether stored data is a run of this game. Anything else is left out of `runs`. */
  validate(value: unknown): value is R;
  /** Whether a finished run still waits to be sent to a leaderboard. Such a run is never folded away. */
  awaitsUpload(run: R): boolean;
  /** Default `defaultRunKeys`. */
  keys?: Partial<RunKeys>;
  /** The groups to keep a summary for, such as the difficulties. Default: one group, "". */
  groups?: readonly string[];
  /** The group a run belongs to. Default: "". */
  groupOf?(run: R): string;
  /** Finished unlimited runs kept per group. Default `KEEP_RUNS`. */
  keep?: number;
  /** The clock. Default `Date.now`. */
  now?: () => number;
}

export interface RunStoreHandle<R extends RunBase> {
  /** The runs as last read or saved by this panel. Replaced, never mutated, by every change. */
  readonly runs: readonly R[];
  readonly summaries: Readonly<Record<string, RunSummary>>;
  /** Reads every run and summary from storage. */
  load(): Promise<{ runs: readonly R[]; summaries: Readonly<Record<string, RunSummary>> }>;
  /**
   * Saves a new run. A daily run that another panel started first for the same day and group is returned instead; an
   * unlimited run is not started while one is still being played in its group: that one is returned.
   */
  start(run: R): Promise<R>;
  /**
   * Changes a saved run and returns it as saved; null when it is gone. `edit` is applied to the newest copy, again after
   * a conflict (5 attempts, then CONFLICT). A ranked run whose time is up ends first and takes no other change, so a move
   * after the deadline never counts.
   */
  change(run: R | string, edit: (run: R) => void): Promise<R | null>;
  /** Ends a run that is still going. */
  finish(run: R | string, status: "won" | "lost"): Promise<R | null>;
  /** Ends a ranked run whose time is up. Any `change` does this too. */
  expire(run: R | string): Promise<R | null>;
  /** Turns a ranked run casual: it counts as a lost ranked run, and the rest is played without a countdown. */
  makeCasual(run: R | string): Promise<R | null>;
  /**
   * Folds the oldest finished unlimited runs into each group's summary once more than `keep` are saved. A run that
   * `awaitsUpload` stays, and nothing after it is folded, so streaks keep their order. When another panel folds at the
   * same time, this one leaves it.
   */
  fold(): Promise<void>;
  /** The numbers of one mode and group, from `runs` and the group's summary. */
  statistics(mode: RunMode, group: string, today: string): RunStatistics;
  onChange(fn: (runs: readonly R[]) => void): () => void;
  dispose(): void;
}

// ── Dates ────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The calendar day in this PC's time zone, as YYYY-MM-DD. A new daily puzzle starts at local midnight. */
export function localDate(at: Date | number = new Date()): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** How long until the next local midnight, when the next daily puzzle comes. */
export function msUntilMidnight(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - at;
}

/** The calendar day before `date` (YYYY-MM-DD). */
export function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** A daily puzzle counts for the daily streak only when it was finished on its own day, not later from the archive. */
export function onItsDay(run: Pick<RunBase, "finishedAt" | "date">): boolean {
  return run.finishedAt !== null && localDate(run.finishedAt) === run.date;
}

// ── Rules ────────────────────────────────────────────────────────────

/** Ends a run that is still going. A ranked run keeps its result for the leaderboard. */
export function finishRun(run: RunBase, status: "won" | "lost", now = Date.now()): void {
  if (run.status !== "playing") return;
  run.status = status;
  run.finishedAt = now;
  if (run.ranked && run.rankedOutcome === null) {
    run.rankedOutcome = status;
    run.rankedAt = now;
  }
}

/** A ranked run whose time ran out is lost, at the moment the time ran out. True when it ended now. */
export function expireRun(run: RunBase, now = Date.now()): boolean {
  if (run.status !== "playing" || run.deadline === null || now < run.deadline) return false;
  finishRun(run, "lost", run.deadline);
  return true;
}

/** Turns a ranked run casual: it counts as a lost ranked run, and the rest is played without a countdown. */
export function makeRunCasual(run: RunBase, now = Date.now()): void {
  if (run.status !== "playing" || !run.ranked) return;
  run.rankedOutcome = "lost";
  run.rankedAt = now;
  run.ranked = false;
  run.deadline = null;
}

/**
 * Played, won and the winning streaks of one mode and group, from every finished run. Daily: consecutive days won,
 * broken by a lost or missed day; today's unplayed puzzle doesn't break it yet. Unlimited: consecutive wins, broken by
 * a loss, continuing from the summary of older runs.
 */
export function runStatistics<R extends RunBase>(runs: readonly R[], mode: RunMode, today: string, summary: RunSummary | null = null, inGroup: (run: R) => boolean = () => true): RunStatistics {
  const base = mode === "unlimited" ? summary : null;
  const finished = runs.filter((run) => run.mode === mode && inGroup(run) && run.status !== "playing" && (!base || run.finishedAt! > base.through));
  const wins = finished.filter((run) => run.status === "won").length + (base?.wins ?? 0);
  let current = base?.current ?? 0;
  let best = base?.best ?? 0;
  if (mode === "daily") {
    let last: string | null = null;
    for (const run of finished.filter(onItsDay).sort((a, b) => a.date.localeCompare(b.date))) {
      if (last !== null && previousDate(run.date) !== last) current = 0;
      current = run.status === "won" ? current + 1 : 0;
      best = Math.max(best, current);
      last = run.date;
    }
    if (last !== today && last !== previousDate(today)) current = 0;
  } else {
    for (const run of [...finished].sort((a, b) => a.finishedAt! - b.finishedAt!)) {
      current = run.status === "won" ? current + 1 : 0;
      best = Math.max(best, current);
    }
  }
  return { played: finished.length + (base?.played ?? 0), wins, current, best };
}

// ── The store ────────────────────────────────────────────────────────

const plain = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));

function isSummary(value: unknown): value is RunSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<RunSummary>;
  return [summary.played, summary.wins, summary.current, summary.best, summary.through].every((n) => typeof n === "number");
}

export function openRuns<R extends RunBase>(sdk: TavoraSDK, options: OpenRunsOptions<R>): RunStoreHandle<R> {
  const { validate, awaitsUpload } = options;
  const keys: RunKeys = { ...defaultRunKeys, ...options.keys };
  const groups = options.groups ?? [""];
  const groupOf = options.groupOf ?? (() => "");
  const keep = options.keep ?? KEEP_RUNS;
  const now = options.now ?? Date.now;
  const store = sdk.storage.app;

  let runs: readonly R[] = [];
  let summaries: Record<string, RunSummary> = {};
  const listeners = new Set<(runs: readonly R[]) => void>();

  const keyOf = (run: R) => (run.mode === "daily" ? keys.daily(run.date, groupOf(run)) : keys.run(run.id));
  const conflict = (what: string) => new TavoraError({ code: "CONFLICT", message: `${what} keeps changing in another panel` });

  function emit() {
    for (const fn of [...listeners]) {
      try {
        fn(runs);
      } catch (error) {
        console.error("[tavora] run listener failed", error);
      }
    }
  }

  function remember(run: R) {
    runs = runs.some((known) => known.id === run.id) ? runs.map((known) => (known.id === run.id ? run : known)) : [...runs, run];
  }

  const find = (target: R | string): R | undefined => (typeof target === "string" ? runs.find((run) => run.id === target) : target);

  async function load() {
    const found = (await store.keys()).filter((key) => keys.prefixes.some((prefix) => key.startsWith(prefix)));
    const values: unknown[] = await Promise.all(found.map((key) => store.get(key)));
    runs = values.filter(validate);
    const next: Record<string, RunSummary> = {};
    for (const group of groups) {
      const value = await store.get(keys.summary(group));
      if (isSummary(value)) next[group] = value;
    }
    summaries = next;
    emit();
    return { runs, summaries };
  }

  async function change(target: R | string, edit: (run: R) => void): Promise<R | null> {
    const known = find(target);
    if (!known) return null;
    const key = keyOf(known);
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
      const before = await store.get(key);
      if (!validate(before)) {
        runs = runs.filter((run) => run.id !== known.id);
        emit();
        return null;
      }
      const next: R = structuredClone(before);
      if (!expireRun(next, now())) edit(next);
      if (JSON.stringify(next) === JSON.stringify(before) || (await store.compareAndSet(key, plain(before), plain(next)))) {
        remember(next);
        emit();
        return next;
      }
    }
    throw conflict("this run");
  }

  async function startDaily(run: R): Promise<R> {
    const key = keyOf(run);
    if (await store.compareAndSet(key, null, plain(run))) return run;
    const existing = await store.get(key);
    if (!validate(existing)) throw conflict("this day");
    return existing;
  }

  async function startUnlimited(run: R): Promise<R> {
    const slot = keys.active(groupOf(run));
    const active = await store.get(slot);
    if (typeof active === "string") {
      const current = await store.get(keys.run(active));
      if (validate(current) && current.status === "playing") return current;
    }
    await store.set(keys.run(run.id), plain(run));
    if (await store.compareAndSet(slot, active ?? null, run.id)) return run;
    await store.delete(keys.run(run.id));
    throw conflict("the running game");
  }

  async function foldGroup(group: string) {
    const summary = summaries[group] ?? null;
    const finished = runs
      .filter((run) => run.mode === "unlimited" && groupOf(run) === group && run.status !== "playing" && (!summary || run.finishedAt! > summary.through))
      .sort((a, b) => a.finishedAt! - b.finishedAt!);
    const old: R[] = [];
    for (const run of finished.slice(0, Math.max(0, finished.length - keep))) {
      if (awaitsUpload(run)) break;
      old.push(run);
    }
    if (!old.length) return;
    const next: RunSummary = { ...runStatistics(old, "unlimited", "", summary, (run) => groupOf(run) === group), through: old.at(-1)!.finishedAt! };
    if (!(await store.compareAndSet(keys.summary(group), summary ? plain(summary) : null, plain(next)))) return;
    for (const run of old) await store.delete(keys.run(run.id));
    summaries = { ...summaries, [group]: next };
    runs = runs.filter((run) => !old.includes(run));
  }

  const handle: RunStoreHandle<R> = {
    get runs() {
      return runs;
    },
    get summaries() {
      return summaries;
    },
    load,
    async start(run) {
      const saved = run.mode === "daily" ? await startDaily(run) : await startUnlimited(run);
      remember(saved);
      emit();
      return saved;
    },
    change,
    finish: (run, status) => change(run, (saved) => finishRun(saved, status, now())),
    expire: (run) => change(run, () => {}),
    makeCasual: (run) => change(run, (saved) => makeRunCasual(saved, now())),
    async fold() {
      for (const group of groups) await foldGroup(group);
      emit();
    },
    statistics: (mode, group, today) => runStatistics(runs, mode, today, summaries[group] ?? null, (run) => groupOf(run) === group),
    onChange(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    dispose() {
      listeners.clear();
    },
  };
  return handle;
}
