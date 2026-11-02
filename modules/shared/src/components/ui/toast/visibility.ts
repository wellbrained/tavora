// Toasts wait while nobody can see them: a toast that expires while the game is in front, or while the panel is
// hidden, is a toast nobody read. The Toaster holds every timer while either is true and starts them again when the
// panel is seen. A window that only lost focus is not hidden (it can still be looked at), so blur does not count.
import { computed, shallowRef } from "vue";

/** The page is not visible: minimised, covered by the game, or on a tab that is not shown. */
export const documentHidden = shallowRef(false);
/** Tavora told this panel it is hidden (`lifecycle.onSuspend`); a module panel can be hidden while its page is not. */
export const panelSuspended = shallowRef(false);
/** Toast timers stand still while this is true. */
export const toastsPaused = computed(() => documentHidden.value || panelSuspended.value);

/** The part of `document` this needs; a test passes its own. */
export interface VisibilityTarget {
  visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Follows the page's visibility; call the returned function to stop. */
export function trackDocumentVisibility(target: VisibilityTarget | undefined = typeof document === "undefined" ? undefined : document): () => void {
  if (!target) return () => {};
  const update = () => (documentHidden.value = target.visibilityState === "hidden");
  update();
  target.addEventListener("visibilitychange", update);
  return () => {
    target.removeEventListener("visibilitychange", update);
    documentHidden.value = false;
  };
}

/** Follows `lifecycle.onSuspend` and `onResume` of a connected panel; call the returned function to stop. */
export function trackPanelSuspension(lifecycle: { onSuspend(fn: () => void): () => void; onResume(fn: () => void): () => void }): () => void {
  const stopSuspend = lifecycle.onSuspend(() => (panelSuspended.value = true));
  const stopResume = lifecycle.onResume(() => (panelSuspended.value = false));
  return () => {
    stopSuspend();
    stopResume();
    panelSuspended.value = false;
  };
}
