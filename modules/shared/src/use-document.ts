// Vue wrapper around the SDK's document store (`@tavora/sdk/store`): reactive data and status for one document.

import { getCurrentScope, onScopeDispose, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type { TavoraSDK } from "@tavora/sdk";
import { openDocument, type DocumentChangeFn, type DocumentHandle, type DocumentStatus, type OpenDocumentOptions } from "@tavora/sdk/store";

export interface UseDocument<T> {
  /** The current value, edits included; `parse(null)` until the document is loaded. Replaced, never mutated. */
  data: Readonly<ShallowRef<T>>;
  status: Readonly<Ref<DocumentStatus>>;
  /** The last save error, until the next edit. */
  error: Readonly<Ref<unknown>>;
  /** True once the stored copy has been read. */
  loaded: Readonly<Ref<boolean>>;
  /** Resolves with the handle when loaded (e.g. for `onChange`); rejects when the document cannot be read. */
  ready: Promise<DocumentHandle<T>>;
  update(change: DocumentChangeFn<T>): void;
  flush(): Promise<void>;
}

/**
 * Opens a document for this component: it is closed (unsaved edits saved first) when the surrounding scope or
 * component is disposed. Edits made before it is loaded wait for the load.
 */
export function useDocument<T>(sdk: TavoraSDK, id: string, options: OpenDocumentOptions<T>): UseDocument<T> {
  const data = shallowRef<T>(options.parse(null));
  const status = ref<DocumentStatus>("idle");
  const error = shallowRef<unknown>(undefined);
  const loaded = ref(false);
  let handle: DocumentHandle<T> | undefined;
  let disposed = false;

  const ready = openDocument(sdk, id, options).then((opened) => {
    handle = opened;
    if (disposed) {
      void opened.dispose();
      return opened;
    }
    data.value = opened.data;
    status.value = opened.status;
    loaded.value = true;
    opened.onChange((event) => (data.value = event.data));
    opened.onStatus((next) => {
      status.value = next;
      if (next === "saving") error.value = undefined;
    });
    opened.onError((failure) => (error.value = failure));
    return opened;
  });

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
      void handle?.dispose();
    });
  }

  return {
    data,
    status,
    error,
    loaded,
    ready,
    update: (change) => (handle ? handle.update(change) : void ready.then((opened) => (disposed ? undefined : opened.update(change)))),
    flush: () => (handle ? handle.flush() : ready.then((opened) => opened.flush())),
  };
}
