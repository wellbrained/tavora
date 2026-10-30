// Which files a panel has open as tabs, and which one is shown. This is the panel's own state, kept across restarts.

export interface TabState {
  tabs: string[];
  active: string | null;
}

export const emptyTabs = (): TabState => ({ tabs: [], active: null });

export function parseTabState(raw: unknown): TabState {
  if (typeof raw !== "object" || raw === null) return emptyTabs();
  const value = raw as { tabs?: unknown; active?: unknown };
  const tabs = Array.isArray(value.tabs) ? [...new Set(value.tabs.filter((id): id is string => typeof id === "string" && id !== ""))] : [];
  const active = typeof value.active === "string" && tabs.includes(value.active) ? value.active : (tabs[0] ?? null);
  return { tabs, active };
}

/** Keeps only the tabs whose file still exists; if the shown one is gone, a neighbour is shown. */
export function keepExisting(state: TabState, exists: (id: string) => boolean): TabState {
  const tabs = state.tabs.filter(exists);
  if (tabs.length === state.tabs.length) return state;
  if (state.active !== null && tabs.includes(state.active)) return { tabs, active: state.active };
  const at = state.active === null ? -1 : state.tabs.indexOf(state.active);
  const after = state.tabs.slice(at + 1).find(exists);
  const before = state.tabs.slice(0, Math.max(at, 0)).reverse().find(exists);
  return { tabs, active: after ?? before ?? null };
}

/** Shows a file: its tab is added at the end when it has none yet. */
export function openTab(state: TabState, id: string): TabState {
  return { tabs: state.tabs.includes(id) ? state.tabs : [...state.tabs, id], active: id };
}

/** Closes a tab only; the file stays. The next tab (else the one before) is shown when it was the open one. */
export function closeTab(state: TabState, id: string): TabState {
  const index = state.tabs.indexOf(id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((other) => other !== id);
  return { tabs, active: state.active === id ? (state.tabs[index + 1] ?? state.tabs[index - 1] ?? null) : state.active };
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
  return { tabs, active: state.active === null ? null : to(state.active) };
}
