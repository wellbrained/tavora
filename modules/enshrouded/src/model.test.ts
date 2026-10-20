import { describe, it, expect } from "vitest";
import {
  SkillNodes,
  MAX_SKILL_POINTS_ABSOLUTE,
  SKILL_TREE_GAME_BUILD,
  SKILL_TREE_CONTENT_HASH,
  readBuild,
  portable,
  changeSkill,
} from "./model";
import { getPointsUsed } from "../vendor/core";
describe("Enshrouded 1.0 module", () => {
  it("pins the release dataset and progression cap", () => {
    expect(SKILL_TREE_GAME_BUILD).toBe("1267041");
    expect(MAX_SKILL_POINTS_ABSOLUTE).toBe(212);
    expect(Object.keys(SkillNodes.nodes)).toHaveLength(231);
    expect(SKILL_TREE_CONTENT_HASH).toMatch(/^[a-f0-9]{64}$/);
  });
  it("round trips named builds, without trusting HTML in names", () => {
    const build = changeSkill(
      { name: "<mage>", selection: {} },
      "2",
      "primary",
    );
    expect(readBuild(portable(build))).toEqual(build);
    expect(getPointsUsed(build.selection)).toBeGreaterThan(0);
  });
  it("rejects invalid levels, duplicate IDs, disconnected skills and foreign trees", () => {
    for (const raw of [
      { skills: ["2", "2"] },
      { skills: ["2"], skillLevels: { "2": NaN } },
      { skills: ["2"], skillLevels: { "2": 999 } },
      { skills: ["9999"] },
      { skills: ["18"] },
      { skills: [], treeContentHash: "old" },
      { skills: [], format: "poe2" },
      { skills: ["__proto__"] },
      { skills: [], name: " " },
    ])
      expect(() => readBuild(raw)).toThrow();
  });
  it("supports upstream JSON with a deliberate unversioned preview", () =>
    expect(readBuild({ skills: ["2"] })).toEqual({
      name: "Imported build",
      selection: { "2": 1 },
    }));
  it("enforces connectivity and removes dependent nodes when refunding", () => {
    let build = { name: "Tank", selection: {} };
    expect(() => changeSkill(build, "18", "primary")).toThrow(/connected/);
    build = changeSkill(build, "2", "primary");
    const neighbor = SkillNodes.edges["2"].find(
      (id) => !SkillNodes.nodes[id].base,
    )!;
    build = changeSkill(build, neighbor, "primary");
    expect(build.selection).toHaveProperty(neighbor);
    build = changeSkill(build, "2", "secondary");
    expect(build.selection).toEqual({});
  });
});
