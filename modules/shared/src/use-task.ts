// One piece of work a view waits for (a confirm, an import, a load), as one value instead of `busy` + `error` flags.
//
// - `state` is `idle`, `running` or `failed` (with the message to show); `busy` and `error` are read from it. Put
//   `state.status` on the view's root as `data-status`, so tests and tools read one value.
// - `run(work)` always ends: a throw becomes `failed`, nothing stays `running`.
// - A run that is no longer the newest is dropped: its result is `undefined` and it changes nothing. `"once"` (the
//   default) ignores a second run while one is going (a double click); `"latest"` lets a new run replace the old one (a
//   load for another id), so an old answer can never land over a newer one.
// - Closing a view does not stop the work; check that what you act on is still there (in the app, close a dialog only
//   when it is still the one shown).
import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";

export type TaskState = { status: "idle" } | { status: "running" } | { status: "failed"; error: string };
export type TaskStatus = TaskState["status"];

export interface TaskOptions {
  /** `"once"`: a run while one is going is ignored. `"latest"`: it replaces the one going, whose result is dropped. */
  mode?: "once" | "latest";
  /** The message for a run that threw; by default the error's own message. */
  describe?(cause: unknown): string;
}

export interface Task {
  readonly state: Readonly<ShallowRef<TaskState>>;
  /** A run is going. */
  readonly busy: ComputedRef<boolean>;
  /** The message of the last run that failed, until the next run or `reset`. */
  readonly error: ComputedRef<string | null>;
  /**
   * Runs `work` and resolves with what it gave, or `undefined` when the run was dropped: ignored (`"once"` while one is
   * going), replaced by a newer run, ended by `reset`, or it threw (then `state` is `failed`).
   */
  run<R>(work: () => Promise<R>): Promise<R | undefined>;
  /** The work answered but did not succeed (a `{ ok: false }` result): show `error`. */
  fail(error: string): void;
  /** Back to idle; a run still going is dropped. */
  reset(): void;
}

const ownMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** One task (see the top of this file). It holds no watchers, so it works outside a component too. */
export function useTask(options: TaskOptions = {}): Task {
  const mode = options.mode ?? "once";
  const describe = options.describe ?? ownMessage;
  const state = shallowRef<TaskState>({ status: "idle" });
  /** Raised by every run and by `reset`: only the run holding the newest turn may change `state`. */
  let turn = 0;
  const busy = computed(() => state.value.status === "running");
  const error = computed(() => (state.value.status === "failed" ? state.value.error : null));

  return {
    state,
    busy,
    error,
    async run<R>(work: () => Promise<R>): Promise<R | undefined> {
      if (mode === "once" && state.value.status === "running") return undefined;
      const mine = ++turn;
      state.value = { status: "running" };
      try {
        const value = await work();
        if (mine !== turn) return undefined;
        state.value = { status: "idle" };
        return value;
      } catch (cause) {
        if (mine === turn) state.value = { status: "failed", error: describe(cause) };
        return undefined;
      }
    },
    fail(message: string) {
      turn++;
      state.value = { status: "failed", error: message };
    },
    reset() {
      turn++;
      state.value = { status: "idle" };
    },
  };
}
