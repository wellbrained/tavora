// Deleting a clock or counter: it is gone at once (and saved), and a toast offers Undo for a few seconds (the kit's
// undoable, so Ctrl+Z takes it back too). Its hotkeys stay while the offer is open, so Undo brings it back working;
// once the delete is final (time ran out, the toast was closed or pushed out, the panel closed) they go too.
import { undoable, type Undoable } from "@tavora/official-ui/components/ui/toast";
import type { Item } from "./items";

export interface DeleteOfferOptions {
  /** "Deleted “Deaths”". */
  title: string;
  /** Puts the item back at `index`; false when it can't come back (the list is full, its id is taken). */
  restore: (item: Item, index: number) => boolean | void;
  /** The delete is final: the item's hotkeys go. */
  forget: (item: Item) => void;
}

export function offerDelete(item: Item, index: number, options: DeleteOfferOptions): Undoable {
  const kept = structuredClone(item);
  let back = false;
  return undoable({
    title: options.title,
    undo: () => {
      // One that can't come back is final, so onFinal lets its hotkeys go.
      const answer = options.restore(kept, index);
      if (answer !== false) back = true;
      return answer;
    },
    onFinal: () => {
      if (!back) options.forget(kept);
    },
  });
}
