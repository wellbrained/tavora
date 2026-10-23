// Shorthands for the solver tests.

import type { GameData, ItemId, Recipe, RecipeId, Unlock } from "../contracts/data";
import type { Plan, PlanResult, Rate, SolveResult, World } from "../contracts/plan";
import { sampleData } from "../data/sample";
import { newWorld } from "../model/world";
import { solve } from "./solve";

export const world = (patch: Partial<World> = {}): World => ({ ...newWorld("World"), ...patch });

export const plan = (
  targets: Record<ItemId, number>,
  patch: { fixedInputs?: Record<ItemId, number>; recipeChoices?: Record<ItemId, RecipeId> } = {},
): Plan => ({
  format: "tavora.satisfactory.plan",
  version: 1,
  name: "Plan",
  worldId: "world-1",
  targets: toRates(targets),
  fixedInputs: toRates(patch.fixedInputs ?? {}),
  recipeChoices: patch.recipeChoices ?? {},
});

export const toRates = (rates: Record<ItemId, number>): Rate[] =>
  Object.entries(rates).map(([item, perMinute]) => ({ item, perMinute }));

export const byItem = (rates: Rate[]) => Object.fromEntries(rates.map((rate) => [rate.item, rate.perMinute]));

export const machinesOf = (result: PlanResult) => Object.fromEntries(result.rows.map((row) => [row.recipe, row.machines]));

export function attempt(input: { plan: Plan; world?: World; data?: GameData }): SolveResult {
  return solve({ data: input.data ?? sampleData, plan: input.plan, world: input.world ?? world() });
}

/** Solves and fails the test with the error when there is no result. */
export function solved(input: { plan: Plan; world?: World; data?: GameData }): PlanResult {
  const outcome = attempt(input);
  if (!outcome.ok) throw new Error(`Expected a result, got ${JSON.stringify(outcome.error)}`);
  return outcome.result;
}

/** The sample with the unlock sources its progress section names, instead of "start" everywhere. */
export function tracked(): GameData {
  const by = (unlock: Unlock) => [unlock];
  const set = (id: string, unlockedBy: Unlock[]): [string, Recipe] => [id, { ...sampleData.recipes[id]!, unlockedBy }];
  return {
    ...sampleData,
    recipes: {
      ...sampleData.recipes,
      ...Object.fromEntries([
        set("Recipe_IronPlate_C", by({ kind: "milestone", tier: 0, name: { en: "HUB Upgrade 1" } })),
        set("Recipe_IronPlateReinforced_C", by({ kind: "milestone", tier: 2, name: { en: "Part Assembly" } })),
        set("Recipe_Plastic_C", by({ kind: "mam", tree: { en: "Oil" }, name: { en: "Plastics" } })),
        set("Recipe_Rubber_C", by({ kind: "mam", tree: { en: "Oil" }, name: { en: "Plastics" } })),
        set("Recipe_PetroleumCoke_C", by({ kind: "awesomeShop", name: { en: "Coke" } })),
      ]),
    },
  };
}
