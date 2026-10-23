import { describe, expect, it } from "vitest";
import type { GameData } from "../contracts/data";
import { tracked } from "../solver/testing";
import { readWorld } from "./validate";
import { newWorld, recipeUnlocker } from "./world";

describe("reading worlds", () => {
  it("reads worlds saved before the tracker with no progress and planning off", () => {
    const old = { format: "tavora.satisfactory.world", version: 1, name: "Old", unlockedAlternates: ["Recipe_Alternate_Screw_C"], showAllAlternates: false };
    expect(readWorld(old)).toEqual({ ...newWorld("Old"), unlockedAlternates: ["Recipe_Alternate_Screw_C"] });
  });

  it("keeps progress and refuses damaged progress", () => {
    const world = { ...newWorld("W"), phasesDelivered: [1, 2], milestonesDone: ["Schematic_2-1_C"], researchDone: ["Research_Oil_1_C"], planWithUnlocks: true };
    expect(readWorld(world)).toEqual(world);
    for (const damaged of [
      { phasesDelivered: [1, 1] },
      { phasesDelivered: [1.5] },
      { milestonesDone: [""] },
      { researchDone: "Research_Oil_1_C" },
      { planWithUnlocks: "yes" },
    ]) {
      expect(() => readWorld({ ...world, ...damaged }), JSON.stringify(damaged)).toThrow();
    }
  });
});

describe("which recipes a world may use", () => {
  const data = tracked();
  const recipe = (id: string) => data.recipes[id]!;
  const usable = (patch: Partial<ReturnType<typeof newWorld>>) => {
    const can = recipeUnlocker(data, { ...newWorld("W"), ...patch });
    return (id: string) => can(recipe(id));
  };

  it("without planning by unlocks: every standard recipe, alternates once unlocked or all shown", () => {
    const can = usable({ milestonesDone: [] });
    expect(can("Recipe_IronPlateReinforced_C")).toBe(true);
    expect(can("Recipe_Alternate_Screw_C")).toBe(false);
    expect(usable({ unlockedAlternates: ["Recipe_Alternate_Screw_C"] })("Recipe_Alternate_Screw_C")).toBe(true);
    expect(usable({ showAllAlternates: true })("Recipe_Alternate_Screw_C")).toBe(true);
  });

  it("with planning by unlocks: what ticked milestones and research unlock", () => {
    const fresh = usable({ planWithUnlocks: true });
    expect(fresh("Recipe_IronPlate_C")).toBe(false);
    expect(fresh("Recipe_Plastic_C")).toBe(false);
    const progressed = usable({ planWithUnlocks: true, milestonesDone: ["Schematic_Tutorial1_C"], researchDone: ["Research_Oil_1_C"] });
    expect(progressed("Recipe_IronPlate_C")).toBe(true);
    expect(progressed("Recipe_IronPlateReinforced_C")).toBe(false);
    expect(progressed("Recipe_Plastic_C")).toBe(true);
    expect(progressed("Recipe_Rubber_C")).toBe(true);
  });

  it("with planning by unlocks: start and shop recipes always, alternates when unlocked or all shown", () => {
    const can = usable({ planWithUnlocks: true });
    expect(can("Recipe_IngotIron_C")).toBe(true);
    expect(can("Recipe_PetroleumCoke_C")).toBe(true);
    expect(can("Recipe_Alternate_Screw_C")).toBe(false);
    expect(usable({ planWithUnlocks: true, unlockedAlternates: ["Recipe_Alternate_Screw_C"] })("Recipe_Alternate_Screw_C")).toBe(true);
    expect(usable({ planWithUnlocks: true, showAllAlternates: true })("Recipe_Alternate_Screw_C")).toBe(true);
  });

  it("with planning by unlocks: a hard drive choice brings every recipe it lists", () => {
    const standardToo: GameData = {
      ...data,
      recipes: { ...data.recipes, Recipe_Screw_C: { ...recipe("Recipe_Screw_C"), unlockedBy: [{ kind: "hardDrive" }] } },
      progress: { ...data.progress, hardDrives: [{ id: "Schematic_Alternate_Screw_C", recipes: ["Recipe_Alternate_Screw_C", "Recipe_Screw_C"], requires: [] }] },
    };
    const world = { ...newWorld("W"), planWithUnlocks: true };
    expect(recipeUnlocker(standardToo, world)(standardToo.recipes.Recipe_Screw_C!)).toBe(false);
    expect(recipeUnlocker(standardToo, { ...world, unlockedAlternates: ["Recipe_Alternate_Screw_C"] })(standardToo.recipes.Recipe_Screw_C!)).toBe(true);
  });
});
