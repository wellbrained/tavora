// The toast page's list of toasts: what the host page sent, in the kit's own store, so the kit's Toaster shows it. The
// functions a toast has in the host page (Undo, what to do when it goes) stay there; here they only report the press.
import { toasts } from "@tavora/official-ui/components/ui/toast";
import type { HostToast } from "../shared/host-toasts";

export interface ToastPresses {
  action(id: number): void;
  dismiss(id: number): void;
}

/** Toasts that left this page and that the host page has not heard of yet: a list sent a moment ago must not bring them back. */
const gone = new Set<number>();

export function mirrorToasts(items: readonly HostToast[], presses: ToastPresses): void {
  const ids = new Set(items.map((item) => item.id));
  for (const id of gone) if (!ids.has(id)) gone.delete(id);
  toasts.value = items
    .filter((item) => !gone.has(item.id))
    .map(({ action, ...item }) => ({
      ...item,
      ...(action ? { action: { label: action, onClick: () => presses.action(item.id) } } : {}),
      onDismiss: () => {
        gone.add(item.id);
        presses.dismiss(item.id);
      },
    }));
}
