import type { KeyObject } from "node:crypto";

/**
 * The saved official key, or null. A saved key that is no longer trusted (revoked, or the pins moved on) is
 * deleted from the key store on the spot, so it is not kept around. `onForgotten` runs after it is gone.
 */
export async function loadTrustedSavedKey(
  store: { load(): Promise<KeyObject | null>; forget(): Promise<void> },
  keyTrusted: (key: KeyObject) => boolean,
  onForgotten: () => void,
): Promise<KeyObject | null> {
  const key = await store.load();
  if (key && !keyTrusted(key)) {
    await store.forget();
    onForgotten();
    return null;
  }
  return key;
}
