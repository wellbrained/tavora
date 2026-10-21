import type { GameData } from "../contracts/data";
import { sampleData } from "./sample";

/** The pinned game data. Until the extracted data is in place this is the hand-made sample. */
export async function loadGameData(): Promise<GameData> {
  return sampleData;
}
