import { describe, expect, it } from "vitest";
import { sampleData } from "../data/sample";
import { newWorld } from "../model/world";
import { parsePlannerContent, progressPlanContentId } from "./content";
import {
  alternateNeeds,
  costPlan,
  isProgressTab,
  markAll,
  milestoneNeeds,
  nodeNeeds,
  openTier,
  phaseNeeds,
  progressEntry,
  setDone,
  setPhase,
  summary,
  tierGroups,
  unmarkAll,
} from "./progress";

const data = sampleData;
const world = newWorld("W");
const [tutorial, partAssembly] = data.progress.milestones;
const plastics = data.progress.research[0]!.nodes[0]!;

describe("open tiers and the summary", () => {
  it("opens the start's tiers, then what delivered phases open", () => {
    expect(openTier(data, world)).toBe(2);
    expect(openTier(data, setPhase(world, 1, true))).toBe(4);
    expect(summary(data, setDone(world, "milestone", tutorial!.id, true))).toEqual({ tier: 2, done: 1, total: 2 });
  });
});

describe("needs hints", () => {
  it("name the phase that opens a milestone's tier, never blocking", () => {
    const high = { ...partAssembly!, tier: 3 };
    expect(milestoneNeeds(data, world, high).phase?.phase).toBe(1);
    expect(milestoneNeeds(data, setPhase(world, 1, true), high).phase).toBeNull();
    expect(milestoneNeeds(data, world, partAssembly!)).toEqual({ phase: null, schematics: [] });
  });

  it("list milestones and research still to do", () => {
    const needy = { ...partAssembly!, requires: [tutorial!.id] };
    expect(milestoneNeeds(data, world, needy).schematics).toEqual([tutorial!.id]);
    expect(milestoneNeeds(data, setDone(world, "milestone", tutorial!.id, true), needy).schematics).toEqual([]);
    expect(nodeNeeds(world, { ...plastics, requires: ["Research_Oil_0_C"] })).toEqual(["Research_Oil_0_C"]);
    expect(alternateNeeds(data, world, "Recipe_Alternate_Screw_C")).toEqual(["Schematic_2-1_C"]);
    expect(alternateNeeds(data, setDone(world, "milestone", "Schematic_2-1_C", true), "Recipe_Alternate_Screw_C")).toEqual([]);
  });

  it("say a phase waits for the one before it", () => {
    const phases = [...data.progress.phases, { phase: 2, name: { en: "Dock" }, cost: [], lastTier: 6 }];
    const withDock = { ...data, progress: { ...data.progress, phases } };
    expect(phaseNeeds(withDock, world, phases[2]!)?.phase).toBe(1);
    expect(phaseNeeds(withDock, setPhase(world, 1, true), phases[2]!)).toBeNull();
    expect(phaseNeeds(withDock, world, phases[1]!)).toBeNull();
  });
});

describe("ticking", () => {
  it("ticks and unticks without duplicates", () => {
    const once = setDone(setDone(world, "research", plastics.id, true), "research", plastics.id, true);
    expect(once.researchDone).toEqual([plastics.id]);
    expect(setDone(once, "research", plastics.id, false).researchDone).toEqual([]);
    expect(setPhase(setPhase(world, 3, true), 1, true).phasesDelivered).toEqual([1, 3]);
  });

  it("marks all done and undoes only what it added", () => {
    const before = setDone(world, "milestone", tutorial!.id, true);
    const { world: after, added } = markAll(before, "milestone", [tutorial!.id, partAssembly!.id]);
    expect(after.milestonesDone).toEqual([tutorial!.id, partAssembly!.id]);
    expect(added).toEqual([partAssembly!.id]);
    expect(unmarkAll(after, "milestone", added).milestonesDone).toEqual([tutorial!.id]);
  });
});

describe("plan this", () => {
  it("plans a cost to be delivered in ten minutes", () => {
    const entry = progressEntry(data, partAssembly!.id)!;
    expect(costPlan(entry.cost, "Part Assembly", "w1")).toMatchObject({
      name: "Part Assembly",
      worldId: "w1",
      targets: [
        { item: "Desc_IronPlate_C", perMinute: 10 },
        { item: "Desc_IronRod_C", perMinute: 10 },
      ],
    });
    expect(progressEntry(data, "phase-1")?.cost).toEqual([{ item: "Desc_IronPlateReinforced_C", amount: 50 }]);
    expect(progressEntry(data, "phase-0")).toBeNull();
    expect(progressEntry(data, plastics.id)?.name.en).toBe("Plastics");
    expect(progressEntry(data, "nope")).toBeNull();
  });

  it("reaches the Planner as a content id", () => {
    expect(parsePlannerContent(progressPlanContentId("phase-2"))).toEqual({ kind: "progress-plan", entry: "phase-2" });
    expect(parsePlannerContent("progress-plan:")).toBeNull();
  });
});

describe("layout", () => {
  it("groups milestones by tier and knows its tabs", () => {
    expect(tierGroups(data).map((group) => [group.tier, group.milestones.length])).toEqual([[0, 1], [2, 1]]);
    expect(isProgressTab("research")).toBe(true);
    expect(isProgressTab("bosses")).toBe(false);
  });
});
