// Tavora's own toasts ("Layout deleted · Undo", "Frame removed") are shown by a small page of their own that sits on top of
// every panel, so they can show where the user put them (main/toast-view.ts). The host page keeps the list and the actions;
// this is what goes between the two pages and the main process in the middle, and where the page goes in the window.

export type HostToastPosition = "bottom-center" | "bottom-right" | "top-center";
export type HostToastKind = "default" | "success" | "error" | "warning" | "info" | "loading";

/** One toast as the host page hands it over: its words and settings, never its functions. */
export interface HostToast {
  id: number;
  revision: number;
  title: string;
  description?: string;
  variant?: HostToastKind;
  /** Milliseconds; Infinity keeps it until it is dismissed. */
  duration?: number;
  testid?: string;
  actionTestid?: string;
  /** The label of its one button, such as Undo; pressing it comes back as an "action" event. */
  action?: string;
}

/** What the toast page needs besides the toasts themselves. */
export interface ToastsLook {
  position: HostToastPosition;
  mode: "dark" | "light";
  /** The theme's colours by name (`toast`, `toast-foreground`, `background`, …). */
  colors: Record<string, string>;
  radius: number;
  language: string;
}

export interface ToastsPageState extends ToastsLook {
  items: HostToast[];
  /** How wide the toasts may lay themselves out: the window's width, up to what one toast needs. */
  room: number;
  /** Tavora is hidden: the toasts keep their time. */
  paused: boolean;
}

/** A press on a toast, on its way back to the host page. */
export interface ToastsEvent {
  type: "action" | "dismiss";
  id: number;
}

/** What the toast page can do: show what it is given, say how big it is, and report presses. Nothing else. */
export interface TavoraToastsApi {
  ready(): void;
  onState(listener: (state: ToastsPageState) => void): void;
  extent(size: { width: number; height: number }): void;
  action(id: number): void;
  dismiss(id: number): void;
  /** A press is done: the keys go back to the page they came from. */
  release(): void;
}

const POSITIONS: readonly string[] = ["bottom-center", "bottom-right", "top-center"];
const KINDS: readonly string[] = ["default", "success", "error", "warning", "info", "loading"];
/** The kit shows three at most; a few more cost nothing and a runaway list is cut. */
export const MAX_HOST_TOASTS = 8;
const TEST_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export function isToastPosition(value: unknown): value is HostToastPosition {
  return typeof value === "string" && POSITIONS.includes(value);
}

const text = (value: unknown, max: number): string | undefined => (typeof value === "string" ? value.slice(0, max) : undefined);

/** The toasts the host page sent, kept to what is allowed; anything else is left out. The host page is Tavora's own, but a bad list never reaches the toast page. */
export function cleanToasts(raw: unknown): HostToast[] {
  if (!Array.isArray(raw)) return [];
  const items: HostToast[] = [];
  for (const entry of raw.slice(-MAX_HOST_TOASTS) as unknown[]) {
    const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const title = text(item.title, 300);
    if (typeof item.id !== "number" || !Number.isSafeInteger(item.id) || typeof item.revision !== "number" || !Number.isSafeInteger(item.revision) || title === undefined) continue;
    const clean: HostToast = { id: item.id, revision: item.revision, title };
    const description = text(item.description, 600);
    if (description) clean.description = description;
    if (typeof item.variant === "string" && KINDS.includes(item.variant)) clean.variant = item.variant as HostToastKind;
    if (typeof item.duration === "number" && item.duration >= 0 && !Number.isNaN(item.duration)) clean.duration = item.duration;
    if (typeof item.testid === "string" && TEST_ID.test(item.testid)) clean.testid = item.testid;
    if (typeof item.actionTestid === "string" && TEST_ID.test(item.actionTestid)) clean.actionTestid = item.actionTestid;
    const action = text(item.action, 60);
    if (action) clean.action = action;
    items.push(clean);
  }
  return items;
}

export interface Size {
  width: number;
  height: number;
}

export interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the kit's toast lays itself out with: a toast is 420 px at most, and sits 16 px from the edge it is anchored to. */
const KIT_EDGE = 16;
const MAX_PILL = 420;
/** The most room the toasts lay themselves out in. */
export const TOAST_ROOM_MAX = MAX_PILL + 2 * KIT_EDGE;
/** Around the toasts, on the sides they are not anchored to, the page keeps this much so the shadow is not cut off. */
export const TOAST_GUTTER = 24;
/** At the top, the toasts start below the header: it drags the window and would swallow every press on a toast. */
export const TOAST_TOP_CLEARANCE = 56;
/** The most a size reported by the toast page may be; a runaway value never makes a window-sized view. */
const MAX_EXTENT = 4000;

/** How much room the toasts may lay themselves out in, for a window this wide. */
export function toastRoom(windowWidth: number): number {
  return Math.max(0, Math.min(TOAST_ROOM_MAX, Math.floor(windowWidth)));
}

/** The size the toast page reported, whole numbers in a sane range; null when it is not a size. */
export function cleanExtent(raw: unknown): Size | null {
  const item = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof Size, unknown>>;
  const { width, height } = item;
  if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return null;
  return { width: Math.min(MAX_EXTENT, Math.ceil(width)), height: Math.min(MAX_EXTENT, Math.ceil(height)) };
}

/**
 * Where the toast page goes in the window (in its content's coordinates) for toasts that take `extent`: just their box
 * and the room for their shadow, pinned to the corner or edge they are anchored to, so presses anywhere else reach the
 * panels. Null when there are no toasts.
 */
export function toastBounds(position: HostToastPosition, extent: Size, area: Size): Place | null {
  if (extent.width < 1 || extent.height < 1 || area.width < 1 || area.height < 1) return null;
  const top = position === "top-center" ? Math.min(TOAST_TOP_CLEARANCE, area.height - 1) : 0;
  const width = Math.min(area.width, extent.width + 2 * TOAST_GUTTER);
  const height = Math.min(area.height - top, KIT_EDGE + extent.height + TOAST_GUTTER);
  const x = position === "bottom-right" ? area.width - width : Math.round((area.width - width) / 2);
  const y = position === "top-center" ? top : area.height - height;
  return { x, y, width, height };
}
