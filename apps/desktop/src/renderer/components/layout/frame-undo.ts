// Undo toasts for frames removed on the Overlay page. The page already has its own undo (Ctrl+Z, the Undo button), so
// the toast never keeps a second copy of the removal: it names the step in the page's history (`removals` in the view),
// and its Undo takes back exactly that step, even with other changes since ("undo-step").
//
// The view says which removal steps can still be taken back. One that leaves that list (Ctrl+Z took it back, it was
// dropped because its frames changed, the page was opened anew) takes its toast with it, quietly: one key press never
// undoes twice. A step that comes back by redo gets no new toast.
import type { UndoOffer } from "@tavora/official-ui/undoable";
import type { LayoutView } from "../../../shared/layout-view";

export type Removal = LayoutView["removals"][number];

export function createFrameUndos(offer: (removal: Removal) => UndoOffer) {
  const offers = new Map<number, UndoOffer>();
  /** The newest step offered so far: older ones (back by redo) are not offered again. */
  let newest = 0;
  return {
    sync(removals: readonly Removal[]): void {
      const live = new Set(removals.map((removal) => removal.step));
      for (const [step, shown] of offers) {
        if (live.has(step)) continue;
        offers.delete(step);
        // Already undone or timed out, this does nothing; otherwise the toast goes without a word.
        shown.commit();
      }
      for (const removal of removals) {
        if (removal.step <= newest) continue;
        newest = removal.step;
        offers.set(removal.step, offer(removal));
      }
    },
    /** What the view already listed when the page opened is not new: no toast for it. */
    skip(removals: readonly Removal[]): void {
      for (const removal of removals) newest = Math.max(newest, removal.step);
    },
    /** The page is left: its toasts go, since their Undo needs the page. */
    drop(): void {
      for (const shown of offers.values()) shown.commit();
      offers.clear();
    },
  };
}
