// The item session: the items of one kind in a module (builds, plans, boards, notes) and the one a panel has open.
//
// It lists the documents whose id starts with a prefix, opens one at a time through the document store, and keeps
// that choice in step with Tavora: restore after a restart, `panel.setContent`, `panel.onNavigate`, and what other
// panels create, rename or delete. Client-side state only (see ADR-0002).

import { TavoraError, type JsonValue, type PanelContent, type PanelLaunch, type TavoraSDK } from "./index.js";
import { openDocument, type DocumentChangeEvent, type DocumentErrorKind, type DocumentHandle, type DocumentStatus, type OpenDocumentOptions } from "./store.js";

export interface ItemSummary {
  id: string;
  title: string;
  /** When it was last saved (from `documents.list`). */
  updatedAt: string;
  /** The stored revision when the list was read. */
  revision: number;
}

export interface OpenItemsOptions<T> extends Pick<OpenDocumentOptions<T>, "parse" | "title" | "merge" | "debounceMs"> {
  /** Every item's document id starts with this, e.g. `"build-"` (a document id is letters, digits, `-` and `_`, at most 64: a new id adds 36). Other documents of the module are left alone. */
  prefix: string;
  /** What `create()` starts with. Default: `parse(null)`. */
  newItem?: () => T;
  /** Changes the title inside the data, so `title(data)` returns it. Needed for `rename()` and for `create(data, title)`. */
  rename?: (draft: T, title: string) => T | void;
  /** What `panel.setContent` shows for the open item. Default: `{ id, title: title(data) }`. */
  content?: (id: string, data: T) => PanelContent;
  /** A panel just added by the user: open the item used last (default), the first of the list, or nothing. */
  onAdd?: "last" | "first" | "none";
  /**
   * The open item was deleted by another panel. `"keep"` (default): stay on it, as a panel never switches by itself;
   * `deleted` turns true, and `restoreDeleted()` brings it back. `"fallback"`: open the next one, or none.
   */
  onDeleted?: "fallback" | "keep";
  /** Switch when another panel asks with `panels.open` and an item of this kind. Default true; turn it off to handle `panel.onNavigate` yourself. */
  followNavigate?: boolean;
  /**
   * Which item a panel shows when it starts, from how it was launched and its `panel.getState()`. Return an item id,
   * or null for the `onAdd` rule. Default: the item of the launch content (a restored panel, or `panels.open`), none for a new panel.
   */
  restore?: (launch: PanelLaunch, state: JsonValue | null) => string | null | Promise<string | null>;
  /**
   * When the list is still empty after restoring, the session creates this item once and opens it (a starter board,
   * a first note). It has a fixed id, so two panels that start together make one item, not two. `title` needs the `rename` option.
   */
  whenEmpty?: () => { data: T; title?: string };
}

/** `"list"`: the list of items changed. `"current"`: the open item changed or was switched. `"busy"`: `busy` changed. */
export type ItemSessionEvent =
  | { type: "list" }
  | { type: "busy" }
  | { type: "current"; id: string | null; source: "pick" | DocumentChangeEvent<unknown>["source"]; deleted: boolean };

export type ItemErrorKind = DocumentErrorKind | "list" | "pick";

export class ItemNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`item ${id} does not exist`);
    this.name = "ItemNotFoundError";
  }
}

/** `pick` could not save the open item, so it stays open. */
export class ItemSaveError extends Error {
  constructor(readonly id: string) {
    super(`item ${id} could not be saved`);
    this.name = "ItemSaveError";
  }
}

export interface ItemSession<T> {
  /** The items, as `documents.list` orders them (newest save first). Replaced, never mutated. */
  readonly items: readonly ItemSummary[];
  readonly currentId: string | null;
  /** The open item; null for none. Its `data`, `update` and `flush` are the document store's. */
  readonly current: DocumentHandle<T> | null;
  /** The open item's status; "idle" for none. */
  readonly status: DocumentStatus;
  /** A `job` is running (or waiting). `panels.open` and the automatic fallback wait until it is done. */
  readonly busy: boolean;
  /**
   * Another panel deleted the open item and the session stayed on it (`onDeleted: "keep"`). The session's `flush()`
   * and `pick` leave it deleted; `restoreDeleted()` brings it back. A direct `current.update()` is still the document
   * store's: it creates the document again from the edits on an empty copy.
   */
  readonly deleted: boolean;
  /**
   * Saves the open item and opens another (or none, with null). Resolves true once it is the open one, false when a
   * newer `pick`, `remove` or `dispose` came first. Rejects with `ItemNotFoundError` when it does not exist (the open
   * item stays) and with `ItemSaveError` when the open item could not be saved (it stays open). Away from a deleted
   * item it does not save, so the item stays deleted.
   */
  pick(id: string | null): Promise<boolean>;
  /** Creates an item (`data` or `newItem()`), saves it and opens it. Resolves with its id. */
  create(data?: T, title?: string): Promise<string>;
  /** Needs the `rename` option. The open item is changed through its handle, any other one is opened, changed and saved. */
  rename(id: string, title: string): Promise<void>;
  /**
   * Deletes an item, only if it has not been saved by another panel since the list was read (rejects with CONFLICT
   * otherwise). When it was the open one, the next in the list is opened, or none. Resolves with a function that
   * creates it again with its last data (and opens it when it was the open one); that rejects with CONFLICT when
   * another panel has made the same id again meanwhile.
   */
  remove(id: string): Promise<() => Promise<void>>;
  /**
   * Runs one async job at a time. Changes other panels make meanwhile (list updates, a delete of the open item, remote
   * edits of it) are held back and shown once when the queue is empty, so a panel in the middle of work is not
   * reloaded under it. The result and errors are the job's own.
   */
  job<R>(fn: () => Promise<R>): Promise<R>;
  /** Reads the list again. */
  refresh(): Promise<void>;
  /** Saves the open item. Never rejects; does nothing for an item deleted elsewhere (see `restoreDeleted`). */
  flush(): Promise<void>;
  /** The open item's `adoptRemote`: drops unsaved edits and shows the other panel's copy. Does nothing for none or a deleted item. */
  adoptRemote(): Promise<void>;
  /**
   * After the open item was deleted elsewhere: puts back the last copy the session had (unsaved edits included) with
   * `ifRevision: 0` and opens it again. Rejects with CONFLICT when another panel has made the id again. Does nothing
   * when the open item is not deleted.
   */
  restoreDeleted(): Promise<void>;
  onChange(fn: (event: ItemSessionEvent) => void): () => void;
  onStatus(fn: (status: DocumentStatus) => void): () => void;
  onError(fn: (error: unknown, kind: ItemErrorKind) => void): () => void;
  /** Saves the open item and stops listening. */
  dispose(): Promise<void>;
}

const lastKey = (prefix: string) => `items.last.${prefix}`;
const isConflict = (error: unknown): boolean => error instanceof TavoraError && error.code === "CONFLICT";

export async function openItems<T>(sdk: TavoraSDK, options: OpenItemsOptions<T>): Promise<ItemSession<T>> {
  const { prefix, parse, title } = options;
  const onAdd = options.onAdd ?? "last";
  const fallbackWhenDeleted = options.onDeleted === "fallback";
  const documentOptions = (): OpenDocumentOptions<T> => ({
    parse,
    title,
    ...(options.merge ? { merge: options.merge } : {}),
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
  });
  const contentOf = (id: string, data: T): PanelContent => (options.content ? options.content(id, data) : { id, title: title(data) });

  let items: readonly ItemSummary[] = [];
  let handle: DocumentHandle<T> | null = null;
  let currentId: string | null = null;
  let detach: Array<() => void> = [];
  /** The open item was deleted elsewhere and not brought back. */
  let deleted = false;
  /** The open item's last copy before a delete elsewhere, for `restoreDeleted`. */
  let lastCopy: T | null = null;
  /** How many saves of the open item gave up: a switch that sees it grow while saving stays on the item. */
  let saveFailures = 0;
  /** Bumped by every switch (and dispose): a switch that finds it changed while waiting has lost. */
  let generation = 0;
  let closed = false;

  const changeListeners = new Set<(event: ItemSessionEvent) => void>();
  const statusListeners = new Set<(status: DocumentStatus) => void>();
  const errorListeners = new Set<(error: unknown, kind: ItemErrorKind) => void>();
  const notify = <A extends unknown[]>(listeners: Set<(...args: A) => void>, ...args: A) => {
    for (const fn of [...listeners]) {
      try {
        fn(...args);
      } catch (error) {
        console.error("[tavora] item session listener failed", error);
      }
    }
  };
  const emit = (event: ItemSessionEvent) => notify(changeListeners, event);
  const report = (error: unknown, kind: ItemErrorKind) => notify(errorListeners, error, kind);

  // ---- the list
  let listing: Promise<void> | null = null;
  let listAgain = false;
  const fetchList = async () => {
    do {
      listAgain = false;
      try {
        const all = await sdk.documents.list();
        items = all
          .filter((doc) => doc.id.startsWith(prefix))
          .map(({ id, title: name, updatedAt, revision }) => ({ id, title: name, updatedAt, revision }));
        if (!closed) emit({ type: "list" });
      } catch (error) {
        report(error, "list");
      }
    } while (listAgain);
  };
  const refresh = (): Promise<void> => {
    if (listing) {
      listAgain = true;
      return listing;
    }
    listing = fetchList().finally(() => (listing = null));
    return listing;
  };

  // ---- panel content and the last used item
  let shownContent = "";
  const syncContent = () => {
    const next = handle && currentId ? contentOf(currentId, handle.data) : null;
    const key = JSON.stringify(next);
    if (key === shownContent) return;
    shownContent = key;
    sdk.panel.setContent(next).catch(() => undefined); // an older Tavora has no content; nothing to do then
  };
  let lastWritten: string | undefined;
  const rememberLast = (id: string | null) => {
    if (!id || id === lastWritten) return;
    lastWritten = id;
    sdk.storage.set(lastKey(prefix), id).catch(() => (lastWritten = undefined));
  };

  // ---- busy jobs
  let running = 0;
  let jobs: Promise<unknown> = Promise.resolve();
  /** What came in during a job. `id` is the open item they are about: a pick makes them stale. */
  const held = { list: false, current: false, deleted: false, id: null as string | null };
  const busy = () => running > 0;
  /** Picks in flight: a fallback after a delete elsewhere must not override the item the user is switching to. */
  let picking = 0;

  async function fallbackFrom(removedId: string, before: readonly ItemSummary[]): Promise<void> {
    const index = before.findIndex((item) => item.id === removedId);
    await refresh();
    if (closed || currentId !== removedId || picking > 0) return;
    const next = items[Math.min(Math.max(index, 0), items.length - 1)]?.id ?? null;
    try {
      await pick(next);
    } catch (error) {
      report(error, "pick");
    }
  }
  /** The fallback is a switch like any other, so it waits for a running job. */
  const fallbackInJob = (removedId: string, before: readonly ItemSummary[]) => void job(() => fallbackFrom(removedId, before)).catch(() => undefined);

  function replayHeld() {
    if (busy() || closed) return;
    const { list, current, deleted: wasDeleted, id } = held;
    held.list = held.current = held.deleted = false;
    held.id = null;
    const here = id === currentId; // a pick since then made the rest stale
    const before = items;
    if (list || (here && wasDeleted)) void refresh();
    if (!here || !currentId) return;
    if (wasDeleted) {
      emit({ type: "current", id: currentId, source: "remote", deleted: true });
      if (fallbackWhenDeleted) fallbackInJob(currentId, before);
    } else if (current) {
      emit({ type: "current", id: currentId, source: "remote", deleted: false });
    }
  }

  // ---- the open item
  function attach(next: DocumentHandle<T>, id: string) {
    let last: DocumentStatus = next.status;
    detach = [
      next.onChange((event) => {
        if (next !== handle) return;
        deleted = event.deleted;
        if (!event.deleted) lastCopy = event.data;
        syncContent();
        if (event.source === "remote") {
          if (event.deleted) {
            if (busy()) {
              held.deleted = true;
              held.id = id;
              return;
            }
            const before = items;
            void refresh();
            emit({ type: "current", id, source: "remote", deleted: true });
            if (fallbackWhenDeleted) fallbackInJob(id, before);
            return;
          }
          if (busy()) {
            held.current = true;
            held.id = id;
            return;
          }
        }
        emit({ type: "current", id, source: event.source, deleted: event.deleted });
      }),
      next.onStatus((status) => {
        if (next !== handle) return;
        // This panel's own saves send no `documents.changed` to itself, so the list learns of them here.
        if (last === "saving" && status !== "saving") void refresh();
        last = status;
        notify(statusListeners, status);
      }),
      next.onError((error, kind) => {
        if (next !== handle) return;
        if (kind === "save") saveFailures++;
        report(error, kind);
      }),
    ];
  }

  async function pick(id: string | null, restoring = false): Promise<boolean> {
    if (closed) throw new Error("the item session is closed");
    picking++;
    try {
      return await pickNow(id, restoring);
    } finally {
      picking--;
    }
  }

  async function pickNow(id: string | null, restoring: boolean): Promise<boolean> {
    if (id !== null) {
      // Checked before `generation` moves, so a wrong id cannot cancel a pick that is still waiting.
      if (!id.startsWith(prefix)) throw new ItemNotFoundError(id);
      if (!restoring && id === currentId && handle) return true;
    }
    const mine = ++generation;
    // An item deleted elsewhere is not saved: a flush would create it again, as a blank one.
    if (handle && !deleted) {
      const failures = saveFailures;
      await handle.flush();
      if (mine !== generation) return false;
      if (saveFailures !== failures) throw new ItemSaveError(currentId ?? "");
    }
    let next: DocumentHandle<T> | null = null;
    if (id !== null) {
      next = await openDocument(sdk, id, documentOptions());
      if (mine !== generation) {
        await next.dispose();
        return false;
      }
      if (next.revision === 0) {
        await next.dispose();
        throw new ItemNotFoundError(id);
      }
    }
    // Edits typed while the next item opened still went to the open one: save them before the swap, or stay.
    while (handle && !deleted && handle.status !== "idle") {
      const failures = saveFailures;
      await handle.flush();
      if (mine !== generation) {
        await next?.dispose();
        return false;
      }
      if (saveFailures !== failures) {
        await next?.dispose();
        throw new ItemSaveError(currentId ?? "");
      }
      if (handle.status === "error") break; // nothing left to save: the failure was reported already
    }
    const previous = handle;
    for (const off of detach) off();
    detach = [];
    handle = next;
    currentId = id;
    deleted = false;
    lastCopy = next ? next.data : null;
    held.current = held.deleted = false;
    held.id = null;
    if (next && id) attach(next, id);
    syncContent();
    rememberLast(id);
    emit({ type: "current", id, source: "pick", deleted: false });
    notify(statusListeners, next?.status ?? "idle");
    if (previous) {
      // Its closing save may fail too: the listeners are gone, so report from here.
      const off = previous.onError((error, kind) => report(error, kind));
      await previous.dispose();
      off();
      await refresh();
    }
    return true;
  }

  async function removeItem(id: string): Promise<() => Promise<void>> {
    if (closed) throw new Error("the item session is closed");
    const before = items;
    const wasCurrent = id === currentId && handle !== null;
    let mine = generation;
    let revision = 0;
    let data: JsonValue | null;
    let alreadyGone = false;
    if (wasCurrent && handle) {
      mine = ++generation; // a pick that is still waiting must not undo this
      const open = handle;
      alreadyGone = deleted;
      const copy = lastCopy;
      for (const off of detach) off();
      detach = [];
      // Nothing is open while the last save runs, so no keystroke goes to a closing handle.
      handle = null;
      currentId = null;
      deleted = false;
      lastCopy = null;
      syncContent();
      emit({ type: "current", id: null, source: "pick", deleted: false });
      await open.dispose(); // saves what is pending, so the revision below is the last one
      revision = open.revision;
      data = (alreadyGone ? copy : open.data) as JsonValue;
    } else {
      const stored = await sdk.documents.get(id);
      if (!stored) throw new ItemNotFoundError(id);
      // Delete only the copy the user saw: a newer save by another panel is a CONFLICT, not a silent loss.
      revision = before.find((item) => item.id === id)?.revision ?? stored.revision;
      data = stored.data;
    }
    if (!alreadyGone) {
      try {
        await sdk.documents.delete(id, { ifRevision: revision });
      } catch (error) {
        if (wasCurrent && mine === generation) await pick(id).catch(() => undefined); // still there: open it again
        await refresh();
        throw error;
      }
    }
    await refresh();
    if (wasCurrent && mine === generation) {
      const index = before.findIndex((item) => item.id === id);
      const next = items[Math.min(Math.max(index, 0), items.length - 1)]?.id ?? null;
      if (next) await pick(next).catch((error) => report(error, "pick"));
    }
    return async () => {
      if (closed) throw new Error("the item session is closed");
      await sdk.documents.put({ id, title: title(parse(data)), data, ifRevision: 0 });
      await refresh();
      if (wasCurrent) await pick(id);
    };
  }

  async function createItem(data?: T, name?: string, fixedId?: string): Promise<string> {
    if (closed) throw new Error("the item session is closed");
    let value = data ?? options.newItem?.() ?? parse(null);
    if (name !== undefined) {
      if (!options.rename) throw new Error("create(data, title) needs the rename option");
      const copy = structuredClone(value);
      value = options.rename(copy, name) ?? copy;
    }
    const id = fixedId ?? `${prefix}${globalThis.crypto.randomUUID()}`;
    await sdk.documents.put({ id, title: title(value), data: value as JsonValue, ifRevision: 0 });
    await refresh();
    await pick(id);
    return id;
  }

  async function renameItem(id: string, name: string): Promise<void> {
    if (closed) throw new Error("the item session is closed");
    const { rename } = options;
    if (!rename) throw new Error("rename() needs the rename option");
    const change = (draft: T) => rename(draft, name);
    if (id === currentId && handle) {
      handle.update(change);
      await handle.flush();
    } else {
      const other = await openDocument(sdk, id, documentOptions());
      try {
        if (other.revision === 0) throw new ItemNotFoundError(id);
        other.update(change);
        await other.flush();
      } finally {
        await other.dispose();
      }
    }
    await refresh();
  }

  async function restoreDeleted(): Promise<void> {
    if (closed) throw new Error("the item session is closed");
    const id = currentId;
    const copy = lastCopy;
    if (!deleted || !id || copy === null) return;
    await sdk.documents.put({ id, title: title(copy), data: copy as JsonValue, ifRevision: 0 });
    await refresh();
    await pick(id, true);
  }

  function job<R>(fn: () => Promise<R>): Promise<R> {
    running++;
    if (running === 1) emit({ type: "busy" });
    const run = jobs.then(fn, fn);
    jobs = run.catch(() => undefined);
    return run.finally(() => {
      running--;
      if (running === 0) emit({ type: "busy" });
      replayHeld();
    });
  }

  // ---- start: the list, then the item to show
  const unsubscribers = [
    sdk.documents.onChange((change) => {
      if (closed || !change.id.startsWith(prefix)) return;
      if (busy()) held.list = true;
      else void refresh();
    }),
  ];
  const session: ItemSession<T> = {
    get items() {
      return items;
    },
    get currentId() {
      return currentId;
    },
    get current() {
      return handle;
    },
    get status() {
      return handle?.status ?? "idle";
    },
    get busy() {
      return busy();
    },
    get deleted() {
      return deleted;
    },
    pick: (id) => pick(id),
    create: (data, name) => createItem(data, name),
    rename: renameItem,
    remove: removeItem,
    job,
    refresh,
    flush: async () => {
      if (handle && !deleted) await handle.flush();
    },
    adoptRemote: async () => {
      if (handle && !deleted) await handle.adoptRemote();
    },
    restoreDeleted,
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
      generation++;
      for (const off of [...unsubscribers, ...detach]) off();
      detach = [];
      const open = handle;
      handle = null;
      await open?.dispose();
      changeListeners.clear();
      statusListeners.clear();
      errorListeners.clear();
    },
  };

  try {
    // The first read must fail loudly: without a list nothing else works.
    const all = await sdk.documents.list();
    items = all.filter((doc) => doc.id.startsWith(prefix)).map(({ id, title: name, updatedAt, revision }) => ({ id, title: name, updatedAt, revision }));
    if (options.followNavigate !== false) {
      unsubscribers.push(
        sdk.panel.onNavigate(async (content) => {
          // A switch waits for a running job, so a `panels.open` never changes the item under it.
          if (!(await job(() => pick(content.id)))) throw new Error("another item was picked first");
        }),
      );
    }
    const launch = await sdk.panel.getLaunch().catch(() => ({ reason: "add" }) as const);
    let wanted: string | null;
    if (options.restore) {
      const state = await sdk.panel.getState().catch(() => null);
      wanted = await Promise.resolve(options.restore(launch, state)).catch(() => null);
    } else {
      wanted = launch.reason === "add" ? null : launch.content?.id ?? null;
    }
    let opened = false;
    if (wanted && wanted.startsWith(prefix)) {
      try {
        opened = await pick(wanted);
      } catch (error) {
        if (!(error instanceof ItemNotFoundError)) throw error;
      }
    }
    if (!opened && !currentId && onAdd !== "none") {
      const last = onAdd === "last" ? await sdk.storage.get<string>(lastKey(prefix)).catch(() => null) : null;
      lastWritten = last ?? undefined;
      const id = items.find((item) => item.id === last)?.id ?? items[0]?.id;
      if (id) {
        try {
          await pick(id);
        } catch (error) {
          if (!(error instanceof ItemNotFoundError)) throw error;
        }
      }
    }
    if (!currentId && items.length === 0 && options.whenEmpty) {
      const starter = options.whenEmpty();
      try {
        await createItem(starter.data, starter.title, `${prefix}start`);
      } catch (error) {
        if (!isConflict(error)) throw error;
        // Another panel made the starter first: show that one.
        await refresh();
        const id = items[0]?.id;
        if (id) await pick(id);
      }
    }
  } catch (error) {
    await session.dispose();
    throw error;
  }
  return session;
}
