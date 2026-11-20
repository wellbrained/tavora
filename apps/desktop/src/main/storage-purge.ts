// Which panels a storage purge stops and reloads (host.ts, purgeModuleStorage): only the module's panels in the
// session that went over the limit. A panel of it kept or lent from another workspace has a session of its own.
import type { Session, WebContents } from "electron";

export function viewsInSession<T extends { moduleId: string; view: { webContents: Pick<WebContents, "isDestroyed" | "session"> } }>(views: T[], moduleId: string, ses: Session): T[] {
  return views.filter((view) => view.moduleId === moduleId && !view.view.webContents.isDestroyed() && view.view.webContents.session === ses);
}

/** How long purges of one module's storage in one workspace count together (PurgeCount). */
export const PURGE_WINDOW_MS = 10 * 60_000;

/**
 * Counts purges per module and workspace session: after the first, the panels start again; a second one within
 * PURGE_WINDOW_MS leaves them stopped, so a module that fills its storage at once again can't keep the disk full in a
 * loop. The user starts it again with Reload.
 */
export class PurgeCount {
  private readonly times = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Notes a purge of `key`; true when its panels may start again. */
  note(key: string): boolean {
    const now = this.now();
    const recent = (this.times.get(key) ?? []).filter((at) => now - at < PURGE_WINDOW_MS);
    recent.push(now);
    this.times.set(key, recent);
    return recent.length < 2;
  }
}
