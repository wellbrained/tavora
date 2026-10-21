// TEMPORARY: a Repository that keeps worlds and plans in memory, so the UI
// works before the real one (src/model) is wired in through ../services.ts.
// Nothing survives a reload and other panels never see the changes.

import { TavoraError, type JsonValue } from "@tavora/sdk";
import type { Plan, World } from "../../contracts/plan";
import type { Repository, RepositoryChange, Stored } from "../../contracts/repository";

export function createMemoryRepository(options: { worldName: () => string; gameBuild: number }): Repository {
  const worlds = new Map<string, Stored<World>>();
  const plans = new Map<string, Stored<Plan>>();
  const listeners = new Set<(change: RepositoryChange) => void>();
  let next = 1;

  const copy = <T>(value: T): T => structuredClone(value);
  const conflict = (revision: number) => new TavoraError({ code: "CONFLICT", message: "changed elsewhere", revision });

  function put<T>(store: Map<string, Stored<T>>, prefix: string, value: T, options: { id?: string; ifRevision?: number } = {}): Stored<T> {
    const id = options.id ?? `${prefix}-${next++}`;
    const current = store.get(id);
    if (options.ifRevision !== undefined && (current?.revision ?? 0) !== options.ifRevision) throw conflict(current?.revision ?? 0);
    const stored = { id, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), value: copy(value) };
    store.set(id, stored);
    return copy(stored);
  }

  const sorted = <T>(store: Map<string, Stored<T>>) => [...store.values()].map(copy).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const repository: Repository = {
    listWorlds: async () => sorted(worlds),
    getWorld: async (id) => (worlds.has(id) ? copy(worlds.get(id)!) : null),
    ensureWorld: async () => {
      const first = sorted(worlds)[0];
      if (first) return first;
      return put(worlds, "world", { format: "tavora.satisfactory.world", version: 1, name: options.worldName(), unlockedAlternates: [], showAllAlternates: false });
    },
    putWorld: async (world, putOptions) => put(worlds, "world", world, putOptions),
    deleteWorld: async (id) => {
      if ([...plans.values()].some((plan) => plan.value.worldId === id)) throw new Error("A plan still uses this world.");
      worlds.delete(id);
    },
    listPlans: async () => sorted(plans),
    getPlan: async (id) => (plans.has(id) ? copy(plans.get(id)!) : null),
    putPlan: async (plan, putOptions) => put(plans, "plan", plan, putOptions),
    deletePlan: async (id, deleteOptions = {}) => {
      const current = plans.get(id);
      if (deleteOptions.ifRevision !== undefined && current && current.revision !== deleteOptions.ifRevision) throw conflict(current.revision);
      plans.delete(id);
    },
    exportPlan: async (id) => {
      const plan = plans.get(id);
      if (!plan) throw new Error("This plan is gone.");
      return { format: "tavora.satisfactory.plan-export", version: 1, gameBuild: options.gameBuild, plan: copy(plan.value) as unknown as JsonValue };
    },
    importPlan: async (file, worldId) => {
      const plan = (file as { plan?: Plan } | null)?.plan;
      if (!plan || plan.format !== "tavora.satisfactory.plan" || !Array.isArray(plan.targets)) throw new Error("This file is not a plan.");
      return put(plans, "plan", { ...plan, worldId });
    },
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return repository;
}
