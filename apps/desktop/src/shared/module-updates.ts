// Module updates that wait for the player (HostViewState.modules[].update). An update that asks for
// nothing new needs no question; one that asks for network hosts or connectors goes through the
// consent dialog first. Update all uses this order: the first group right away, then one dialog each.
import type { ModulePermissions } from "./host-api";

export interface WaitingUpdate {
  id: string;
  name: string;
  update: { version: string; asks: ModulePermissions } | null;
}

/** The modules with an update waiting, by name. */
export function waitingUpdates<T extends WaitingUpdate>(modules: readonly T[]): T[] {
  return modules.filter((module) => module.update !== null).sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether installing the update needs the player's yes to new access first. */
export function asksMore(update: { asks: ModulePermissions }): boolean {
  return update.asks.network.length > 0 || update.asks.connectors.length > 0;
}

/** Update all: the ids that install at once, then the ids that each get a consent dialog, in the order the list shows. */
export function updateAllPlan(modules: readonly WaitingUpdate[]): { now: string[]; ask: string[] } {
  const waiting = waitingUpdates(modules);
  return {
    now: waiting.filter((module) => !asksMore(module.update!)).map((module) => module.id),
    ask: waiting.filter((module) => asksMore(module.update!)).map((module) => module.id),
  };
}
