// The one place the UI gets its game data, solver and repository from.

import type { TavoraSDK } from "@tavora/sdk";
import type { GameData } from "../contracts/data";
import type { Solve } from "../contracts/plan";
import type { Repository } from "../contracts/repository";
import { loadGameData } from "../data";
import { DocumentRepository } from "../model";
import { solve } from "../solver";

export interface Services {
  data: GameData;
  solve: Solve;
  repository: Repository;
}

export async function createServices(sdk: TavoraSDK, options: { language: () => string }): Promise<Services> {
  const data = await loadGameData();
  return { data, solve, repository: new DocumentRepository(sdk, { data, language: options.language }) };
}
