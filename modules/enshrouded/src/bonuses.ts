import {
  SkillNodes, getStatsFromSkills, getSkillName, getSkillDescription,
  type SkillSelection,
} from "../vendor/core";

/** Attribute sums are structured data. Other effects retain their conditions
 * and purchased-rank descriptions: prose percentages have no stacking schema. */
export function summarizeBonuses(selection: SkillSelection) {
  const attributes = getStatsFromSkills(selection);
  const effects = Object.entries(selection)
    .filter(([id, level]) => level > 0 && SkillNodes.nodes[id])
    .map(([id, level]) => {
      const type = SkillNodes.nodes[id].type;
      return {
        id, level, maxLevel: SkillNodes.types[type].maxLevel ?? 1,
        name: getSkillName(type, "en"),
        paragraphs: getSkillDescription(type, "en", level),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en") || Number(a.id)-Number(b.id));
  // These per-attribute contributions come from the pinned 1.0 descriptions.
  // They are not complete character totals or a simulation of conditional skills.
  const fromAttributes = {
    health: (attributes.CONS ?? 0) * 50,
    stamina: (attributes.ENDURANCE ?? 0) * 10,
    mana: (attributes.SPIRIT ?? 0) * 20,
    melee: (attributes.STR ?? 0) * 5,
    bowDagger: (attributes.DEX ?? 0) * 5,
    magic: (attributes.INT ?? 0) * 5,
  };
  return { attributes, fromAttributes, effects };
}
