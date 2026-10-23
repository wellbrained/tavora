// Worlds and the recipes they unlock. The solver and the Planner's pickers ask the
// same question, so the rule lives here once.

import type { GameData, Recipe, RecipeId } from "../contracts/data";
import type { World } from "../contracts/plan";
import { WORLD_FORMAT } from "./validate";

export function newWorld(name: string): World {
  return {
    format: WORLD_FORMAT,
    version: 1,
    name,
    unlockedAlternates: [],
    showAllAlternates: false,
    phasesDelivered: [],
    milestonesDone: [],
    researchDone: [],
    planWithUnlocks: false,
  };
}

/**
 * Whether a world may use a recipe.
 *
 * Without `planWithUnlocks`: standard recipes always; alternates once unlocked, or all of them with
 * `showAllAlternates`.
 *
 * With it, a recipe counts when something ticked off unlocks it (a milestone, MAM research, or a hard drive
 * choice whose alternate is unlocked), when it comes from a source the tracker does not follow (the start,
 * the AWESOME Shop, anything else, or nothing known), or when it is an alternate and `showAllAlternates` is on.
 */
export function recipeUnlocker(data: GameData, world: World): (recipe: Recipe) => boolean {
  const alternates = new Set(world.unlockedAlternates);
  if (!world.planWithUnlocks) return (recipe) => !recipe.alternate || world.showAllAlternates || alternates.has(recipe.id);

  const unlocked = new Set<RecipeId>(alternates);
  const done = new Set([...world.milestonesDone, ...world.researchDone]);
  const { milestones, research, hardDrives } = data.progress;
  for (const entry of [...milestones, ...research.flatMap((tree) => tree.nodes)]) {
    if (done.has(entry.id)) for (const recipe of entry.unlocks.recipes) unlocked.add(recipe);
  }
  // A hard drive choice brings every recipe it lists, such as a standard one next to its alternate.
  for (const drive of hardDrives) {
    if (drive.recipes.some((recipe) => alternates.has(recipe))) for (const recipe of drive.recipes) unlocked.add(recipe);
  }
  const untracked = (recipe: Recipe) =>
    recipe.unlockedBy.length === 0 || recipe.unlockedBy.some((unlock) => ["start", "awesomeShop", "other"].includes(unlock.kind));
  return (recipe) => unlocked.has(recipe.id) || untracked(recipe) || (recipe.alternate && world.showAllAlternates);
}
