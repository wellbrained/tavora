// Hotkeys of items that are gone. A delete keeps the item's hotkeys while its Undo is open and lets them go when the
// delete is final; but closing a panel destroys its page without letting it finish (Tavora refuses calls from a page
// that is going), and a crash ends it too. So on every start the panel lets go of the hotkeys of items that are gone.
import type { HotkeyBinding } from "@tavora/sdk";
import type { ItemList } from "./items";

export interface HotkeysApi {
  list(): Promise<HotkeyBinding[]>;
  remove(target: string): Promise<unknown>;
}

/** Removes every hotkey whose item is not in the list; answers the targets it let go of. Never rejects. */
export async function sweepHotkeys(hotkeys: HotkeysApi, list: ItemList): Promise<string[]> {
  const bindings = await hotkeys.list().catch((): HotkeyBinding[] => []);
  const items = new Set(list.items.map((item) => item.id));
  const gone = [...new Set(bindings.map((binding) => binding.target).filter((target) => !items.has(target)))];
  await Promise.all(gone.map((target) => hotkeys.remove(target).catch(() => undefined)));
  return gone;
}
