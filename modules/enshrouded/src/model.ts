import {
  SkillNodes,
  SKILL_TREE_CONTENT_HASH,
  SKILL_TREE_GAME_BUILD,
  MAX_SKILL_POINTS_ABSOLUTE,
  buildToSelection,
  selectionToBuild,
  sanitizeSelection,
  getPointsUsed,
  applySkillAction,
  type SkillSelection,
  type SkillAction,
} from "../vendor/core";
export {
  SkillNodes,
  SKILL_TREE_CONTENT_HASH,
  SKILL_TREE_GAME_BUILD,
  MAX_SKILL_POINTS_ABSOLUTE,
};
export type Build = { name: string; selection: SkillSelection };
export const MAX_BUILD_BYTES = 256 * 1024;
export function validName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
    throw Error("Choose a build name between 1 and 100 characters.");
  return value.trim();
}
export function readBuild(value: unknown): Build {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Choose an Enshrouded build JSON file.");
  const raw = value as Record<string, unknown>;
  if (raw.format !== undefined && raw.format !== "tavora.enshrouded")
    throw Error("This file belongs to another module.");
  if (raw.version !== undefined && raw.version !== 1)
    throw Error("This build format is not supported.");
  if (
    raw.treeContentHash !== undefined &&
    raw.treeContentHash !== SKILL_TREE_CONTENT_HASH
  )
    throw Error(
      "This build uses a different tree version. Keep the original file and check its skills first.",
    );
  if (
    !Array.isArray(raw.skills) ||
    raw.skills.length > 300 ||
    !raw.skills.every(
      (id) => typeof id === "string" && Object.hasOwn(SkillNodes.nodes, id),
    )
  )
    throw Error("This file contains unknown or invalid skills.");
  if (new Set(raw.skills).size !== raw.skills.length)
    throw Error("This file repeats a skill.");
  if (raw.skillLevels !== undefined) {
    if (
      !raw.skillLevels ||
      typeof raw.skillLevels !== "object" ||
      Array.isArray(raw.skillLevels)
    )
      throw Error("Invalid skill levels.");
    for (const [id, level] of Object.entries(raw.skillLevels)) {
      if (
        !raw.skills.includes(id) ||
        !Number.isInteger(level) ||
        Number(level) < 1 ||
        Number(level) >
          (SkillNodes.types[SkillNodes.nodes[id]?.type]?.maxLevel ?? 1)
      )
        throw Error("Invalid skill levels.");
    }
  }
  const selection = buildToSelection({
    skills: raw.skills,
    skillLevels: raw.skillLevels as Record<string, number> | undefined,
  });
  const clean = sanitizeSelection(selection);
  if (JSON.stringify(clean.selection) !== JSON.stringify(selection))
    throw Error(
      "Some skills have no connection to the tree. The build was not imported.",
    );
  if (getPointsUsed(selection) > MAX_SKILL_POINTS_ABSOLUTE)
    throw Error("This build exceeds the 1.0 skill-point limit.");
  return { name: validName(raw.name ?? "Imported build"), selection };
}
export function portable(build: Build) {
  return {
    format: "tavora.enshrouded",
    version: 1,
    name: validName(build.name),
    ...selectionToBuild(build.selection),
  };
}
export function changeSkill(
  build: Build,
  id: string,
  action: SkillAction,
): Build {
  const result = applySkillAction(build.selection, id, action, {
    maxPoints: MAX_SKILL_POINTS_ABSOLUTE,
  });
  if (result.type === "out-of-range")
    throw Error("Select a connected skill first.");
  if (result.type === "hard-cap")
    throw Error("You have used all available skill points.");
  return "selection" in result
    ? { ...build, selection: result.selection }
    : build;
}
