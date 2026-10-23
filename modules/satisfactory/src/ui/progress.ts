// What the Progress panel shows and how its ticks change a world. Pure, so the
// rules (open tiers, "needs" hints, Mark all done and its undo) are tested here.

import type { Amount, GameData, Localized, Milestone, Phase, RecipeId, ResearchNode, SchematicId } from "../contracts/data";
import type { Plan, World } from "../contracts/plan";
import { emptyPlan } from "./planEdit";

export const PROGRESS_TABS = ["elevator", "milestones", "research", "alternates"] as const;
export type ProgressTab = (typeof PROGRESS_TABS)[number];

/** Where a tick goes in the world. */
export type ProgressKind = "milestone" | "research";

/** Plan this: the cost as targets, at a rate that finishes it in ten minutes. */
const PLAN_MINUTES = 10;

export function isProgressTab(value: unknown): value is ProgressTab {
  return typeof value === "string" && (PROGRESS_TABS as readonly string[]).includes(value);
}

/** The highest milestone tier open: the start's tiers, plus every phase delivered. */
export function openTier(data: GameData, world: World): number {
  const delivered = new Set(world.phasesDelivered);
  return Math.max(0, ...data.progress.phases.filter((phase) => phase.phase === 0 || delivered.has(phase.phase)).map((phase) => phase.lastTier));
}

/** The toolbar's summary: the open tier and how many milestones are bought. */
export function summary(data: GameData, world: World): { tier: number; done: number; total: number } {
  const done = new Set(world.milestonesDone);
  const milestones = data.progress.milestones;
  return { tier: openTier(data, world), done: milestones.filter((m) => done.has(m.id)).length, total: milestones.length };
}

/** Milestones and research by id, for names in "needs" hints. */
export function schematicNames(data: GameData): Map<SchematicId, Localized> {
  const names = new Map<SchematicId, Localized>();
  for (const milestone of data.progress.milestones) names.set(milestone.id, milestone.name);
  for (const tree of data.progress.research) for (const node of tree.nodes) names.set(node.id, node.name);
  return names;
}

function doneSet(world: World): Set<SchematicId> {
  return new Set([...world.milestonesDone, ...world.researchDone]);
}

/** Why a phase may not be reachable yet: the phase before it is not delivered. Never blocks ticking. */
export function phaseNeeds(data: GameData, world: World, phase: Phase): Phase | null {
  if (phase.phase <= 1) return null;
  const before = data.progress.phases.find((p) => p.phase === phase.phase - 1);
  return before && !world.phasesDelivered.includes(before.phase) ? before : null;
}

/** What a milestone still waits for: the phase that opens its tier, and milestones the game wants first. */
export function milestoneNeeds(data: GameData, world: World, milestone: Milestone): { phase: Phase | null; schematics: SchematicId[] } {
  const done = doneSet(world);
  const phase =
    milestone.tier > openTier(data, world) ? (data.progress.phases.find((p) => p.lastTier >= milestone.tier) ?? null) : null;
  return { phase, schematics: milestone.requires.filter((id) => !done.has(id)) };
}

/** Research nodes still to do before this one. */
export function nodeNeeds(world: World, node: ResearchNode): SchematicId[] {
  const done = doneSet(world);
  return node.requires.filter((id) => !done.has(id));
}

/** What a hard drive alternate still waits for, from the hard drive choices that offer it. */
export function alternateNeeds(data: GameData, world: World, recipe: RecipeId): SchematicId[] {
  const done = doneSet(world);
  const needs = new Set<SchematicId>();
  for (const drive of data.progress.hardDrives) {
    if (drive.recipes.includes(recipe)) for (const id of drive.requires) if (!done.has(id)) needs.add(id);
  }
  return [...needs];
}

/** Milestones grouped by tier, in the HUB's order. */
export function tierGroups(data: GameData): { tier: number; milestones: Milestone[] }[] {
  const groups = new Map<number, Milestone[]>();
  for (const milestone of data.progress.milestones) groups.set(milestone.tier, [...(groups.get(milestone.tier) ?? []), milestone]);
  return [...groups].map(([tier, milestones]) => ({ tier, milestones }));
}

const listOf = (kind: ProgressKind) => (kind === "milestone" ? "milestonesDone" : "researchDone");

export function setDone(world: World, kind: ProgressKind, id: SchematicId, on: boolean): World {
  const key = listOf(kind);
  const others = world[key].filter((entry) => entry !== id);
  return { ...world, [key]: on ? [...others, id] : others };
}

export function setPhase(world: World, phase: number, on: boolean): World {
  const others = world.phasesDelivered.filter((entry) => entry !== phase);
  return { ...world, phasesDelivered: on ? [...others, phase].sort((a, b) => a - b) : others };
}

/** Ticks every id; `added` are the ones that were not ticked before, which Undo takes back. */
export function markAll(world: World, kind: ProgressKind, ids: SchematicId[]): { world: World; added: SchematicId[] } {
  const key = listOf(kind);
  const added = ids.filter((id) => !world[key].includes(id));
  return { world: { ...world, [key]: [...world[key], ...added] }, added };
}

export function unmarkAll(world: World, kind: ProgressKind, ids: SchematicId[]): World {
  const key = listOf(kind);
  const remove = new Set(ids);
  return { ...world, [key]: world[key].filter((id) => !remove.has(id)) };
}

/** A new plan for a cost: each item a target at the rate that delivers it in ten minutes. */
export function costPlan(cost: Amount[], name: string, worldId: string): Plan {
  return { ...emptyPlan(name, worldId), targets: cost.map(({ item, amount }) => ({ item, perMinute: amount / PLAN_MINUTES })) };
}

/** The cost and name of something "Plan this" can start from: a phase (`phase-<n>`), a milestone or research. */
export function progressEntry(data: GameData, id: string): { name: Localized; cost: Amount[] } | null {
  const phase = /^phase-(\d+)$/.exec(id);
  if (phase) {
    const found = data.progress.phases.find((p) => p.phase === Number(phase[1]));
    return found && found.cost.length ? found : null;
  }
  const entry = [...data.progress.milestones, ...data.progress.research.flatMap((tree) => tree.nodes)].find((e) => e.id === id);
  return entry && entry.cost.length ? entry : null;
}
