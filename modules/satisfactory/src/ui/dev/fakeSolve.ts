// TEMPORARY: a rough stand-in for the solver (src/solver), so the Planner has
// tables to show before the real one is wired in through ../services.ts. It
// walks the recipes from the targets down, one item at a time; it does not
// balance loops or byproducts properly.

import type { Amount, ItemId, Recipe } from "../../contracts/data";
import type { PlanResult, Rate, RecipeRow, Solve, SolveInput, World } from "../../contracts/plan";

const MAX_STEPS = 500;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

const usable = (world: World, recipe: Recipe) =>
  !recipe.alternate || world.showAllAlternates || world.unlockedAlternates.includes(recipe.id);

function rates(map: Map<ItemId, number>): Rate[] {
  return [...map].filter(([, perMinute]) => perMinute > 1e-9).map(([item, perMinute]) => ({ item, perMinute: round4(perMinute) }));
}

export const fakeSolve: Solve = ({ data, plan, world }: SolveInput) => {
  if (!plan.targets.length) return { ok: false, error: { code: "INVALID_PLAN", message: "no targets" } };
  for (const rate of [...plan.targets, ...plan.fixedInputs]) {
    if (!data.items[rate.item] || !(rate.perMinute > 0) || !Number.isFinite(rate.perMinute)) {
      return { ok: false, error: { code: "INVALID_PLAN", message: `bad rate for ${rate.item}` } };
    }
  }
  for (const [item, id] of Object.entries(plan.recipeChoices)) {
    const recipe = data.recipes[id];
    if (!recipe) return { ok: false, error: { code: "INVALID_PLAN", message: `unknown recipe ${id}` } };
    if (!recipe.products.some((product) => product.item === item)) return { ok: false, error: { code: "WRONG_RECIPE", recipe: id, item } };
    if (!usable(world, recipe)) return { ok: false, error: { code: "LOCKED_RECIPE", recipe: id, item } };
  }

  const fixedLeft = new Map(plan.fixedInputs.map((rate) => [rate.item, rate.perMinute]));
  const fixedUsed = new Map<ItemId, number>();
  const spare = new Map<ItemId, number>();
  const raw = new Map<ItemId, number>();
  const imports = new Map<ItemId, number>();
  const rows = new Map<ItemId, { recipe: Recipe; machines: number }>();
  const queue: Amount[] = plan.targets.map((rate) => ({ item: rate.item, amount: rate.perMinute }));
  const add = (map: Map<ItemId, number>, item: ItemId, amount: number) => map.set(item, (map.get(item) ?? 0) + amount);

  for (let step = 0; queue.length; step++) {
    if (step > MAX_STEPS) return { ok: false, error: { code: "INFEASIBLE" } };
    const { item, amount } = queue.shift()!;
    let need = amount;
    const take = (pool: Map<ItemId, number>, used?: Map<ItemId, number>) => {
      const got = Math.min(pool.get(item) ?? 0, need);
      if (got <= 0) return;
      pool.set(item, (pool.get(item) ?? 0) - got);
      if (used) add(used, item, got);
      need -= got;
    };
    take(spare);
    take(fixedLeft, fixedUsed);
    if (need <= 1e-9) continue;
    if (data.resources.includes(item)) {
      add(raw, item, need);
      continue;
    }
    const recipe = data.recipes[plan.recipeChoices[item] ?? data.defaultRecipe[item] ?? ""];
    if (!recipe || !usable(world, recipe)) {
      add(imports, item, need);
      continue;
    }
    const cycles = 60 / recipe.durationSeconds;
    const made = recipe.products.find((product) => product.item === item)!.amount * cycles;
    const machines = need / made;
    const row = rows.get(item) ?? { recipe, machines: 0 };
    row.machines += machines;
    rows.set(item, row);
    for (const product of recipe.products) if (product.item !== item) add(spare, product.item, product.amount * cycles * machines);
    for (const ingredient of recipe.ingredients) queue.push({ item: ingredient.item, amount: ingredient.amount * cycles * machines });
  }

  const recipeRows: RecipeRow[] = [...rows].map(([item, { recipe, machines }]) => {
    const building = data.buildings[recipe.producedIn[0] ?? ""];
    const machinesRounded = Math.max(1, Math.ceil(machines - 1e-9));
    const clockPercent = round4((machines / machinesRounded) * 100);
    const basePower = recipe.variablePowerMW ? (recipe.variablePowerMW.min + recipe.variablePowerMW.max) / 2 : (building?.powerMW ?? 0);
    const powerMW = machinesRounded * basePower * Math.pow(clockPercent / 100, building?.powerExponent ?? 1);
    const cycles = (60 / recipe.durationSeconds) * machines;
    return {
      recipe: recipe.id,
      item,
      building: building?.id ?? "",
      machines: round4(machines),
      machinesRounded,
      clockPercent,
      powerMW: round4(powerMW),
      inputs: recipe.ingredients.map((entry) => ({ item: entry.item, perMinute: round4(entry.amount * cycles) })),
      outputs: recipe.products.map((entry) => ({ item: entry.item, perMinute: round4(entry.amount * cycles) })),
      alternatives: Object.values(data.recipes)
        .filter((candidate) => usable(world, candidate) && candidate.products.some((product) => product.item === item))
        .map((candidate) => candidate.id),
    };
  });

  const buildCost = new Map<ItemId, number>();
  for (const row of recipeRows) for (const cost of data.buildings[row.building]?.buildCost ?? []) add(buildCost, cost.item, cost.amount * row.machinesRounded);

  const result: PlanResult = {
    rows: recipeRows,
    rawResources: rates(raw),
    imports: rates(imports),
    fixedInputsUsed: rates(fixedUsed),
    byproducts: rates(spare),
    surplus: rates(fixedLeft),
    powerMW: round4(recipeRows.reduce((sum, row) => sum + row.powerMW, 0)),
    buildCost: [...buildCost].map(([item, amount]) => ({ item, amount })),
  };
  return { ok: true, result };
};
