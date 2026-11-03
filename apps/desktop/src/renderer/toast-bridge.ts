// The host page's side of Tavora's toasts. `toast()` and `undoable()` work as everywhere in the kit and fill the kit's list;
// nothing draws it here. The list goes to the toast page above the panels (main/toast-view.ts), and a press on a toast there
// comes back to run its button or dismiss it.
import { dismissToast, toasts, type ToastItem } from "@tavora/official-ui/components/ui/toast";
import { watch } from "vue";
import type { HostToast, ToastsEvent } from "../shared/host-toasts";

export interface ToastBridgeApi {
  sync(items: HostToast[]): void;
  onEvent(listener: (event: ToastsEvent) => void): void;
}

/** A toast without its functions. */
export function plainToast(item: ToastItem): HostToast {
  const { id, revision, title, description, variant, duration, testid, actionTestid, action } = item;
  return {
    id,
    revision,
    title,
    ...(description !== undefined ? { description } : {}),
    ...(variant !== undefined ? { variant } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(testid !== undefined ? { testid } : {}),
    ...(actionTestid !== undefined ? { actionTestid } : {}),
    ...(action ? { action: action.label } : {}),
  };
}

/** Starts sending; the function it returns stops it (for tests). */
export function bridgeToasts(api: ToastBridgeApi): () => void {
  // At once, not at the next tick: a toast and the change right after it reach the toast page in order.
  const stop = watch(toasts, (list) => api.sync(list.map(plainToast)), { immediate: true, flush: "sync" });
  api.onEvent(({ type, id }) => {
    const item = toasts.value.find((candidate) => candidate.id === id);
    if (!item) return;
    // The button runs here, where Undo knows what to put back; it dismisses its toast as it always did.
    if (type === "action") item.action?.onClick();
    else dismissToast(id);
  });
  return stop;
}
