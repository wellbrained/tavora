import { describe, expect, it } from "vitest";
import { sampleData } from "../data/sample";
import { matchScore, normalize, search } from "./search";

describe("normalize", () => {
  it("folds case, accents, umlauts and ß", () => {
    expect(normalize("  Verstärkte   EISENPLATTE ")).toBe("verstarkte eisenplatte");
    expect(normalize("Straße")).toBe("strasse");
  });
});

describe("matchScore", () => {
  it("ranks whole name, then start, then word start, then anywhere", () => {
    expect(matchScore("Iron Plate", "iron plate")).toBe(0);
    expect(matchScore("Iron Plate", "iron")).toBe(1);
    expect(matchScore("Reinforced Iron Plate", "plate")).toBe(2);
    expect(matchScore("Alternate: Cast Screw", "cast")).toBe(2);
    expect(matchScore("Iron Plate", "late")).toBe(3);
    expect(matchScore("Iron Plate", "copper")).toBeNull();
    expect(matchScore("Iron Plate", "  ")).toBeNull();
  });

  it("needs every word of the query, in any order", () => {
    expect(matchScore("Reinforced Iron Plate", "plate reinf")).toBe(2);
    expect(matchScore("Reinforced Iron Plate", "plate copper")).toBeNull();
  });
});

describe("search", () => {
  it("puts the closest match first and items before recipes of the same name", () => {
    const hits = search(sampleData, "iron plate", "en");
    expect(hits[0]).toEqual({ kind: "item", id: "Desc_IronPlate_C", name: "Iron Plate" });
    expect(hits[1]).toMatchObject({ kind: "recipe", id: "Recipe_IronPlate_C" });
    expect(hits.map((hit) => hit.id)).toContain("Desc_IronPlateReinforced_C");
  });

  it("finds German and English names for a German player, and shows the German one", () => {
    expect(search(sampleData, "schraube", "de", { kinds: ["item"] })).toEqual([{ kind: "item", id: "Desc_IronScrew_C", name: "Schrauben" }]);
    expect(search(sampleData, "screw", "de", { kinds: ["item"] })[0]?.name).toBe("Schrauben");
  });

  it("filters by kind and by a test, and keeps to the limit", () => {
    expect(search(sampleData, "s", "en", { kinds: ["building"] }).every((hit) => hit.kind === "building")).toBe(true);
    expect(search(sampleData, "iron", "en", { filter: (entry) => entry.id !== "Desc_IronPlate_C" }).some((hit) => hit.id === "Desc_IronPlate_C")).toBe(false);
    expect(search(sampleData, "e", "en", { limit: 3 })).toHaveLength(3);
  });

  it("finds nothing for an empty query", () => {
    expect(search(sampleData, " ", "en")).toEqual([]);
  });
});
