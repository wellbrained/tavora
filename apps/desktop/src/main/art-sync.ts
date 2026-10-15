import { gamesNeedingArt, recordArt, type Library } from "./library";
import { fetchSteamArt, removeSteamArt } from "./steam-art";

export interface ArtSyncOptions {
  library: Library;
  artDir: string;
  /** Where covers come from; Steam itself unless a test or development build says otherwise. */
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  /** Called after the library changed, so it is saved and the host UI refreshed. */
  onChange: () => void;
  /** False stops the run, e.g. the player switched fetching off or the window closed. */
  shouldRun?: () => boolean;
  now?: () => Date;
  /** Pause between games, so Steam is never hit in a burst. */
  pauseMs?: number;
}

/**
 * Asks Steam, one game at a time, for the cover of every live game that has a
 * Steam id and none yet. Quiet on purpose: when Steam or the network does not
 * answer it stops and leaves the rest for the next start or the next added game.
 * Returns how many covers were saved.
 */
export async function syncArt(options: ArtSyncOptions): Promise<number> {
  const { library, artDir, onChange } = options;
  const shouldRun = options.shouldRun ?? (() => library.steamIcons);
  const now = options.now ?? (() => new Date());
  let saved = 0;
  for (;;) {
    if (!shouldRun() || !library.steamIcons) return saved;
    const game = gamesNeedingArt(library, now())[0];
    if (!game || game.steamAppId === null) return saved;

    const result = await fetchSteamArt(artDir, game.steamAppId, {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });
    if (result.status === "failed") return saved;
    if (result.status === "saved" && !library.games[game.id]) {
      // The game was deleted while its cover was on the way.
      await removeSteamArt(artDir, result.file);
      continue;
    }
    recordArt(library, game.id, result.status === "saved" ? { file: result.file } : { none: now() });
    if (result.status === "saved") saved += 1;
    onChange();
    const pause = options.pauseMs ?? 250;
    if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
  }
}
