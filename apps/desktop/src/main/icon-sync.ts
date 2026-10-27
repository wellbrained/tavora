import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchHostedList, matchHosted, saveHostedIcon, type HostedList } from "./hosted-icons";
import { findInstalledGames, matchInstalled, type InstalledGame } from "./launcher-games";
import { DEFAULT_API_URL } from "./online";
import { icoFramesAgree, readIcoFromFile } from "./pe-icon";
import { AppInfoError, readClientIcons } from "./steam-appinfo";
import { readShortcutIcons, saveShortcutIcon, shortcutFolders } from "./steam-shortcuts";
import { workspacesNeedingIcon, liveWorkspaces, recordIcon, type WorkspaceEntry, type Library } from "./library";
import {
  fetchPublicIconHash,
  loadAppInfo,
  needsIcon,
  publicIconFileName,
  removeSteamIcon,
  saveLibraryCacheIcon,
  saveExeIcon,
  savePublicSteamIcon,
  saveSteamIcon,
  type IconResult,
} from "./steam-icons";

export interface IconSyncOptions {
  library: Library;
  iconDir: string;
  /** The Steam client's folder on this PC, or null when Steam is not installed. */
  steamDir: string | null;
  /** The folders that hold Steam's shortcuts (Start menu, desktops); the usual ones unless told otherwise. */
  shortcutDirs?: string[];
  /** Where icons come from when Steam does not have the file; Steam's public address unless told otherwise. */
  baseUrl?: string | undefined;
  /** Where Steam's public store API is; its public address unless told otherwise. */
  apiUrl?: string | undefined;
  /** The Tavora service, for its hosted icons; its public address unless told otherwise. */
  serviceUrl?: string | undefined;
  /** The service's list of hosted icons, or null when it cannot be had. The host shares one list with the share check. */
  loadHostedList?: () => Promise<HostedList | null>;
  fetchImpl?: typeof fetch | undefined;
  /** Steam's appinfo.vdf as bytes, or null when it cannot be read. */
  loadAppInfoImpl?: (steamDir: string) => Promise<Uint8Array | null>;
  /** The games the launchers have installed on this PC. */
  installedGames?: () => Promise<InstalledGame[]>;
  /** An `.ico` read out of a program file, or null. */
  readIcon?: (file: string, index: number) => Promise<Uint8Array | null>;
  /** Called after the library changed, so it is saved and the host UI refreshed. */
  onChange: () => void;
  /** False stops the run, e.g. the window closed. */
  shouldRun?: () => boolean;
  now?: () => Date;
  /** Pause between downloads, so Steam is never hit in a burst. */
  pauseMs?: number;
}

/**
 * Finds the icon of every live game that has none yet, from the best place
 * that has one, one game at a time:
 *  1. the installed game itself (Battle.net first, then Epic, GOG and the rest),
 *  2. the icon Steam's client keeps on this PC, as its appinfo or the game's Steam shortcut names it (or the same file from Steam's public address),
 *  3. the Tavora service's hosted icon, when online features are on (the app takes its list and
 *     asks for a file only when a game is in it),
 *  4. the small icon Steam keeps in its library cache on this PC,
 *  5. the small icon Steam's public store API knows for any Steam game,
 *  6. the program of a game Steam installed on this PC, when Steam has no icon for it.
 * Quiet on purpose. When the network fails it stops and leaves the rest for the
 * next start or the next added game. Returns how many icons were saved.
 */
export async function syncIcons(options: IconSyncOptions): Promise<number> {
  const { library, iconDir, steamDir, onChange } = options;
  const shouldRun = options.shouldRun ?? (() => true);
  const now = options.now ?? (() => new Date());
  const readClient = options.loadAppInfoImpl ?? loadAppInfo;
  const readIcon = options.readIcon ?? readIcoFromFile;
  const network = {
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  };

  // Loaded once per run, and only when a game needs them.
  let installed: InstalledGame[] | undefined;
  let appInfo: Uint8Array | null | undefined;
  const installedGames = async () => (installed ??= await (options.installedGames ?? (() => findInstalledGames({ steamDir })))().catch(() => []));
  const clientCache = async () => {
    if (appInfo === undefined) appInfo = steamDir === null ? null : await readClient(steamDir);
    return appInfo;
  };

  // The launchers' own games come first. A game Steam installed is only a last resort: its folder holds
  // several programs, and Steam's own icon for the game is the better one when Steam has it.
  const fromInstalledGame = async (game: WorkspaceEntry, viaSteam = false): Promise<IconResult> => {
    const list = (await installedGames()).filter((item) => (item.source === "steam") === viaSteam);
    const found = matchInstalled(game.name, list, game.steamAppId);
    const bytes = found ? await readIcon(found.file, found.index).catch(() => null) : null;
    return bytes ? saveExeIcon(iconDir, game.id, bytes) : { status: "none" };
  };

  const fromSteamClient = async (appid: number): Promise<IconResult> => {
    const cache = steamDir === null ? null : await clientCache();
    if (cache === null || steamDir === null) return { status: "none" };
    let hash: string | undefined;
    try {
      hash = readClientIcons(cache, new Set([appid])).get(appid);
    } catch (error) {
      // A file this app cannot read is not the user's problem: no client icons, no noise.
      if (error instanceof AppInfoError) {
        appInfo = null;
        return { status: "none" };
      }
      throw error;
    }
    return hash === undefined ? { status: "none" } : saveSteamIcon(iconDir, steamDir, appid, hash, network);
  };

  // Steam's shortcuts name the icon Windows shows for each installed game: a file Steam keeps on this PC.
  let shortcuts: Map<number, string[]> | undefined;
  const fromShortcut = async (appid: number): Promise<IconResult> => {
    if (steamDir === null) return { status: "none" };
    shortcuts ??= await readShortcutIcons(options.shortcutDirs ?? shortcutFolders());
    // The first icon that is on this PC wins: a newer shortcut can name one Steam never got.
    for (const hash of shortcuts.get(appid) ?? []) {
      const saved = await saveShortcutIcon(iconDir, steamDir, appid, hash);
      if (saved.status === "saved") return saved;
    }
    return { status: "none" };
  };

  // The service's list is asked for once per run, and only when a game gets this far.
  const serviceOptions = {
    baseUrl: options.serviceUrl ?? DEFAULT_API_URL,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  let hostedList: HostedList | null | undefined;
  const hosted = async () => (hostedList ??= await (options.loadHostedList ?? (() => fetchHostedList(serviceOptions)))());
  const fromHosted = async (game: WorkspaceEntry): Promise<IconResult> => {
    // Online features off: the service is never contacted.
    if (!library.onlineSearch) return { status: "none" };
    const list = await hosted();
    // The list could not be had: say nothing about this game, so it is asked again next time.
    if (list === null) return { status: "failed" };
    const icon = matchHosted(game, list);
    return icon ? saveHostedIcon(iconDir, game.id, icon, serviceOptions) : { status: "none" };
  };

  // The small icon Steam keeps on this PC, for when Steam's public address does not have it.
  const fromLibraryCache = async (appid: number): Promise<IconResult> => (steamDir === null ? { status: "none" } : saveLibraryCacheIcon(iconDir, steamDir, appid));

  const fromSteamPublic = async (appid: number): Promise<IconResult> => {
    const hash = await fetchPublicIconHash(appid, {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
    });
    if (hash.status !== "found") return hash;
    return savePublicSteamIcon(iconDir, appid, hash.hash, network);
  };

  // An icon an earlier version saved from a program can have frames that disagree with their entries, which shows as
  // nothing. Such a file is removed and the game looked up again.
  for (const game of liveWorkspaces(library)) {
    if (!game.iconFile?.startsWith("exe-")) continue;
    const bytes = await readFile(path.join(iconDir, game.iconFile)).catch(() => null);
    if (bytes && !icoFramesAgree(bytes)) {
      await removeSteamIcon(iconDir, game.iconFile);
      game.iconFile = null;
      game.iconCheckedAt = null;
    }
  }

  // A Steam game that only has the icon of its program (the last resort) or Steam's small public icon takes
  // the icon Steam itself shows once that is on this PC: the one its shortcut names, else the small one in its library cache.
  if (steamDir !== null && library.steamIcons) {
    for (const game of liveWorkspaces(library)) {
      const appid = game.steamAppId;
      if (!game.iconFile || appid === null) continue;
      const ofProgram = game.iconFile.startsWith("exe-");
      if (!ofProgram && game.iconFile !== publicIconFileName(appid)) continue;
      // An icon from a launcher's own game (Battle.net, Epic, GOG) is the better one, and stays.
      if (ofProgram && matchInstalled(game.name, (await installedGames()).filter((item) => item.source !== "steam"))) continue;
      let better = await fromShortcut(appid);
      if (better.status !== "saved" && ofProgram) better = await saveLibraryCacheIcon(iconDir, steamDir, appid);
      if (better.status !== "saved") continue;
      if (better.file !== game.iconFile) await removeSteamIcon(iconDir, game.iconFile);
      recordIcon(library, game.id, { file: better.file });
      onChange();
    }
  }

  // A game that found no icon waits a week before it is looked up again. When the service has an icon
  // for it by now, or it is installed on this PC, it need not wait.
  const waiting = liveWorkspaces(library).filter((game) => game.iconFile === null && game.iconCheckedAt !== null && !needsIcon(game, now()));
  if (waiting.length > 0 && library.steamIcons && shouldRun()) {
    const list = library.onlineSearch ? await hosted() : null;
    const onThisPc = await installedGames();
    for (const game of waiting) {
      if ((list && matchHosted(game, list)) || matchInstalled(game.name, onThisPc, game.steamAppId)) game.iconCheckedAt = null;
    }
  }

  let saved = 0;
  for (;;) {
    if (!shouldRun() || !library.steamIcons) return saved;
    const game = workspacesNeedingIcon(library, now())[0];
    if (!game) return saved;

    let result = await fromInstalledGame(game);
    const asksNetwork = result.status !== "saved";
    if (result.status === "none" && game.steamAppId !== null) result = await fromSteamClient(game.steamAppId);
    if (result.status === "none" && game.steamAppId !== null) result = await fromShortcut(game.steamAppId);
    if (result.status === "none") result = await fromHosted(game);
    if (result.status === "none" && game.steamAppId !== null) result = await fromLibraryCache(game.steamAppId);
    if (result.status === "none" && game.steamAppId !== null) result = await fromSteamPublic(game.steamAppId);
    if (result.status === "none") result = await fromInstalledGame(game, true);
    if (result.status === "failed") return saved;

    if (result.status === "saved" && !library.workspaces[game.id]) {
      // The game was deleted while its icon was on the way.
      await removeSteamIcon(iconDir, result.file);
      continue;
    }
    recordIcon(library, game.id, result.status === "saved" ? { file: result.file } : { none: now() });
    if (result.status === "saved") saved += 1;
    onChange();
    const pause = options.pauseMs ?? 150;
    if (asksNetwork && pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
  }
}
