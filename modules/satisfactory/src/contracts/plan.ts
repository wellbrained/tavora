// Worlds, plans and the solver's input and result. The model stores worlds and
// plans; the solver turns a plan into the tables the Planner shows.

import type { Amount, BuildingId, GameData, ItemId, RecipeId } from "./data";

/** An item flowing at a rate, per minute (pieces, or cubic metres for fluids). */
export interface Rate {
  item: ItemId;
  perMinute: number;
}

/** One playthrough. */
export interface World {
  format: "tavora.satisfactory.world";
  version: 1;
  name: string;
  /** Alternate recipes the player has unlocked. Standard recipes always count as unlocked. */
  unlockedAlternates: RecipeId[];
  /** Theory-crafting: treat every alternate as unlocked. */
  showAllAlternates: boolean;
}

export interface Plan {
  format: "tavora.satisfactory.plan";
  version: 1;
  name: string;
  /** The document id of the world whose recipes the plan may use. */
  worldId: string;
  /** What the plan should produce, each above 0. Empty for a new plan; the UI does not solve it until there is one. */
  targets: Rate[];
  /** What the player already supplies from elsewhere; used before producing the item. */
  fixedInputs: Rate[];
  /** The recipe chosen per item; an item without an entry uses `GameData.defaultRecipe`. */
  recipeChoices: Record<ItemId, RecipeId>;
}

export interface SolveInput {
  data: GameData;
  plan: Plan;
  world: World;
}

export type Solve = (input: SolveInput) => SolveResult;

export type SolveResult =
  | { ok: true; result: PlanResult }
  | { ok: false; error: SolveError };

export type SolveError =
  /**
   * The plan refers to an item or recipe the game data does not have (for example after a game update),
   * or a rate is not a positive finite number, or it has no targets. `message` is English, for logs; the UI
   * shows its own text for `reason`.
   */
  | {
      code: "INVALID_PLAN";
      reason: "UNKNOWN_ITEM" | "UNKNOWN_RECIPE" | "BAD_RATE" | "NO_TARGETS";
      item?: ItemId;
      recipe?: RecipeId;
      message: string;
    }
  /** A chosen recipe is an alternate the world has not unlocked (and showAllAlternates is off). */
  | { code: "LOCKED_RECIPE"; recipe: RecipeId; item: ItemId }
  /** A chosen recipe does not produce the item it was chosen for. */
  | { code: "WRONG_RECIPE"; recipe: RecipeId; item: ItemId }
  /** The chosen recipes cannot reach the targets (for example a loop that consumes more than it makes). */
  | { code: "INFEASIBLE" };

export interface PlanResult {
  /** One row per recipe in use, ordered from the targets down to the raw resources. */
  rows: RecipeRow[];
  /** Ground resources the factory needs. */
  rawResources: Rate[];
  /** Items with no usable recipe in this world that are not resources: they must be brought in. */
  imports: Rate[];
  /** Fixed inputs the plan uses, at most what was supplied. */
  fixedInputsUsed: Rate[];
  /** Side products that leave the factory unused. */
  byproducts: Rate[];
  /** Supplied fixed inputs that are not used, and production beyond the targets. */
  surplus: Rate[];
  /** All rows together, at the rounded-up machine counts and their clock speed. */
  powerMW: number;
  /** Building materials for all rounded-up machines. */
  buildCost: Amount[];
}

export interface RecipeRow {
  recipe: RecipeId;
  /** The item this row was chosen for. */
  item: ItemId;
  building: BuildingId;
  /** Exact machines at 100 % clock. */
  machines: number;
  /** machines rounded up. */
  machinesRounded: number;
  /** Clock speed in percent for every one of the rounded-up machines, so they make exactly what is needed; 4 decimals at most, as in the game. */
  clockPercent: number;
  /** The row's power at machinesRounded and clockPercent. */
  powerMW: number;
  inputs: Rate[];
  outputs: Rate[];
  /** Every recipe usable in this world that makes `item`, for the row's recipe picker. */
  alternatives: RecipeId[];
}
