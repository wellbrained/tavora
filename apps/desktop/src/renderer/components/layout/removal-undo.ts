// The Overlay page's Undo after a remove: each frame (or set of frames) the user removes gets a toast "Frame removed"
// with Undo, as deleting does everywhere else (undoable in the kit). The page already has an undo stack (Ctrl+Z,
// layout-history.ts) and the remove is a step on it, so both take back the same step and never twice:
// - Undo on the toast takes back that remove only, in the setup it was made in, even after other changes or a switch
//   to another setup (`undo-removal`).
// - Ctrl+Z stays the page's: it takes back the newest step. When that is the remove, its toast goes away.
// - The toast's offer is kept off Ctrl+Z (`key: false`), so the window's own Ctrl+Z for deletes never acts here.
// Leaving the page ends the offers; the delete stays (the page's history starts over when it opens again).
import { watch, type Ref } from "vue";
import { undoable, type Undoable } from "@tavora/official-ui/components/ui/toast";
import type { LayoutMessage, LayoutView } from "../../../shared/layout-view";

/** How long Undo waits for the page's answer before it counts as not done. */
const ANSWER_MS = 3000;

export interface RemovalUndoOptions {
  view: Ref<LayoutView | null>;
  send(message: LayoutMessage): void;
  title(count: number): string;
}

export function watchRemovals({ view, send, title }: RemovalUndoOptions): { stop(): void } {
  const offers = new Map<number, Undoable>();
  /** Removes up to this step were made before the page showed (or were offered already): no toast for them. */
  let seen: number | null = null;

  const undo = (step: number) =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), ANSWER_MS);
      const stopWatch = watch(
        () => view.value?.undone,
        (undone) => {
          if (undone?.step === step) finish(undone.ok);
        },
      );
      function finish(ok: boolean) {
        clearTimeout(timer);
        stopWatch();
        resolve(ok);
      }
      send({ type: "undo-removal", step });
    });

  const stopView = watch(
    () => view.value?.removals,
    (removals) => {
      if (!removals) return;
      const steps = new Set(removals.map((removal) => removal.step));
      if (seen === null) seen = Math.max(0, ...steps);
      for (const removal of removals) {
        if (removal.step <= seen) continue;
        seen = removal.step;
        const offer = undoable({ title: title(removal.count), key: false, undo: () => undo(removal.step), onFinal: () => offers.delete(removal.step) });
        offers.set(removal.step, offer);
      }
      // Gone from the list: Ctrl+Z took it back (or its frames changed since). The toast goes without a word.
      for (const [step, offer] of offers) {
        if (steps.has(step)) continue;
        offer.drop();
        offers.delete(step);
      }
    },
    { immediate: true },
  );

  return {
    stop() {
      stopView();
      for (const offer of offers.values()) offer.close();
      offers.clear();
    },
  };
}
