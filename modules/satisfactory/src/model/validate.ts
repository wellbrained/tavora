// Checks worlds, plans and plan files read from storage or from a file the
// player picked. Each reader returns a clean copy or throws an Error whose
// message can be shown to the player. Stored worlds and plans are checked for
// their shape only: after a game update they may name items or recipes the
// data no longer has, and the solver reports those. Imported files must only
// name ids the game data has.

import type { GameData } from "../contracts/data";
import type { Plan, Rate, World } from "../contracts/plan";

export const WORLD_FORMAT = "tavora.satisfactory.world";
export const PLAN_FORMAT = "tavora.satisfactory.plan";
export const PLAN_FILE_FORMAT = "tavora.satisfactory.plan-file";

export const LIMITS = {
  nameLength: 100,
  /** Targets, and fixed inputs, per plan. */
  rates: 100,
  recipeChoices: 1000,
  unlockedAlternates: 1000,
  /** Milestones and research a world can have ticked off; the game has a few hundred. */
  progressEntries: 2000,
  /** Per minute; far beyond any factory, low enough to keep the numbers sane. */
  maxPerMinute: 1_000_000,
  /** What files.exportJson takes. */
  exportBytes: 1024 * 1024,
};

/** Document ids as the host accepts them. */
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface PlanFile {
  format: typeof PLAN_FILE_FORMAT;
  version: 1;
  gameBuild: number;
  plan: Plan;
}

export function readWorld(value: unknown): World {
  const raw = record(value, "This isn't a world.");
  if (raw.format !== WORLD_FORMAT || raw.version !== 1) throw new Error("This isn't a world.");
  const alternates = list(raw.unlockedAlternates, LIMITS.unlockedAlternates, "This world has too many unlocked alternates.");
  const unlockedAlternates: string[] = [];
  for (const recipe of alternates) {
    if (typeof recipe !== "string" || recipe.length === 0) throw new Error("This world's alternates are damaged.");
    if (unlockedAlternates.includes(recipe)) throw new Error("This world lists an alternate twice.");
    unlockedAlternates.push(recipe);
  }
  if (typeof raw.showAllAlternates !== "boolean") throw new Error("This world is missing a setting.");
  // Worlds saved before the tracker have none of the progress fields.
  const phasesDelivered = ids(raw.phasesDelivered ?? [], (phase) => Number.isInteger(phase) && (phase as number) >= 0 && (phase as number) <= 100) as number[];
  const milestonesDone = ids(raw.milestonesDone ?? [], (id) => typeof id === "string" && id.length > 0) as string[];
  const researchDone = ids(raw.researchDone ?? [], (id) => typeof id === "string" && id.length > 0) as string[];
  const planWithUnlocks = raw.planWithUnlocks ?? false;
  if (typeof planWithUnlocks !== "boolean") throw new Error("This world is missing a setting.");
  return {
    format: WORLD_FORMAT,
    version: 1,
    name: name(raw.name),
    unlockedAlternates,
    showAllAlternates: raw.showAllAlternates,
    phasesDelivered,
    milestonesDone,
    researchDone,
    planWithUnlocks,
  };
}

/** A list of distinct entries that each pass `valid`. */
function ids(value: unknown, valid: (entry: unknown) => boolean): unknown[] {
  const entries = list(value, LIMITS.progressEntries, "This world's progress is damaged.");
  if (entries.some((entry) => !valid(entry)) || new Set(entries).size !== entries.length) throw new Error("This world's progress is damaged.");
  return [...entries];
}

/** With `data`, every item and recipe must also be in it. */
export function readPlan(value: unknown, data?: GameData): Plan {
  const raw = record(value, "This isn't a plan.");
  if (raw.format !== PLAN_FORMAT || raw.version !== 1) throw new Error("This isn't a plan.");
  if (typeof raw.worldId !== "string" || !DOCUMENT_ID.test(raw.worldId)) throw new Error("This plan isn't in a world.");
  const targets = rates(raw.targets, "targets", data);
  const choices = record(raw.recipeChoices ?? {}, "This plan's recipe choices are damaged.");
  const entries = Object.entries(choices);
  if (entries.length > LIMITS.recipeChoices) throw new Error("This plan has too many recipe choices.");
  const recipeChoices: Record<string, string> = {};
  for (const [item, recipe] of entries) {
    knownItem(item, data);
    if (typeof recipe !== "string" || recipe.length === 0) throw new Error("This plan's recipe choices are damaged.");
    if (data && !Object.hasOwn(data.recipes, recipe)) throw new Error(`This plan uses a recipe the planner doesn't know: ${recipe}.`);
    recipeChoices[item] = recipe;
  }
  return {
    format: PLAN_FORMAT,
    version: 1,
    name: name(raw.name),
    worldId: raw.worldId,
    targets,
    fixedInputs: rates(raw.fixedInputs ?? [], "fixed inputs", data),
    recipeChoices,
  };
}

/** An export file's plan, moved into `worldId`. */
export function readPlanFile(value: unknown, data: GameData, worldId: string): Plan {
  const raw = record(value, "This isn't a Satisfactory plan file.");
  if (raw.format !== PLAN_FILE_FORMAT) throw new Error("This isn't a Satisfactory plan file.");
  if (typeof raw.version === "number" && raw.version > 1) throw new Error("This plan file is from a newer version of the planner. Update it and try again.");
  if (raw.version !== 1) throw new Error("This plan file's version isn't supported.");
  if (typeof raw.gameBuild !== "number" || !Number.isFinite(raw.gameBuild)) throw new Error("This plan file is damaged.");
  const plan = record(raw.plan, "This plan file is damaged.");
  return readPlan({ ...plan, worldId }, data);
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function list(value: unknown, limit: number, tooLong: string): unknown[] {
  if (!Array.isArray(value)) throw new Error("Something in this file is damaged.");
  if (value.length > limit) throw new Error(tooLong);
  return value;
}

function name(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < 1 || trimmed.length > LIMITS.nameLength) throw new Error(`Choose a name between 1 and ${LIMITS.nameLength} characters.`);
  return trimmed;
}

function knownItem(item: unknown, data: GameData | undefined): string {
  if (typeof item !== "string" || item.length === 0) throw new Error("Something in this plan is damaged.");
  if (data && !Object.hasOwn(data.items, item)) throw new Error(`This plan uses an item the planner doesn't know: ${item}.`);
  return item;
}

function rates(value: unknown, what: string, data: GameData | undefined): Rate[] {
  const result: Rate[] = [];
  for (const entry of list(value, LIMITS.rates, `A plan can have at most ${LIMITS.rates} ${what}.`)) {
    const rate = record(entry, `This plan's ${what} are damaged.`);
    const item = knownItem(rate.item, data);
    const perMinute = rate.perMinute;
    if (typeof perMinute !== "number" || !Number.isFinite(perMinute) || perMinute <= 0 || perMinute > LIMITS.maxPerMinute) {
      throw new Error(`Rates need to be above 0 and at most ${LIMITS.maxPerMinute.toLocaleString("en")} a minute.`);
    }
    if (result.some((other) => other.item === item)) throw new Error(`This plan lists ${data?.items[item]?.name.en ?? item} twice in its ${what}.`);
    result.push({ item, perMinute });
  }
  return result;
}
