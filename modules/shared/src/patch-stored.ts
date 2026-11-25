// Changes some fields of a stored settings object without writing the rest from a copy read earlier.
import type { JsonValue, KeyValueStore } from "@tavora/sdk";
import { isRecord } from "./lib/utils";

const ATTEMPTS = 5;

/**
 * Writes `change` over the newest stored copy of `key`: only those fields change. What the other fields hold stays as it
 * is stored, also when another panel saved them since this one read them (for `storage.app`, a panel in another workspace)
 * or a newer version of the module wrote a value this one doesn't know. Returns what is stored now, for the panel to show.
 *
 * `atomic`: the store has `compareAndSet` (`sdk.supports("storage.app.compareAndSet")` or `"storage.compareAndSet"`), so a save
 * that another one beat is tried again on the newer copy. Without it, the newest copy is read just before the write.
 */
export async function patchStored(store: KeyValueStore, key: string, change: Record<string, JsonValue>, options: { atomic?: boolean } = {}): Promise<Record<string, JsonValue>> {
  for (let attempt = 1; ; attempt++) {
    const stored = await store.get(key);
    const next = { ...(isRecord(stored) ? (stored as Record<string, JsonValue>) : {}), ...change };
    if (!options.atomic) {
      await store.set(key, next);
      return next;
    }
    if (await store.compareAndSet(key, stored, next)) return next;
    if (attempt >= ATTEMPTS) throw new Error(`Could not save ${key}: other panels kept saving first`);
  }
}
