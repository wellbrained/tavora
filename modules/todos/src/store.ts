// Keeps this panel's copy of the to-do list on top of the SDK's document store: changes show at once and are saved a
// moment later, re-applied on the newest stored list, so two panels editing at the same time both keep their changes.
// A new list keeps the parts that did not change, so rows that stay the same are not drawn again and an open menu
// stays open when a save comes back.

import { errorMessage } from "@tavora/official-ui";
import type { JsonValue, TavoraSDK } from "@tavora/sdk";
import { openDocument, type DocumentChangeFn, type DocumentStatus } from "@tavora/sdk/store";
import { ref, shallowRef } from "vue";
import { t } from "./i18n";
import { LIST_ID, LIST_TITLE, parseList, type TodoList } from "./todos";

export type TodoStore = Awaited<ReturnType<typeof createTodoStore>>;

export async function createTodoStore(sdk: TavoraSDK, options: { debounceMs?: number } = {}) {
  const doc = await openDocument(sdk, LIST_ID, { parse: parseList, title: () => LIST_TITLE, debounceMs: options.debounceMs ?? 0 });
  /** What the panel shows: the stored list plus changes still being saved. */
  const list = shallowRef<TodoList>(doc.data);
  const error = ref<string | null>(null);
  const status = ref<DocumentStatus>(doc.status);

  doc.onChange((event) => (list.value = keepSame(list.value, event.data)));
  doc.onStatus((next) => {
    status.value = next;
    if (next === "dirty" || next === "saving") error.value = null;
  });
  doc.onError((reason, kind) => {
    if (kind === "save") error.value = t("store.saveError", { error: errorMessage(reason) });
  });

  return {
    list,
    error,
    status,
    /** Changes the list at once and saves it soon. `change` runs again on a newer stored list, so it must not make ids. */
    apply: (change: DocumentChangeFn<TodoList>): void => doc.update(change),
    flush: () => doc.flush(),
    /** Saves what is left, then stops listening. */
    dispose: () => doc.dispose(),
  };
}

/**
 * `next`, but with every part that equals the same part of `previous` taken
 * from `previous`. When nothing changed, `previous` itself comes back.
 */
export function keepSame<T>(previous: T, next: T): T {
  if (previous === next) return previous;
  const a = previous as JsonValue;
  const b = next as JsonValue;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return next;
  if (Array.isArray(a) && Array.isArray(b)) {
    const items = b.map((item, index) => (index < a.length ? keepSame(a[index], item) : item));
    return (items.length === a.length && items.every((item, index) => item === a[index]) ? previous : items) as T;
  }
  const before = a as { [key: string]: JsonValue };
  const after = b as { [key: string]: JsonValue };
  const entries = Object.entries(after).map(([key, value]) => [key, key in before ? keepSame(before[key], value) : value] as const);
  const same = entries.length === Object.keys(before).length && entries.every(([key, value]) => key in before && value === before[key]);
  const merged = Object.fromEntries(entries);
  return (same ? previous : merged) as T;
}
