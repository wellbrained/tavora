import { describe, expect, it } from "vitest";
import type { World } from "../contracts/plan";
import { sampleData } from "../data/sample";
import {
  addRate,
  canPlan,
  chooseRecipe,
  defaultRate,
  emptyPlan,
  isUnlocked,
  parseRate,
  planForItem,
  recipesMaking,
  removeRate,
  setAlternate,
  setRate,
  uniqueName,
} from "./planEdit";

const world: World = { format: "tavora.satisfactory.world", version: 1, name: "W", unlockedAlternates: [], showAllAlternates: false };

describe("defaultRate", () => {
  it("is one machine's output of the default recipe", () => {
    expect(defaultRate(sampleData, "Desc_IronPlate_C")).toBe(20); // 2 every 6 s
    expect(defaultRate(sampleData, "Desc_IronScrew_C")).toBe(40); // 4 every 6 s
    expect(defaultRate(sampleData, "Desc_IronPlateReinforced_C")).toBe(5); // 1 every 12 s
  });

  it("uses another recipe that makes the item when there is no default, else 60", () => {
    expect(defaultRate(sampleData, "Desc_PolymerResin_C")).toBe(20); // byproduct of an alternate, 2 every 6 s
    expect(defaultRate(sampleData, "Desc_OreIron_C")).toBe(60);
  });
});

describe("planForItem", () => {
  it("makes a plan for one item at its default rate", () => {
    expect(planForItem(sampleData, "Desc_IronPlate_C", "Iron Plate", "world-1")).toEqual({
      ...emptyPlan("Iron Plate", "world-1"),
      targets: [{ item: "Desc_IronPlate_C", perMinute: 20 }],
    });
  });
});

describe("canPlan", () => {
  it("allows made items but not ground resources", () => {
    expect(canPlan(sampleData, "Desc_IronPlate_C")).toBe(true);
    expect(canPlan(sampleData, "Desc_HeavyOilResidue_C")).toBe(true);
    expect(canPlan(sampleData, "Desc_OreIron_C")).toBe(false);
  });
});

describe("recipesMaking", () => {
  it("lists main-product recipes first, standard before alternate", () => {
    expect(recipesMaking(sampleData, "Desc_IronScrew_C").map((recipe) => recipe.id)).toEqual(["Recipe_Screw_C", "Recipe_Alternate_Screw_C"]);
    expect(recipesMaking(sampleData, "Desc_HeavyOilResidue_C")[0]?.id).toBe("Recipe_Alternate_HeavyOilResidue_C");
  });
});

describe("rate lists", () => {
  const list = [
    { item: "A", perMinute: 10 },
    { item: "B", perMinute: 20 },
  ];

  it("adds a new item at the end and updates one already there in place", () => {
    expect(addRate(list, "C", 5)).toEqual([...list, { item: "C", perMinute: 5 }]);
    expect(addRate(list, "A", 7)).toEqual([{ item: "A", perMinute: 7 }, list[1]]);
  });

  it("sets and removes by position without touching the input", () => {
    expect(setRate(list, 1, 3)).toEqual([list[0], { item: "B", perMinute: 3 }]);
    expect(removeRate(list, 0)).toEqual([list[1]]);
    expect(list).toHaveLength(2);
  });
});

describe("parseRate", () => {
  it("reads dots and commas and rounds to 4 decimals", () => {
    expect(parseRate("12.5")).toBe(12.5);
    expect(parseRate(" 12,5 ")).toBe(12.5);
    expect(parseRate("1.234567")).toBe(1.2346);
  });

  it("refuses empty, zero, negative and non-numbers", () => {
    for (const text of ["", " ", "0", "-3", "abc", "1,2,3", "Infinity"]) expect(parseRate(text), text).toBeNull();
  });
});

describe("chooseRecipe", () => {
  it("stores a choice and drops it again when the default is picked", () => {
    const plan = emptyPlan("P", "w");
    const chosen = chooseRecipe(plan, sampleData, "Desc_IronScrew_C", "Recipe_Alternate_Screw_C");
    expect(chosen.recipeChoices).toEqual({ Desc_IronScrew_C: "Recipe_Alternate_Screw_C" });
    expect(chooseRecipe(chosen, sampleData, "Desc_IronScrew_C", "Recipe_Screw_C").recipeChoices).toEqual({});
    expect(plan.recipeChoices).toEqual({});
  });
});

describe("alternates in a world", () => {
  const cast = sampleData.recipes.Recipe_Alternate_Screw_C!;
  const standard = sampleData.recipes.Recipe_Screw_C!;

  it("count standard recipes as unlocked, alternates only when ticked or all are shown", () => {
    expect(isUnlocked(world, standard)).toBe(true);
    expect(isUnlocked(world, cast)).toBe(false);
    expect(isUnlocked(setAlternate(world, cast.id, true), cast)).toBe(true);
    expect(isUnlocked({ ...world, showAllAlternates: true }, cast)).toBe(true);
  });

  it("tick and untick without duplicates", () => {
    const once = setAlternate(setAlternate(world, cast.id, true), cast.id, true);
    expect(once.unlockedAlternates).toEqual([cast.id]);
    expect(setAlternate(once, cast.id, false).unlockedAlternates).toEqual([]);
  });
});

describe("uniqueName", () => {
  it("numbers a name that is taken, ignoring case", () => {
    expect(uniqueName("New plan", [])).toBe("New plan");
    expect(uniqueName("New plan", ["new plan", "New plan 2"])).toBe("New plan 3");
  });
});
