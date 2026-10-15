import { fetchHostedList, matchHosted, saveHostedIcon, type HostedList } from "./hosted-icons";
import { findInstalledGames, matchInstalled, type InstalledGame } from "./launcher-games";
import { DEFAULT_API_URL } from "./online";
import { readIcoFromFile } from "./pe-icon";
import { AppInfoError, readClientIcons } from "./steam-appinfo";
import { gamesNeedingIcon, recordIcon, type GameEntry, type Library } from "./library";
import {
  fetchPublicIconHash,
  loadAppInfo,
  removeSteamIcon,
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
 *  2. the icon Steam's client keeps on this PC (or the same file from Steam's public address),
 *  3. the Tavora service's hosted icon, when online features are on (the app takes its list and
 *     asks for a file only when a game is in it),
 *  4. the small icon Steam's public store API knows for any Steam game.
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
  const installedGames = async () => (installed ??= await (options.installedGames ?? findInstalledGames)().catch(() => []));
  const clientCache = async () => {
    if (appInfo === undefined) appInfo = steamDir === null ? null : await readClient(steamDir);
    return appInfo;
  };

  const fromInstalledGame = async (game: GameEntry): Promise<IconResult> => {
    const found = matchInstalled(game.name, await installedGames());
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
      // A file this app cannot read is not the player's problem: no client icons, no noise.
      if (error instanceof AppInfoError) {
        appInfo = null;
        return { status: "none" };
      }
      throw error;
    }
    return hash === undefined ? { status: "none" } : saveSteamIcon(iconDir, steamDir, appid, hash, network);
  };

  // The service's list is asked for once per run, and only when a game gets this far.
  const serviceOptions = {
    baseUrl: options.serviceUrl ?? DEFAULT_API_URL,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  let hostedList: HostedList | null | undefined;
  const fromHosted = async (game: GameEntry): Promise<IconResult> => {
    // Online features off: the service is never contacted.
    if (!library.onlineSearch) return { status: "none" };
    hostedList ??= await (options.loadHostedList ?? (() => fetchHostedList(serviceOptions)))();
    // The list could not be had: say nothing about this game, so it is asked again next time.
    if (hostedList === null) return { status: "failed" };
    const icon = matchHosted(game, hostedList);
    return icon ? saveHostedIcon(iconDir, game.id, icon, serviceOptions) : { status: "none" };
  };

  const fromSteamPublic = async (appid: number): Promise<IconResult> => {
    const hash = await fetchPublicIconHash(appid, {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
    });
    if (hash.status !== "found") return hash;
    return savePublicSteamIcon(iconDir, appid, hash.hash, network);
  };

  let saved = 0;
  for (;;) {
    if (!shouldRun() || !library.steamIcons) return saved;
    const game = gamesNeedingIcon(library, now())[0];
    if (!game) return saved;

    let result = await fromInstalledGame(game);
    const asksNetwork = result.status !== "saved";
    if (result.status === "none" && game.steamAppId !== null) result = await fromSteamClient(game.steamAppId);
    if (result.status === "none") result = await fromHosted(game);
    if (result.status === "none" && game.steamAppId !== null) result = await fromSteamPublic(game.steamAppId);
    if (result.status === "failed") return saved;

    if (result.status === "saved" && !library.games[game.id]) {
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
