// Toasts wait while nobody can see them: a toast that expires while the game is in front, or while the panel is
// hidden, is a toast nobody read (and an Undo nobody could press). The Toaster holds every timer while any of these is
// true and starts them again when the user is back:
//  - the page is hidden (visibilitychange: minimised, or covered where the system says so),
//  - Tavora suspended the panel (`lifecycle.onSuspend`: its tab is in the background),
//  - Tavora's window is behind another program (`lifecycle.onBehindChange`, and for the app's own page the host's
//    window-behind message): the user is in the game. The page is not hidden then, so visibilitychange never tells.
import { computed, shallowRef } from "vue";

/** The page is not visible: minimised, covered by the game, or on a tab that is not shown. */
export const documentHidden = shallowRef(false);
/** Tavora told this panel it is hidden (`lifecycle.onSuspend`); a module panel can be hidden while its page is not. */
export const panelSuspended = shallowRef(false);
/** Tavora's window is behind another program, usually the game. */
export const windowBehind = shallowRef(false);
/** Toast timers stand still while this is true. */
export const toastsPaused = computed(() => documentHidden.value || panelSuspended.value || windowBehind.value);

/** The window went behind another program (true) or came back in front (false); the host page calls this. */
export function setWindowBehind(behind: boolean): void {
  windowBehind.value = behind;
}

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

/**
 * Follows the panel's `lifecycle` (onSuspend, onResume and, from Tavora 0.23.81, onBehindChange); call the returned
 * function to stop. A Tavora or SDK without `onBehindChange` just never says the window is behind.
 */
export function trackPanelSuspension(lifecycle: {
  onSuspend(fn: () => void): () => void;
  onResume(fn: () => void): () => void;
  onBehindChange?(fn: (behind: boolean) => void): () => void;
}): () => void {
  const stopSuspend = lifecycle.onSuspend(() => (panelSuspended.value = true));
  const stopResume = lifecycle.onResume(() => (panelSuspended.value = false));
  const stopBehind = lifecycle.onBehindChange?.((behind) => (windowBehind.value = behind));
  return () => {
    stopSuspend();
    stopResume();
    stopBehind?.();
    panelSuspended.value = false;
    windowBehind.value = false;
  };
}
