// The document store: one document that several panels of a module edit at once.
//
// A panel opens a document, changes it with `update()` and never thinks about saving: edits show at once, are
// saved a moment later one after another, and are re-applied on top of another panel's newer copy instead of
// overwriting it. Client-side state only; the host still enforces every limit and revision check (see ADR-0002).

import { TavoraError, type JsonValue, type KeyValueStore, type TavoraSDK } from "./index.js";
import type { DocumentChange } from "./protocol.js";

/** How often a save is tried when other panels keep saving first, before the edit is given up. */
export const MAX_SAVE_ATTEMPTS = 5;

const DEFAULT_DEBOUNCE_MS = 500;

/** Changes the draft in place, or returns a replacement. Applied to the newest copy, so it must not depend on older state. */
export type DocumentChangeFn<T> = (draft: T) => T | void;

export interface OpenDocumentOptions<T> {
  /** Turns stored data, or null for a missing document, into a valid value. */
  parse(raw: JsonValue | null): T;
  title(data: T): string;
  /**
   * `"reapply"` (default): an edit is a function applied again on the newest copy, so two panels' edits both survive.
   * `"mine"`: for an editor that owns the whole document; on a conflict the local copy wins, and while it has unsaved
   * edits another panel's change is only reported through `onChange`, never merged.
   */
  merge?: "reapply" | "mine";
  /** How long after the last edit the save starts. Default 500. */
  debounceMs?: number;
}

export interface DocumentChangeEvent<T> {
  /** What `data` is now. With `merge: "mine"` and unsaved edits after a remote change, still the local copy. */
  data: T;
  /** The stored revision: for a remote change, the other panel's. */
  revision: number;
  /** `"local"`: this panel's own edit, or its rollback after a failed save. `"remote"`: another panel's change. */
  source: "local" | "remote";
  /** The document was deleted by another panel. `data` is then `parse(null)` (or the unsaved local edits). */
  deleted: boolean;
}

export type DocumentStatus = "idle" | "saving" | "error";

export interface DocumentHandle<T> {
  /** The current value, including edits that are not saved yet. Replaced (never mutated) by every change. */
  readonly data: T;
  /** The newest stored revision this panel knows; 0 while the document does not exist. */
  readonly revision: number;
  /** `"saving"` from the first unsaved edit until it is stored; `"error"` after a failed save, until the next edit. */
  readonly status: DocumentStatus;
  /** Applies `change` at once and saves it soon. Throws after `dispose()`. */
  update(change: DocumentChangeFn<T>): void;
  /** Saves now and resolves once nothing is left to save. Never rejects: a failed save goes to `onError` and `status`. */
  flush(): Promise<void>;
  onChange(fn: (event: DocumentChangeEvent<T>) => void): () => void;
  onStatus(fn: (status: DocumentStatus) => void): () => void;
  /** A save gave up (not a conflict that resolved): `data` is back at the stored copy. */
  onError(fn: (error: unknown) => void): () => void;
  /** Saves unsaved edits, then stops listening. */
  dispose(): Promise<void>;
}

interface Stored<T> {
  data: T;
  revision: number;
}

const isConflict = (error: unknown): boolean => error instanceof TavoraError && error.code === "CONFLICT";

/** Reads a typed value from settings, with the default `parse(null)` gives for a missing key. */
export async function readStored<T>(store: Pick<KeyValueStore, "get">, key: string, parse: (raw: JsonValue | null) => T): Promise<T> {
  return parse(await store.get(key));
}

export async function openDocument<T>(sdk: TavoraSDK, id: string, options: OpenDocumentOptions<T>): Promise<DocumentHandle<T>> {
  const { parse, title } = options;
  const mine = options.merge === "mine";
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const apply = (base: T, change: DocumentChangeFn<T>): T => {
    const copy = structuredClone(base);
    const result = change(copy);
    return result === undefined ? copy : (result as T);
  };
  const applyAll = (base: T, changes: readonly DocumentChangeFn<T>[]): T => changes.reduce(apply, base);

  async function readNewest(): Promise<Stored<T> & { exists: boolean }> {
    const doc = await sdk.documents.get(id);
    return doc ? { data: parse(doc.data), revision: doc.revision, exists: true } : { data: parse(null), revision: 0, exists: false };
  }

  const first = await readNewest();
  let stored: Stored<T> = { data: first.data, revision: first.revision };
  let data = stored.data;
  let status: DocumentStatus = "idle";
  /** Edits not handed to a save yet, oldest first. */
  let pending: DocumentChangeFn<T>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();

  const changeListeners = new Set<(event: DocumentChangeEvent<T>) => void>();
  const statusListeners = new Set<(status: DocumentStatus) => void>();
  const errorListeners = new Set<(error: unknown) => void>();

  const notify = <A>(listeners: Set<(arg: A) => void>, arg: A) => {
    for (const fn of [...listeners]) {
      try {
        fn(arg);
      } catch (error) {
        console.error("[tavora] document listener failed", error);
      }
    }
  };
  const emit = (source: "local" | "remote", deleted = false, revision = stored.revision) =>
    notify(changeListeners, { data, revision, source, deleted });
  const setStatus = (next: DocumentStatus) => {
    if (status === next) return;
    status = next;
    notify(statusListeners, next);
  };

  /** Runs jobs one after another, so two saves (or a save and a reload) never overlap. */
  const enqueue = <R>(job: () => Promise<R>): Promise<R> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };

  async function saveJob(): Promise<void> {
    while (pending.length > 0) {
      const batch = pending;
      pending = [];
      setStatus("saving");
      let base = stored;
      try {
        for (let attempt = 1; ; attempt++) {
          const next = mine ? data : applyAll(base.data, batch);
          try {
            const saved = await sdk.documents.put({ id, title: title(next), data: next as JsonValue, ifRevision: base.revision });
            stored = { data: next, revision: saved.revision };
            break;
          } catch (error) {
            if (!isConflict(error) || attempt >= MAX_SAVE_ATTEMPTS) throw error;
            const newest = await readNewest();
            base = { data: newest.data, revision: newest.revision };
            if (!mine) {
              // Another panel saved first: show its copy with our edits (saved and unsaved) on top.
              stored = base;
              data = applyAll(base.data, [...batch, ...pending]);
              emit("remote");
            }
          }
        }
      } catch (error) {
        if (isConflict(error)) {
          try {
            const newest = await readNewest();
            stored = { data: newest.data, revision: newest.revision };
          } catch {
            // keep the copy we have
          }
        }
        pending = [];
        data = stored.data;
        setStatus("error");
        emit("local");
        notify(errorListeners, error);
        return;
      }
    }
    setStatus("idle");
  }

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    return enqueue(saveJob);
  };
  const flushQuietly = () => void flush();

  function reloadJob(change: DocumentChange): Promise<void> {
    return enqueue(async () => {
      if (closed) return;
      try {
        const newest = await readNewest();
        const dirty = pending.length > 0;
        if (!newest.exists) {
          if (!change.deleted && stored.revision === 0) return;
          stored = { data: newest.data, revision: 0 };
          data = dirty ? (mine ? data : applyAll(stored.data, pending)) : stored.data;
          emit("remote", true, change.revision);
          return;
        }
        if (newest.revision <= stored.revision) return;
        stored = { data: newest.data, revision: newest.revision };
        data = dirty ? (mine ? data : applyAll(stored.data, pending)) : stored.data;
        emit("remote");
      } catch (error) {
        notify(errorListeners, error);
      }
    });
  }

  const unsubscribers = [
    sdk.documents.onChange((change) => {
      if (change.id === id && !closed) void reloadJob(change);
    }),
    sdk.lifecycle.onSuspend(flushQuietly),
    sdk.lifecycle.onDispose(flushQuietly),
  ];

  return {
    get data() {
      return data;
    },
    get revision() {
      return stored.revision;
    },
    get status() {
      return status;
    },
    update(change) {
      if (closed) throw new Error("the document is closed");
      data = apply(data, change);
      pending.push(change);
      setStatus("saving");
      emit("local");
      clearTimeout(timer);
      timer = setTimeout(flushQuietly, debounceMs);
    },
    flush,
    onChange(fn) {
      changeListeners.add(fn);
      return () => void changeListeners.delete(fn);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => void statusListeners.delete(fn);
    },
    onError(fn) {
      errorListeners.add(fn);
      return () => void errorListeners.delete(fn);
    },
    async dispose() {
      if (closed) return;
      closed = true;
      for (const off of unsubscribers) off();
      await flush();
      changeListeners.clear();
      statusListeners.clear();
      errorListeners.clear();
    },
  };
}
