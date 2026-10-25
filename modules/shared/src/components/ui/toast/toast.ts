// The list of toasts on screen, shared by every caller of useToast() and read by the Toaster.
import { shallowRef } from "vue";

export interface ToastOptions {
  title: string;
  description?: string;
  /** One button on the toast, such as Undo. Pressing it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
  variant?: "default" | "error";
  /** How long it stays, in milliseconds. */
  duration?: number;
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

/** Shows a toast and returns a function that dismisses it again. */
export function toast(options: ToastOptions): () => void {
  const id = nextId++;
  toasts.value = [...toasts.value, { ...options, id }].slice(-MAX_TOASTS);
  return () => dismissToast(id);
}

export function useToast() {
  return { toast, dismiss: dismissToast };
}
