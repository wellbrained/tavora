// The one place the UI gets its game data, solver and repository from.
// The solver and repository are stand-ins (./dev) until the real ones are wired in here.

import type { TavoraSDK } from "@tavora/sdk";
import type { GameData } from "../contracts/data";
import type { Solve } from "../contracts/plan";
import type { Repository } from "../contracts/repository";
import { loadGameData } from "../data";
import { fakeSolve } from "./dev/fakeSolve";
import { createMemoryRepository } from "./dev/memoryRepository";

export interface Services {
  data: GameData;
  solve: Solve;
  repository: Repository;
}

export async function createServices(_sdk: TavoraSDK, options: { worldName: () => string }): Promise<Services> {
  const data = await loadGameData();
  return {
    data,
    solve: fakeSolve,
    repository: createMemoryRepository({ worldName: options.worldName, gameBuild: data.game.build }),
  };
}
