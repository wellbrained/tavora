// Act first, confirm later: a change shows on screen at once, is saved in the background, and is put back (with a short
// message) when saving fails. Use it where saving takes a moment (the network). Where it finishes in a frame, don't.
//
// Not for anything that can't be put back: deleting, publishing, money, keys, security. Those wait for the answer.
// While a change is still `waiting`, keep such actions on the same thing switched off, so two requests about it never
// run at once.
//
// Two quick changes: the later one wins. Saves go one after another, a change made while one is saving replaces any
// change still waiting behind it, and a save that fails while a newer change is waiting is dropped without a word.
// When the newest change fails, the screen goes back to the last value that was really saved, never to a
// change that was still on its way.
//
// A save that never answers counts as failed after `timeoutMs` (it may still land later, so the caller reads the
// saved state again in `failed`). A callback that throws is logged and never stops the queue.

import { computed, shallowRef, watch, type ComputedRef } from "vue";

/** A save that doesn't answer in this long is treated as failed. */
export const SAVE_TIMEOUT_MS = 30_000;
/** After a save, how long the new value is kept on screen while the saved state hasn't caught up yet. */
export const CATCH_UP_MS = 2_000;

export interface OptimisticOptions<T> {
  /** The saved value: what the screen shows when nothing is waiting. Read when a change starts, to know what to put back. */
  read: () => T;
  /** Puts a value on screen. */
  show: (value: T) => void;
  /** Saves a value. Rejects (or throws) when it could not be saved. */
  save: (value: T) => Promise<unknown>;
  /** The newest change (`value`) could not be saved and the saved value is back on screen. Called once per failure, after it. */
  failed: (error: unknown, value: T) => void;
  /** Nothing is waiting any more. `saved`: the last save worked; `value`: the last value that was really saved. */
  settled?: (outcome: { saved: boolean; value: T }) => void;
  /** Default `SAVE_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface Optimistic<T> {
  /** Shows `next` now and saves it. Resolves true when it was saved, false when it failed or a newer change replaced it. */
  set(next: T): Promise<boolean>;
  /** True while a change is saving or waiting to be. */
  readonly waiting: boolean;
}

interface Job<T> {
  value: T;
  done: (saved: boolean) => void;
}

function guard(run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error("[optimistic]", error);
  }
}

/** The save's answer, or a rejection when it takes longer than `ms`. */
function within<T>(run: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The save took too long.")), ms);
    Promise.resolve()
      .then(run)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

/** One value that saves optimistically. See the top of this file for the rules; `useOptimistic` is the Vue form. */
export function createOptimistic<T>(options: OptimisticOptions<T>): Optimistic<T> {
  let confirmed: T;
  let saving = false;
  let next: Job<T> | null = null;

  async function drain(): Promise<void> {
    saving = true;
    let saved = false;
    try {
      while (next) {
        const job: Job<T> = next;
        next = null;
        try {
          await within(() => options.save(job.value), options.timeoutMs ?? SAVE_TIMEOUT_MS);
          confirmed = job.value;
          saved = true;
          job.done(true);
        } catch (error) {
          saved = false;
          job.done(false);
          // A newer change is waiting: it is saved next and decides what is shown. Only the newest failure speaks.
          if (!next) {
            guard(() => options.show(confirmed));
            guard(() => options.failed(error, job.value));
          }
        }
      }
    } finally {
      saving = false;
      guard(() => options.settled?.({ saved, value: confirmed }));
    }
  }

  return {
    set(value) {
      if (!saving && !next) confirmed = options.read();
      options.show(value);
      return new Promise<boolean>((resolve) => {
        next?.done(false);
        next = { value, done: resolve };
        if (!saving) void drain();
      });
    },
    get waiting() {
      return saving || next !== null;
    },
  };
}

export interface UseOptimisticOptions<T> {
  /** Whether the saved state shows a value already. Default: the same JSON. */
  equal?: (a: T, b: T) => boolean;
  /** How long a saved value stays on screen while the saved state hasn't caught up. Default `CATCH_UP_MS`. */
  catchUpMs?: number;
  timeoutMs?: number;
}

function sameJson<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * What is on screen for one value: the new value while it saves, then still the saved value until `source` shows it (or
 * `catchUpMs` has passed), so a state that arrives a moment after the save's answer doesn't make it blink back.
 */
function overlay<T>(source: () => T, options: UseOptimisticOptions<T>) {
  const equal = options.equal ?? sameJson;
  const shown = shallowRef<{ value: T } | null>(null);
  const waiting = shallowRef(false);
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    stop?.();
    stop = undefined;
    clearTimeout(timer);
    timer = undefined;
  };
  const clear = () => {
    release();
    shown.value = null;
  };
  return {
    shown,
    waiting,
    show(value: T) {
      release();
      shown.value = { value };
      waiting.value = true;
    },
    settled({ saved, value }: { saved: boolean; value: T }) {
      waiting.value = false;
      if (!saved || equal(source(), value)) return clear();
      // Saved, but the state doesn't show it yet: keep it on screen until the state changes.
      release();
      shown.value = { value };
      stop = watch(source, clear, { flush: "sync" });
      timer = setTimeout(clear, options.catchUpMs ?? CATCH_UP_MS);
    },
  };
}

export interface UseOptimistic<T> {
  /** What to show: the new value while it is saving, else the saved one (`source`). */
  value: ComputedRef<T>;
  set(next: T): Promise<boolean>;
  /** True while a change is saving or waiting to be: switch off what can't be put back, such as Delete. */
  waiting: ComputedRef<boolean>;
}

/**
 * Vue form. `source` is the saved value (a computed from the store or the view the host pushes). `failed` shows the
 * message, and should read the saved state again (the request may have landed although its answer was lost).
 */
export function useOptimistic<T>(source: () => T, save: (value: T) => Promise<unknown>, failed: (error: unknown, value: T) => void, options: UseOptimisticOptions<T> = {}): UseOptimistic<T> {
  const screen = overlay(source, options);
  const slot = createOptimistic<T>({ read: source, show: screen.show, save, failed, settled: screen.settled, timeoutMs: options.timeoutMs });
  return {
    value: computed(() => (screen.shown.value ? screen.shown.value.value : source())),
    set: (next) => slot.set(next),
    waiting: computed(() => screen.waiting.value),
  };
}

export interface UseOptimisticKeyed<K, T> {
  /** What to show for `key`. */
  value(key: K): T;
  set(key: K, next: T): Promise<boolean>;
  /** True while a change to `key` is saving or waiting to be. */
  waiting(key: K): boolean;
}

/** Like `useOptimistic` for a list: one value per key (a device's name, a review's reply). Each key races on its own. */
export function useOptimisticKeyed<K, T>(
  source: (key: K) => T,
  save: (key: K, value: T) => Promise<unknown>,
  failed: (error: unknown, key: K, value: T) => void,
  options: UseOptimisticOptions<T> = {},
): UseOptimisticKeyed<K, T> {
  const known = shallowRef(0);
  const slots = new Map<K, { screen: ReturnType<typeof overlay<T>>; slot: Optimistic<T> }>();
  function slotFor(key: K) {
    let entry = slots.get(key);
    if (!entry) {
      const screen = overlay(() => source(key), options);
      const slot = createOptimistic<T>({
        read: () => source(key),
        show: screen.show,
        save: (value) => save(key, value),
        failed: (error, value) => failed(error, key, value),
        settled: screen.settled,
        timeoutMs: options.timeoutMs,
      });
      entry = { screen, slot };
      slots.set(key, entry);
      known.value++;
    }
    return entry;
  }
  return {
    value: (key) => {
      void known.value;
      const shown = slots.get(key)?.screen.shown.value;
      return shown ? shown.value : source(key);
    },
    set: (key, next) => slotFor(key).slot.set(next),
    waiting: (key) => {
      void known.value;
      return slots.get(key)?.screen.waiting.value ?? false;
    },
  };
}
