// The document store: one document that several panels of a module edit at once.
//
// A panel opens a document, changes it with `update()` and never thinks about saving: edits show at once, are
// saved a moment later one after another, and are re-applied on top of another panel's newer copy instead of
// overwriting it. Client-side state only; the host still enforces every limit and revision check (see ADR-0002).

import { TavoraError, type JsonValue, type TavoraSDK } from "./index.js";
import type { DocumentChange } from "./protocol.js";

/** How often a save is tried when other panels keep saving first, before the edit is given up. */
export const MAX_SAVE_ATTEMPTS = 5;

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Changes the draft in place, or returns a replacement. Applied to the newest copy, and again on a newer one after
 * a conflict, so it must not depend on older state. Make ids and timestamps outside of it: inside, a re-apply makes new ones.
 */
export type DocumentChangeFn<T> = (draft: T) => T | void;

export interface OpenDocumentOptions<T> {
  /** Turns stored data, or null for a missing document, into a valid value. */
  parse(raw: JsonValue | null): T;
  title(data: T): string;
  /**
   * `"reapply"` (default): an edit is a function applied again on the newest copy, so two panels' edits both survive.
   * `"mine"`: for an editor that owns the whole document; on a conflict the local copy wins, and while it has unsaved
   * edits another panel's change is only reported through `onChange`, never merged. A failed save keeps the local copy.
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
  /**
   * `"local"`: this panel's own edit. `"remote"`: another panel's change. `"rollback"`: a save failed and `data` went
   * back to the stored copy (plus later edits): an editor that ignores its own events must adopt `data` here too.
   */
  source: "local" | "remote" | "rollback";
  /** The document was deleted by another panel. `data` is then `parse(null)` (or the unsaved local edits). */
  deleted: boolean;
  /** For a remote change: the other panel's copy, even when `data` is still the local one (`merge: "mine"`). */
  remote?: T;
}

/** `"dirty"`: edits not saved yet. `"saving"`: a save is running. `"error"`: the last save failed, until the next edit. */
export type DocumentStatus = "idle" | "dirty" | "saving" | "error";

/**
 * `"save"`: a save gave up (`"reapply"`: `data` is back at the stored copy, later edits kept; `"mine"`: `data` kept).
 * `"change"`: an edit threw on the newest copy and was dropped; the others are kept.
 * `"reload"`: reading another panel's change failed; nothing was rolled back.
 */
export type DocumentErrorKind = "save" | "change" | "reload";

export interface DocumentHandle<T> {
  /** The current value, including edits that are not saved yet. Replaced (never mutated) by every change. */
  readonly data: T;
  /** The newest stored revision this panel knows; 0 while the document does not exist. */
  readonly revision: number;
  readonly status: DocumentStatus;
  /**
   * Applies `change` at once and saves it soon; also ends a pause after the document was deleted elsewhere (the save
   * then creates it again). Throws after `dispose()`.
   */
  update(change: DocumentChangeFn<T>): void;
  /**
   * Saves now and resolves once nothing is left to save, or saving was paused by a delete elsewhere that came in
   * meanwhile (a flush also ends an earlier pause). Never rejects: a failed save goes to `onError` and `status`;
   * `onError` is the reliable signal, as a later edit in the same run can leave `status` at "idle".
   */
  flush(): Promise<void>;
  /**
   * Drops unsaved edits and shows the other panel's last copy (or the stored one): the "load theirs" of a `"mine"` editor.
   * When this panel's own save already went over that copy, it is saved back as a new revision.
   */
  adoptRemote(): Promise<void>;
  onChange(fn: (event: DocumentChangeEvent<T>) => void): () => void;
  onStatus(fn: (status: DocumentStatus) => void): () => void;
  onError(fn: (error: unknown, kind: DocumentErrorKind) => void): () => void;
  /** Saves unsaved edits, then stops listening. Edits paused by a delete elsewhere are not saved. */
  dispose(): Promise<void>;
}

interface Stored<T> {
  data: T;
  revision: number;
}

const isConflict = (error: unknown): boolean => error instanceof TavoraError && error.code === "CONFLICT";

export async function openDocument<T>(sdk: TavoraSDK, id: string, options: OpenDocumentOptions<T>): Promise<DocumentHandle<T>> {
  const { parse, title } = options;
  const mine = options.merge === "mine";
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const apply = (base: T, change: DocumentChangeFn<T>): T => {
    const copy = structuredClone(base);
    const result = change(copy);
    return result === undefined ? copy : (result as T);
  };

  async function readNewest(): Promise<Stored<T> & { exists: boolean }> {
    const doc = await sdk.documents.get(id);
    return doc ? { data: parse(doc.data), revision: doc.revision, exists: true } : { data: parse(null), revision: 0, exists: false };
  }

  const first = await readNewest();
  let stored: Stored<T> = { data: first.data, revision: first.revision };
  let data = stored.data;
  /** The last copy another panel saved, for `adoptRemote`. */
  let remote: T | undefined;
  let status: DocumentStatus = "idle";
  /** Edits not handed to a save yet, oldest first. */
  let pending: DocumentChangeFn<T>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  /** The document was deleted elsewhere: pending edits wait for an explicit update or flush. */
  let paused = false;
  /** A save already found the document deleted: its own `documents.changed` event brings nothing new. */
  let skipDelete = false;
  let queue: Promise<unknown> = Promise.resolve();

  const changeListeners = new Set<(event: DocumentChangeEvent<T>) => void>();
  const statusListeners = new Set<(status: DocumentStatus) => void>();
  const errorListeners = new Set<(error: unknown, kind: DocumentErrorKind) => void>();

  const notify = <A extends unknown[]>(listeners: Set<(...args: A) => void>, ...args: A) => {
    for (const fn of [...listeners]) {
      try {
        fn(...args);
      } catch (error) {
        console.error("[tavora] document listener failed", error);
      }
    }
  };
  const emit = (source: DocumentChangeEvent<T>["source"], deleted = false, revision = stored.revision, remoteCopy?: T) =>
    notify(changeListeners, { data, revision, source, deleted, ...(remoteCopy === undefined ? {} : { remote: remoteCopy }) });
  const setStatus = (next: DocumentStatus) => {
    if (status === next) return;
    status = next;
    notify(statusListeners, next);
  };
  const report = (error: unknown, kind: DocumentErrorKind) => notify(errorListeners, error, kind);

  /** Applies edits one by one; one that throws is dropped and reported, the others stay. */
  const applySafe = (base: T, changes: readonly DocumentChangeFn<T>[]): { data: T; kept: DocumentChangeFn<T>[] } => {
    let result = base;
    const kept: DocumentChangeFn<T>[] = [];
    for (const change of changes) {
      try {
        result = apply(result, change);
        kept.push(change);
      } catch (error) {
        report(error, "change");
      }
    }
    return { data: result, kept };
  };

  /** Runs jobs one after another, so two saves (or a save and a reload) never overlap. */
  const enqueue = <R>(job: () => Promise<R>): Promise<R> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void save();
    }, debounceMs);
  };

  async function saveJob(): Promise<void> {
    let outcome: DocumentStatus | undefined;
    while (pending.length > 0 && !paused) {
      let batch = pending;
      pending = [];
      setStatus("saving");
      let base = stored;
      // The copy the panel shows is what gets saved, so what is on screen is what is stored (ids made in a change included).
      let next = data;
      try {
        let deletedElsewhere = false;
        for (let attempt = 1; ; attempt++) {
          if (mine) {
            batch = [...batch, ...pending];
            pending = [];
            next = data;
          }
          try {
            const saved = await sdk.documents.put({ id, title: title(next), data: next as JsonValue, ifRevision: base.revision });
            stored = { data: next, revision: saved.revision };
            skipDelete = false;
            break;
          } catch (error) {
            if (!isConflict(error) || attempt >= MAX_SAVE_ATTEMPTS) throw error;
            const newest = await readNewest();
            base = { data: newest.data, revision: newest.revision };
            const wasStored = stored.revision !== 0;
            stored = base;
            if (!newest.exists && wasStored) {
              // Deleted elsewhere: keep every edit, but do not create the document again behind the user's back.
              pending = [...batch, ...pending];
              if (!mine) {
                const again = applySafe(base.data, pending);
                pending = again.kept;
                data = again.data;
              }
              paused = true;
              deletedElsewhere = true;
              skipDelete = true;
              break;
            }
            if (!mine) {
              // Another panel saved first: save our batch on its copy and show it with the later edits on top.
              const saving = applySafe(base.data, batch);
              batch = saving.kept;
              next = saving.data;
              const later = applySafe(next, pending);
              pending = later.kept;
              data = later.data;
              emit("remote");
              if (batch.length === 0) break;
            }
          }
        }
        if (deletedElsewhere) {
          setStatus("dirty");
          emit("remote", true);
          return;
        }
        outcome = "idle";
      } catch (error) {
        if (isConflict(error)) {
          try {
            const newest = await readNewest();
            stored = { data: newest.data, revision: newest.revision };
          } catch {
            // keep the copy we have
          }
        }
        if (mine) {
          // The user's work stays on screen; the next flush or edit tries again.
          pending = [...batch, ...pending];
          setStatus("error");
          report(error, "save");
          return;
        }
        // Back to the stored copy, with the edits made while the save ran on top; those are tried next.
        const later = applySafe(stored.data, pending);
        pending = later.kept;
        data = later.data;
        outcome = "error";
        emit("rollback");
        report(error, "save");
      }
    }
    if (outcome) setStatus(pending.length > 0 ? "dirty" : outcome);
  }

  /** The store's own saves (timer, suspend, dispose): they leave a pause after a delete elsewhere alone. */
  const save = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    return enqueue(saveJob);
  };
  const saveQuietly = () => void save();
  const flush = (): Promise<void> => {
    paused = false;
    return save();
  };

  function reloadJob(change: DocumentChange): Promise<void> {
    return enqueue(async () => {
      if (closed) return;
      try {
        const newest = await readNewest();
        const dirty = pending.length > 0;
        if (!newest.exists) {
          // The one delete a save already found: nothing new, and an explicit edit must not be paused again. Any other
          // delete (the document came back and went again) pauses once more when there are edits.
          if (skipDelete) {
            skipDelete = false;
            return;
          }
          if (stored.revision === 0 && !dirty) return;
          stored = { data: newest.data, revision: 0 };
          remote = undefined;
          if (dirty) {
            clearTimeout(timer);
            timer = undefined;
            paused = true;
            if (!mine) {
              const again = applySafe(stored.data, pending);
              pending = again.kept;
              data = again.data;
            }
            if (status !== "saving") setStatus("dirty");
          } else {
            data = stored.data;
          }
          emit("remote", true, change.revision);
          return;
        }
        // Compare revisions for inequality: a document deleted and created again starts over at 1.
        if (!change.deleted && newest.revision === stored.revision) return;
        remote = newest.data;
        skipDelete = false;
        if (!dirty || mine) {
          stored = { data: newest.data, revision: newest.revision };
          if (!dirty) data = stored.data;
        } else {
          const merged = applySafe(newest.data, pending);
          pending = merged.kept;
          stored = { data: newest.data, revision: newest.revision };
          data = merged.data;
        }
        if (paused) {
          paused = false;
          if (pending.length > 0) schedule();
        }
        if (pending.length === 0 && status === "dirty") setStatus("idle");
        emit("remote", false, stored.revision, newest.data);
      } catch (error) {
        report(error, "reload");
      }
    });
  }

  const unsubscribers = [
    sdk.documents.onChange((change) => {
      if (change.id === id && !closed) void reloadJob(change);
    }),
    sdk.lifecycle.onSuspend(saveQuietly),
    sdk.lifecycle.onDispose(saveQuietly),
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
      paused = false;
      data = apply(data, change);
      pending.push(change);
      if (status !== "saving") setStatus("dirty");
      emit("local");
      schedule();
    },
    flush,
    adoptRemote() {
      if (closed) throw new Error("the document is closed");
      clearTimeout(timer);
      timer = undefined;
      return enqueue(async () => {
        pending = [];
        paused = false;
        const adopted = remote;
        remote = undefined;
        data = adopted ?? stored.data;
        emit("remote", false, stored.revision, data);
        if (adopted !== undefined && adopted !== stored.data) {
          // This panel's own save already went over the other copy: put theirs back as a new revision.
          pending = [() => adopted];
          await saveJob();
          return;
        }
        setStatus("idle");
      });
    },
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
      await save();
      changeListeners.clear();
      statusListeners.clear();
      errorListeners.clear();
    },
  };
}

export * from "./items.js";
export * from "./results.js";
export * from "./runs.js";
