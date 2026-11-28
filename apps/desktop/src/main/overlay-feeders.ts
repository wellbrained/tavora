// Which panels feed an overlay: a module's overlay (over a game, on the Overlay page or in OBS) shows what one of its
// panels publishes for its key, so that panel has to run while the overlay is on screen, whichever workspace is shown.
// The panel that published a key last is remembered (in memory only); until one has, every panel of the module in that
// workspace runs, since any of them may be the one that feeds it (a module with several panel types, or two panels of one type).
import type { InstanceRecord } from "./workspace";

/** An overlay's key in a module and workspace (who owns the module doesn't matter here: its panels are the same). */
export interface FedKey {
  moduleId: string;
  workspaceId: string;
  key: string;
}

/** Keys remembered at most; the oldest goes first (a module can't make Tavora keep more). */
export const MAX_FEEDERS = 512;

const idOf = (fed: FedKey) => JSON.stringify([fed.moduleId, fed.workspaceId, fed.key]);

/** The panel that published each overlay key last. */
export class OverlayFeeders {
  private readonly last = new Map<string, string>();

  /** A panel published `fed`; whether that changes which panel feeds it. */
  published(fed: FedKey, instanceId: string): boolean {
    const id = idOf(fed);
    if (this.last.get(id) === instanceId) return false;
    this.last.delete(id);
    this.last.set(id, instanceId);
    if (this.last.size > MAX_FEEDERS) this.last.delete(this.last.keys().next().value!);
    return true;
  }

  /** The panel closed for good: the keys it fed are open again to any panel of their module. */
  forget(instanceId: string): void {
    for (const [id, panel] of this.last) if (panel === instanceId) this.last.delete(id);
  }

  /**
   * The panels of a workspace (`records`) that feed `fed`: the one that published it last while it is still there, else
   * every panel of the module there.
   */
  of(records: readonly InstanceRecord[], fed: FedKey): InstanceRecord[] {
    const module = records.filter((record) => record.moduleId === fed.moduleId);
    const last = this.last.get(idOf(fed));
    const one = last === undefined ? undefined : module.find((record) => record.instanceId === last);
    return one ? [one] : module;
  }
}
