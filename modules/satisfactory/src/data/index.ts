import type { GameData } from "../contracts/data";

export { sampleData } from "./sample";

/** The game data pinned to one game build (see DATA.md). It loads on first use, from its own chunk. */
export async function loadGameData(): Promise<GameData> {
  const { default: data } = await import("./game-data.json");
  // JSON imports widen literal fields such as `format` to string; the data tests check the real shape.
  return data as unknown as GameData;
}
