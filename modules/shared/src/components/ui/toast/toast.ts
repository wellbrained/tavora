// The list of toasts on screen, shared by every caller of useToast() and read by the Toaster.
import { shallowRef } from "vue";

export interface ToastOptions {
  title: string;
  description?: string;
  /** One button on the toast, such as Undo. Pressing it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
  variant?: "default" | "error";
  /** How long it stays, in milliseconds. Infinity or 0 keeps it until it is dismissed. */
  duration?: number;
  /** Test id on the toast. */
  testid?: string;
  /** Test id on the action button. */
  actionTestid?: string;
}

export interface ToastItem extends ToastOptions {
  id: number;
}

/** Five seconds is long enough to read a line and press Undo. */
export const TOAST_DURATION = 5000;
/** More than this at once would cover the panel; the oldest goes first. */
const MAX_TOASTS = 3;

export const toasts = shallowRef<ToastItem[]>([]);
let nextId = 1;

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((item) => item.id !== id);
}

/** Shows a toast. `dismiss()` on the result closes it early. */
export function toast(options: ToastOptions): { id: number; dismiss: () => void } {
  const id = nextId++;
  toasts.value = [...toasts.value, { ...options, id }].slice(-MAX_TOASTS);
  return { id, dismiss: () => dismissToast(id) };
}

export function useToast() {
  return { toast, dismiss: dismissToast };
}
