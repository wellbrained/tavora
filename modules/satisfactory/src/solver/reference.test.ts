// Reference chains with numbers worked out by hand from the recipes. Each chain names its recipes by
// id, so the same table runs on the sample data and, once it is there, on the extracted game data.
// All rates are a minute; "a × 60 / s" is a recipe amount at 100 % clock.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GameData, ItemId, RecipeId } from "../contracts/data";
import { sampleData } from "../data/sample";
import { byItem, machinesOf, plan, solved, world } from "./testing";

interface Chain {
  name: string;
  /** "sample": the sample has every recipe, so it runs there and on the game data. "game": only the game data has them. */
  needs: "sample" | "game";
  targets: Record<ItemId, number>;
  choices?: Record<ItemId, RecipeId>;
  machines: Record<RecipeId, number>;
  rawResources: Record<ItemId, number>;
  imports?: Record<ItemId, number>;
  byproducts?: Record<ItemId, number>;
}

const chains: Chain[] = [
  {
    // Iron Plate 3 ingots → 2 plates / 6 s: 30 → 20 per constructor, so 60 plates take 3 constructors and 90 ingots.
    // Iron Ingot 1 ore → 1 ingot / 2 s: 30 per smelter, 3 smelters, 90 ore.
    name: "Iron Plate",
    needs: "sample",
    targets: { Desc_IronPlate_C: 60 },
    machines: { Recipe_IronPlate_C: 3, Recipe_IngotIron_C: 3 },
    rawResources: { Desc_OreIron_C: 90 },
  },
  {
    // Reinforced Iron Plate 6 plates + 12 screws → 1 / 12 s: 30 + 60 → 5, one assembler.
    // Plates 30 / 20 = 1.5 constructors (45 ingots). Screws 1 rod → 4 / 6 s: 10 → 40, 60 / 40 = 1.5 (15 rods).
    // Rods 1 ingot → 1 / 4 s: 15 → 15, 1 constructor (15 ingots). Ingots 45 + 15 = 60: 2 smelters, 60 ore.
    name: "Reinforced Iron Plate",
    needs: "sample",
    targets: { Desc_IronPlateReinforced_C: 5 },
    machines: { Recipe_IronPlateReinforced_C: 1, Recipe_IronPlate_C: 1.5, Recipe_Screw_C: 1.5, Recipe_IronRod_C: 1, Recipe_IngotIron_C: 2 },
    rawResources: { Desc_OreIron_C: 60 },
  },
  {
    // As above, with Cast Screw 5 ingots → 20 screws / 24 s: 12.5 → 50, so 60 screws take 1.2 machines and 15 ingots.
    // Ingots 45 + 15 = 60: 2 smelters, 60 ore, and no rods.
    name: "Reinforced Iron Plate with Cast Screw",
    needs: "sample",
    targets: { Desc_IronPlateReinforced_C: 5 },
    choices: { Desc_IronScrew_C: "Recipe_Alternate_Screw_C" },
    machines: { Recipe_IronPlateReinforced_C: 1, Recipe_IronPlate_C: 1.5, Recipe_Alternate_Screw_C: 1.2, Recipe_IngotIron_C: 2 },
    rawResources: { Desc_OreIron_C: 60 },
  },
  {
    // Plastic 3 oil → 2 plastic + 1 residue / 6 s: 30 → 20 + 10. Rubber 3 oil → 2 rubber + 2 residue / 6 s: 30 → 20 + 20.
    // 40 of each: 2 refineries each, oil 120, residue 20 + 40 = 60 left over.
    name: "Plastic and Rubber",
    needs: "sample",
    targets: { Desc_Plastic_C: 40, Desc_Rubber_C: 40 },
    machines: { Recipe_Plastic_C: 2, Recipe_Rubber_C: 2 },
    rawResources: { Desc_LiquidOil_C: 120 },
    byproducts: { Desc_HeavyOilResidue_C: 60 },
  },
  {
    // As above with Petroleum Coke 4 residue → 12 coke / 6 s: 40 → 120. 180 coke take 1.5 machines and 60 residue,
    // exactly the residue the refineries leave: nothing left over, nothing brought in.
    name: "Plastic and Rubber, residue into Petroleum Coke",
    needs: "sample",
    targets: { Desc_Plastic_C: 40, Desc_Rubber_C: 40, Desc_PetroleumCoke_C: 180 },
    machines: { Recipe_Plastic_C: 2, Recipe_Rubber_C: 2, Recipe_PetroleumCoke_C: 1.5 },
    rawResources: { Desc_LiquidOil_C: 120 },
  },
  {
    // Heavy Oil Residue (alternate) 3 oil → 4 residue + 2 resin / 6 s: 30 → 40 + 20.
    // 240 coke take 2 coke refineries and 80 residue: 2 residue refineries, 60 oil, 40 resin left over.
    name: "Petroleum Coke from Heavy Oil Residue",
    needs: "sample",
    targets: { Desc_PetroleumCoke_C: 240 },
    choices: { Desc_HeavyOilResidue_C: "Recipe_Alternate_HeavyOilResidue_C" },
    machines: { Recipe_PetroleumCoke_C: 2, Recipe_Alternate_HeavyOilResidue_C: 2 },
    rawResources: { Desc_LiquidOil_C: 60 },
    byproducts: { Desc_PolymerResin_C: 40 },
  },
  {
    // Residual Plastic 6 resin + 2 water → 2 plastic / 6 s: 60 + 20 → 20. 20 plastic: 1 refinery, 60 resin, 20 water.
    // Resin from Heavy Oil Residue (20 a refinery): 3 refineries, 90 oil, 120 residue left over.
    name: "Residual Plastic from resin",
    needs: "sample",
    targets: { Desc_Plastic_C: 20 },
    choices: { Desc_Plastic_C: "Recipe_ResidualPlastic_C", Desc_PolymerResin_C: "Recipe_Alternate_HeavyOilResidue_C" },
    machines: { Recipe_ResidualPlastic_C: 1, Recipe_Alternate_HeavyOilResidue_C: 3 },
    rawResources: { Desc_LiquidOil_C: 90, Desc_Water_C: 20 },
    byproducts: { Desc_HeavyOilResidue_C: 120 },
  },
  {
    // Residual Rubber 4 resin + 4 water → 2 rubber / 6 s: 40 + 40 → 20. 40 rubber: 2 refineries, 80 resin, 80 water.
    // Resin: 4 Heavy Oil Residue refineries, 120 oil, 160 residue. 120 coke take 1 coke refinery and 40 of it:
    // 120 residue left over.
    name: "Residual Rubber with Petroleum Coke",
    needs: "sample",
    targets: { Desc_Rubber_C: 40, Desc_PetroleumCoke_C: 120 },
    choices: { Desc_Rubber_C: "Recipe_ResidualRubber_C", Desc_PolymerResin_C: "Recipe_Alternate_HeavyOilResidue_C" },
    machines: { Recipe_ResidualRubber_C: 2, Recipe_PetroleumCoke_C: 1, Recipe_Alternate_HeavyOilResidue_C: 4 },
    rawResources: { Desc_LiquidOil_C: 120, Desc_Water_C: 80 },
    byproducts: { Desc_HeavyOilResidue_C: 120 },
  },
  {
    // Recycled Plastic 6 rubber + 6 fuel → 12 plastic / 12 s: 30 + 30 → 60. Recycled Rubber 6 plastic + 6 fuel → 12 rubber
    // / 12 s: 30 + 30 → 60. For 120 plastic: 60p − 30r = 120 and 60r − 30p = 0, so r = p / 2 and p = 8/3, r = 4/3.
    // Fuel 30 × (8/3 + 4/3) = 120. Fuel 6 oil → 4 fuel + 3 resin / 6 s: 60 → 40 + 30, so 3 refineries, 180 oil, 90 resin.
    // The sample has neither recycled recipe nor fuel.
    name: "Recycled Plastic and Rubber loop",
    needs: "game",
    targets: { Desc_Plastic_C: 120 },
    choices: {
      Desc_Plastic_C: "Recipe_Alternate_Plastic_1_C",
      Desc_Rubber_C: "Recipe_Alternate_RecycledRubber_C",
      Desc_LiquidFuel_C: "Recipe_LiquidFuel_C",
    },
    machines: { Recipe_Alternate_Plastic_1_C: 8 / 3, Recipe_Alternate_RecycledRubber_C: 4 / 3, Recipe_LiquidFuel_C: 3 },
    rawResources: { Desc_LiquidOil_C: 180 },
    byproducts: { Desc_PolymerResin_C: 90 },
  },
];

/** The extracted game data, once it is in the module. */
const gameDataFile = fileURLToPath(new URL("../data/game-data.json", import.meta.url));
const gameData = existsSync(gameDataFile) ? (JSON.parse(readFileSync(gameDataFile, "utf8")) as GameData) : null;

const sets: { label: string; data: GameData | null; runs: (chain: Chain) => boolean }[] = [
  { label: "sample data", data: sampleData, runs: (chain) => chain.needs === "sample" },
  { label: "game data", data: gameData, runs: () => gameData !== null },
];

for (const set of sets) {
  describe(`reference chains on the ${set.label}`, () => {
    for (const chain of chains) {
      const test = set.runs(chain) ? it : it.skip;
      test(chain.name, () => {
        const result = solved({
          data: set.data!,
          plan: plan(chain.targets, { recipeChoices: chain.choices ?? {} }),
          world: world({ showAllAlternates: true }),
        });
        const machines = machinesOf(result);
        expect(Object.keys(machines).sort()).toEqual(Object.keys(chain.machines).sort());
        for (const [recipe, count] of Object.entries(chain.machines)) expect(machines[recipe]).toBeCloseTo(count, 9);
        expect(byItem(result.rawResources)).toEqual(chain.rawResources);
        expect(byItem(result.imports)).toEqual(chain.imports ?? {});
        expect(byItem(result.byproducts)).toEqual(chain.byproducts ?? {});
        expect(result.surplus).toEqual([]);
      });
    }
  });
}
