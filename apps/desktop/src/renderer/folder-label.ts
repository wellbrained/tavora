// How the host UI names a folder of permissions.folders: its root as the system calls it in the app's language, then
// the folders below it, with the separator of this PC ("Documents\My Game" on Windows).
import type { MessageKey } from "../shared/i18n";
import { folderView, type FolderView } from "../shared/folder-keys";
import { t } from "./i18n";

const separator = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent) ? "\\" : "/";

export function folderLabel(folder: FolderView | string): string {
  const view = typeof folder === "string" ? folderView(folder) : folder;
  if (!view) return "";
  return [t(`folders.root.${view.root}` as MessageKey), ...view.names].join(separator);
}

/** The folders of a list of grant keys, leaving out any that can't be one. */
export function foldersOf(keys: readonly string[]): FolderView[] {
  return keys.map(folderView).filter((view): view is FolderView => view !== null);
}
