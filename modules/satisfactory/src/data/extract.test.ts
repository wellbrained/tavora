import { describe, expect, it } from "vitest";
import {
  classNameOf,
  cleanText,
  compareIds,
  decodeDocs,
  DocsError,
  finish,
  iconRequests,
  nativeClassName,
  parseItemAmounts,
  parsePathList,
  parseTexture,
  readDocs,
  serialize,
  type DocsClass,
  type DocsGroup,
  type GamePhaseAsset,
  type ResearchTreeAsset,
} from "../../tools/game-docs";
import { patchUsmap } from "../../tools/usmap";
import { sampleData } from "./sample";

// Small Docs fixtures in the real shape: one smelter chain, a fluid, an alternate, a variable-power recipe.

const native = (name: string) => `/Script/CoreUObject.Class'/Script/FactoryGame.${name}'`;
const ref = (id: string) => `/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/X/${id.slice(0, -2)}.${id}'`;
const amounts = (...list: [string, number][]) =>
  `(${list.map(([id, amount]) => `(ItemClass="${ref(id)}",Amount=${amount})`).join(",")})`;
const paths = (...ids: string[]) => `(${ids.map((id) => (id.startsWith("/") ? `"${id}"` : `"/Game/FactoryGame/B/${id.slice(0, -2)}.${id}"`)).join(",")})`;
const icon = (id: string) => `Texture2D /Game/FactoryGame/UI/Icon_${id}.Icon_${id}`;

const item = (id: string, name: string, extra: Partial<DocsClass> = {}): DocsClass => ({
  ClassName: id,
  mDisplayName: name,
  mDescription: `${name} for crafting.\r\n`,
  mStackSize: "SS_BIG",
  mCachedStackSize: "200",
  mForm: "RF_SOLID",
  mEnergyValue: "0.000000",
  mResourceSinkPoints: "6",
  mSmallIcon: icon(id),
  mPersistentBigIcon: icon(id),
  mIsAlienItem: "False",
  ...extra,
});
const fluid = (id: string, name: string, extra: Partial<DocsClass> = {}) =>
  item(id, name, { mStackSize: "SS_FLUID", mCachedStackSize: "50000", mForm: "RF_LIQUID", mResourceSinkPoints: "5", ...extra });

const recipe = (id: string, name: string, producedIn: string, ingredients: string, product: string, extra: Partial<DocsClass> = {}): DocsClass => ({
  ClassName: id,
  mDisplayName: name,
  mIngredients: ingredients,
  mProduct: product,
  mManufactoringDuration: "6.000000",
  mProducedIn: producedIn,
  mVariablePowerConsumptionConstant: "0.000000",
  mVariablePowerConsumptionFactor: "1.000000",
  ...extra,
});

const schematic = (id: string, type: string, name: string, unlocks: Record<string, string>[], tier = "0", extra: Partial<DocsClass> = {}): DocsClass => ({
  ClassName: id,
  mType: type,
  mDisplayName: name,
  mTechTier: tier,
  mMenuPriority: "0.000000",
  mCost: "",
  mSchematicDependencies: "",
  mUnlocks: unlocks,
  ...extra,
});
const needs = (...ids: string[]) => [
  { Class: "BP_SchematicPurchasedDependency_C", mSchematics: `(${ids.map((id) => `"${ref(id)}"`).join(",")})`, mRequireAllSchematicsToBePurchased: "True" },
];
const unlockRecipes = (...ids: string[]) => ({ Class: "BP_UnlockRecipe_C", mRecipes: `(${ids.map((id) => `"${ref(id)}"`).join(",")})` });
const unlockSchematics = (...ids: string[]) => ({ Class: "BP_UnlockSchematic_C", mSchematics: `(${ids.map((id) => `"${ref(id)}"`).join(",")})` });

const WORKBENCH = "/Game/FactoryGame/Buildable/-Shared/WorkBench/BP_WorkBenchComponent.BP_WorkBenchComponent_C";
const WORKSHOP = "/Game/FactoryGame/Buildable/-Shared/WorkBench/BP_WorkshopComponent.BP_WorkshopComponent_C";
const BUILD_GUN = "/Game/FactoryGame/Equipment/BuildGun/BP_BuildGun.BP_BuildGun_C";

function fixture(): { en: DocsGroup[]; de: DocsGroup[] } {
  const en: DocsGroup[] = [
    { NativeClass: native("FGResourceDescriptor"), Classes: [item("Desc_OreIron_C", "Iron Ore", { mResourceSinkPoints: "1" }), fluid("Desc_Water_C", "Water")] },
    {
      NativeClass: native("FGItemDescriptor"),
      Classes: [
        item("Desc_IronIngot_C", "Iron Ingot"),
        item("Desc_IronPlate_C", "Iron Plate"),
        fluid("Desc_LiquidFuel_C", "Fuel", { mEnergyValue: "0.750000" }),
      ],
    },
    {
      NativeClass: native("FGBuildableManufacturer"),
      Classes: [
        { ClassName: "Build_SmelterMk1_C", mDisplayName: "Smelter", mDescription: "Smelts.", mPowerConsumption: "4.000000", mPowerConsumptionExponent: "1.321929" },
        { ClassName: "Build_ConstructorMk1_C", mDisplayName: "Constructor", mDescription: "Crafts.", mPowerConsumption: "4.000000", mPowerConsumptionExponent: "1.321929" },
      ],
    },
    {
      NativeClass: native("FGBuildableManufacturerVariablePower"),
      Classes: [{ ClassName: "Build_Converter_C", mDisplayName: "Converter", mDescription: "Converts.", mPowerConsumption: "0.000000", mPowerConsumptionExponent: "1.321929" }],
    },
    {
      NativeClass: native("FGBuildingDescriptor"),
      Classes: [{ ClassName: "Desc_ConstructorMk1_C", mSmallIcon: icon("Constructor"), mPersistentBigIcon: icon("Constructor") }],
    },
    {
      NativeClass: native("FGRecipe"),
      Classes: [
        recipe("Recipe_IngotIron_C", "Iron Ingot", paths("Build_SmelterMk1_C", WORKBENCH), amounts(["Desc_OreIron_C", 1]), amounts(["Desc_IronIngot_C", 1]), { mManufactoringDuration: "2.000000" }),
        recipe("Recipe_IronPlate_C", "Iron Plate", paths("Build_ConstructorMk1_C"), amounts(["Desc_IronIngot_C", 3]), amounts(["Desc_IronPlate_C", 2])),
        recipe("Recipe_Alternate_WetPlate_C", "Alternate: Wet Plate", paths("Build_ConstructorMk1_C"), amounts(["Desc_IronIngot_C", 1], ["Desc_Water_C", 2000]), amounts(["Desc_IronPlate_C", 1])),
        recipe("Recipe_WaterFuel_C", "Fuel", paths("Build_Converter_C"), amounts(["Desc_Water_C", 1000]), amounts(["Desc_LiquidFuel_C", 500]), {
          mVariablePowerConsumptionConstant: "100.000000",
          mVariablePowerConsumptionFactor: "200.000000",
        }),
        recipe("Recipe_ConstructorMk1_C", "Constructor", paths(BUILD_GUN), amounts(["Desc_IronPlate_C", 2]), amounts(["Desc_ConstructorMk1_C", 1])),
        recipe("Recipe_Gadget_C", "Gadget", paths(WORKSHOP), amounts(["Desc_IronPlate_C", 1]), amounts(["Desc_IronIngot_C", 1])),
      ],
    },
    {
      NativeClass: native("FGSchematic"),
      Classes: [
        schematic("Schematic_StartingRecipes_C", "EST_Custom", "Starting Blueprints", [unlockRecipes("Recipe_IngotIron_C", "Recipe_ConstructorMk1_C")]),
        schematic("Schematic_Tutorial1_C", "EST_Tutorial", "HUB Upgrade 1", [], "0", { mMenuPriority: "1.000000" }),
        schematic("Schematic_Tutorial2_C", "EST_Tutorial", "HUB Upgrade 2", [], "0", { mMenuPriority: "2.000000", mSchematicDependencies: needs("Schematic_Tutorial1_C") }),
        schematic("Schematic_1-1_C", "EST_Milestone", "Base Building", [unlockRecipes("Recipe_IronPlate_C", "Recipe_Gadget_C"), unlockSchematics("Schematic_1-1-1_C")], "1", {
          mCost: amounts(["Desc_IronPlate_C", 10], ["Desc_Water_C", 3000]),
        }),
        schematic("Schematic_1-1-1_C", "EST_Custom", "Base Building 2", [unlockRecipes("Recipe_WaterFuel_C", "Recipe_ConstructorMk1_C")]),
        schematic("Schematic_Alternate_WetPlate_C", "EST_Alternate", "Alternate: Wet Plate", [unlockRecipes("Recipe_Alternate_WetPlate_C")], "1", {
          mSchematicDependencies: needs("Schematic_1-1_C"),
        }),
        schematic("Research_Old_C", "EST_MAM", "Discontinued - Plates", [unlockRecipes("Recipe_IronPlate_C")], "3"),
        schematic("Research_Water_C", "EST_MAM", "Water Fuel", [unlockRecipes("Recipe_WaterFuel_C")], "3", { mCost: amounts(["Desc_IronPlate_C", 5]) }),
        schematic("Research_Water2_C", "EST_MAM", "More Water", [], "3", { mCost: amounts(["Desc_IronIngot_C", 5], ["Desc_HardDrive_C", 1]) }),
        schematic("ResourceSink_Coupon_C", "EST_ResourceSink", "Shop Thing", [], "0", { mCost: `((ItemClass="${ref("Desc_ResourceSinkCoupon_C")}"))` }),
      ],
    },
  ];
  const german: Record<string, string> = { "Iron Plate": "Eisenplatte", Water: "Wasser", "Base Building": "Basisbau" };
  const de = en.map((group) => ({
    NativeClass: group.NativeClass,
    Classes: group.Classes.map((c) => ({ ...c, mDisplayName: german[String(c.mDisplayName)] ?? c.mDisplayName })),
  }));
  return { en, de };
}

const trees: ResearchTreeAsset[] = [
  {
    id: "BPD_ResearchTree_Water_C",
    name: { en: "Water", de: "Wasser" },
    nodes: [
      // Listed bottom-up, with a parent position where no node is left, as the game files have.
      { schematic: "Research_Water2_C", at: { x: 0, y: 1 }, parents: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
      { schematic: "Research_Water_C", at: { x: 0, y: 0 }, parents: [] },
    ],
  },
];
const phases: GamePhaseAsset[] = [
  { phase: 1, name: { en: "Platform", de: "Plattform" }, lastTier: 1, costs: [{ item: "Desc_IronPlate_C", amount: 50 }] },
  { phase: 0, name: { en: "Onboarding" }, lastTier: 0, costs: [] },
  { phase: 2, name: { en: "After" }, lastTier: 1, costs: [] },
];

function extract(change?: (en: DocsGroup[]) => void, choices: Record<string, string> = {}) {
  const { en, de } = fixture();
  change?.(en);
  const catalog = readDocs(en, de);
  return { catalog, ...finish(catalog, { build: 1, version: "1.0", researchTrees: trees, gamePhases: phases, icons: new Set(["Desc_IronPlate_C", "Build_ConstructorMk1_C"]) }, choices) };
}

function problems(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof DocsError) return error.problems;
    throw error;
  }
  throw new Error("Expected the run to fail.");
}

const group = (en: DocsGroup[], name: string) => en.find((g) => g.NativeClass === native(name))!;

describe("Unreal text parsers", () => {
  it("decode UTF-16 LE with a byte order mark and UTF-8", () => {
    const json = JSON.stringify([{ NativeClass: native("FGRecipe"), Classes: [{ ClassName: "Recipe_Ä_C" }] }]);
    const utf16 = new Uint8Array(2 + json.length * 2);
    utf16.set([0xff, 0xfe]);
    for (let i = 0; i < json.length; i++) utf16.set([json.charCodeAt(i) & 0xff, json.charCodeAt(i) >> 8], 2 + i * 2);
    expect(decodeDocs(utf16)[0]?.Classes[0]?.ClassName).toBe("Recipe_Ä_C");
    expect(decodeDocs(new TextEncoder().encode(json))[0]?.Classes[0]?.ClassName).toBe("Recipe_Ä_C");
    expect(() => decodeDocs(new TextEncoder().encode('{"NativeClass": 1}'))).toThrow(/not a list/);
  });

  it("read native classes and object paths", () => {
    expect(nativeClassName(native("FGRecipe"))).toBe("FGRecipe");
    expect(() => nativeClassName("/Script/Engine.Class'/Script/Engine.Actor'")).toThrow();
    expect(classNameOf("/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C")).toBe("Build_ConstructorMk1_C");
    expect(classNameOf("/Script/FactoryGame.FGBuildGun")).toBe("FGBuildGun");
    expect(classNameOf(ref("Desc_IronPlate_C"))).toBe("Desc_IronPlate_C");
  });

  it("read lists, amounts and icons strictly", () => {
    expect(parsePathList(paths("Build_A_C", WORKBENCH))).toEqual(["/Game/FactoryGame/B/Build_A.Build_A_C", WORKBENCH]);
    expect(parsePathList("")).toEqual([]);
    expect(() => parsePathList('("a",b)')).toThrow();
    expect(parseItemAmounts(amounts(["Desc_IronIngot_C", 3], ["Desc_Water_C", 1500]))).toEqual([
      { item: "Desc_IronIngot_C", amount: 3 },
      { item: "Desc_Water_C", amount: 1500 },
    ]);
    expect(() => parseItemAmounts(`((ItemClass="${ref("Desc_A_C")}",Amount=3,Chance=0.5))`)).toThrow();
    expect(parseTexture("Texture2D /Game/FactoryGame/UI/IconDesc_A_256.IconDesc_A_256")).toBe("/Game/FactoryGame/UI/IconDesc_A_256.IconDesc_A_256");
    expect(parseTexture("None")).toBeUndefined();
    expect(() => parseTexture("Material /Game/A.A")).toThrow();
    expect(cleanText("Line one.\r\nLine two.\r\n ")).toBe("Line one.\nLine two.");
  });
});

describe("readDocs and finish", () => {
  it("list progress: phases, milestones in HUB order, research with its links, and hard drives", () => {
    const { progress } = extract().data;
    // Phases 0 to the last one that costs something; later ones are left out.
    expect(progress.phases).toEqual([
      { phase: 0, name: { en: "Onboarding" }, cost: [], lastTier: 0 },
      { phase: 1, name: { en: "Platform", de: "Plattform" }, cost: [{ item: "Desc_IronPlate_C", amount: 50 }], lastTier: 1 },
    ]);
    expect(progress.milestones.map((m) => m.id)).toEqual(["Schematic_Tutorial1_C", "Schematic_Tutorial2_C", "Schematic_1-1_C"]);
    expect(progress.milestones[1]?.requires).toEqual(["Schematic_Tutorial1_C"]);
    // Costs with fluids in cubic metres; unlocks include the background schematic, the building it places and workshop items.
    expect(progress.milestones[2]).toEqual({
      id: "Schematic_1-1_C",
      name: { en: "Base Building", de: "Basisbau" },
      tier: 1,
      cost: [{ item: "Desc_IronPlate_C", amount: 10 }, { item: "Desc_Water_C", amount: 3 }],
      unlocks: { recipes: ["Recipe_IronPlate_C", "Recipe_WaterFuel_C"], buildings: ["Build_ConstructorMk1_C"], items: ["Desc_IronIngot_C"] },
      requires: [],
    });
    // Nodes top-down; a parent position without a node is skipped; hard drives are counted apart from the cost.
    expect(progress.research).toEqual([
      {
        id: "BPD_ResearchTree_Water_C",
        name: { en: "Water", de: "Wasser" },
        nodes: [
          { id: "Research_Water_C", name: { en: "Water Fuel", de: "Water Fuel" }, cost: [{ item: "Desc_IronPlate_C", amount: 5 }], unlocks: { recipes: ["Recipe_WaterFuel_C"], buildings: [], items: [] }, requires: [] },
          { id: "Research_Water2_C", name: { en: "More Water", de: "More Water" }, cost: [{ item: "Desc_IronIngot_C", amount: 5 }], hardDrives: 1, unlocks: { recipes: [], buildings: [], items: [] }, requires: ["Research_Water_C"] },
        ],
      },
    ]);
    expect(progress.hardDrives).toEqual([{ id: "Schematic_Alternate_WetPlate_C", recipes: ["Recipe_Alternate_WetPlate_C"], requires: ["Schematic_1-1_C"] }]);
  });

  it("refuse progress they cannot read", () => {
    const runWith = (change: (en: DocsGroup[]) => void) => problems(() => extract(change));
    expect(runWith((en) => {
      group(en, "FGSchematic").Classes.find((c) => c.ClassName === "Schematic_1-1_C")!.mCost = amounts(["Desc_Mystery_C", 1]);
    })).toContain("Schematic_1-1_C costs Desc_Mystery_C, which is not in the Docs.");
    expect(runWith((en) => {
      group(en, "FGSchematic").Classes.find((c) => c.ClassName === "Schematic_1-1_C")!.mTechTier = "4";
    })).toContain("Schematic_1-1_C is in tier 4, which no phase opens.");
    expect(runWith((en) => {
      group(en, "FGSchematic").Classes.find((c) => c.ClassName === "Schematic_Alternate_WetPlate_C")!.mSchematicDependencies = [
        { Class: "BP_SchematicPurchasedDependency_C", mSchematics: `("${ref("Schematic_1-1_C")}")`, mRequireAllSchematicsToBePurchased: "False" },
      ];
    })).toContain('Schematic_Alternate_WetPlate_C needs one of several schematics; the tracker only knows "all of".');
    expect(runWith((en) => {
      group(en, "FGSchematic").Classes.find((c) => c.ClassName === "Schematic_1-1_C")!.mSchematicDependencies = [{ Class: "BP_SomethingNew_C" }];
    })).toContain("Schematic_1-1_C: unknown dependency BP_SomethingNew_C.");
  });

  it("read items with fluids in cubic metres", () => {
    const { data } = extract();
    expect(data.items.Desc_Water_C).toMatchObject({ form: "liquid", kind: "resource", name: { en: "Water", de: "Wasser" } });
    expect(data.items.Desc_Water_C).not.toHaveProperty("stackSize");
    expect(data.items.Desc_Water_C).not.toHaveProperty("sinkPoints");
    expect(data.items.Desc_LiquidFuel_C?.energyMJ).toBe(750);
    expect(data.items.Desc_IronPlate_C).toMatchObject({ stackSize: 200, sinkPoints: 6, icon: "icons/Desc_IronPlate_C.webp", description: { en: "Iron Plate for crafting." } });
    expect(data.items.Desc_IronIngot_C).not.toHaveProperty("icon");
    expect(data.resources).toEqual(["Desc_OreIron_C", "Desc_Water_C"]);
  });

  it("keep production recipes only and record their buildings", () => {
    const { data } = extract();
    expect(Object.keys(data.recipes).sort()).toEqual(["Recipe_Alternate_WetPlate_C", "Recipe_IngotIron_C", "Recipe_IronPlate_C", "Recipe_WaterFuel_C"]);
    expect(data.recipes.Recipe_IngotIron_C).toMatchObject({ producedIn: ["Build_SmelterMk1_C"], durationSeconds: 2 });
    expect(data.recipes.Recipe_Alternate_WetPlate_C).toMatchObject({ alternate: true, ingredients: [{ item: "Desc_IronIngot_C", amount: 1 }, { item: "Desc_Water_C", amount: 2 }] });
    expect(data.recipes.Recipe_WaterFuel_C).toMatchObject({ products: [{ item: "Desc_LiquidFuel_C", amount: 0.5 }], variablePowerMW: { min: 100, max: 300 } });
    expect(data.recipes.Recipe_IronPlate_C).not.toHaveProperty("variablePowerMW");
  });

  it("read buildings with power, build costs and icons", () => {
    const { data, catalog } = extract();
    expect(data.buildings.Build_ConstructorMk1_C).toMatchObject({
      kind: "production",
      powerMW: 4,
      powerExponent: 1.321929,
      buildCost: [{ item: "Desc_IronPlate_C", amount: 2 }],
      icon: "icons/Build_ConstructorMk1_C.webp",
    });
    expect(data.buildings.Build_Converter_C).not.toHaveProperty("powerMW");
    expect(data.buildings.Build_Converter_C?.powerExponent).toBe(1.321929);
    expect(iconRequests(catalog).map((r) => r.id)).toContain("Build_ConstructorMk1_C");
  });

  it("resolve unlocks through background schematics and research trees", () => {
    const { data, unreachableResearch } = extract();
    expect(data.recipes.Recipe_IngotIron_C?.unlockedBy).toEqual([{ kind: "start" }]);
    expect(data.recipes.Recipe_IronPlate_C?.unlockedBy).toEqual([{ kind: "milestone", tier: 1, name: { en: "Base Building", de: "Basisbau" } }]);
    expect(data.recipes.Recipe_WaterFuel_C?.unlockedBy).toEqual([
      { kind: "milestone", tier: 1, name: { en: "Base Building", de: "Basisbau" } },
      { kind: "mam", tree: { en: "Water", de: "Wasser" }, name: { en: "Water Fuel", de: "Water Fuel" } },
    ]);
    expect(data.recipes.Recipe_Alternate_WetPlate_C?.unlockedBy).toEqual([{ kind: "hardDrive" }]);
    expect(unreachableResearch).toEqual(["Research_Old_C"]);
  });

  it("pick default recipes: the only one, the one named like the item, or a pinned choice", () => {
    expect(extract().data.defaultRecipe).toEqual({
      Desc_IronIngot_C: "Recipe_IngotIron_C",
      Desc_IronPlate_C: "Recipe_IronPlate_C",
      Desc_LiquidFuel_C: "Recipe_WaterFuel_C",
    });
    const secondPlate = (en: DocsGroup[]) =>
      group(en, "FGRecipe").Classes.push(recipe("Recipe_PlateFromOre_C", "Ore Plate", paths("Build_ConstructorMk1_C"), amounts(["Desc_OreIron_C", 4]), amounts(["Desc_IronPlate_C", 1])));
    expect(extract(secondPlate).data.defaultRecipe.Desc_IronPlate_C).toBe("Recipe_IronPlate_C");
    const renamed = (en: DocsGroup[]) => {
      secondPlate(en);
      group(en, "FGRecipe").Classes.find((c) => c.ClassName === "Recipe_IronPlate_C")!.mDisplayName = "Plate";
    };
    expect(problems(() => extract(renamed))).toEqual([expect.stringMatching(/^Desc_IronPlate_C has several standard recipes/)]);
    expect(extract(renamed, { Desc_IronPlate_C: "Recipe_PlateFromOre_C" }).data.defaultRecipe.Desc_IronPlate_C).toBe("Recipe_PlateFromOre_C");
    expect(problems(() => extract(undefined, { Desc_IronPlate_C: "Recipe_IronPlate_C" }))).toEqual([expect.stringMatching(/no longer needed/)]);
  });

  it("never default a fluid to unpacking its own package", () => {
    const { data } = extract((en) => {
      group(en, "FGItemDescriptor").Classes.push(fluid("Desc_Residue_C", "Residue"), item("Desc_PackagedResidue_C", "Packaged Residue"));
      group(en, "FGRecipe").Classes.push(
        recipe("Recipe_PackagedResidue_C", "Packaged Residue", paths("Build_ConstructorMk1_C"), amounts(["Desc_Residue_C", 2000]), amounts(["Desc_PackagedResidue_C", 2])),
        recipe("Recipe_UnpackageResidue_C", "Unpackage Residue", paths("Build_ConstructorMk1_C"), amounts(["Desc_PackagedResidue_C", 2]), amounts(["Desc_Residue_C", 2000])),
      );
    });
    expect(data.defaultRecipe.Desc_PackagedResidue_C).toBe("Recipe_PackagedResidue_C");
    expect(data.defaultRecipe.Desc_Residue_C).toBeUndefined();
  });

  it("fail on what they do not understand, listing everything at once", () => {
    const found = problems(() =>
      extract((en) => {
        en.push({ NativeClass: native("FGBuildableTeleporter"), Classes: [{ ClassName: "Build_Teleporter_C" }] });
        group(en, "FGRecipe").Classes[0]!.mChance = "0.5";
        group(en, "FGRecipe").Classes[1]!.mProducedIn = paths("Build_Workshop9000_C");
        group(en, "FGRecipe").Classes[2]!.mProduct = amounts(["Desc_Unknown_C", 1]);
        group(en, "FGItemDescriptor").Classes.push(item("Desc_Plasma_C", "Plasma", { mForm: "RF_PLASMA" }));
        group(en, "FGSchematic").Classes[0]!.mUnlocks = [{ Class: "BP_UnlockTeleport_C" }];
        group(en, "FGBuildableManufacturer").Classes[0]!.mPowerBurst = "9";
      }),
    );
    expect(found).toEqual([
      expect.stringMatching(/Unknown native class FGBuildableTeleporter/),
      expect.stringMatching(/Desc_Plasma_C: unexpected form RF_PLASMA/),
      expect.stringMatching(/Build_SmelterMk1_C: unknown field mPowerBurst/),
      expect.stringMatching(/Recipe_IngotIron_C: unknown field mChance/),
      expect.stringMatching(/Recipe_IronPlate_C: unknown producer Build_Workshop9000_C/),
      expect.stringMatching(/Recipe_Alternate_WetPlate_C: unknown item Desc_Unknown_C/),
      expect.stringMatching(/Schematic_StartingRecipes_C: unknown unlock BP_UnlockTeleport_C/),
      expect.stringMatching(/start schematic/),
    ]);
  });
});

describe("output and guard", () => {
  it("serialize with sorted keys and arrays in order", () => {
    const text = serialize(sampleData);
    expect(text.endsWith("}\n")).toBe(true);
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    expect(Object.keys(parsed.recipes.Recipe_Plastic_C)).toEqual([...Object.keys(parsed.recipes.Recipe_Plastic_C)].sort());
    expect(parsed.recipes.Recipe_Plastic_C.products.map((p: { item: string }) => p.item)).toEqual(["Desc_Plastic_C", "Desc_HeavyOilResidue_C"]);
  });

  it("list new and missing items, recipes and buildings", () => {
    const next = structuredClone(sampleData);
    delete next.recipes.Recipe_Rubber_C;
    next.items.Desc_Wire_C = { ...next.items.Desc_IronRod_C!, id: "Desc_Wire_C" };
    expect(compareIds(sampleData, next)).toEqual(["New items: Desc_Wire_C", "Missing recipes: Recipe_Rubber_C"]);
    expect(compareIds(sampleData, sampleData)).toEqual([]);
  });
});

describe("patchUsmap", () => {
  // A minimal usmap: version 0, three names, no enums, one struct with an optional and an int property.
  function usmap(): Uint8Array {
    const names = ["S", "a", "b"];
    const body = [
      ...u32(names.length), ...names.flatMap((n) => [n.length, ...new TextEncoder().encode(n)]),
      ...u32(0),
      ...u32(1), ...u32(0), ...u32(0xffffffff), ...u16(2), ...u16(2),
      ...u16(0), 1, ...u32(1), 28,
      ...u16(1), 1, ...u32(2), 2,
    ];
    return new Uint8Array([0xc4, 0x30, 0, 0, ...u32(body.length), ...u32(body.length), ...body]);
  }
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

  it("gives optional properties an inner type and fixes the sizes", () => {
    const input = usmap();
    const { bytes, patched } = patchUsmap(input);
    expect(patched).toBe(1);
    expect(bytes.length).toBe(input.length + 1);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(4, true)).toBe(input.length - 12 + 1);
    expect(view.getUint32(8, true)).toBe(input.length - 12 + 1);
    expect([...bytes.subarray(-10)]).toEqual([28, 1, ...u16(1), 1, ...u32(2), 2]);
  });

  it("refuses files it cannot walk", () => {
    expect(() => patchUsmap(new Uint8Array([1, 2, 3, 4]))).toThrow(/Not a usmap/);
    const future = usmap();
    future[2] = 9;
    expect(() => patchUsmap(future)).toThrow(/version 9/);
  });
});
