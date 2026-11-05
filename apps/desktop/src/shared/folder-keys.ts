// A folder of permissions.folders as the host UI shows it, from its grant key (module-schema folderKey: the path, then
// the extensions it may read and those it may only see by name, joined by "|"). The main process checks every key it
// gets; this only splits one for showing.

export interface FolderView {
  key: string;
  /** The path from the manifest, such as Documents/My Game. */
  path: string;
  /** The root (Documents or Saved Games) and the folders below it. */
  root: string;
  names: string[];
  /** Extensions it may read, and those it may only see by name. */
  read: string[];
  nameOnly: string[];
}

export function folderView(key: string): FolderView | null {
  const parts = key.split("|");
  if (parts.length !== 3 || !parts[0]) return null;
  const [root = "", ...names] = parts[0].split("/");
  const list = (text: string) => (text ? text.split(",") : []);
  return { key, path: parts[0], root, names, read: list(parts[1]!), nameOnly: list(parts[2]!) };
}

/** Extensions as the user knows them: ".sav, .txt". */
export function extensionList(extensions: readonly string[]): string {
  return extensions.map((extension) => `.${extension}`).join(", ");
}
