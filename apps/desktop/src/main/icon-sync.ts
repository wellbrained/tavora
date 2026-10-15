import { AppInfoError, readClientIcons } from "./steam-appinfo";
import { gamesNeedingIcon, recordIcon, type Library } from "./library";
import { loadAppInfo, removeSteamIcon, saveSteamIcon } from "./steam-icons";

export interface IconSyncOptions {
  library: Library;
  iconDir: string;
  /** The Steam client's folder on this PC, or null when Steam is not installed. */
  steamDir: string | null;
  /** Where icons come from when Steam does not have the file; Steam's public address unless told otherwise. */
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  /** Steam's appinfo.vdf as bytes, or null when it cannot be read. */
  loadAppInfoImpl?: (steamDir: string) => Promise<Uint8Array | null>;
  /** Called after the library changed, so it is saved and the host UI refreshed. */
  onChange: () => void;
  /** False stops the run, e.g. the window closed. */
  shouldRun?: () => boolean;
  now?: () => Date;
  /** Pause between downloads, so Steam is never hit in a burst. */
  pauseMs?: number;
}

/**
 * Finds the icon of every live game that has a Steam id and none yet: the hash
 * comes from the Steam client's own cache on this PC, the file from the same
 * place (or Steam's public address). Quiet on purpose. Without a Steam client
 * there is no hash to ask for, so nothing is asked and nothing is marked; when
 * the network fails it stops and leaves the rest for the next start or the next
 * added game. Returns how many icons were saved.
 */
export async function syncIcons(options: IconSyncOptions): Promise<number> {
  const { library, iconDir, steamDir, onChange } = options;
  if (steamDir === null) return 0;
  const shouldRun = options.shouldRun ?? (() => true);
  const now = options.now ?? (() => new Date());
  const read = options.loadAppInfoImpl ?? loadAppInfo;

  const appInfo = await read(steamDir);
  if (appInfo === null) return 0;

  let saved = 0;
  for (;;) {
    if (!shouldRun() || !library.steamIcons) return saved;
    const game = gamesNeedingIcon(library, now())[0];
    if (!game || game.steamAppId === null) return saved;

    let hash: string | undefined;
    try {
      hash = readClientIcons(appInfo, new Set([game.steamAppId])).get(game.steamAppId);
    } catch (error) {
      // A file this app cannot read is not the player's problem: no icons, no noise.
      if (error instanceof AppInfoError) return saved;
      throw error;
    }

    if (hash === undefined) {
      // Steam's cache has no icon for this game: ask again in a while.
      recordIcon(library, game.id, { none: now() });
      onChange();
      continue;
    }

    const result = await saveSteamIcon(iconDir, steamDir, game.steamAppId, hash, {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });
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
    if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
  }
}
