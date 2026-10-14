// Host UI state: the latest view state from the main process, plus the
// dialog, menu and toast that are shown over it.
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { ActionResult, HostAction, HostViewState } from "../shared/host-api";

export const api = window.tavoraHost;
export const state = shallowRef<HostViewState | null>(null);

api.onState((next) => (state.value = next));
void api.getState().then((initial) => {
  if (initial && !state.value) state.value = initial;
});

export const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string): void {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 5000);
}

/** Runs an action. Errors are shown as a toast unless the caller handles them. */
export async function act(action: HostAction, { quiet = false } = {}): Promise<ActionResult> {
  const result = await api.act(action);
  if (!result.ok && !quiet) showToast(result.error);
  return result;
}

// ── Menus and dialogs ──────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  testid?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Opens a nested list. */
  submenu?: () => MenuItem[];
  run?: () => unknown;
}

export interface PromptRequest {
  kind: "prompt";
  title: string;
  label: string;
  value: string;
  confirm: string;
  maxLength: number;
  /** Returns an error to show, or null when done. */
  submit(value: string): Promise<string | null>;
}

export interface ConfirmRequest {
  kind: "confirm";
  title: string;
  message: string;
  confirm: string;
  danger: boolean;
  run(): Promise<string | null>;
}

export type DialogRequest = PromptRequest | ConfirmRequest | { kind: "add-game" };

export const dialog = shallowRef<DialogRequest | null>(null);

export function prompt(request: Omit<PromptRequest, "kind" | "value" | "maxLength"> & { value?: string; maxLength?: number }) {
  dialog.value = { kind: "prompt", value: "", maxLength: 80, ...request };
}

export function confirmAction(request: Omit<ConfirmRequest, "kind" | "danger"> & { danger?: boolean }) {
  dialog.value = { kind: "confirm", danger: false, ...request };
}

/** Prompt submit helper: runs the action and reports its error inline. */
export async function submitAction(action: HostAction): Promise<string | null> {
  const result = await act(action, { quiet: true });
  return result.ok ? null : result.error;
}

// Module panels are separate native views drawn above this page, so they
// are hidden while a menu or dialog floats over the workspace.
const openMenus = ref(0);

/** For a menu component: reports its open state, also when it unmounts open. */
export function useFloating(): (open: boolean) => void {
  let isOpen = false;
  const set = (open: boolean) => {
    if (open === isOpen) return;
    isOpen = open;
    openMenus.value += open ? 1 : -1;
  };
  onBeforeUnmount(() => set(false));
  return set;
}

const overlayOpen = computed(() => openMenus.value > 0 || dialog.value !== null);
watch(overlayOpen, (open) => api.setOverlay(open));
