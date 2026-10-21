import { describe, expect, it } from "vitest";
import { sampleData } from "../data/sample";
import { alternateGroups } from "./alternates";

describe("alternateGroups", () => {
  it("groups alternates by their main product, products A to Z", () => {
    const groups = alternateGroups(sampleData, "en");
    expect(groups.map((group) => group.itemName)).toEqual(["Heavy Oil Residue", "Screws"]);
    expect(groups[1]?.recipes.map((entry) => entry.recipe.id)).toEqual(["Recipe_Alternate_Screw_C"]);
  });

  it("names groups and recipes in Tavora's language", () => {
    const groups = alternateGroups(sampleData, "de");
    expect(groups.map((group) => group.itemName)).toEqual(["Schrauben", "Schweröl-Rückstand"]);
    expect(groups[0]?.recipes[0]?.name).toBe("Alternativ: Gegossene Schraube");
  });

  it("filters by recipe or product name, in either language", () => {
    expect(alternateGroups(sampleData, "de", "cast").map((group) => group.item)).toEqual(["Desc_IronScrew_C"]);
    expect(alternateGroups(sampleData, "en", "residue").map((group) => group.item)).toEqual(["Desc_HeavyOilResidue_C"]);
    expect(alternateGroups(sampleData, "en", "copper")).toEqual([]);
  });
});
