import { describe, expect, it } from "vitest";
import type { Amount, Building, GameData, Recipe } from "../contracts/data";
import { sampleData } from "../data/sample";
import { attempt, byItem, machinesOf, plan, solved, tracked, world } from "./testing";

const ORE = "Desc_OreIron_C";
const OIL = "Desc_LiquidOil_C";
const WATER = "Desc_Water_C";
const INGOT = "Desc_IronIngot_C";
const PLATE = "Desc_IronPlate_C";
const ROD = "Desc_IronRod_C";
const SCREW = "Desc_IronScrew_C";
const RIP = "Desc_IronPlateReinforced_C";
const PLASTIC = "Desc_Plastic_C";
const RUBBER = "Desc_Rubber_C";
const RESIDUE = "Desc_HeavyOilResidue_C";
const RESIN = "Desc_PolymerResin_C";
const COKE = "Desc_PetroleumCoke_C";
const CAST_SCREW = "Recipe_Alternate_Screw_C";
const EXPONENT = 1.321928;

/** The sample with extra recipes, items and buildings for cases it does not cover. */
function extended(extra: { recipes?: Recipe[]; items?: string[]; buildings?: Building[]; defaults?: Record<string, string> }): GameData {
  const data = structuredClone(sampleData);
  for (const id of extra.items ?? []) {
    data.items[id] = { id, name: { en: id }, description: { en: id }, form: "solid", kind: "part", stackSize: 100 };
  }
  for (const recipe of extra.recipes ?? []) data.recipes[recipe.id] = recipe;
  for (const building of extra.buildings ?? []) data.buildings[building.id] = building;
  Object.assign(data.defaultRecipe, extra.defaults ?? {});
  return data;
}

const testRecipe = (id: string, building: string, durationSeconds: number, ingredients: Amount[], products: Amount[]): Recipe => ({
  id,
  name: { en: id },
  alternate: false,
  producedIn: [building],
  durationSeconds,
  ingredients,
  products,
  unlockedBy: [],
});

describe("a plain chain", () => {
  // 5 Reinforced Iron Plates a minute: 1 assembler (30 plates, 60 screws), plates 30/20 = 1.5 constructors
  // (45 ingots), screws 60/40 = 1.5 constructors (15 rods), rods 15/15 = 1 constructor (15 ingots),
  // ingots 60/30 = 2 smelters, 60 iron ore.
  const result = solved({ plan: plan({ [RIP]: 5 }) });

  it("runs every recipe as often as needed", () => {
    expect(machinesOf(result)).toEqual({
      Recipe_IronPlateReinforced_C: 1,
      Recipe_IronPlate_C: 1.5,
      Recipe_Screw_C: 1.5,
      Recipe_IronRod_C: 1,
      Recipe_IngotIron_C: 2,
    });
    expect(byItem(result.rawResources)).toEqual({ [ORE]: 60 });
    expect(result.imports).toEqual([]);
    expect(result.byproducts).toEqual([]);
    expect(result.surplus).toEqual([]);
    expect(result.fixedInputsUsed).toEqual([]);
  });

  it("orders the rows from the target down to the ingots", () => {
    expect(result.rows.map((row) => row.item)).toEqual([RIP, PLATE, SCREW, ROD, INGOT]);
  });

  it("shows each row's flows and buildings", () => {
    const [assembler] = result.rows;
    expect(assembler).toMatchObject({
      recipe: "Recipe_IronPlateReinforced_C",
      building: "Build_AssemblerMk1_C",
      inputs: [
        { item: PLATE, perMinute: 30 },
        { item: SCREW, perMinute: 60 },
      ],
      outputs: [{ item: RIP, perMinute: 5 }],
    });
  });

  it("offers only usable recipes as alternatives", () => {
    const screws = result.rows.find((row) => row.item === SCREW)!;
    expect(screws.alternatives).toEqual(["Recipe_Screw_C"]);
    const all = solved({ plan: plan({ [RIP]: 5 }), world: world({ showAllAlternates: true }) });
    expect(all.rows.find((row) => row.item === SCREW)!.alternatives).toEqual(["Recipe_Screw_C", CAST_SCREW]);
  });
});

describe("alternate recipes", () => {
  const castScrews = plan({ [RIP]: 5 }, { recipeChoices: { [SCREW]: CAST_SCREW } });

  it("refuses a locked alternate", () => {
    expect(attempt({ plan: castScrews })).toEqual({ ok: false, error: { code: "LOCKED_RECIPE", recipe: CAST_SCREW, item: SCREW } });
  });

  // Cast Screw: 5 ingots → 20 screws in 24 s, so 12.5 ingots → 50 screws a minute. 60 screws take 1.2
  // machines and 15 ingots; with 45 ingots for the plates that is 60 ingots, 2 smelters, and no rods.
  const expected = {
    Recipe_IronPlateReinforced_C: 1,
    Recipe_IronPlate_C: 1.5,
    [CAST_SCREW]: 1.2,
    Recipe_IngotIron_C: 2,
  };

  it("uses an unlocked alternate", () => {
    const result = solved({ plan: castScrews, world: world({ unlockedAlternates: [CAST_SCREW] }) });
    expect(machinesOf(result)).toEqual(expected);
    expect(byItem(result.rawResources)).toEqual({ [ORE]: 60 });
  });

  it("uses any alternate when the world shows them all", () => {
    expect(machinesOf(solved({ plan: castScrews, world: world({ showAllAlternates: true }) }))).toEqual(expected);
  });

  it("refuses a recipe that does not make the item", () => {
    const wrong = plan({ [RIP]: 5 }, { recipeChoices: { [SCREW]: "Recipe_IronRod_C" } });
    expect(attempt({ plan: wrong })).toEqual({ ok: false, error: { code: "WRONG_RECIPE", recipe: "Recipe_IronRod_C", item: SCREW } });
  });

  it("ignores choices for items the plan does not reach", () => {
    const unused = plan({ [PLATE]: 20 }, { recipeChoices: { [SCREW]: CAST_SCREW } });
    expect(machinesOf(solved({ plan: unused }))).toEqual({ Recipe_IronPlate_C: 1, Recipe_IngotIron_C: 1 });
  });
});

describe("planning with what the world has unlocked", () => {
  const data = tracked();

  it("brings in what the world has not unlocked, and says so", () => {
    const result = solved({ data, plan: plan({ Desc_IronPlateReinforced_C: 1 }), world: world({ planWithUnlocks: true }) });
    expect(result.rows).toEqual([]);
    expect(byItem(result.imports)).toEqual({ Desc_IronPlateReinforced_C: 1 });
    expect(result.notUnlocked).toEqual(["Desc_IronPlateReinforced_C"]);
  });

  it("plans the chain once its milestones are ticked", () => {
    const done = world({ planWithUnlocks: true, milestonesDone: ["Schematic_Tutorial1_C", "Schematic_2-1_C"] });
    const result = solved({ data, plan: plan({ Desc_IronPlateReinforced_C: 1 }), world: done });
    expect(Object.keys(machinesOf(result))).toContain("Recipe_IronPlateReinforced_C");
    expect(result.imports).toEqual([]);
    expect(result.notUnlocked).toEqual([]);
  });

  it("keeps items without any recipe apart from locked ones", () => {
    const done = world({ planWithUnlocks: true, milestonesDone: ["Schematic_2-1_C"] });
    const result = solved({ data, plan: plan({ Desc_IronPlateReinforced_C: 1 }), world: done });
    expect(byItem(result.imports)).toHaveProperty("Desc_IronPlate_C");
    expect(result.notUnlocked).toEqual(["Desc_IronPlate_C"]);
  });

  it("refuses a chosen recipe the world has not unlocked", () => {
    const outcome = attempt({ data, plan: plan({ Desc_Plastic_C: 1 }, { recipeChoices: { Desc_Plastic_C: "Recipe_Plastic_C" } }), world: world({ planWithUnlocks: true }) });
    expect(outcome).toEqual({ ok: false, error: { code: "LOCKED_RECIPE", recipe: "Recipe_Plastic_C", item: "Desc_Plastic_C" } });
  });

  it("changes nothing while the switch is off", () => {
    const result = solved({ data, plan: plan({ Desc_IronPlateReinforced_C: 1 }), world: world() });
    expect(result.imports).toEqual([]);
    expect(result.notUnlocked).toEqual([]);
  });
});

describe("invalid plans", () => {
  const NOTHING = "Desc_Nothing_C";
  it.each([
    ["an unknown target", [{ [NOTHING]: 1 }], { reason: "UNKNOWN_ITEM", item: NOTHING }],
    ["a zero rate", [{ [PLATE]: 0 }], { reason: "BAD_RATE", item: PLATE }],
    ["a negative rate", [{ [PLATE]: -5 }], { reason: "BAD_RATE", item: PLATE }],
    ["an endless rate", [{ [PLATE]: Infinity }], { reason: "BAD_RATE", item: PLATE }],
    ["a rate that is not a number", [{ [PLATE]: Number.NaN }], { reason: "BAD_RATE", item: PLATE }],
    ["no targets", [{}], { reason: "NO_TARGETS" }],
    ["an unknown fixed input", [{ [PLATE]: 10 }, { fixedInputs: { [NOTHING]: 5 } }], { reason: "UNKNOWN_ITEM", item: NOTHING }],
    ["a fixed input of 0", [{ [PLATE]: 10 }, { fixedInputs: { [INGOT]: 0 } }], { reason: "BAD_RATE", item: INGOT }],
    ["an unknown recipe", [{ [PLATE]: 10 }, { recipeChoices: { [PLATE]: "Recipe_Nothing_C" } }], { reason: "UNKNOWN_RECIPE", item: PLATE, recipe: "Recipe_Nothing_C" }],
    ["a choice for an unknown item", [{ [PLATE]: 10 }, { recipeChoices: { [NOTHING]: "Recipe_IronPlate_C" } }], { reason: "UNKNOWN_ITEM", item: NOTHING, recipe: "Recipe_IronPlate_C" }],
  ] as [string, Parameters<typeof plan>, Record<string, string>][])("refuses %s", (_, input, expected) => {
    const outcome = attempt({ plan: plan(...input) });
    expect(outcome).toMatchObject({ ok: false, error: { code: "INVALID_PLAN", ...expected, message: expect.any(String) } });
  });

  it("ignores unlocked alternates the game data no longer has", () => {
    const result = solved({ plan: plan({ [PLATE]: 20 }), world: world({ unlockedAlternates: ["Recipe_Gone_C"] }) });
    expect(machinesOf(result)).toEqual({ Recipe_IronPlate_C: 1, Recipe_IngotIron_C: 1 });
  });
});

describe("byproducts", () => {
  // Plastic: 30 oil → 20 plastic + 10 residue a minute; Rubber: 30 oil → 20 rubber + 20 residue.
  it("lists side products nothing uses", () => {
    const result = solved({ plan: plan({ [PLASTIC]: 20, [RUBBER]: 20 }) });
    expect(machinesOf(result)).toEqual({ Recipe_Plastic_C: 1, Recipe_Rubber_C: 1 });
    expect(byItem(result.rawResources)).toEqual({ [OIL]: 60 });
    expect(byItem(result.byproducts)).toEqual({ [RESIDUE]: 30 });
    expect(result.imports).toEqual([]);
  });

  // Petroleum Coke: 40 residue → 120 coke a minute. 60 coke take 0.5 machines and 20 of the 30 residue.
  it("uses side products where a chosen recipe consumes them", () => {
    const result = solved({ plan: plan({ [PLASTIC]: 20, [RUBBER]: 20, [COKE]: 60 }) });
    expect(machinesOf(result)).toEqual({ Recipe_Plastic_C: 1, Recipe_Rubber_C: 1, Recipe_PetroleumCoke_C: 0.5 });
    expect(byItem(result.byproducts)).toEqual({ [RESIDUE]: 10 });
    expect(result.imports).toEqual([]);
  });

  // 120 coke need 40 residue; the refineries leave 30, so 10 come in.
  it("brings in only what the side products do not cover", () => {
    const result = solved({ plan: plan({ [PLASTIC]: 20, [RUBBER]: 20, [COKE]: 120 }) });
    expect(byItem(result.imports)).toEqual({ [RESIDUE]: 10 });
    expect(result.byproducts).toEqual([]);
  });

  it("does not make more of a target just for its side products", () => {
    const result = solved({ plan: plan({ [PLASTIC]: 20, [COKE]: 120 }) });
    expect(machinesOf(result)).toEqual({ Recipe_Plastic_C: 1, Recipe_PetroleumCoke_C: 1 });
    expect(byItem(result.imports)).toEqual({ [RESIDUE]: 30 });
    expect(result.surplus).toEqual([]);
  });
});

describe("imports", () => {
  // Residual Plastic: 60 resin + 20 water → 20 plastic a minute. Resin has no standard recipe.
  it("brings in items without a usable recipe", () => {
    const result = solved({ plan: plan({ [PLASTIC]: 20 }, { recipeChoices: { [PLASTIC]: "Recipe_ResidualPlastic_C" } }) });
    expect(machinesOf(result)).toEqual({ Recipe_ResidualPlastic_C: 1 });
    expect(byItem(result.imports)).toEqual({ [RESIN]: 60 });
    expect(byItem(result.rawResources)).toEqual({ [WATER]: 20 });
  });

  it("brings in a target without a recipe", () => {
    const result = solved({ plan: plan({ [RESIN]: 30 }) });
    expect(result.rows).toEqual([]);
    expect(byItem(result.imports)).toEqual({ [RESIN]: 30 });
  });

  it("stops at resources", () => {
    const result = solved({ plan: plan({ [WATER]: 100 }) });
    expect(result.rows).toEqual([]);
    expect(byItem(result.rawResources)).toEqual({ [WATER]: 100 });
  });
});

describe("fixed inputs", () => {
  // The chain needs 60 screws a minute.
  it("uses a partial supply first and makes the rest", () => {
    // 20 screws left: 0.5 constructors, 5 rods (1/3 constructor), ingots 45 + 5 = 50 (5/3 smelters).
    const result = solved({ plan: plan({ [RIP]: 5 }, { fixedInputs: { [SCREW]: 40 } }) });
    expect(byItem(result.fixedInputsUsed)).toEqual({ [SCREW]: 40 });
    expect(machinesOf(result)).toMatchObject({ Recipe_Screw_C: 0.5, Recipe_IronRod_C: 0.333333333333, Recipe_IngotIron_C: 1.66666666667 });
    expect(byItem(result.rawResources)).toEqual({ [ORE]: 50 });
    expect(result.surplus).toEqual([]);
  });

  it("makes nothing an exact supply covers", () => {
    const result = solved({ plan: plan({ [RIP]: 5 }, { fixedInputs: { [SCREW]: 60 } }) });
    expect(Object.keys(machinesOf(result))).toEqual(["Recipe_IronPlateReinforced_C", "Recipe_IronPlate_C", "Recipe_IngotIron_C"]);
    expect(byItem(result.rawResources)).toEqual({ [ORE]: 45 });
    expect(result.surplus).toEqual([]);
  });

  it("shows supply beyond the need as surplus", () => {
    const result = solved({ plan: plan({ [RIP]: 5 }, { fixedInputs: { [SCREW]: 100, [OIL]: 30 } }) });
    expect(byItem(result.fixedInputsUsed)).toEqual({ [SCREW]: 60 });
    expect(byItem(result.surplus)).toEqual({ [SCREW]: 40, [OIL]: 30 });
  });

  it("uses a supplied resource before mining more", () => {
    const result = solved({ plan: plan({ [RIP]: 5 }, { fixedInputs: { [ORE]: 25 } }) });
    expect(byItem(result.fixedInputsUsed)).toEqual({ [ORE]: 25 });
    expect(byItem(result.rawResources)).toEqual({ [ORE]: 35 });
  });

  it("uses a supplied item before making it from other supplies", () => {
    // Making the 60 screws from supplied ingots would take only 15 of them, but the screws come first.
    const result = solved({ plan: plan({ [RIP]: 5 }, { fixedInputs: { [SCREW]: 60, [INGOT]: 100 } }) });
    expect(byItem(result.fixedInputsUsed)).toEqual({ [SCREW]: 60, [INGOT]: 45 });
    expect(byItem(result.surplus)).toEqual({ [INGOT]: 55 });
    expect(result.rawResources).toEqual([]);
  });

  it("covers a target", () => {
    const result = solved({ plan: plan({ [PLATE]: 30 }, { fixedInputs: { [PLATE]: 50 } }) });
    expect(result.rows).toEqual([]);
    expect(byItem(result.fixedInputsUsed)).toEqual({ [PLATE]: 30 });
    expect(byItem(result.surplus)).toEqual({ [PLATE]: 20 });
  });
});

describe("loops", () => {
  const FUEL = "Desc_TestFuel_C";
  const loop = (rubberPerRun: number) =>
    extended({
      items: [FUEL],
      recipes: [
        testRecipe("Recipe_Test_RecycledPlastic_C", "Build_OilRefinery_C", 12, [{ item: RUBBER, amount: rubberPerRun }, { item: FUEL, amount: 6 }], [{ item: PLASTIC, amount: 12 }]),
        testRecipe("Recipe_Test_RecycledRubber_C", "Build_OilRefinery_C", 12, [{ item: PLASTIC, amount: 6 }, { item: FUEL, amount: 6 }], [{ item: RUBBER, amount: 12 }]),
      ],
    });
  const choices = { [PLASTIC]: "Recipe_Test_RecycledPlastic_C", [RUBBER]: "Recipe_Test_RecycledRubber_C" };

  it("balances a loop that makes more than it takes", () => {
    // Plastic p: 30 rubber + 30 fuel → 60 plastic; rubber r: 30 plastic + 30 fuel → 60 rubber, all a minute.
    // 60p − 30r = 120 and 60r − 30p = 0 give r = p/2, p = 8/3; fuel 30 × (8/3 + 4/3) = 120.
    const result = solved({ data: loop(6), plan: plan({ [PLASTIC]: 120 }, { recipeChoices: choices }) });
    expect(machinesOf(result)).toEqual({ Recipe_Test_RecycledPlastic_C: 2.66666666667, Recipe_Test_RecycledRubber_C: 1.33333333333 });
    expect(byItem(result.imports)).toEqual({ [FUEL]: 120 });
  });

  it("reports a loop that takes more than it makes", () => {
    // Each plastic needs 2 rubber (24 per 12), each rubber needs half a plastic: 1 plastic costs 1 plastic and more.
    const outcome = attempt({ data: loop(24), plan: plan({ [PLASTIC]: 120 }, { recipeChoices: choices }) });
    expect(outcome).toEqual({ ok: false, error: { code: "INFEASIBLE" } });
  });
});

describe("machine counts and clock speed", () => {
  const plates = (perMinute: number) => solved({ plan: plan({ [PLATE]: perMinute }) }).rows[0]!;

  it("keeps exact whole numbers at 100 %", () => {
    expect(plates(60)).toMatchObject({ machines: 3, machinesRounded: 3, clockPercent: 100 });
  });

  it("treats floating-point noise above a whole number as that number", () => {
    // 40.000000002 plates are 2.0000000001 constructors.
    expect(plates(40.000000002)).toMatchObject({ machinesRounded: 2, clockPercent: 100 });
  });

  it("rounds up and slows every machine down to match", () => {
    expect(plates(50)).toMatchObject({ machines: 2.5, machinesRounded: 3, clockPercent: 83.3333 });
  });

  it("keeps at most 4 decimals", () => {
    expect(plates(20 / 3)).toMatchObject({ machinesRounded: 1, clockPercent: 33.3333 });
    expect(plates(20 / 7).clockPercent).toBe(14.2857);
  });
});

describe("power", () => {
  it("takes full power at 100 %", () => {
    expect(solved({ plan: plan({ [PLATE]: 60 }) }).rows[0]!.powerMW).toBe(12);
  });

  it("scales with the clock speed to the power exponent", () => {
    // 3 constructors of 4 MW at 83.3333 %.
    expect(solved({ plan: plan({ [PLATE]: 50 }) }).rows[0]!.powerMW).toBeCloseTo(3 * 4 * 0.833333 ** EXPONENT, 9);
  });

  it("adds up every row", () => {
    // Assembler 15 MW; plates and screws 2 constructors at 75 % each; rods 1 constructor; 2 smelters.
    const result = solved({ plan: plan({ [RIP]: 5 }) });
    expect(result.powerMW).toBeCloseTo(15 + 2 * (2 * 4 * 0.75 ** EXPONENT) + 4 + 8, 9);
  });

  it("uses the average of a variable-power recipe", () => {
    const data = extended({
      items: ["Desc_TestMatter_C"],
      buildings: [{ id: "Build_TestAccelerator_C", name: { en: "Accelerator" }, description: { en: "" }, kind: "production", powerExponent: 1.321928, buildCost: [] }],
      recipes: [{ ...testRecipe("Recipe_TestMatter_C", "Build_TestAccelerator_C", 60, [{ item: PLATE, amount: 1 }], [{ item: "Desc_TestMatter_C", amount: 1 }]), variablePowerMW: { min: 250, max: 750 } }],
      defaults: { Desc_TestMatter_C: "Recipe_TestMatter_C" },
    });
    // 2 machines at 100 %, 500 MW each.
    expect(solved({ data, plan: plan({ Desc_TestMatter_C: 2 }) }).rows[0]!.powerMW).toBe(1000);
  });
});

describe("build cost", () => {
  it("adds up every rounded-up machine", () => {
    // 1 assembler (8 plates, 20 rods), 5 constructors (2 plates each), 2 smelters (5 rods each).
    const result = solved({ plan: plan({ [RIP]: 5 }) });
    expect(result.buildCost).toEqual([
      { item: RIP, amount: 18 },
      { item: ROD, amount: 30 },
    ]);
  });
});
