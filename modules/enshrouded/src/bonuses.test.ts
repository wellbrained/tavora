import {describe, it, expect} from "vitest";
import {SkillNodes, getSkillDescription} from "../vendor/core";
import {summarizeBonuses} from "./bonuses";
const node = (type: string) => Object.values(SkillNodes.nodes).find(node => node.type === type)!.id;
describe("chosen skill bonuses", () => {
  it("sums separate attribute purchases and multi-rank Ranger contributions", () => {
    const constitution = Object.values(SkillNodes.nodes).filter(node => node.type === "ATTR_CONS").slice(0, 2);
    const summary = summarizeBonuses({[constitution[0].id]:1, [constitution[1].id]:1, [node("RANGER")]:3});
    expect(summary.attributes).toMatchObject({CONS:2, DEX:3, ENDURANCE:3});
    expect(summary.fromAttributes).toMatchObject({health:100, stamina:30, bowDagger:15});
    expect(summary.effects).toHaveLength(3);
  });
  it("preserves purchased rank, conditions and replacing formulas for every selected skill", () => {
    const selection = {[node("NECROMANCER")]:3, [node("WATER_AURA")]:1, [node("WATERS_OF_LIFE")]:1};
    const summary = summarizeBonuses(selection);
    expect(summary.effects.map(effect => effect.id).sort()).toEqual(Object.keys(selection).sort());
    for (const effect of summary.effects) {
      expect(effect.paragraphs).toEqual(getSkillDescription(SkillNodes.nodes[effect.id].type, "en", selection[effect.id]));
    }
    const necromancer = summary.effects.find(effect => effect.id === node("NECROMANCER"))!;
    expect(necromancer.paragraphs.join(" ")).toContain("15%");
    expect(necromancer.paragraphs.join(" ")).toMatch(/kill/i);
    expect(summary.attributes).toEqual({});
  });
  it("has no effects or invented bonuses for an empty build", () => {
    const summary = summarizeBonuses({});
    expect(summary.effects).toEqual([]);
    expect(Object.values(summary.fromAttributes)).toEqual([0,0,0,0,0,0]);
  });
});
