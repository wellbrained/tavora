// What Ask for a module (Add a game) names a game by, shared by the main process (which sends it) and the
// screen (which shows that a game was asked for).

export interface AskedGame {
  name: string;
  steamAppId: number | null;
  /** Tavora's id for the game, when the game list has one. */
  gameId: string | null;
}

/** Which asks count as the same game, here and on the service: Steam's id, else Tavora's, else the name's letters and digits. */
export function askKey(game: AskedGame): string {
  if (game.steamAppId !== null) return `steam:${game.steamAppId}`;
  if (game.gameId !== null) return `game:${game.gameId}`;
  return `name:${game.name.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()}`;
}
