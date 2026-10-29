import { realpath } from "node:fs/promises";
import path from "node:path";
import { applyOwners, readOwnerRecords } from "./installer";
import { BROWSER_MODULE_ID, browserModule, describeModules, discoverModules, type InstalledModule, type ModuleInfo, type ModuleProblem, type ModuleSources } from "./registry";
import { stopBlocked, type SafetyCheck } from "./safety-lists";

export interface InstalledModulesOptions {
  userData: string;
  /** The user's own modules folder, as configured (not yet a real path). */
  userModules: string;
  sources: Omit<ModuleSources, "tavoraVersion">;
  tavoraVersion: string;
  safety: Pick<SafetyCheck, "blocked">;
}

export interface InstalledModules {
  /** Every module that loads, the Browser included. */
  modules: Map<string, InstalledModule>;
  /** Modules taken out because their zip is blocked; the installer still counts them as installed. */
  blocked: Map<string, InstalledModule>;
  /** Ids of the modules (loaded or blocked) the catalog installed and keeps up to date. */
  catalog: Set<string>;
  info: Map<string, ModuleInfo>;
  problems: ModuleProblem[];
}

/**
 * Looks for every module Tavora has: finds the packages, gives installed ones their recorded
 * owner, stops blocked zips and notes which came from the catalog. Startup and every reload run
 * this same step, so nothing they know about the modules can differ.
 */
export async function loadInstalledModules(options: InstalledModulesOptions): Promise<InstalledModules> {
  const problems: ModuleProblem[] = [];
  const modules = await discoverModules({ ...options.sources, tavoraVersion: options.tavoraVersion }, problems);
  const userRoot = await realpath(options.userModules).catch(() => path.resolve(options.userModules));
  const records = await readOwnerRecords(options.userData);
  applyOwners(modules, userRoot, records);
  const blocked = stopBlocked(modules, userRoot, records, options.safety, problems);
  const catalog = new Set(
    [...blocked.values(), ...modules.values()]
      .filter((module) => {
        const record = records[path.basename(module.root)];
        return module.provenance === "local" && path.dirname(module.root) === userRoot && record?.catalog === true && record.id === module.manifest.id;
      })
      .map((module) => module.manifest.id),
  );
  modules.set(BROWSER_MODULE_ID, browserModule(options.tavoraVersion));
  const info = await describeModules(options.userModules, modules);
  return { modules, blocked, catalog, info, problems };
}
