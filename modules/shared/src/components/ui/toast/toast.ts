// The list of toasts on screen, shared by every caller of useToast() and read by the Toaster.
import { shallowRef } from "vue";

/** What a toast is about; it picks the icon and how long the toast stays. */
export type ToastKind = "default" | "success" | "error" | "warning" | "info" | "loading";

/** Where toasts show in the panel; the user picks it in Settings > Appearance and it comes with the theme. */
export type ToastPosition = "bottom-center" | "bottom-right" | "top-center";
const POSITIONS: readonly string[] = ["bottom-center", "bottom-right", "top-center"];

export interface ToastOptions {
  title: string;
  /** A short second line. Most toasts need only the title. */
  description?: string;
  /** One button on the toast, such as Undo. Pressing it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
  variant?: ToastKind;
  /** How long it stays, in milliseconds. Infinity or 0 keeps it until it is dismissed. Errors, warnings and loading stay by default. */
  duration?: number;
  /** Test id on the toast. */
  testid?: string;
  /** Test id on the action button. */
  actionTestid?: string;
  /** Keys that press the action, for screen readers (`aria-keyshortcuts`), such as "Control+Z" for Undo. */
  actionKeys?: string;
  /** Runs once when the toast goes, with why: its button was pressed, it was closed, its time ran out, or newer ones pushed it out. */
  onDismiss?: (reason: ToastDismissReason) => void;
}

/** Why a toast went away. */
export type ToastDismissReason = "action" | "closed" | "timeout" | "pushed";

export interface ToastItem extends ToastOptions {
  id: number;
  /** Goes up on every update, so the toast shows the new content and starts its time again. */
  revision: number;
}

export interface ToastHandle {
  id: number;
  dismiss: () => void;
  /** Changes the toast in place, say from loading to done; it changes shape instead of popping a new one. False when it is gone already. */
  update: (options: Partial<ToastOptions>) => boolean;
}

/** Five seconds is long enough to read a line and press Undo. */
export const TOAST_DURATION = 5000;
/** More than this at once would cover the panel; the oldest goes first. */
const MAX_TOASTS = 3;

export const toasts = shallowRef<ToastItem[]>([]);
export const toastPosition = shallowRef<ToastPosition>("bottom-center");
let nextId = 1;

/** Takes the position from the theme; anything unknown (older Tavora) means bottom center. */
export function setToastPosition(position: unknown): void {
  toastPosition.value = typeof position === "string" && POSITIONS.includes(position) ? (position as ToastPosition) : "bottom-center";
}

/** How long a toast stays: its own duration, else errors, warnings and loading until dismissed. */
export function toastDuration(item: ToastOptions): number {
  if (item.duration !== undefined) return item.duration;
  return item.variant === "error" || item.variant === "warning" || item.variant === "loading" ? Infinity : TOAST_DURATION;
}

export function dismissToast(id: number, reason: ToastDismissReason = "closed"): void {
  const gone = toasts.value.find((item) => item.id === id);
  if (!gone) return;
  toasts.value = toasts.value.filter((item) => item.id !== id);
  gone.onDismiss?.(reason);
}

function updateToast(id: number, options: Partial<ToastOptions>): boolean {
  if (!toasts.value.some((item) => item.id === id)) return false;
  toasts.value = toasts.value.map((item) => (item.id === id ? { ...item, ...options, id, revision: item.revision + 1 } : item));
  return true;
}

function show(options: ToastOptions): ToastHandle {
  const id = nextId++;
  const all = [...toasts.value, { ...options, id, revision: 0 }];
  toasts.value = all.slice(-MAX_TOASTS);
  for (const item of all.slice(0, -MAX_TOASTS)) item.onDismiss?.("pushed");
  return { id, dismiss: () => dismissToast(id), update: (next) => updateToast(id, next) };
}

type KindOptions = Omit<ToastOptions, "title" | "variant">;
const kind =
  (variant: ToastKind) =>
  (title: string, options: KindOptions = {}): ToastHandle =>
    show({ ...options, title, variant });

/**
 * Shows a toast. `toast.success("Saved")` and friends pick the kind; `toast.promise` shows loading
 * while a promise runs, then turns into done or failed.
 */
export const toast = Object.assign(show, {
  success: kind("success"),
  error: kind("error"),
  warning: kind("warning"),
  info: kind("info"),
  loading: kind("loading"),
  dismiss: (id: number) => dismissToast(id),
  promise<T>(
    promise: Promise<T>,
    texts: { loading: string; success: string | ((value: T) => string); error: string | ((reason: unknown) => string) },
  ): Promise<T> {
    const handle = show({ title: texts.loading, variant: "loading" });
    promise.then(
      (value) => handle.update({ variant: "success", title: typeof texts.success === "function" ? texts.success(value) : texts.success }),
      (reason: unknown) => handle.update({ variant: "error", title: typeof texts.error === "function" ? texts.error(reason) : texts.error }),
    );
    return promise;
  },
});

/**
 * What the Toaster's live regions should say now: the newest toast that is new or changed since `heard` (the revision
 * each toast was read out at, kept up to date here), errors in the alert region. Undefined: nothing new to say there.
 * A toast that leaves is forgotten, but never makes an older one be read again.
 */
export function toAnnounce(list: readonly ToastItem[], heard: Map<number, number>): { status?: string; alert?: string } {
  const out: { status?: string; alert?: string } = {};
  for (const item of list) {
    if (heard.get(item.id) === item.revision) continue;
    heard.set(item.id, item.revision);
    out[item.variant === "error" ? "alert" : "status"] = [item.title, item.description].filter(Boolean).join(". ");
  }
  for (const id of [...heard.keys()]) if (!list.some((item) => item.id === id)) heard.delete(id);
  return out;
}

export function useToast() {
  return { toast, dismiss: dismissToast };
}
