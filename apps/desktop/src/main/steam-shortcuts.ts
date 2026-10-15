import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./fsutil";
import { iconFileName, isIco, isSteamAppId, MAX_STEAM_ICON_BYTES, type IconResult } from "./steam-icons";

/**
 * Steam puts a shortcut (`<game>.url`) in the Start menu, and on the desktop when asked, for each installed game.
 * It names the game (`steam://rungameid/<id>`) and the game's icon file in Steam's own folder, which is the icon
 * Windows shows for the game. Only those two lines are read, and the icon is only ever taken from Steam's
 * `steam/games` folder by its 40-digit name, whatever path the shortcut gives.
 */

const MAX_SHORTCUTS = 1000;
const MAX_SHORTCUT_BYTES = 8 * 1024;
const HASH_ICON = /^([0-9a-f]{40})\.ico$/i;

/** Where Steam's shortcuts are: its Start menu folder, and the desktops. */
export function shortcutFolders(env: NodeJS.ProcessEnv = process.env): string[] {
  const folders: string[] = [];
  if (env.APPDATA) folders.push(path.join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Steam"));
  if (env.USERPROFILE) folders.push(path.join(env.USERPROFILE, "Desktop"));
  if (env.PUBLIC) folders.push(path.join(env.PUBLIC, "Desktop"));
  return folders;
}

/** The icon name (without its folder) and game id one shortcut states, or null when it is not a Steam game's shortcut. */
export function parseShortcut(text: string): { appid: number; hash: string } | null {
  const url = /^URL=steam:\/\/rungameid\/(\d{1,10})\s*$/im.exec(text);
  const icon = /^IconFile=(.+?)\s*$/im.exec(text);
  const appid = url ? Number(url[1]) : NaN;
  // The file name is all that is kept: the shortcut cannot point this app at any other file.
  const name = icon ? icon[1]!.split(/[\\/]/).pop() : undefined;
  const match = name ? HASH_ICON.exec(name) : null;
  return isSteamAppId(appid) && match ? { appid, hash: match[1]!.toLowerCase() } : null;
}

/** The icon hashes the Steam shortcuts in these folders name, by game id, in the order the folders are given. A newer shortcut can name an icon Steam never got, so every one is kept. */
export async function readShortcutIcons(folders: readonly string[]): Promise<Map<number, string[]>> {
  const icons = new Map<number, string[]>();
  for (const folder of folders) {
    let names: string[];
    try {
      names = (await readdir(folder)).filter((name) => name.toLowerCase().endsWith(".url")).slice(0, MAX_SHORTCUTS);
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const file = path.join(folder, name);
        if ((await stat(file)).size > MAX_SHORTCUT_BYTES) continue;
        const shortcut = parseShortcut(await readFile(file, "utf8"));
        if (!shortcut) continue;
        const hashes = icons.get(shortcut.appid) ?? [];
        if (!hashes.includes(shortcut.hash)) icons.set(shortcut.appid, [...hashes, shortcut.hash]);
      } catch {
        // A shortcut that cannot be read is skipped.
      }
    }
  }
  return icons;
}

/** Copies the game's icon out of Steam's own folder, with nothing asked of the network. */
export async function saveShortcutIcon(iconDir: string, steamDir: string, appid: number, hash: string): Promise<IconResult> {
  if (!isSteamAppId(appid) || !/^[0-9a-f]{40}$/.test(hash)) return { status: "none" };
  try {
    const source = path.join(steamDir, "steam", "games", `${hash}.ico`);
    const info = await stat(source);
    if (!info.isFile() || info.size > MAX_STEAM_ICON_BYTES) return { status: "none" };
    const bytes = new Uint8Array(await readFile(source));
    if (!isIco(bytes)) return { status: "none" };
    const file = iconFileName(appid);
    await writeFileAtomic(path.join(iconDir, file), bytes);
    return { status: "saved", file };
  } catch {
    return { status: "none" };
  }
}
