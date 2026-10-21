import { describe, expect, it } from "vitest";
import { entryContentId, newPlanContentId, parseEntryContent, parsePlannerContent } from "./content";

describe("Planner content", () => {
  it("reads a new-plan request and a plan id", () => {
    expect(parsePlannerContent(newPlanContentId("Desc_IronPlate_C"))).toEqual({ kind: "new-plan", item: "Desc_IronPlate_C" });
    expect(parsePlannerContent("plan-7")).toEqual({ kind: "plan", planId: "plan-7" });
  });

  it("refuses empty ids", () => {
    expect(parsePlannerContent("")).toBeNull();
    expect(parsePlannerContent("new-plan:")).toBeNull();
  });
});

describe("Codex content", () => {
  it("round-trips every kind of entry", () => {
    for (const entry of [
      { kind: "item", id: "Desc_IronPlate_C" },
      { kind: "recipe", id: "Recipe_Alternate_Screw_C" },
      { kind: "building", id: "Build_ConstructorMk1_C" },
    ] as const) {
      expect(parseEntryContent(entryContentId(entry))).toEqual(entry);
    }
  });

  it("refuses unknown kinds and missing ids", () => {
    expect(parseEntryContent("plan:1")).toBeNull();
    expect(parseEntryContent("item:")).toBeNull();
    expect(parseEntryContent("Desc_IronPlate_C")).toBeNull();
  });
});
