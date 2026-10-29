// Vue wrapper around the SDK's item session (`@tavora/sdk/store`): the items of one kind and the open one, reactive.

import { getCurrentScope, onScopeDispose, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type { TavoraSDK } from "@tavora/sdk";
import { openItems, type DocumentChangeFn, type DocumentStatus, type ItemSession, type ItemSummary, type OpenItemsOptions } from "@tavora/sdk/store";

export interface UseItemSession<T> {
  /** The items, newest save first. Empty until loaded. */
  items: Readonly<ShallowRef<readonly ItemSummary[]>>;
  /** The open item's id, or null. */
  currentId: Readonly<Ref<string | null>>;
  /** The open item's data, edits included; null for none. Replaced, never mutated. */
  current: Readonly<ShallowRef<T | null>>;
  status: Readonly<Ref<DocumentStatus>>;
  /** The last error (a failed save, list or pick, or the session not opening), until the next edit. */
  error: Readonly<Ref<unknown>>;
  /** True once the list is read and the first item is open (or there is none). */
  loaded: Readonly<Ref<boolean>>;
  /** Resolves with the session when loaded; rejects when it cannot be opened (also in `error`). */
  ready: Promise<ItemSession<T>>;
  /** Changes the open item; does nothing for none. */
  update(change: DocumentChangeFn<T>): void;
  pick(id: string | null): Promise<boolean>;
  create(data?: T, title?: string): Promise<string>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<() => Promise<void>>;
  job<R>(fn: () => Promise<R>): Promise<R>;
  /** Never rejects; does nothing before the session is open. */
  flush(): Promise<void>;
}

/**
 * Opens an item session for this component: the open item is saved and the session closed when the surrounding scope
 * or component is disposed. Calls made before it has loaded wait for it.
 */
export function useItemSession<T>(sdk: TavoraSDK, options: OpenItemsOptions<T>): UseItemSession<T> {
  const items = shallowRef<readonly ItemSummary[]>([]);
  const currentId = ref<string | null>(null);
  const current = shallowRef<T | null>(null);
  const status = ref<DocumentStatus>("idle");
  const error = shallowRef<unknown>(undefined);
  const loaded = ref(false);
  let session: ItemSession<T> | undefined;
  let disposed = false;

  const ready = openItems(sdk, options).then(
    (opened) => {
      session = opened;
      if (disposed) {
        void opened.dispose();
        return opened;
      }
      const sync = () => {
        items.value = opened.items;
        currentId.value = opened.currentId;
        current.value = opened.current?.data ?? null;
        status.value = opened.status;
      };
      sync();
      loaded.value = true;
      opened.onChange(sync);
      opened.onStatus((next) => {
        status.value = next;
        if (next === "dirty" || next === "saving") error.value = undefined;
      });
      opened.onError((failure, kind) => {
        if (kind !== "reload") error.value = failure;
      });
      return opened;
    },
    (failure: unknown) => {
      error.value = failure;
      throw failure;
    },
  );
  // Whoever does not await `ready` must not get an unhandled rejection; `error` carries it.
  ready.catch(() => undefined);

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
      void session?.dispose();
    });
  }

  const use = <R>(fn: (opened: ItemSession<T>) => R | Promise<R>): Promise<R> => ready.then(fn);
  return {
    items,
    currentId,
    current,
    status,
    error,
    loaded,
    ready,
    update: (change) => session?.current?.update(change),
    pick: (id) => use((opened) => opened.pick(id)),
    create: (data, title) => use((opened) => opened.create(data, title)),
    rename: (id, title) => use((opened) => opened.rename(id, title)),
    remove: (id) => use((opened) => opened.remove(id)),
    job: (fn) => use((opened) => opened.job(fn)),
    flush: () => (session ? session.flush() : ready.then((opened) => opened.flush(), () => undefined)),
  };
}
