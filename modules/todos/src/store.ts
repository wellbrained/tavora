// Keeps this panel's copy of the to-do list and saves each change. Changes
// show at once; saving re-applies them to the newest stored list, so two
// panels editing at the same time both keep their changes. A new list keeps
// the parts that did not change, so rows that stay the same are not drawn
// again and an open menu stays open when a save comes back.

import { errorMessage, readDocument, serial, updateDocument, type Versioned } from "@tavora/official-ui";
import type { JsonValue, TavoraSDK } from "@tavora/sdk";
import { ref, shallowRef } from "vue";
import { t } from "./i18n";
import { LIST_ID, LIST_TITLE, parseList, type TodoList } from "./todos";

export type TodoStore = ReturnType<typeof createTodoStore>;

export function createTodoStore(sdk: TavoraSDK) {
  /** What the panel shows: the stored list plus changes still being saved. */
  const list = shallowRef<TodoList>(parseList(null));
  const error = ref<string | null>(null);
  /** The last list this panel knows is stored. */
  let stored: Versioned<TodoList> = { data: list.value, revision: 0 };
  let saving = 0;
  const queue = serial();

  async function load(): Promise<void> {
    stored = await readDocument(sdk, LIST_ID, parseList);
    show(stored.data);
  }

  function apply(change: (data: TodoList) => void): Promise<void> {
    const next = structuredClone(list.value);
    change(next);
    show(next);
    saving++;
    return queue(async () => {
      try {
        stored = await updateDocument(sdk, LIST_ID, { parse: parseList, change, title: () => LIST_TITLE, known: stored });
        error.value = null;
      } catch (reason) {
        error.value = t("store.saveError", { error: errorMessage(reason) });
        // Show what is really stored rather than a change that was lost.
        stored = await readDocument(sdk, LIST_ID, parseList).catch(() => stored);
      } finally {
        saving--;
        if (saving === 0) show(stored.data);
      }
    });
  }

  /** Another panel saved: show its list unless this panel is still saving, which reads it anyway. */
  async function reload(): Promise<void> {
    if (saving > 0) return;
    const fresh = await readDocument(sdk, LIST_ID, parseList);
    if (saving > 0) return;
    stored = fresh;
    show(fresh.data);
  }

  function show(next: TodoList): void {
    list.value = keepSame(list.value, next);
  }

  return { list, error, load, apply, reload };
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
