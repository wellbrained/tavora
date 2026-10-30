// The result queue: finished games waiting for a leaderboard.
//
// A result is kept in `storage.app` the moment it is recorded, sent in batches once the user is signed in and agreed,
// and kept and retried while Tavora's service is away. Two panels of a module share one queue and never lose a result.
// Client-side state only; the host still checks every result (see ADR-0002).

import { LIMITS, TavoraError, type LeaderboardMine, type LeaderboardResult, type LeaderboardRow, type LeaderboardStatus, type TavoraSDK } from "./index.js";
import type { JsonValue } from "./index.js";

/** Where the queue is: `idle` (nothing waits, or all sent), `sending`, `offline` (Tavora's service can't be reached),
 * `waiting` (signed out, not agreed yet, or the boards aren't live), `denied` (the user didn't allow the leaderboard connector),
 * `unsupported` (this Tavora has no leaderboards), `failed` (something unexpected; retried later). */
export type ResultsState = "idle" | "sending" | "offline" | "waiting" | "denied" | "unsupported" | "failed";

export interface OpenResultsOptions {
  /** The boards this queue sends to. Default: every board that has results in storage (and any you record to). */
  boards?: readonly string[];
  /** Storage key prefix; each board keeps its results under `<key>:<board>`. Default `"leaderboard-queue"`. */
  key?: string;
  /** How often to ask whether the user signed in and agreed while results wait for that, in ms. Default 60 000. */
  pollMs?: number;
}

export interface ResultsHandle {
  /** Results not sent yet, over all boards. Follows this panel's own changes and every flush. */
  readonly pending: number;
  readonly status: ResultsState;
  /** The error behind `status` `"failed"`, else null. */
  readonly error: unknown;
  /** Whether a result with this id still waits to be sent. */
  has(id: string): boolean;
  /**
   * Keeps `result` in `storage.app` at once, then sends in the background. Recording an id that already waits changes
   * nothing. Rejects only when the result cannot be stored (quota, CONFLICT after several tries).
   */
  record(board: string, result: LeaderboardResult): Promise<void>;
  /** Tries to send what waits now and resolves when this try is over. Never rejects: see `status`. */
  flush(): Promise<void>;
  /**
   * Called after results were taken, with the user's standing on every board (`leaderboards.mine`). Not called on a
   * Tavora older than 0.21.97, which has no `mine`.
   */
  onStanding(fn: (standing: LeaderboardMine) => void): () => void;
  onStatus(fn: (status: ResultsState) => void): () => void;
  /** Stops retrying and listening. What is stored stays for the next panel. */
  dispose(): void;
}

/** Most results Tavora takes in one submit. */
export const RESULT_BATCH = LIMITS.maxLeaderboardResults;

const DEFAULT_KEY = "leaderboard-queue";
const DEFAULT_POLL_MS = 60_000;
/** Tries to store a result when other panels keep writing first: a lost result is worse than a lost edit, so many. */
const ATTEMPTS = 20;

/** Tavora's service says it can't be reached with `online: false`; Tavora 0.21.92 has no `online` field at all, which means it can. */
export const isOffline = (status: { online?: boolean }): boolean => status.online === false;

/** The lines of a board: Tavora 0.21.92 answers `top` with the bare list, later versions with `{ rows }`. */
export const rowsOf = (answer: unknown): LeaderboardRow[] => (Array.isArray(answer) ? answer : ((answer as { rows?: LeaderboardRow[] } | null)?.rows ?? []));

/** How long to wait before trying again after `failures` failed sends in a row: 1 minute, doubling, at most 30. */
export function retryDelay(failures: number): number {
  return Math.min(30, 2 ** Math.max(0, failures - 1)) * 60_000;
}

const codeOf = (error: unknown) => (error instanceof TavoraError ? error.code : null);

const isResult = (value: unknown): value is LeaderboardResult => {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<LeaderboardResult> & { outcome?: unknown; value?: unknown };
  return typeof result.id === "string" && typeof result.at === "number" && (typeof result.outcome === "string" || typeof result.value === "number");
};

const listOf = (raw: unknown): LeaderboardResult[] => (Array.isArray(raw) ? raw.filter(isResult) : []);

export function openResults(sdk: TavoraSDK, options: OpenResultsOptions = {}): Promise<ResultsHandle> {
  const prefix = `${options.key ?? DEFAULT_KEY}:`;
  const fixed = options.boards ? new Set(options.boards) : null;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const store = sdk.storage.app;

  /** What waits, per board: a mirror of storage, refreshed by every flush. */
  let waiting = new Map<string, LeaderboardResult[]>();
  let state: ResultsState = "idle";
  let error: unknown = null;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let inflight: Promise<void> | null = null;
  let again = false;

  const standingListeners = new Set<(standing: LeaderboardMine) => void>();
  const statusListeners = new Set<(status: ResultsState) => void>();
  const notify = <A extends unknown[]>(listeners: Set<(...args: A) => void>, ...args: A) => {
    for (const fn of [...listeners]) {
      try {
        fn(...args);
      } catch (cause) {
        console.error("[tavora] result queue listener failed", cause);
      }
    }
  };

  const keyOf = (board: string) => `${prefix}${board}`;
  const count = () => [...waiting.values()].reduce((sum, list) => sum + list.length, 0);

  function setState(next: ResultsState, cause: unknown = null) {
    error = cause;
    if (next === state) return;
    state = next;
    notify(statusListeners, state);
  }

  async function read(board: string): Promise<LeaderboardResult[]> {
    const raw = await store.get(keyOf(board));
    return listOf(raw);
  }

  /** Reads every board of the queue from storage into the mirror. */
  async function refresh() {
    const boards = fixed ? [...fixed] : (await store.keys()).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    const next = new Map<string, LeaderboardResult[]>();
    for (const board of boards) {
      const list = await read(board);
      if (list.length) next.set(board, list);
    }
    waiting = next;
  }

  /** Writes `edit(list)` for a board against the newest stored list, again when another panel wrote first. */
  async function change(board: string, edit: (list: LeaderboardResult[]) => LeaderboardResult[]): Promise<void> {
    const key = keyOf(board);
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const before = await store.get(key);
      const list = listOf(before);
      const next = edit(list);
      const done = (!Array.isArray(before) && !next.length) || (await store.compareAndSet(key, before, next as unknown as JsonValue));
      if (done) {
        if (next.length) waiting.set(board, next);
        else waiting.delete(board);
        return;
      }
    }
    throw new TavoraError({ code: "CONFLICT", message: `the result queue for ${board} keeps changing` });
  }

  const drop = (board: string, ids: readonly string[]) => (ids.length ? change(board, (list) => list.filter((result) => !ids.includes(result.id))) : Promise.resolve());

  function later(delay: number) {
    clearTimeout(timer);
    if (!closed) timer = setTimeout(() => void flush(), delay);
  }

  function retry(next: ResultsState, cause: unknown = null) {
    setState(next, cause);
    later(retryDelay(++failures));
  }

  /** A failed call: keep everything, say why, and try again the way that state asks for. */
  function failed(cause: unknown, whileSubmitting: boolean) {
    const code = codeOf(cause);
    if (code === "NETWORK_ERROR" || code === "TIMEOUT") retry("offline");
    else if (code === "PERMISSION_DENIED") {
      // Asking at all was refused: the connector. Sending was refused: signed out meanwhile or not agreed.
      if (whileSubmitting) {
        setState("waiting");
        later(pollMs);
      } else setState("denied");
    } else if (code === "UNKNOWN_METHOD") setState("unsupported");
    else retry("failed", cause);
  }

  /** A batch the host calls invalid as a whole: send its results one by one, and drop the ones it refuses. */
  async function oneByOne(board: string, batch: LeaderboardResult[]): Promise<string[]> {
    const taken: string[] = [];
    for (const result of batch) {
      try {
        const answer = await sdk.leaderboards.submit(board, [result]);
        if (answer.accepted.includes(result.id)) taken.push(result.id);
        await drop(board, [result.id]);
      } catch (cause) {
        if (codeOf(cause) !== "INVALID_PARAMS") throw cause;
        await drop(board, [result.id]);
      }
    }
    return taken;
  }

  /** One try: asks where the user stands, then sends board by board. */
  async function pass(): Promise<void> {
    clearTimeout(timer);
    try {
      await refresh();
    } catch (cause) {
      return failed(cause, false);
    }
    if (!count()) {
      failures = 0;
      return setState("idle");
    }
    let status: LeaderboardStatus;
    try {
      status = await sdk.leaderboards.status();
    } catch (cause) {
      return failed(cause, false);
    }
    if (isOffline(status)) return retry("offline");
    if (status.signedIn === false || !status.shown || !status.available) {
      setState("waiting");
      return later(pollMs);
    }
    setState("sending");
    let taken = 0;
    try {
      for (const [board, list] of [...waiting]) {
        for (let at = 0; at < list.length; at += RESULT_BATCH) {
          const batch = list.slice(at, at + RESULT_BATCH);
          try {
            const answer = await sdk.leaderboards.submit(board, batch);
            // A refused result never counts, so it leaves the queue like a taken one.
            await drop(board, [...answer.accepted, ...answer.rejected.map((refused) => refused.id)]);
            taken += answer.accepted.length;
          } catch (cause) {
            if (codeOf(cause) !== "INVALID_PARAMS" || batch.length === 1) {
              if (codeOf(cause) !== "INVALID_PARAMS") throw cause;
              await drop(board, [batch[0]!.id]);
            } else taken += (await oneByOne(board, batch)).length;
          }
        }
      }
    } catch (cause) {
      return failed(cause, true);
    }
    failures = 0;
    setState("idle");
    if (taken && standingListeners.size) {
      try {
        const standing = await sdk.leaderboards.mine();
        notify(standingListeners, standing);
      } catch {
        // No `mine` before Tavora 0.21.97, or the service dropped out right after: the results are in anyway.
      }
    }
  }

  function flush(): Promise<void> {
    if (closed) return Promise.resolve();
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = (async () => {
      do {
        again = false;
        await pass();
      } while (again && !closed);
    })()
      .catch((cause: unknown) => setState("failed", cause))
      .finally(() => (inflight = null));
    return inflight;
  }

  const offResume = sdk.lifecycle.onResume(() => void flush());

  const handle: ResultsHandle = {
    get pending() {
      return count();
    },
    get status() {
      return state;
    },
    get error() {
      return error;
    },
    has: (id) => [...waiting.values()].some((list) => list.some((result) => result.id === id)),
    async record(board, result) {
      if (closed) throw new TypeError("the result queue is disposed");
      if (fixed && !fixed.has(board)) throw new TypeError(`${board} is not a board of this queue`);
      await change(board, (list) => (list.some((known) => known.id === result.id) ? list : [...list, structuredClone(result)]));
      void flush();
    },
    flush,
    onStanding(fn) {
      standingListeners.add(fn);
      return () => void standingListeners.delete(fn);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => void statusListeners.delete(fn);
    },
    dispose() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      offResume();
      standingListeners.clear();
      statusListeners.clear();
    },
  };

  return refresh().then(() => {
    // Results left by an earlier session go out now, without holding up the panel.
    if (count()) void flush();
    return handle;
  });
}
