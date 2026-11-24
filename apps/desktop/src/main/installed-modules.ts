import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { SIGNATURE_FILE, signedHash } from "@tavora/pack";
import { FolderChecks } from "./module-folder-check";
import type { OfficialUpdates } from "./official-updates";
import { applyOwners, readOwnerRecords, strandedModules, type OwnerRecords } from "./installer";
import { BROWSER_MODULE_ID, browserModule, describeModules, discoverModules, type InstalledModule, type ModuleInfo, type ModuleProblem, type ModuleSources } from "./registry";
import { stopBlocked, type SafetyCheck } from "./safety-lists";

/** The signature checks of installed folders, by their stamp (module-folder-check.ts): a cache. */
export const MODULE_CHECKS_FILE = "module-checks.json";

export interface InstalledModulesOptions {
  userData: string;
  /** The user's own modules folder, as configured (not yet a real path). */
  userModules: string;
  sources: Omit<ModuleSources, "tavoraVersion">;
  tavoraVersion: string;
  safety: Pick<SafetyCheck, "blocked">;
  /** Tavora's own modules downloaded from the catalogue (official-updates.ts); absent or off: only the shipped copies load. */
  official?: OfficialUpdates;
}

export interface InstalledModules {
  /** Every module that loads, the Browser included. */
  modules: Map<string, InstalledModule>;
  /** Modules taken out because their zip is blocked or their folder changed; the installer still counts them as installed. */
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
  // A module whose update couldn't be put right yet isn't gone: its panels wait.
  const problems: ModuleProblem[] = [...strandedModules(options.userData)];
  const { official } = options;
  if (official?.on) await official.load();
  const downloads = official?.on ? { officialUpdates: { dir: official.dir, trusted: (id: string, dir: string) => official.trusted(id, dir) } } : {};
  const modules = await discoverModules({ ...options.sources, ...downloads, tavoraVersion: options.tavoraVersion }, problems);
  if (official?.on) {
    // Copies the shipped one makes useless (or that are blocked, revoked or no longer shipped) go; their high-water mark stays.
    const shipped = new Map([...modules].flatMap(([id, module]) => (module.shippedVersion === undefined ? [] : [[id, module.shippedVersion] as const])));
    const unsure = new Set(problems.flatMap((problem) => (problem.official && problem.about?.id ? [problem.about.id] : [])));
    await official.cleanup(shipped, unsure);
  }
  const userRoot = await realpath(options.userModules).catch(() => path.resolve(options.userModules));
  const records = await readOwnerRecords(options.userData);
  // Each folder's files are checked against the owner's signature; unchanged folders by their stamp alone.
  const checks = new FolderChecks(path.join(options.userData, MODULE_CHECKS_FILE));
  const started = Date.now();
  const unsure: string[] = [];
  const changed = await applyOwners(modules, userRoot, records, checks, unsure);
  if (checks.hashed > 0 || changed.length > 0) console.log(`[tavora] checked installed module folders: ${checks.hashed} of ${checks.looked} read and hashed, ${changed.length} changed, ${Date.now() - started} ms`);
  await checks.save();
  const stopped = new Map([...stopChanged(modules, changed, records, problems), ...stopUnsure(modules, unsure, records, problems)]);
  await addSignedHashes(modules, userRoot, records);
  const blocked = new Map([...stopped, ...stopBlocked(modules, userRoot, records, options.safety, problems)]);
  const catalog = new Set(
    [...blocked.values(), ...modules.values()]
      .filter((module) => {
        const record = records[path.basename(module.root)];
        // Only a folder that got its recorded owner: one changed by hand is not the catalog's to update.
        return module.provenance === "local" && path.dirname(module.root) === userRoot && record?.catalog === true && record.id === module.manifest.id && module.owner === record.owner;
      })
      .map((module) => module.manifest.id),
  );
  modules.set(BROWSER_MODULE_ID, browserModule(options.tavoraVersion));
  const info = await describeModules(options.userModules, modules);
  return { modules, blocked, catalog, info, problems };
}

/**
 * Stops installed folders whose files are not what their publisher signed. They don't load at all, rather than as an
 * unsigned folder: as one they would start over without their data and write new data apart from it, which a repair
 * would leave behind. They keep the recorded owner, so the installer and the catalog take a zip from that publisher as
 * their repair (at any version, installer.ts), and Settings > Modules says what happened. Their panels wait.
 */
function stopChanged(modules: Map<string, InstalledModule>, ids: readonly string[], records: OwnerRecords, problems: ModuleProblem[]): Map<string, InstalledModule> {
  const stopped = new Map<string, InstalledModule>();
  for (const id of ids) {
    const module = modules.get(id);
    const record = module && records[path.basename(module.root)];
    if (!module || !record) continue;
    modules.delete(id);
    stopped.set(id, { ...module, owner: record.owner, changed: true });
    console.warn(`[tavora] ${path.basename(module.root)}: its files are not what its publisher signed, so it is stopped`);
    problems.push({
      folder: path.basename(module.root),
      path: module.root,
      kind: "changed",
      values: { name: module.manifest.name },
      about: { name: module.manifest.name, version: module.manifest.version, id },
      message: `${module.manifest.name} changed since it was installed: its files are not what its publisher signed. Reinstall it to use it again; its data stays.`,
    });
  }
  return stopped;
}

/**
 * Stops installed folders that could not be read to check them (a file another program held for longer than the
 * waits). Not tampering: nothing is said about changed files, they just don't run this time, their panels wait, and the
 * next start looks again.
 */
function stopUnsure(modules: Map<string, InstalledModule>, ids: readonly string[], records: OwnerRecords, problems: ModuleProblem[]): Map<string, InstalledModule> {
  const stopped = new Map<string, InstalledModule>();
  for (const id of ids) {
    const module = modules.get(id);
    const record = module && records[path.basename(module.root)];
    if (!module || !record) continue;
    modules.delete(id);
    stopped.set(id, { ...module, owner: record.owner });
    problems.push({
      folder: path.basename(module.root),
      path: module.root,
      kind: "unreadable",
      about: { name: module.manifest.name, version: module.manifest.version, id },
      message: `${module.manifest.name}'s files can't be read right now, so it waits until the next start.`,
    });
  }
  return stopped;
}

/** A signature file bigger than this is not read for its hash: a zip holds at most a few thousand files. */
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

/**
 * Fills in `signedSha256` for records from before the installer kept it, in memory only, from the signature file the
 * installer left in the module's folder, so a block by what the signature covers stops those copies too. A file that
 * is missing or can't be read adds nothing, and the block by the zip's own hash holds whatever the file says.
 */
export async function addSignedHashes(modules: ReadonlyMap<string, InstalledModule>, userRoot: string, records: OwnerRecords): Promise<void> {
  for (const [id, module] of modules) {
    if (module.provenance !== "local" || path.dirname(module.root) !== userRoot) continue;
    const record = records[path.basename(module.root)];
    if (!record || record.id !== id || record.signedSha256) continue;
    const file = path.join(module.root, SIGNATURE_FILE);
    const size = await stat(file).then((info) => (info.isFile() ? info.size : -1), () => -1);
    if (size < 0 || size > MAX_SIGNATURE_BYTES) continue;
    const data = await readFile(file).catch(() => null);
    const hash = data ? signedHash([{ name: SIGNATURE_FILE, data }]) : null;
    if (hash) record.signedSha256 = hash;
  }
}

/**
 * The modules installed now, as one object that services hold: a reload replaces what is inside, so they never keep
 * an out-of-date map. `shown` gives a module with its texts in Tavora's language now.
 */
export class Installed {
  constructor(
    private current: InstalledModules,
    private readonly translate: (manifest: InstalledModule["manifest"]) => InstalledModule["manifest"],
  ) {}

  /** Puts what a new look at the modules found in place of the old (every reload). */
  replace(next: InstalledModules): void {
    this.current = next;
  }

  get modules(): Map<string, InstalledModule> {
    return this.current.modules;
  }
  get blocked(): Map<string, InstalledModule> {
    return this.current.blocked;
  }
  get catalog(): Set<string> {
    return this.current.catalog;
  }
  get info(): Map<string, ModuleInfo> {
    return this.current.info;
  }
  get problems(): ModuleProblem[] {
    return this.current.problems;
  }

  get(moduleId: string): InstalledModule | undefined {
    return this.current.modules.get(moduleId);
  }

  /** The module with its name, description, panel and action names in Tavora's language now; undefined when it is not installed. */
  shown(moduleId: string): InstalledModule | undefined {
    const module = this.current.modules.get(moduleId);
    return module && { ...module, manifest: this.translate(module.manifest) };
  }
}
