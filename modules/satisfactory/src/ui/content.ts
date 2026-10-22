// What a panel shows, as the id Tavora keeps with it (panel.setContent,
// panels.open). A Planner shows a plan; a Codex shows one entry.

import type { Entry, EntryKind } from "./search";

/** A Planner asked to start a new plan for this item ("Plan this" in the Codex). */
const NEW_PLAN = "new-plan:";
const ENTRY_KINDS: EntryKind[] = ["item", "recipe", "building"];

export type PlannerContent = { kind: "plan"; planId: string } | { kind: "new-plan"; item: string };

export function newPlanContentId(item: string): string {
  return NEW_PLAN + item;
}

/** A Planner content id: `new-plan:<ItemId>` asks for a new plan, anything else is a plan's id. */
export function parsePlannerContent(id: string): PlannerContent | null {
  if (id.startsWith(NEW_PLAN)) {
    const item = id.slice(NEW_PLAN.length);
    return item ? { kind: "new-plan", item } : null;
  }
  return id ? { kind: "plan", planId: id } : null;
}

export function entryContentId(entry: Entry): string {
  return `${entry.kind}:${entry.id}`;
}

/** A Codex content id, `item:<ItemId>`, `recipe:<RecipeId>` or `building:<BuildingId>`. */
export function parseEntryContent(id: string): Entry | null {
  const colon = id.indexOf(":");
  if (colon < 1) return null;
  const kind = id.slice(0, colon) as EntryKind;
  const entryId = id.slice(colon + 1);
  return ENTRY_KINDS.includes(kind) && entryId ? { kind, id: entryId } : null;
}
