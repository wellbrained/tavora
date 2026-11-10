// Which panels a storage purge stops and reloads (host.ts, purgeModuleStorage): only the module's panels in the
// session that went over the limit. A panel of it kept or lent from another workspace has a session of its own.
import type { Session, WebContents } from "electron";

export function viewsInSession<T extends { moduleId: string; view: { webContents: Pick<WebContents, "isDestroyed" | "session"> } }>(views: T[], moduleId: string, ses: Session): T[] {
  return views.filter((view) => view.moduleId === moduleId && !view.view.webContents.isDestroyed() && view.view.webContents.session === ses);
}
