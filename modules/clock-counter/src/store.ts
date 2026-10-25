// Keeps this panel's copy of the list and saves each change. Changes show at once; saving re-applies them to the
// newest stored list, so two panels changing it at the same time both keep their changes. After a save, the panel
// that made the change tells each touched item's overlay what it shows now.
import { errorMessage, readDocument, serial, updateDocument, type Versioned } from "@tavora/official-ui";
import type { TavoraSDK } from "@tavora/sdk";
import { ref, shallowRef } from "vue";
import { t } from "./i18n";
import { find, LIST_ID, LIST_TITLE, overlayState, parseList, type ItemList } from "./items";

export type ItemStore = ReturnType<typeof createItemStore>;

export function createItemStore(sdk: TavoraSDK) {
  const list = shallowRef<ItemList>(parseList(null));
  const error = ref<string | null>(null);
  let stored: Versioned<ItemList> = { data: list.value, revision: 0 };
  let saving = 0;
  const queue = serial();
  /** Whether the player allowed stream overlays; asked for on the first Copy OBS link, so it can turn true later. */
  const overlays = ref(sdk.host.capabilities.includes("overlay"));

  async function load(): Promise<void> {
    stored = await readDocument(sdk, LIST_ID, parseList);
    list.value = stored.data;
  }

  /** Tells the overlays of these items (OBS or over the game) what they show now; an item that is gone shows nothing. */
  function publish(ids: string[], data: ItemList): void {
    for (const id of ids) {
      const item = find(data, id);
      const sent = item ? sdk.overlay.publish(id, overlayState(item)) : sdk.overlay.remove(id);
      sent.catch((reason: unknown) => console.warn("[clock-counter] overlay", errorMessage(reason)));
    }
  }

  /** Applies a change to the items `touched` names, shows it and saves it. */
  function apply(touched: string[], change: (data: ItemList) => void): Promise<void> {
    const next = structuredClone(list.value);
    change(next);
    list.value = next;
    saving++;
    return queue(async () => {
      try {
        stored = await updateDocument(sdk, LIST_ID, { parse: parseList, change, title: () => LIST_TITLE, known: stored });
        error.value = null;
        publish(touched, stored.data);
      } catch (reason) {
        error.value = t("store.saveError", { error: errorMessage(reason) });
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

  return { list, error, load, apply, reload, publish, overlays };
}
