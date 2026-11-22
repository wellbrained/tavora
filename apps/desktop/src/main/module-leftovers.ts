import { LOCAL_OWNER, OFFICIAL_OWNER } from "@tavora/module-schema";
import type { HostViewState } from "../shared/host-api";
import type { Installed } from "./installed-modules";
import { LibraryError } from "./library";
import { deleteModuleDataOf, listModuleData, queueLocalDataMove } from "./module-data";
import { publisherOf } from "./publisher-names";
import type { InstalledModule } from "./registry";

export interface ModuleLeftoversOptions {
  userData: string;
  /** Where modules keep their files now (module-files-folder.ts). */
  filesRoot: () => string;
  installed: Pick<Installed, "get">;
  /** What else keeps something per module (settings and documents, OBS pages, game overlays) forgets it. */
  forget: (owner: string, moduleId: string) => void;
  /** Clears a browser session's storage and cache, by partition (Electron's session). */
  clearSession: (partition: string) => Promise<void>;
  /** Restarts Tavora, which moves data it was asked to before any module opens. */
  restart: () => void;
}

/**
 * The data modules keep on this PC, by who published them and their id: what a module that isn't installed (or is
 * installed from another publisher) left behind, which Settings > Modules lists and deletes, and the data of an unsigned
 * local copy its signed version can take over. An installed module's data is never deleted here.
 */
export class ModuleLeftovers {
  private entries: { owner: string; moduleId: string }[] = [];

  constructor(private readonly options: ModuleLeftoversOptions) {}

  /** Looks again at what is stored (at the start, and each time modules are looked for). */
  async refresh(): Promise<void> {
    this.entries = await listModuleData(this.options.userData, this.options.filesRoot());
  }

  /** Settings > Modules' leftover data: everything not of a module installed now under the same owner. */
  view(): HostViewState["leftoverModuleData"] {
    return this.entries
      .filter((entry) => this.options.installed.get(entry.moduleId)?.owner !== entry.owner)
      .map((entry) => ({ ...entry, publisher: entry.owner === LOCAL_OWNER || entry.owner === OFFICIAL_OWNER ? null : entry.owner }));
  }

  /** A signed module whose id has data from an unsigned local copy. */
  localWaiting(module: InstalledModule): boolean {
    return publisherOf(module) !== null && this.entries.some((entry) => entry.owner === LOCAL_OWNER && entry.moduleId === module.manifest.id);
  }

  /**
   * Deletes what a module that is not installed left behind: its settings and documents in every workspace now, its
   * browser storage cleared now and its folders removed at the next start.
   */
  async delete(owner: string, moduleId: string): Promise<void> {
    const { installed, userData } = this.options;
    if (installed.get(moduleId)?.owner === owner) throw new LibraryError("error.dataInUse");
    this.options.forget(owner, moduleId);
    for (const partition of await deleteModuleDataOf(userData, owner, moduleId, this.options.filesRoot())) await this.options.clearSession(partition);
    await this.refresh();
  }

  /** Hands a module's local data (from an unsigned copy used before) to its signed version: Tavora restarts and moves it before any module opens. */
  async moveLocal(moduleId: string): Promise<void> {
    const module = this.options.installed.get(moduleId);
    if (!module || !this.localWaiting(module)) throw new LibraryError("error.noLocalData");
    await queueLocalDataMove(this.options.userData, moduleId, module.owner);
    this.options.restart();
  }
}
