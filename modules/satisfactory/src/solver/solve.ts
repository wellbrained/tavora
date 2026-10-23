// Turns a plan into the rows and totals the Planner shows. The recipes are fixed
// by the plan (the player's choice, else the default recipe); the solver only
// balances how much each one runs, with byproducts and loops, as a linear program.

import type { Amount, GameData, ItemId, Recipe, RecipeId } from "../contracts/data";
import type { Plan, PlanResult, Rate, RecipeRow, Solve, SolveError, World } from "../contracts/plan";
import { recipeUnlocker } from "../model/world";
import { minimise, type Constraint } from "./simplex";

// The objective, cheapest first:
// - fixed inputs are free up to their supply, so they are used before anything is made or brought in;
// - each machine costs a little, so a supplied item is used rather than made from other supplied items;
// - a side product left over costs a little, so it is used where a recipe consumes it and supply is not wasted;
// - raw resources and imports cost 1 per unit a minute;
// - making a row's own item beyond what is needed costs a lot, so nothing is overproduced just to get its side products.
// Recipes are fixed before the program is built, so the weights only decide amounts, never recipes.
const MACHINE_COST = 1e-4;
const LEFTOVER_COST = 1e-3;
const SOURCE_COST = 1;
const OVERPRODUCTION_COST = 100;

/** Machine counts within this of a whole number count as that number. */
const ROUNDING_SLACK = 1e-6;
/** The game's default power exponent for production buildings. */
const DEFAULT_POWER_EXPONENT = 1.321928;

export const solve: Solve = ({ data, plan, world }) => {
  const invalid = checkPlan(data, plan);
  if (invalid) return fail(invalid);
  const usable = recipeUnlocker(data, world);
  const resources = new Set(data.resources);
  const choices = plan.recipeChoices ?? {};

  // Walk from the targets to the resources, fixing one recipe (or none) per needed item.
  const order: ItemId[] = [];
  const seen = new Set<ItemId>();
  const meet = (item: ItemId) => {
    if (!seen.has(item)) seen.add(item), order.push(item);
  };
  const recipeOf = new Map<ItemId, Recipe | null>();
  /** Recipe id → the items it was chosen for, in the order they were reached. */
  const chosenFor = new Map<RecipeId, ItemId[]>();
  const queue = plan.targets.map((target) => target.item);
  for (let next = 0; next < queue.length; next++) {
    const item = queue[next]!;
    meet(item);
    if (recipeOf.has(item)) continue;
    let recipe: Recipe | null = null;
    if (!resources.has(item)) {
      const choice = Object.hasOwn(choices, item) ? choices[item] : undefined;
      if (choice !== undefined) {
        recipe = data.recipes[choice]!;
        if (!makes(recipe, item)) return fail({ code: "WRONG_RECIPE", recipe: choice, item });
        if (!usable(recipe)) return fail({ code: "LOCKED_RECIPE", recipe: choice, item });
      } else {
        const fallback = data.defaultRecipe[item];
        const found = fallback === undefined ? undefined : data.recipes[fallback];
        recipe = found && makes(found, item) && usable(found) ? found : null;
      }
    }
    recipeOf.set(item, recipe);
    if (!recipe) continue;
    const items = chosenFor.get(recipe.id);
    if (items) {
      items.push(item);
      continue;
    }
    chosenFor.set(recipe.id, [item]);
    for (const ingredient of recipe.ingredients) queue.push(ingredient.item);
    for (const product of recipe.products) meet(product.item);
  }

  const recipes = [...chosenFor.keys()].map((id) => data.recipes[id]!);
  const demand = sumRates(plan.targets);
  const supply = sumRates(plan.fixedInputs ?? []);

  // Variables: machines per recipe, then per item its leftover, its source (resources and items
  // without a recipe) and the fixed input it takes, plus a slack that caps the fixed input.
  const costs: number[] = recipes.map(() => MACHINE_COST);
  const variable = (cost: number) => costs.push(cost) - 1;
  const leftover = new Map<ItemId, number>();
  const source = new Map<ItemId, number>();
  const fixed = new Map<ItemId, number>();
  const constraints: Constraint[] = [];
  for (const item of order) {
    const terms: Constraint["terms"] = [];
    recipes.forEach((recipe, index) => {
      const net = flow(recipe, recipe.products, item) - flow(recipe, recipe.ingredients, item);
      if (net !== 0) terms.push([index, net]);
    });
    const recipe = recipeOf.get(item);
    leftover.set(item, variable(recipe ? OVERPRODUCTION_COST : LEFTOVER_COST));
    terms.push([leftover.get(item)!, -1]);
    if (!recipe) {
      source.set(item, variable(SOURCE_COST));
      terms.push([source.get(item)!, 1]);
    }
    const supplied = supply.get(item);
    if (supplied !== undefined) {
      const used = variable(0);
      fixed.set(item, used);
      terms.push([used, 1]);
      constraints.push({ terms: [[used, 1], [variable(0), 1]], rhs: supplied });
    }
    constraints.push({ terms, rhs: demand.get(item) ?? 0 });
  }

  const x = minimise(costs, constraints);
  if (!x) return fail({ code: "INFEASIBLE" });
  const value = (index: number | undefined) => (index === undefined ? 0 : clean(x[index]!));

  const machines = new Map(recipes.map((recipe, index) => [recipe.id, clean(x[index]!)]));
  const running = recipes.filter((recipe) => machines.get(recipe.id)! > 0);
  const madeHere = new Set(running.flatMap((recipe) => chosenFor.get(recipe.id)!));

  const rawResources: Rate[] = [];
  const imports: Rate[] = [];
  const fixedInputsUsed: Rate[] = [];
  const byproducts: Rate[] = [];
  const surplus: Rate[] = [];
  const add = (list: Rate[], item: ItemId, perMinute: number) => {
    if (perMinute > 0) list.push({ item, perMinute });
  };
  for (const item of order) {
    add(resources.has(item) ? rawResources : imports, item, value(source.get(item)));
    const used = value(fixed.get(item));
    add(fixedInputsUsed, item, used);
    // What is left of an item a row makes is overproduction; of any other item, a side product.
    const left = value(leftover.get(item));
    const unused = clean((supply.get(item) ?? 0) - used);
    if (madeHere.has(item)) add(surplus, item, clean(unused + left));
    else add(byproducts, item, left), add(surplus, item, unused);
  }
  for (const [item, perMinute] of supply) if (!seen.has(item)) add(surplus, item, perMinute);
  // Brought in only because the world has not unlocked the recipe that would make it.
  const notUnlocked = imports
    .map((rate) => rate.item)
    .filter((item) => {
      const fallback = data.defaultRecipe[item];
      const recipe = fallback === undefined ? undefined : data.recipes[fallback];
      return recipe !== undefined && makes(recipe, item) && !usable(recipe);
    });

  const alternatives = producers(data, usable);
  const rows = orderRows(running, recipeOf, plan.targets.map((target) => target.item)).map((recipe) =>
    row(data, recipe, chosenFor.get(recipe.id)![0]!, machines.get(recipe.id)!, alternatives),
  );

  const buildCost = new Map<ItemId, number>();
  for (const entry of rows) {
    for (const cost of data.buildings[entry.building]?.buildCost ?? []) {
      buildCost.set(cost.item, (buildCost.get(cost.item) ?? 0) + cost.amount * entry.machinesRounded);
    }
  }

  const result: PlanResult = {
    rows,
    rawResources,
    imports,
    notUnlocked,
    fixedInputsUsed,
    byproducts,
    surplus,
    powerMW: clean(rows.reduce((sum, entry) => sum + entry.powerMW, 0)),
    buildCost: [...buildCost].map(([item, amount]) => ({ item, amount })),
  };
  return { ok: true, result };
};

function fail(error: SolveError) {
  return { ok: false as const, error };
}

type InvalidPlan = Extract<SolveError, { code: "INVALID_PLAN" }>;

/** Why the plan cannot be solved as it stands, or null. */
function checkPlan(data: GameData, plan: Plan): InvalidPlan | null {
  const invalid = (reason: InvalidPlan["reason"], message: string, ids: { item?: ItemId; recipe?: RecipeId } = {}): InvalidPlan => ({
    code: "INVALID_PLAN",
    reason,
    ...ids,
    message,
  });
  if (!Array.isArray(plan.targets) || plan.targets.length === 0) return invalid("NO_TARGETS", "The plan has no targets.");
  for (const [list, what] of [
    [plan.targets, "target"],
    [plan.fixedInputs ?? [], "fixed input"],
  ] as const) {
    for (const { item, perMinute } of list) {
      if (!Object.hasOwn(data.items, item)) return invalid("UNKNOWN_ITEM", `Unknown item in a ${what}: ${item}.`, { item });
      if (!Number.isFinite(perMinute) || perMinute <= 0) return invalid("BAD_RATE", `The ${what} ${item} needs a rate above 0.`, { item });
    }
  }
  for (const [item, recipe] of Object.entries(plan.recipeChoices ?? {})) {
    if (!Object.hasOwn(data.items, item)) return invalid("UNKNOWN_ITEM", `Unknown item in a recipe choice: ${item}.`, { item, recipe });
    if (!Object.hasOwn(data.recipes, recipe)) return invalid("UNKNOWN_RECIPE", `Unknown recipe for ${item}: ${recipe}.`, { item, recipe });
  }
  return null;
}

function makes(recipe: Recipe, item: ItemId): boolean {
  return recipe.products.some((product) => product.item === item);
}

/** Per machine at 100 %, per minute. */
function flow(recipe: Recipe, amounts: Amount[], item: ItemId): number {
  let total = 0;
  for (const amount of amounts) if (amount.item === item) total += (amount.amount * 60) / recipe.durationSeconds;
  return total;
}

function sumRates(rates: Rate[]): Map<ItemId, number> {
  const sums = new Map<ItemId, number>();
  for (const rate of rates) sums.set(rate.item, (sums.get(rate.item) ?? 0) + rate.perMinute);
  return sums;
}

/** Drops floating-point noise: 12 significant digits, and zero for anything negligible. */
function clean(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toPrecision(12));
}

/**
 * Targets first, every recipe below all recipes that consume its item (loops aside), so the list
 * reads from the targets down to the raw resources. Ties keep the order the walk reached them in.
 */
function orderRows(recipes: Recipe[], recipeOf: Map<ItemId, Recipe | null>, targets: ItemId[]): Recipe[] {
  const included = new Set(recipes.map((recipe) => recipe.id));
  const feeders = (recipe: Recipe) =>
    recipe.ingredients.map((ingredient) => recipeOf.get(ingredient.item)).filter((next): next is Recipe => !!next && included.has(next.id));

  const visited = new Set<RecipeId>();
  const finished: Recipe[] = [];
  const visit = (recipe: Recipe) => {
    if (visited.has(recipe.id)) return;
    visited.add(recipe.id);
    for (const next of feeders(recipe)) visit(next);
    finished.push(recipe);
  };
  for (const item of targets) {
    const recipe = recipeOf.get(item);
    if (recipe && included.has(recipe.id)) visit(recipe);
  }
  for (const recipe of recipes) visit(recipe);
  const topological = finished.reverse();
  const position = new Map(topological.map((recipe, index) => [recipe.id, index]));

  const depth = new Map(topological.map((recipe) => [recipe.id, 0]));
  for (const recipe of topological) {
    for (const next of feeders(recipe)) {
      if (position.get(next.id)! > position.get(recipe.id)!) depth.set(next.id, Math.max(depth.get(next.id)!, depth.get(recipe.id)! + 1));
    }
  }
  const reached = new Map(recipes.map((recipe, index) => [recipe.id, index]));
  return [...recipes].sort((a, b) => depth.get(a.id)! - depth.get(b.id)! || reached.get(a.id)! - reached.get(b.id)!);
}

function row(data: GameData, recipe: Recipe, item: ItemId, machines: number, alternatives: (item: ItemId) => RecipeId[]): RecipeRow {
  const buildingId = recipe.producedIn[0] ?? "";
  const building = data.buildings[buildingId];
  const machinesRounded = Math.max(1, Math.ceil(machines - ROUNDING_SLACK));
  const clockPercent = Math.round((machines / machinesRounded) * 100 * 10_000) / 10_000;
  const basePower = recipe.variablePowerMW ? (recipe.variablePowerMW.min + recipe.variablePowerMW.max) / 2 : (building?.powerMW ?? 0);
  const exponent = building?.powerExponent ?? DEFAULT_POWER_EXPONENT;
  const rates = (amounts: Amount[]) =>
    amounts.map((amount) => ({ item: amount.item, perMinute: clean(((amount.amount * 60) / recipe.durationSeconds) * machines) }));
  return {
    recipe: recipe.id,
    item,
    building: buildingId,
    machines,
    machinesRounded,
    clockPercent,
    powerMW: clean(machinesRounded * basePower * (clockPercent / 100) ** exponent),
    inputs: rates(recipe.ingredients),
    outputs: rates(recipe.products),
    alternatives: alternatives(item),
  };
}

/**
 * The usable recipes that make an item: the default first, then recipes whose main product it is,
 * standard before alternate, then by English name.
 */
function producers(data: GameData, usable: (recipe: Recipe) => boolean): (item: ItemId) => RecipeId[] {
  return (item) =>
    Object.values(data.recipes)
      .filter((recipe) => usable(recipe) && makes(recipe, item))
      .sort(
        (a, b) =>
          Number(b.id === data.defaultRecipe[item]) - Number(a.id === data.defaultRecipe[item]) ||
          Number(a.products[0]?.item !== item) - Number(b.products[0]?.item !== item) ||
          Number(a.alternate) - Number(b.alternate) ||
          a.name.en.localeCompare(b.name.en, "en"),
      )
      .map((recipe) => recipe.id);
}
