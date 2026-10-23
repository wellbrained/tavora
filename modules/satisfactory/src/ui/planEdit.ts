// Small, pure changes to plans and worlds, as the Planner's controls make them.

import type { GameData, ItemId, Recipe, RecipeId } from "../contracts/data";
import type { Plan, Rate, World } from "../contracts/plan";

/** Rates are kept to 4 decimals, as the game shows them. */
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** How much of an amount a recipe moves per minute at 100 % clock. */
export function perMinute(recipe: Recipe, amount: number): number {
  return round4((amount * 60) / recipe.durationSeconds);
}

/** Recipes that make the item, the main product first. */
export function recipesMaking(data: GameData, item: ItemId): Recipe[] {
  const making = Object.values(data.recipes).filter((recipe) => recipe.products.some((product) => product.item === item));
  const main = (recipe: Recipe) => (recipe.products[0]?.item === item ? 0 : 1);
  return making.sort((a, b) => main(a) - main(b) || Number(a.alternate) - Number(b.alternate) || a.id.localeCompare(b.id));
}

export function recipesUsing(data: GameData, item: ItemId): Recipe[] {
  return Object.values(data.recipes)
    .filter((recipe) => recipe.ingredients.some((ingredient) => ingredient.item === item))
    .sort((a, b) => Number(a.alternate) - Number(b.alternate) || a.id.localeCompare(b.id));
}

/** Items a plan can aim for: made by some recipe and not dug out of the ground. */
export function canPlan(data: GameData, item: ItemId): boolean {
  return !data.resources.includes(item) && Object.values(data.recipes).some((recipe) => recipe.products.some((product) => product.item === item));
}

/**
 * A sensible first rate for a new target: what one machine of the item's default recipe makes per minute
 * (else of the first recipe that makes it), or 60 when nothing does.
 */
export function defaultRate(data: GameData, item: ItemId): number {
  const recipe = data.recipes[data.defaultRecipe[item] ?? ""] ?? recipesMaking(data, item)[0];
  const product = recipe?.products.find((entry) => entry.item === item);
  return recipe && product ? perMinute(recipe, product.amount) : 60;
}

export function emptyPlan(name: string, worldId: string): Plan {
  return { format: "tavora.satisfactory.plan", version: 1, name, worldId, targets: [], fixedInputs: [], recipeChoices: {} };
}

/** A new plan that makes one item at its default rate, named after it. */
export function planForItem(data: GameData, item: ItemId, name: string, worldId: string): Plan {
  return { ...emptyPlan(name, worldId), targets: [{ item, perMinute: defaultRate(data, item) }] };
}

/** Adds an item to a list of rates; an item already in it keeps its place and gets the new rate. */
export function addRate(list: Rate[], item: ItemId, perMinute: number): Rate[] {
  return list.some((rate) => rate.item === item)
    ? list.map((rate) => (rate.item === item ? { item, perMinute } : rate))
    : [...list, { item, perMinute }];
}

export function setRate(list: Rate[], index: number, perMinute: number): Rate[] {
  return list.map((rate, at) => (at === index ? { ...rate, perMinute } : rate));
}

export function removeRate(list: Rate[], index: number): Rate[] {
  return list.filter((_, at) => at !== index);
}

/** Reads a rate the player typed, with a dot or a comma; null unless it is above 0. */
export function parseRate(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() && Number.isFinite(value) && value > 0 ? round4(value) : null;
}

/** Picks the recipe for an item; picking the default recipe drops the choice, so later data changes apply. */
export function chooseRecipe(plan: Plan, data: GameData, item: ItemId, recipe: RecipeId): Plan {
  const recipeChoices = { ...plan.recipeChoices };
  if (data.defaultRecipe[item] === recipe) delete recipeChoices[item];
  else recipeChoices[item] = recipe;
  return { ...plan, recipeChoices };
}

/** Takes an item out of a plan: its targets, supplies and recipe choice (for items that left the game). */
export function removeItem(plan: Plan, item: ItemId): Plan {
  const recipeChoices = { ...plan.recipeChoices };
  delete recipeChoices[item];
  return {
    ...plan,
    targets: plan.targets.filter((rate) => rate.item !== item),
    fixedInputs: plan.fixedInputs.filter((rate) => rate.item !== item),
    recipeChoices,
  };
}

/** Drops every choice of a recipe, so its items go back to their default recipe. */
export function dropRecipe(plan: Plan, recipe: RecipeId): Plan {
  return { ...plan, recipeChoices: Object.fromEntries(Object.entries(plan.recipeChoices).filter(([, chosen]) => chosen !== recipe)) };
}

export function setAlternate(world: World, recipe: RecipeId, unlocked: boolean): World {
  const others = world.unlockedAlternates.filter((id) => id !== recipe);
  return { ...world, unlockedAlternates: unlocked ? [...others, recipe] : others };
}

/** A name not yet taken: "New plan", then "New plan 2", "New plan 3"… */
export function uniqueName(base: string, taken: string[]): string {
  const names = new Set(taken.map((name) => name.trim().toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}
