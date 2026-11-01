// Keeps this panel's copy of the list on top of the SDK's document store: changes show at once and are saved a moment
// later, re-applied on the newest stored list, so two panels changing it at the same time both keep their changes.
// After a save, the panel that made the change tells each touched item's overlay what it shows now.
import { errorMessage } from "@tavora/official-ui";
import type { TavoraSDK } from "@tavora/sdk";
import { openDocument } from "@tavora/sdk/store";
import { ref, shallowRef } from "vue";
import { t } from "./i18n";
import { find, groupOf, groupOverlayState, LIST_ID, LIST_TITLE, linkedGroups, overlayState, parseList, type Counter, type ItemList } from "./items";

/** A counter's name in a group's default line. */
export const counterName = (counter: Counter): string => counter.label || t("kind.counter");

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
  /** The overlay keys shown over the game now: a group's overlay is fed while it is shown, whether or not it was ever set up for stream. */
  let shown: ReadonlySet<string> = new Set();

  /**
   * Tells the overlays of these items (OBS or over the game) what they show now; an item that is gone shows nothing.
   * A linked group that has a key of its own (it was shown as a whole once) hears of it too: one line for all its counters.
   */
  function publish(ids: string[], data: ItemList): void {
    const warn = (reason: unknown) => console.warn("[clock-counter] overlay", errorMessage(reason));
    const groups = new Map<string, NonNullable<ReturnType<typeof groupOf>>>();
    for (const id of ids) {
      const item = find(data, id);
      (item ? sdk.overlay.publish(id, overlayState(item)) : sdk.overlay.remove(id)).catch(warn);
      const group = item?.kind === "counter" ? groupOf(data, id) : null;
      if (group) groups.set(group.key, group);
    }
    // Only a group with stream settings saved, or one shown over the game, has an overlay to feed.
    for (const group of groups.values()) if (group.members.some((member) => member.stream) || shown.has(group.key)) sdk.overlay.publish(group.key, groupOverlayState(group, counterName)).catch(warn);
  }

  /** Tells the overlay for `key` (an item's id, or a group's key) what it shows now: when the Overlay page just put it over the game, before any change. */
  function publishKey(key: string, data: ItemList): void {
    const item = find(data, key);
    if (item) return publish([item.id], data);
    const group = linkedGroups(data).find((one) => one.key === key);
    if (group) sdk.overlay.publish(group.key, groupOverlayState(group, counterName)).catch((reason) => console.warn("[clock-counter] overlay", errorMessage(reason)));
  }

  function setShown(keys: Iterable<string>): void {
    shown = new Set(keys);
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
    publishKey,
    setShown,
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
