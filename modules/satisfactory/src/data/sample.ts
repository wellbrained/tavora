// A small hand-made data set for tests and UI work before the extracted data exists.
// The shape is the real one; the numbers follow the game but are not authoritative.

import type { Amount, Building, GameData, Item, Recipe } from "../contracts/data";

const item = (
  id: string,
  en: string,
  de: string,
  form: Item["form"],
  kind: Item["kind"],
  extra: Partial<Item> = {},
): Item => ({
  id,
  name: { en, de },
  description: { en: `${en}.`, de: `${de}.` },
  form,
  kind,
  ...(form === "solid" ? { stackSize: 100 } : {}),
  ...extra,
});

const a = (item: string, amount: number): Amount => ({ item, amount });

const recipe = (
  id: string,
  en: string,
  de: string,
  building: string,
  durationSeconds: number,
  ingredients: Amount[],
  products: Amount[],
  alternate = false,
): Recipe => ({
  id,
  name: { en, de },
  alternate,
  producedIn: [building],
  durationSeconds,
  ingredients,
  products,
  unlockedBy: alternate ? [{ kind: "hardDrive" }] : [{ kind: "start" }],
});

const building = (
  id: string,
  en: string,
  de: string,
  powerMW: number,
  buildCost: Amount[],
): Building => ({
  id,
  name: { en, de },
  description: { en: `${en}.`, de: `${de}.` },
  kind: "production",
  powerMW,
  powerExponent: 1.321928,
  buildCost,
});

const items: Item[] = [
  item("Desc_OreIron_C", "Iron Ore", "Eisenerz", "solid", "resource", { sinkPoints: 1 }),
  item("Desc_LiquidOil_C", "Crude Oil", "Rohöl", "liquid", "resource"),
  item("Desc_Water_C", "Water", "Wasser", "liquid", "resource"),
  item("Desc_IronIngot_C", "Iron Ingot", "Eisenbarren", "solid", "part", { sinkPoints: 2 }),
  item("Desc_IronPlate_C", "Iron Plate", "Eisenplatte", "solid", "part", { sinkPoints: 6 }),
  item("Desc_IronRod_C", "Iron Rod", "Eisenstange", "solid", "part", { sinkPoints: 4 }),
  item("Desc_IronScrew_C", "Screws", "Schrauben", "solid", "part", { sinkPoints: 2, stackSize: 500 }),
  item("Desc_IronPlateReinforced_C", "Reinforced Iron Plate", "Verstärkte Eisenplatte", "solid", "part", { sinkPoints: 120 }),
  item("Desc_Plastic_C", "Plastic", "Plastik", "solid", "part", { sinkPoints: 75 }),
  item("Desc_Rubber_C", "Rubber", "Gummi", "solid", "part", { sinkPoints: 60 }),
  item("Desc_HeavyOilResidue_C", "Heavy Oil Residue", "Schweröl-Rückstand", "liquid", "part"),
  item("Desc_PolymerResin_C", "Polymer Resin", "Polymerharz", "solid", "part", { sinkPoints: 12, stackSize: 200 }),
  item("Desc_PetroleumCoke_C", "Petroleum Coke", "Petrolkoks", "solid", "part", { sinkPoints: 20, stackSize: 200 }),
];

const recipes: Recipe[] = [
  recipe("Recipe_IngotIron_C", "Iron Ingot", "Eisenbarren", "Build_SmelterMk1_C", 2, [a("Desc_OreIron_C", 1)], [a("Desc_IronIngot_C", 1)]),
  recipe("Recipe_IronPlate_C", "Iron Plate", "Eisenplatte", "Build_ConstructorMk1_C", 6, [a("Desc_IronIngot_C", 3)], [a("Desc_IronPlate_C", 2)]),
  recipe("Recipe_IronRod_C", "Iron Rod", "Eisenstange", "Build_ConstructorMk1_C", 4, [a("Desc_IronIngot_C", 1)], [a("Desc_IronRod_C", 1)]),
  recipe("Recipe_Screw_C", "Screws", "Schrauben", "Build_ConstructorMk1_C", 6, [a("Desc_IronRod_C", 1)], [a("Desc_IronScrew_C", 4)]),
  recipe("Recipe_Alternate_Screw_C", "Alternate: Cast Screw", "Alternativ: Gegossene Schraube", "Build_ConstructorMk1_C", 24, [a("Desc_IronIngot_C", 5)], [a("Desc_IronScrew_C", 20)], true),
  recipe("Recipe_IronPlateReinforced_C", "Reinforced Iron Plate", "Verstärkte Eisenplatte", "Build_AssemblerMk1_C", 12, [a("Desc_IronPlate_C", 6), a("Desc_IronScrew_C", 12)], [a("Desc_IronPlateReinforced_C", 1)]),
  recipe("Recipe_Plastic_C", "Plastic", "Plastik", "Build_OilRefinery_C", 6, [a("Desc_LiquidOil_C", 3)], [a("Desc_Plastic_C", 2), a("Desc_HeavyOilResidue_C", 1)]),
  recipe("Recipe_Rubber_C", "Rubber", "Gummi", "Build_OilRefinery_C", 6, [a("Desc_LiquidOil_C", 3)], [a("Desc_Rubber_C", 2), a("Desc_HeavyOilResidue_C", 2)]),
  recipe("Recipe_ResidualPlastic_C", "Residual Plastic", "Rückstands-Plastik", "Build_OilRefinery_C", 6, [a("Desc_PolymerResin_C", 6), a("Desc_Water_C", 2)], [a("Desc_Plastic_C", 2)]),
  recipe("Recipe_ResidualRubber_C", "Residual Rubber", "Rückstands-Gummi", "Build_OilRefinery_C", 6, [a("Desc_PolymerResin_C", 4), a("Desc_Water_C", 4)], [a("Desc_Rubber_C", 2)]),
  recipe("Recipe_Alternate_HeavyOilResidue_C", "Alternate: Heavy Oil Residue", "Alternativ: Schweröl-Rückstand", "Build_OilRefinery_C", 6, [a("Desc_LiquidOil_C", 3)], [a("Desc_HeavyOilResidue_C", 4), a("Desc_PolymerResin_C", 2)], true),
  recipe("Recipe_PetroleumCoke_C", "Petroleum Coke", "Petrolkoks", "Build_OilRefinery_C", 6, [a("Desc_HeavyOilResidue_C", 4)], [a("Desc_PetroleumCoke_C", 12)]),
];

const buildings: Building[] = [
  building("Build_SmelterMk1_C", "Smelter", "Schmelzofen", 4, [a("Desc_IronRod_C", 5)]),
  building("Build_ConstructorMk1_C", "Constructor", "Konstruktor", 4, [a("Desc_IronPlateReinforced_C", 2)]),
  building("Build_AssemblerMk1_C", "Assembler", "Monteur", 15, [a("Desc_IronPlateReinforced_C", 8), a("Desc_IronRod_C", 20)]),
  building("Build_OilRefinery_C", "Refinery", "Raffinerie", 30, [a("Desc_IronPlateReinforced_C", 10), a("Desc_Plastic_C", 20)]),
];

const byId = <T extends { id: string }>(list: T[]) =>
  Object.fromEntries(list.map((entry) => [entry.id, entry]));

/**
 * Covers a plain chain (Reinforced Iron Plate), an alternate (Cast Screw), byproducts (Plastic, Rubber),
 * an item with no standard recipe (Polymer Resin, only a byproduct of an alternate) and an item that is
 * only a byproduct of standard recipes (Heavy Oil Residue).
 */
export const sampleData: GameData = {
  format: "tavora.satisfactory.data",
  version: 1,
  game: { build: 0, version: "sample" },
  items: byId(items),
  recipes: byId(recipes),
  buildings: byId(buildings),
  resources: ["Desc_OreIron_C", "Desc_LiquidOil_C", "Desc_Water_C"],
  defaultRecipe: {
    Desc_IronIngot_C: "Recipe_IngotIron_C",
    Desc_IronPlate_C: "Recipe_IronPlate_C",
    Desc_IronRod_C: "Recipe_IronRod_C",
    Desc_IronScrew_C: "Recipe_Screw_C",
    Desc_IronPlateReinforced_C: "Recipe_IronPlateReinforced_C",
    Desc_Plastic_C: "Recipe_Plastic_C",
    Desc_Rubber_C: "Recipe_Rubber_C",
    Desc_PetroleumCoke_C: "Recipe_PetroleumCoke_C",
  },
  progress: {
    phases: [
      { phase: 0, name: { en: "Onboarding", de: "Einführung" }, cost: [], lastTier: 2 },
      { phase: 1, name: { en: "Distribution Platform", de: "Verteilplattform" }, cost: [a("Desc_IronPlateReinforced_C", 50)], lastTier: 4 },
    ],
    milestones: [
      {
        id: "Schematic_Tutorial1_C",
        name: { en: "HUB Upgrade 1", de: "HUB-Upgrade 1" },
        tier: 0,
        cost: [a("Desc_IronRod_C", 10)],
        unlocks: { recipes: ["Recipe_IronPlate_C"], buildings: [], items: [] },
        requires: [],
      },
      {
        id: "Schematic_2-1_C",
        name: { en: "Part Assembly", de: "Bauteilmontage" },
        tier: 2,
        cost: [a("Desc_IronPlate_C", 100), a("Desc_IronRod_C", 100)],
        unlocks: { recipes: ["Recipe_IronPlateReinforced_C"], buildings: ["Build_AssemblerMk1_C"], items: [] },
        requires: [],
      },
    ],
    research: [
      {
        id: "BPD_ResearchTree_Oil_C",
        name: { en: "Oil", de: "Öl" },
        nodes: [
          {
            id: "Research_Oil_1_C",
            name: { en: "Plastics", de: "Kunststoffe" },
            cost: [a("Desc_IronPlate_C", 50)],
            unlocks: { recipes: ["Recipe_Plastic_C", "Recipe_Rubber_C"], buildings: ["Build_OilRefinery_C"], items: [] },
            requires: [],
          },
        ],
      },
    ],
    hardDrives: [{ id: "Schematic_Alternate_Screw_C", recipes: ["Recipe_Alternate_Screw_C"], requires: ["Schematic_2-1_C"] }],
  },
};
