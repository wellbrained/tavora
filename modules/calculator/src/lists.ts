// The workspace's last results and named values, together in one document so every panel of the workspace shows the same
// lists and sees another panel's change at once. Edits show at once and are saved a moment later on the newest stored
// copy, so two panels changing the lists at the same time both keep their changes.
import { errorMessage, useDocument } from "@tavora/official-ui";
import { unknownFields } from "@tavora/official-ui/lib/utils";
import { TavoraError, type JsonValue, type TavoraSDK } from "@tavora/sdk";
import { computed, effectScope, ref } from "vue";
import { HISTORY_KEY, parseHistory, type Calculation } from "./history";
import { t } from "./i18n";
import { parseValues, VALUES_KEY, type Value } from "./values";

export const LISTS_ID = "lists";
export const LISTS_TITLE = "Calculator history and values";

export type Lists = { history: Calculation[]; values: Value[] };

export function parseLists(raw: JsonValue | null): Lists {
  const stored = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, JsonValue | undefined>;
  // Fields a newer version added are kept as they are (unknownFields), so its data survives an edit made here.
  return { ...unknownFields<JsonValue>(stored, ["history", "values"]), history: parseHistory(stored.history ?? null), values: parseValues(stored.values ?? null) };
}

/**
 * Versions before kept the two lists as plain module storage values. The first panel to open without the document
 * copies them in; the old values stay where they are.
 */
export async function migrateLists(sdk: TavoraSDK): Promise<void> {
  if (await sdk.documents.get(LISTS_ID)) return;
  const history = parseHistory(await sdk.storage.get(HISTORY_KEY));
  const values = parseValues(await sdk.storage.get(VALUES_KEY));
  if (!history.length && !values.length) return;
  try {
    await sdk.documents.put({ id: LISTS_ID, title: LISTS_TITLE, data: { history, values } as unknown as JsonValue, ifRevision: 0 });
  } catch (reason) {
    // Another panel copied them first.
    if (!(reason instanceof TavoraError && reason.code === "CONFLICT")) throw reason;
  }
}

export type ListsStore = Awaited<ReturnType<typeof createListsStore>>;

export async function createListsStore(sdk: TavoraSDK, options: { debounceMs?: number } = {}) {
  await migrateLists(sdk);
  // Detached: the panel closes the store itself (`dispose`), not whatever scope happens to be running here.
  const scope = effectScope(true);
  const doc = scope.run(() => useDocument(sdk, LISTS_ID, { parse: parseLists, title: () => LISTS_TITLE, debounceMs: options.debounceMs ?? 0 }))!;
  const opened = await doc.ready;
  const history = computed<Calculation[]>(() => doc.data.value.history);
  const values = computed<Value[]>(() => doc.data.value.values);
  const error = ref<string | null>(null);
  /** Which list the last edit was in, for the words of a failed save. */
  let last: "history" | "values" = "history";

  opened.onStatus((status) => {
    if (status === "dirty" || status === "saving") error.value = null;
  });
  opened.onError((reason, kind) => {
    if (kind === "save") error.value = t(last === "history" ? "saveError" : "valuesError", { error: errorMessage(reason) });
  });

  return {
    history,
    values,
    error,
    /** Changes the history at once and saves it soon. `change` runs again on a newer stored list. */
    changeHistory(change: (items: Calculation[]) => Calculation[]): void {
      last = "history";
      doc.update((lists) => void (lists.history = change(lists.history)));
    },
    changeValues(change: (items: Value[]) => Value[]): void {
      last = "values";
      doc.update((lists) => void (lists.values = change(lists.values)));
    },
    flush: () => doc.flush(),
    /** Saves what is left, then stops listening. */
    dispose: () => {
      const saved = opened.dispose();
      // The scope ends too, so a change that comes later (a blur, a timer) is dropped, not an error.
      scope.stop();
      return saved;
    },
  };
}
