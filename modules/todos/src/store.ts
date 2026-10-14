// Keeps this panel's copy of the to-do list and saves each change. Changes
// show at once; saving re-applies them to the newest stored list, so two
// panels editing at the same time both keep their changes.

import { errorMessage, readDocument, serial, updateDocument, type Versioned } from "@tavora/official-ui";
import type { TavoraSDK } from "@tavora/sdk";
import { ref, shallowRef } from "vue";
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
    list.value = stored.data;
  }

  function apply(change: (data: TodoList) => void): Promise<void> {
    const next = structuredClone(list.value);
    change(next);
    list.value = next;
    saving++;
    return queue(async () => {
      try {
        stored = await updateDocument(sdk, LIST_ID, { parse: parseList, change, title: () => LIST_TITLE, known: stored });
        error.value = null;
      } catch (reason) {
        error.value = `Could not save: ${errorMessage(reason)}`;
        // Show what is really stored rather than a change that was lost.
        stored = await readDocument(sdk, LIST_ID, parseList).catch(() => stored);
      } finally {
        saving--;
        if (saving === 0) list.value = stored.data;
      }
    });
  }

  /** Another panel saved: show its list unless this panel is still saving, which reads it anyway. */
  async function reload(): Promise<void> {
    if (saving > 0) return;
    const fresh = await readDocument(sdk, LIST_ID, parseList);
    if (saving > 0) return;
    stored = fresh;
    list.value = fresh.data;
  }

  return { list, error, load, apply, reload };
}
