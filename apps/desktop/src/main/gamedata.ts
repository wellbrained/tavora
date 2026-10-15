import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { isGameId } from "@tavora/module-schema";

/**
 * Deletes what modules stored on disk for one game: settings and documents
 * of every module, installed or not. Web storage in each module's browser
 * session is cleared separately by the host.
 */
export async function deleteModuleData(userData: string, gameId: string): Promise<void> {
  if (!isGameId(gameId)) throw new Error("invalid game id");
  const root = path.join(userData, "module-data");
  let modules: string[];
  try {
    modules = await readdir(root);
  } catch {
    return;
  }
  await Promise.all(modules.map((module) => rm(path.join(root, module, gameId), { recursive: true, force: true })));
}

/**
 * Electron keeps each module's browser storage in a partition directory
 * named after `persist:module:<module>@<game>`, and each game's Browser
 * storage in `persist:browser@<game>`. Returns the partition
 * directories whose game is not in `keep`, so they can be deleted at
 * startup before any session for them is opened.
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
      const match = /^(?:module:[a-z0-9.-]+|browser)@([a-z0-9-]+)$/.exec(decoded);
      return match !== null && !keep.has(match[1]!);
    })
    .map((name) => path.join(root, name));
}

function safeDecode(name: string): string {
  try {
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}
