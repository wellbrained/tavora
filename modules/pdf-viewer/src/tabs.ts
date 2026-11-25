// Which files a panel has open as tabs, and which one is shown. This is the panel's own state, kept across restarts.
// What a newer version keeps there besides is carried along (unknownFields), so it is still there after a change here.
import { unknownFields } from "@tavora/official-ui/lib/utils";

export interface TabState {
  tabs: string[];
  active: string | null;
  [key: string]: unknown;
}

export const emptyTabs = (): TabState => ({ tabs: [], active: null });

export function parseTabState(raw: unknown): TabState {
  if (typeof raw !== "object" || raw === null) return emptyTabs();
  const value = raw as { tabs?: unknown; active?: unknown };
  const tabs = Array.isArray(value.tabs) ? [...new Set(value.tabs.filter((id): id is string => typeof id === "string" && id !== ""))] : [];
  const active = typeof value.active === "string" && tabs.includes(value.active) ? value.active : (tabs[0] ?? null);
  return { ...unknownFields(raw, ["tabs", "active"]), tabs, active };
}

/** The state as the panel saves it: plain values, what a newer version kept included. */
export function savedTabState(state: TabState): TabState {
  return { ...state, tabs: [...state.tabs], active: state.active };
}

/**
 * Keeps only the tabs whose file still exists; if the shown one is gone, a neighbour is shown. A tab of a file a newer version
 * keeps (`kept`: not shown here, but still stored) stays in the state, so it is there when that version comes back; it is
 * never the shown one.
 */
export function keepExisting(state: TabState, exists: (id: string) => boolean, kept: (id: string) => boolean = () => false): TabState {
  const tabs = state.tabs.filter((id) => exists(id) || kept(id));
  const shown = state.active !== null && exists(state.active);
  if (tabs.length === state.tabs.length && (shown || state.active === null)) return state;
  if (shown) return { ...state, tabs, active: state.active };
  const at = state.active === null ? -1 : state.tabs.indexOf(state.active);
  const after = state.tabs.slice(at + 1).find(exists);
  const before = state.tabs.slice(0, Math.max(at, 0)).reverse().find(exists);
  return { ...state, tabs, active: after ?? before ?? null };
}

/** Shows a file: its tab is added at the end when it has none yet. */
export function openTab(state: TabState, id: string): TabState {
  return { ...state, tabs: state.tabs.includes(id) ? state.tabs : [...state.tabs, id], active: id };
}

/** Closes a tab only; the file stays. The next tab (else the one before) is shown when it was the open one. */
export function closeTab(state: TabState, id: string): TabState {
  const index = state.tabs.indexOf(id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((other) => other !== id);
  return { ...state, tabs, active: state.active === id ? (state.tabs[index + 1] ?? state.tabs[index - 1] ?? null) : state.active };
}

/** The tabs in a new order (the strip hands over the whole list); ids that are not open are ignored. */
export function reorderTabs(state: TabState, ids: readonly string[]): TabState {
  const known = ids.filter((id, at) => state.tabs.includes(id) && ids.indexOf(id) === at);
  const missing = state.tabs.filter((id) => !known.includes(id));
  return { ...state, tabs: [...known, ...missing] };
}

/** Tabs of files that got a new id (a reloaded original, see `previous`) follow it. */
export function followRenamed(state: TabState, renamed: ReadonlyMap<string, string>): TabState {
  if (!state.tabs.some((id) => renamed.has(id))) return state;
  const to = (id: string) => renamed.get(id) ?? id;
  const tabs = [...new Set(state.tabs.map(to))];
  return { ...state, tabs, active: state.active === null ? null : to(state.active) };
}
