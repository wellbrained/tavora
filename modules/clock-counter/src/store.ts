// Keeps this panel's copy of the list on top of the SDK's document store: changes show at once and are saved a moment
// later, re-applied on the newest stored list, so two panels changing it at the same time both keep their changes.
// After a save, the panel that made the change tells each touched item's overlay what it shows now.
import { errorMessage } from "@tavora/official-ui";
import type { TavoraSDK } from "@tavora/sdk";
import { openDocument } from "@tavora/sdk/store";
import { ref, shallowRef } from "vue";
import { t } from "./i18n";
import { find, LIST_ID, LIST_TITLE, overlayState, parseList, type ItemList } from "./items";

export type ItemStore = Awaited<ReturnType<typeof createItemStore>>;

export async function createItemStore(sdk: TavoraSDK, options: { debounceMs?: number } = {}) {
  const doc = await openDocument(sdk, LIST_ID, { parse: parseList, title: () => LIST_TITLE, debounceMs: options.debounceMs ?? 0 });
  /** What the panel shows: the stored list plus changes still being saved. */
  const list = shallowRef<ItemList>(doc.data);
  const error = ref<string | null>(null);
  /** Whether the user allowed stream overlays; asked for on the first Copy OBS link, so it can turn true later. */
  const overlays = ref(sdk.host.capabilities.includes("overlay"));
  /** Items changed here whose overlays have not been told yet. */
  const touched = new Set<string>();

  /** Tells the overlays of these items (OBS or over the game) what they show now; an item that is gone shows nothing. */
  function publish(ids: string[], data: ItemList): void {
    for (const id of ids) {
      const item = find(data, id);
      const sent = item ? sdk.overlay.publish(id, overlayState(item)) : sdk.overlay.remove(id);
      sent.catch((reason: unknown) => console.warn("[clock-counter] overlay", errorMessage(reason)));
    }
  }

  doc.onChange((event) => (list.value = event.data));
  doc.onStatus((status) => {
    if (status === "dirty" || status === "saving") error.value = null;
    else if (status === "idle") {
      publish([...touched], doc.data);
      touched.clear();
    } else touched.clear();
  });
  doc.onError((reason, kind) => {
    if (kind === "save") error.value = t("store.saveError", { error: errorMessage(reason) });
  });

  return {
    list,
    error,
    overlays,
    publish,
    status: () => doc.status,
    /** Changes the list at once and saves it soon; the overlays of the `touched` items hear of it after the save. `change` runs again on a newer stored list, so it must not make ids. */
    apply(items: string[], change: (data: ItemList) => void): void {
      for (const id of items) touched.add(id);
      doc.update(change);
    },
    flush: () => doc.flush(),
    /** Saves what is left, then stops listening. */
    dispose: () => doc.dispose(),
  };
}
