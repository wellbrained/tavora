// A folder of permissions.folders as the host UI shows it, from its grant key (module-schema folderKey: the path, then
// the extensions it may read and those it may only see by name, joined by "|"). The main process checks every key it
// gets; this only splits one for showing.

/**
 * Key and certificate files: never read from a folder, at most seen by name, wherever they are. Tavora's own key files
 * are .pem; a module has no use for a private key.
 */
export const KEY_EXTENSIONS: readonly string[] = ["pem", "key", "p12", "pfx", "ppk"];

export interface FolderView {
  key: string;
  /** The path from the manifest, such as Documents/My Game. */
  path: string;
  /** The root (Documents or Saved Games) and the folders below it. */
  root: string;
  names: string[];
  /** Extensions it may read, and those it may only see by name (key files asked for in read go here: they are never read). */
  read: string[];
  nameOnly: string[];
}

export function folderView(key: string): FolderView | null {
  const parts = key.split("|");
  if (parts.length !== 3 || !parts[0]) return null;
  const [root = "", ...names] = parts[0].split("/");
  const list = (text: string) => (text ? text.split(",") : []);
  const asked = list(parts[1]!);
  const isKey = (extension: string) => KEY_EXTENSIONS.includes(extension);
  return { key, path: parts[0], root, names, read: asked.filter((extension) => !isKey(extension)), nameOnly: [...list(parts[2]!), ...asked.filter(isKey)] };
}

/** Extensions as the user knows them: ".sav, .txt". */
export function extensionList(extensions: readonly string[]): string {
  return extensions.map((extension) => `.${extension}`).join(", ");
}
