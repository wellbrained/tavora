import { mkdir, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { isGameId, isModuleId, isOwnerId, LOCAL_OWNER, OFFICIAL_OWNER } from "@tavora/module-schema";
import { writeFileAtomic } from "./fsutil";
import { defaultFilesRoot } from "./module-files";
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
 * The folders modules keep data in, each laid out `<owner>/<module>/<game>`:
 * settings and documents, and files (pictures, see blobs.ts). The files can
 * sit in a folder the player chose (module-files.ts); callers pass it.
 */
function dataRoots(userData: string, blobRoot = defaultFilesRoot(userData)): string[] {
  return [path.join(userData, "module-data"), blobRoot];
}

/**
 * Deletes what modules stored on disk for one game: settings, documents and
 * files of every module of every owner, installed or not. Web storage in each
 * module's browser session is cleared separately by the host.
 */
export async function deleteModuleData(userData: string, gameId: string, blobRoot?: string): Promise<void> {
  if (!isGameId(gameId)) throw new Error("invalid game id");
  for (const root of dataRoots(userData, blobRoot)) {
    for (const owner of await readdir(root).catch(() => [] as string[])) {
      const modules = await readdir(path.join(root, owner)).catch(() => [] as string[]);
      await Promise.all(modules.map((module) => rm(path.join(root, owner, module, gameId), { recursive: true, force: true })));
    }
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
 * Runs at every start before any module session or store is opened. First it
 * carries out what Settings > Modules queued (applyPending). Then it moves
 * data saved before modules had owners (keyed by id alone) under its owner:
 * `tavora.` ids are Tavora's own, everything else was an unsigned local
 * module. A backup copied back by hand is moved too; data already under an
 * owner is never overwritten, and the old copy then stays where it is.
 */
export async function migrateModuleData(userData: string, log: (line: string) => void = () => undefined, blobRoot?: string): Promise<void> {
  await applyPending(userData, log, blobRoot);
  const ownerOf = (moduleId: string) => (moduleId.startsWith(OFFICIAL_PREFIX) ? OFFICIAL_OWNER : LOCAL_OWNER);

  for (const dataRoot of dataRoots(userData, blobRoot)) {
    for (const name of await readdir(dataRoot).catch(() => [] as string[])) {
      // Owners never contain a dot and module ids always do.
      if (!isModuleId(name)) continue;
      const target = path.join(dataRoot, ownerOf(name), name);
      if (await exists(target)) {
        log(`module data of ${name} is already under its owner; the old copy stays in ${path.basename(dataRoot)}/${name}`);
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await rename(path.join(dataRoot, name), target);
    }
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

/** Every (owner, module) that has settings, documents or files saved, in any game. */
export async function listModuleData(userData: string, blobRoot?: string): Promise<{ owner: string; moduleId: string }[]> {
  const found = new Map<string, { owner: string; moduleId: string }>();
  for (const root of dataRoots(userData, blobRoot)) {
    for (const owner of await readdir(root).catch(() => [] as string[])) {
      if (!isOwnerId(owner)) continue;
      for (const moduleId of await readdir(path.join(root, owner)).catch(() => [] as string[])) {
        if (isModuleId(moduleId)) found.set(`${owner}/${moduleId}`, { owner, moduleId });
      }
    }
  }
  return [...found.values()];
}

/**
 * Deletes the settings, documents and files one owner's module saved, in every game,
 * and answers with the browser sessions it had, for the host to clear (their
 * folders go with the next start's cleanup, see applyPending).
 */
export async function deleteModuleDataOf(userData: string, owner: string, moduleId: string, blobRoot?: string): Promise<string[]> {
  if (!isOwnerId(owner) || !isModuleId(moduleId)) throw new Error("invalid owner or module id");
  for (const root of dataRoots(userData, blobRoot)) await rm(path.join(root, owner, moduleId), { recursive: true, force: true });
  const partitions: string[] = [];
  for (const name of await readdir(path.join(userData, "Partitions")).catch(() => [] as string[])) {
    const match = /^module:([a-z0-9]+):([a-z0-9.-]+)@([a-z0-9-]+)$/.exec(safeDecode(name));
    if (match && match[1] === owner && match[2] === moduleId) partitions.push(modulePartition(owner, moduleId, match[3]!));
  }
  await queue(userData, { deletePartitions: partitions });
  return partitions;
}

interface PendingChanges {
  /** Local data to hand to the signed module of the same id: Settings > Modules, "Move data from the local copy". */
  moves?: { moduleId: string; to: string }[];
  /** Browser storage folders to remove once no session has them open. */
  deletePartitions?: string[];
}

const PENDING = "module-data-pending.json";

async function readPending(userData: string): Promise<PendingChanges> {
  try {
    const parsed = JSON.parse(await readFile(path.join(userData, PENDING), "utf8")) as PendingChanges;
    return {
      moves: (Array.isArray(parsed.moves) ? parsed.moves : []).filter((move) => isModuleId(move?.moduleId) && isOwnerId(move?.to) && move.to !== LOCAL_OWNER && move.to !== OFFICIAL_OWNER),
      deletePartitions: (Array.isArray(parsed.deletePartitions) ? parsed.deletePartitions : []).filter((name) => typeof name === "string" && /^persist:module:[a-z0-9]+:[a-z0-9.-]+@[a-z0-9-]+$/.test(name)),
    };
  } catch {
    return {};
  }
}

async function queue(userData: string, change: PendingChanges): Promise<void> {
  const pending = await readPending(userData);
  const next: PendingChanges = {
    moves: [...(pending.moves ?? []), ...(change.moves ?? [])],
    deletePartitions: [...new Set([...(pending.deletePartitions ?? []), ...(change.deletePartitions ?? [])])],
  };
  await writeFileAtomic(path.join(userData, PENDING), `${JSON.stringify(next, null, 2)}\n`);
}

/**
 * Asks for a module's local data to move to its signed version at the next
 * start, when no session has either open. Only a deliberate press in Settings
 * > Modules does this, never an install (docs/decisions.md, S5 rule 3).
 */
export async function queueLocalDataMove(userData: string, moduleId: string, to: string): Promise<void> {
  if (!isModuleId(moduleId) || !isOwnerId(to) || to === LOCAL_OWNER || to === OFFICIAL_OWNER) throw new Error("invalid move");
  await queue(userData, { moves: [{ moduleId, to }] });
}

/**
 * Carries out what was queued, before any module session or store opens:
 * local data moves to the signed owner game by game (a game where the signed
 * module already saved something keeps its own data, and the local copy stays),
 * and deleted modules' browser storage folders go.
 */
async function applyPending(userData: string, log: (line: string) => void, blobRoot?: string): Promise<void> {
  const pending = await readPending(userData);
  const partitions = path.join(userData, "Partitions");
  for (const { moduleId, to } of pending.moves ?? []) {
    for (const root of dataRoots(userData, blobRoot)) {
      const from = path.join(root, LOCAL_OWNER, moduleId);
      for (const game of await readdir(from).catch(() => [] as string[])) {
        if (!isGameId(game)) continue;
        const target = path.join(root, to, moduleId, game);
        if (await exists(target)) {
          log(`${moduleId} already has data in ${game}; its local data there stays`);
          continue;
        }
        await mkdir(path.dirname(target), { recursive: true });
        await rename(path.join(from, game), target);
      }
      // Gone unless a game kept its local data.
      await rmdir(from).catch(() => undefined);
    }
    for (const name of await readdir(partitions).catch(() => [] as string[])) {
      const match = /^module:local:([a-z0-9.-]+)@([a-z0-9-]+)$/.exec(safeDecode(name));
      if (!match || match[1] !== moduleId || !isGameId(match[2])) continue;
      const target = path.join(partitions, partitionDirName(modulePartition(to, moduleId, match[2])));
      if (!(await exists(target))) await rename(path.join(partitions, name), target);
    }
  }
  for (const partition of pending.deletePartitions ?? []) {
    await rm(path.join(partitions, partitionDirName(partition)), { recursive: true, force: true });
  }
  await rm(path.join(userData, PENDING), { force: true });
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
