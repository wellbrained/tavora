import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isGameId, isModuleId, LOCAL_OWNER, OFFICIAL_OWNER } from "@tavora/module-schema";
import { OFFICIAL_PREFIX } from "./registry";

/**
 * The browser session of one module in one game. The owner is part of the
 * name, so a module from another publisher with the same id gets storage of
 * its own (S5). Electron names the directory after the partition with ":"
 * escaped, so no "/" may appear in it (that would nest directories).
 */
export function modulePartition(owner: string, moduleId: string, gameId: string): string {
  return `persist:module:${owner}:${moduleId}@${gameId}`;
}

/** Electron's directory name for a `persist:` partition, as it writes it on disk. */
function partitionDirName(partition: string): string {
  return partition.slice("persist:".length).toLowerCase().replaceAll(":", "%3A");
}

/**
 * Deletes what modules stored on disk for one game: settings and documents
 * of every module of every owner, installed or not. Web storage in each
 * module's browser session is cleared separately by the host.
 */
export async function deleteModuleData(userData: string, gameId: string): Promise<void> {
  if (!isGameId(gameId)) throw new Error("invalid game id");
  const root = path.join(userData, "module-data");
  const owners = await readdir(root).catch(() => [] as string[]);
  for (const owner of owners) {
    const modules = await readdir(path.join(root, owner)).catch(() => [] as string[]);
    await Promise.all(modules.map((module) => rm(path.join(root, owner, module, gameId), { recursive: true, force: true })));
  }
}

/**
 * Electron keeps each module's browser storage in a partition directory
 * named after `persist:module:<owner>:<module>@<game>` (in older versions
 * `persist:module:<module>@<game>`, see migrateModuleData), and each game's Browser storage in
 * `persist:browser@<game>`. Returns the partition directories whose game is
 * not in `keep`, so they can be deleted at startup before any session for
 * them is opened.
 */
export async function orphanedPartitions(userData: string, keep: ReadonlySet<string>): Promise<string[]> {
  const root = path.join(userData, "Partitions");
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  return names
    .filter((name) => {
      const decoded = safeDecode(name);
      const match = /^(?:module:(?:[a-z0-9]+:)?[a-z0-9.-]+|browser)@([a-z0-9-]+)$/.exec(decoded);
      return match !== null && !keep.has(match[1]!);
    })
    .map((name) => path.join(root, name));
}

/**
 * Moves data saved before modules had owners (keyed by id alone) under its owner: `tavora.` ids are Tavora's own, everything else was
 * an unsigned local module. Runs at every start before any module session is
 * opened, so a backup copied back by hand is moved too; data already under
 * an owner is never overwritten, and the old copy then stays where it is.
 */
export async function migrateModuleData(userData: string, log: (line: string) => void = () => undefined): Promise<void> {
  const ownerOf = (moduleId: string) => (moduleId.startsWith(OFFICIAL_PREFIX) ? OFFICIAL_OWNER : LOCAL_OWNER);

  const dataRoot = path.join(userData, "module-data");
  for (const name of await readdir(dataRoot).catch(() => [] as string[])) {
    // Owners never contain a dot and module ids always do.
    if (!isModuleId(name)) continue;
    const target = path.join(dataRoot, ownerOf(name), name);
    if (await exists(target)) {
      log(`module data of ${name} is already under its owner; the old copy stays in module-data/${name}`);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await rename(path.join(dataRoot, name), target);
  }

  const partitions = path.join(userData, "Partitions");
  for (const name of await readdir(partitions).catch(() => [] as string[])) {
    const match = /^module:([a-z0-9.-]+)@([a-z0-9-]+)$/.exec(safeDecode(name));
    if (!match || !isModuleId(match[1]) || !isGameId(match[2])) continue;
    const [, moduleId, gameId] = match as unknown as [string, string, string];
    const target = path.join(partitions, partitionDirName(modulePartition(ownerOf(moduleId), moduleId, gameId)));
    if (await exists(target)) {
      log(`browser storage of ${moduleId} in ${gameId} is already under its owner; the old one stays`);
      continue;
    }
    await rename(path.join(partitions, name), target);
  }
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

function safeDecode(name: string): string {
  try {
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}
