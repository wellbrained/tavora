import { beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "../contracts/data";
import { loadGameData } from "./index";

let data: GameData;
beforeAll(async () => {
  data = await loadGameData();
});

describe("pinned game data", () => {
  it("has the format and a game build", () => {
    expect(data.format).toBe("tavora.satisfactory.data");
    expect(data.version).toBe(1);
    expect(Number.isInteger(data.game.build) && data.game.build > 0).toBe(true);
    expect(data.game.version).toMatch(/^\d+\.\d+/);
  });

  it("keys every entry by its id and names it in English and German", () => {
    for (const table of [data.items, data.recipes, data.buildings]) {
      for (const [id, entry] of Object.entries(table)) {
        expect(entry.id).toBe(id);
        expect(entry.name.en, id).not.toBe("");
        expect(entry.name.de, id).toBeTruthy();
      }
    }
  });

  it("only refers to items and buildings that exist", () => {
    for (const recipe of Object.values(data.recipes)) {
      for (const amount of [...recipe.ingredients, ...recipe.products]) {
        expect(data.items[amount.item], `${recipe.id} → ${amount.item}`).toBeDefined();
        expect(amount.amount, recipe.id).toBeGreaterThan(0);
      }
      expect(recipe.products.length, recipe.id).toBeGreaterThan(0);
      expect(recipe.producedIn.length, recipe.id).toBeGreaterThan(0);
      for (const building of recipe.producedIn) expect(data.buildings[building]?.kind, `${recipe.id} → ${building}`).toBe("production");
    }
    for (const building of Object.values(data.buildings)) {
      for (const cost of building.buildCost) expect(data.items[cost.item], `${building.id} → ${cost.item}`).toBeDefined();
    }
  });

  it("has a default recipe that makes its item first and is no alternate, never for resources", () => {
    for (const [item, id] of Object.entries(data.defaultRecipe)) {
      const recipe = data.recipes[id];
      expect(recipe, item).toBeDefined();
      expect(recipe!.products[0]!.item, id).toBe(item);
      expect(recipe!.alternate, id).toBe(false);
    }
    for (const resource of data.resources) {
      expect(data.items[resource]?.kind, resource).toBe("resource");
      expect(data.defaultRecipe[resource], resource).toBeUndefined();
    }
    expect(data.resources).toEqual(Object.values(data.items).filter((i) => i.kind === "resource").map((i) => i.id).sort());
  });

  it("gives stack sizes to solids only and icons in the module's icon folder", () => {
    for (const item of Object.values(data.items)) {
      expect(item.stackSize === undefined, item.id).toBe(item.form !== "solid");
      if (item.form !== "solid") expect(item.sinkPoints, item.id).toBeUndefined();
      if (item.icon) expect(item.icon).toBe(`icons/${item.id}.webp`);
    }
    for (const building of Object.values(data.buildings)) if (building.icon) expect(building.icon).toBe(`icons/${building.id}.webp`);
  });

  it("gives variable power only to recipes in variable-power buildings", () => {
    for (const recipe of Object.values(data.recipes)) {
      const variable = recipe.producedIn.some((b) => data.buildings[b]?.powerMW === undefined);
      expect(recipe.variablePowerMW !== undefined, recipe.id).toBe(variable);
      if (recipe.variablePowerMW) expect(recipe.variablePowerMW.max, recipe.id).toBeGreaterThan(recipe.variablePowerMW.min);
    }
  });

  it("matches known values", () => {
    expect(data.recipes.Recipe_IronPlate_C).toMatchObject({
      alternate: false,
      producedIn: ["Build_ConstructorMk1_C"],
      durationSeconds: 6,
      ingredients: [{ item: "Desc_IronIngot_C", amount: 3 }],
      products: [{ item: "Desc_IronPlate_C", amount: 2 }],
      unlockedBy: [{ kind: "start" }],
    });
    expect(data.buildings.Build_ConstructorMk1_C).toMatchObject({ kind: "production", powerMW: 4, name: { en: "Constructor" } });
    expect(data.defaultRecipe.Desc_IronPlate_C).toBe("Recipe_IronPlate_C");
    // Fluids in cubic metres: Plastic takes 3 m³ of crude oil and leaves 1 m³ of heavy oil residue.
    expect(data.recipes.Recipe_Plastic_C).toMatchObject({
      ingredients: [{ item: "Desc_LiquidOil_C", amount: 3 }],
      products: [{ item: "Desc_Plastic_C", amount: 2 }, { item: "Desc_HeavyOilResidue_C", amount: 1 }],
    });
    expect(data.items.Desc_LiquidFuel_C).toMatchObject({ form: "liquid", energyMJ: 750 });
    expect(data.recipes.Recipe_Alternate_PureIronIngot_C).toMatchObject({ alternate: true, unlockedBy: [{ kind: "hardDrive" }] });
    expect(data.recipes.Recipe_Diamond_C?.variablePowerMW).toEqual({ min: 250, max: 750 });
    expect(data.resources).toContain("Desc_Water_C");
    expect(data.defaultRecipe.Desc_HeavyOilResidue_C).toBeUndefined();
  });
});
