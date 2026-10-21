// How panels read and change worlds and plans. Both are module documents in the
// current game, so every panel of the module sees the same ones.

import type { JsonValue } from "@tavora/sdk";
import type { Plan, World } from "./plan";

export interface Stored<T> {
  id: string;
  revision: number;
  updatedAt: string;
  value: T;
}

export type RepositoryChange =
  | { kind: "world"; id: string; deleted: boolean }
  | { kind: "plan"; id: string; deleted: boolean };

export interface Repository {
  listWorlds(): Promise<Stored<World>[]>;
  getWorld(id: string): Promise<Stored<World> | null>;
  /** Returns the first world, creating "My world" (localized) when there is none. */
  ensureWorld(): Promise<Stored<World>>;
  /** Creates (no id) or replaces a world. Rejects with the SDK's CONFLICT when ifRevision no longer matches. */
  putWorld(world: World, options?: { id?: string; ifRevision?: number }): Promise<Stored<World>>;
  /** Refuses (rejects) while a plan still uses the world. */
  deleteWorld(id: string): Promise<void>;

  listPlans(): Promise<Stored<Plan>[]>;
  getPlan(id: string): Promise<Stored<Plan> | null>;
  putPlan(plan: Plan, options?: { id?: string; ifRevision?: number }): Promise<Stored<Plan>>;
  deletePlan(id: string, options?: { ifRevision?: number }): Promise<void>;

  /** The plan as an export file's JSON (format, version, plan, game build), for files.exportJson. */
  exportPlan(id: string): Promise<JsonValue>;
  /** Validates an imported file and stores it as a new plan in the given world. Throws a readable Error otherwise. */
  importPlan(file: unknown, worldId: string): Promise<Stored<Plan>>;

  /** Fires when another panel changes a world or plan. */
  onChange(fn: (change: RepositoryChange) => void): () => void;
}
