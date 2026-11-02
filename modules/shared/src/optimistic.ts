// Act first, confirm later: a change shows on screen at once, is saved in the background, and is put back (with a short
// message) when saving fails. Use it where saving takes a moment (the network). Where it finishes in a frame, don't.
//
// Not for anything that can't be put back: deleting, publishing, money, keys, security. Those wait for the answer.
//
// Two quick changes: the later one wins. Saves go one after another, a change made while one is saving replaces any
// change still waiting behind it, and a save that fails while a newer change is waiting is dropped without a word.
// When the newest change fails, the screen goes back to the last value that was really saved, never to a
// change that was still on its way.

import { computed, shallowRef, type ComputedRef } from "vue";

export interface OptimisticOptions<T> {
  /** The saved value: what the screen shows when nothing is waiting. Read when a change starts, to know what to put back. */
  read: () => T;
  /** Puts a value on screen. */
  show: (value: T) => void;
  /** Saves a value. Rejects (or throws) when it could not be saved. */
  save: (value: T) => Promise<unknown>;
  /** The newest change could not be saved and the saved value is back on screen. Called once per failure, after it. */
  failed: (error: unknown) => void;
  /** Nothing is waiting any more (saved or put back). */
  settled?: () => void;
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

/** One value that saves optimistically. See the top of this file for the rules; `useOptimistic` is the Vue form. */
export function createOptimistic<T>(options: OptimisticOptions<T>): Optimistic<T> {
  let confirmed: T;
  let saving = false;
  let next: Job<T> | null = null;

  async function drain(): Promise<void> {
    saving = true;
    while (next) {
      const job: Job<T> = next;
      next = null;
      try {
        await options.save(job.value);
        confirmed = job.value;
        job.done(true);
      } catch (error) {
        job.done(false);
        // A newer change is waiting: it is saved next and decides what is shown. Only the newest failure speaks.
        if (!next) {
          options.show(confirmed);
          options.failed(error);
        }
      }
    }
    saving = false;
    options.settled?.();
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

export interface UseOptimistic<T> {
  /** What to show: the new value while it is saving, else the saved one (`source`). */
  value: ComputedRef<T>;
  set(next: T): Promise<boolean>;
  waiting: ComputedRef<boolean>;
}

/**
 * Vue form. `source` is the saved value (a computed from the store or the view the host pushes); `save` has to resolve
 * after `source` shows the saved value, so the screen doesn't blink back. `failed` shows the message.
 */
export function useOptimistic<T>(source: () => T, save: (value: T) => Promise<unknown>, failed: (error: unknown) => void): UseOptimistic<T> {
  const override = shallowRef<{ value: T } | null>(null);
  const waiting = shallowRef(false);
  const slot = createOptimistic<T>({
    read: source,
    show: (value) => {
      override.value = { value };
      waiting.value = true;
    },
    save,
    failed,
    settled: () => {
      override.value = null;
      waiting.value = false;
    },
  });
  return {
    value: computed(() => (override.value ? override.value.value : source())),
    set: (next) => slot.set(next),
    waiting: computed(() => waiting.value),
  };
}

export interface UseOptimisticKeyed<K, T> {
  /** What to show for `key`. */
  value(key: K): T;
  set(key: K, next: T): Promise<boolean>;
}

/** Like `useOptimistic` for a list: one value per key (a device's name, a row's switch). Each key races on its own. */
export function useOptimisticKeyed<K, T>(source: (key: K) => T, save: (key: K, value: T) => Promise<unknown>, failed: (error: unknown, key: K) => void): UseOptimisticKeyed<K, T> {
  const overrides = shallowRef<ReadonlyMap<K, { value: T }>>(new Map());
  const slots = new Map<K, Optimistic<T>>();
  const change = (key: K, shown: { value: T } | null) => {
    const copy = new Map(overrides.value);
    if (shown) copy.set(key, shown);
    else copy.delete(key);
    overrides.value = copy;
  };
  function slotFor(key: K): Optimistic<T> {
    let slot = slots.get(key);
    if (!slot) {
      slot = createOptimistic<T>({
        read: () => source(key),
        show: (value) => change(key, { value }),
        save: (value) => save(key, value),
        failed: (error) => failed(error, key),
        settled: () => change(key, null),
      });
      slots.set(key, slot);
    }
    return slot;
  }
  return {
    value: (key) => {
      const shown = overrides.value.get(key);
      return shown ? shown.value : source(key);
    },
    set: (key, next) => slotFor(key).set(next),
  };
}
