import { mkdir, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { isModuleId, isOwnerId, LOCAL_OWNER, OFFICIAL_OWNER } from "@tavora/module-schema";
import { isWorkspaceId } from "./workspace-id";
import { writeFileAtomic } from "./fsutil";
import { readSavedFile } from "./json";
import { SUPPORTED_VERSIONS } from "./saved-versions";
import { defaultFilesRoot } from "./module-files";
import { OFFICIAL_PREFIX } from "./registry";
import { APP_DATA_DIR } from "./storage";

/**
 * The browser session of one module in one workspace. The owner is part of the
 * name, so a module from another publisher with the same id gets storage of
 * its own (S5). Electron names the directory after the partition with ":"
 * escaped, so no "/" may appear in it (that would nest directories).
 */
export function modulePartition(owner: string, moduleId: string, workspaceId: string): string {
  return `persist:module:${owner}:${moduleId}@${workspaceId}`;
}

/** Electron's directory name for a `persist:` partition, as it writes it on disk. */
export function partitionDirName(partition: string): string {
  return partition.slice("persist:".length).toLowerCase().replaceAll(":", "%3A");
}

/**
 * The folders modules keep data in, each laid out `<owner>/<module>/<workspace>`:
 * settings and documents, and files (pictures, see blobs.ts). The files can
 * sit in a folder the user chose (module-files.ts); callers pass it.
 */
function dataRoots(userData: string, blobRoot = defaultFilesRoot(userData)): string[] {
  return [path.join(userData, "module-data"), blobRoot];
}

/**
 * Deletes what modules stored on disk for one workspace: settings, documents and
 * files of every module of every owner, installed or not. Web storage in each
 * module's browser session is cleared separately by the host.
 */
export async function deleteModuleData(userData: string, workspaceId: string, blobRoot?: string): Promise<void> {
  if (!isWorkspaceId(workspaceId)) throw new Error("invalid workspace id");
  for (const root of [...dataRoots(userData, blobRoot), path.join(userData, 'read-only-files')]) {
    for (const owner of await readdir(root).catch(() => [] as string[])) {
      const modules = await readdir(path.join(root, owner)).catch(() => [] as string[]);
      await Promise.all(modules.map((module) => rm(path.join(root, owner, module, workspaceId), { recursive: true, force: true })));
    }
  }
}

/**
 * Electron keeps each module's browser storage in a partition directory
 * named after `persist:module:<owner>:<module>@<workspace>` (in older versions
 * `persist:module:<module>@<workspace>`, see migrateModuleData), and each workspace's Browser storage in
 * `persist:browser@<workspace>`. Returns the partition directories whose workspace is
 * not in `keep`, so they can be deleted at startup before any session for
 * them is opened.
 */
export function orphanedPartitions(userData: string, keep: ReadonlySet<string>): Promise<string[]> {
  return partitionsWhere(userData, (workspaceId) => !keep.has(workspaceId));
}

/** The partition directories (as orphanedPartitions finds them) of the given workspaces only. */
export function partitionsOf(userData: string, workspaceIds: Iterable<string>): Promise<string[]> {
  const ids = new Set([...workspaceIds].map((id) => id.toLowerCase()));
  return partitionsWhere(userData, (workspaceId) => ids.has(workspaceId));
}

async function partitionsWhere(userData: string, pick: (workspaceId: string) => boolean): Promise<string[]> {
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
      return match !== null && pick(match[1]!);
    })
    .map((name) => path.join(root, name));
}

/** In the data folder while what the start sweep would delete is kept (startSweepAllowed). */
export const SWEEP_HOLD_FILE = "sweep-hold.json";

/**
 * Whether this start may delete the browser storage of workspaces that aren't in the library and the panel state of
 * panels that aren't in any workspace. When library.json or workspace.json was missing or unreadable this start
 * (`filesRead` false), what looks left over is most likely the user's, back once they put the file back: nothing is
 * deleted, and a hold file keeps it that way at later starts too, as Tavora saves new files meanwhile. The hold lifts
 * at a start with nothing to delete (the files came back, or there never was anything).
 */
export async function startSweepAllowed(userData: string, filesRead: boolean, anythingToDelete: boolean): Promise<boolean> {
  const hold = path.join(userData, SWEEP_HOLD_FILE);
  if (!anythingToDelete) {
    await rm(hold, { force: true });
    return false;
  }
  if (!filesRead) {
    await writeFileAtomic(hold, JSON.stringify({ since: new Date().toISOString() }));
    return false;
  }
  // Only a hold that is surely not there lets the sweep run.
  return stat(hold).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );
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
    if (!match || !isModuleId(match[1]) || !isWorkspaceId(match[2])) continue;
    const [, moduleId, workspaceId] = match as unknown as [string, string, string];
    const target = path.join(partitions, partitionDirName(modulePartition(ownerOf(moduleId), moduleId, workspaceId)));
    if (await exists(target)) {
      log(`browser storage of ${moduleId} in ${workspaceId} is already under its owner; the old one stays`);
      continue;
    }
    await rename(path.join(partitions, name), target);
  }
}

/** Every (owner, module) that has settings, documents or files saved, in any workspace. */
export async function listModuleData(userData: string, blobRoot?: string): Promise<{ owner: string; moduleId: string }[]> {
  const found = new Map<string, { owner: string; moduleId: string }>();
  for (const root of [...dataRoots(userData, blobRoot), path.join(userData, 'read-only-files')]) {
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
 * Deletes the settings, documents and files one owner's module saved, in every workspace,
 * and answers with the browser sessions it had, for the host to clear (their
 * folders go with the next start's cleanup, see applyPending).
 */
export async function deleteModuleDataOf(userData: string, owner: string, moduleId: string, blobRoot?: string): Promise<string[]> {
  if (!isOwnerId(owner) || !isModuleId(moduleId)) throw new Error("invalid owner or module id");
  for (const root of [...dataRoots(userData, blobRoot), path.join(userData, 'read-only-files'), path.join(userData, 'folder-access')]) await rm(path.join(root, owner, moduleId), { recursive: true, force: true });
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

/**
 * What waits for the next start. A file a newer Tavora wrote is copied aside first, and a damaged one set aside
 * (readSavedFile); one that can't be read right now throws, so nothing queued is written over.
 */
async function readPending(userData: string): Promise<PendingChanges> {
  const parsed = ((await readSavedFile(path.join(userData, PENDING), { version: SUPPORTED_VERSIONS[PENDING] })) ?? {}) as PendingChanges;
  return {
    moves: (Array.isArray(parsed.moves) ? parsed.moves : []).filter((move) => isModuleId(move?.moduleId) && isOwnerId(move?.to) && move.to !== LOCAL_OWNER && move.to !== OFFICIAL_OWNER),
    deletePartitions: (Array.isArray(parsed.deletePartitions) ? parsed.deletePartitions : []).filter((name) => typeof name === "string" && /^persist:module:[a-z0-9]+:[a-z0-9.-]+@[a-z0-9-]+$/.test(name)),
  };
}

async function queue(userData: string, change: PendingChanges): Promise<void> {
  const pending = await readPending(userData);
  const next: PendingChanges = {
    moves: [...(pending.moves ?? []), ...(change.moves ?? [])],
    deletePartitions: [...new Set([...(pending.deletePartitions ?? []), ...(change.deletePartitions ?? [])])],
  };
  await writeFileAtomic(path.join(userData, PENDING), `${JSON.stringify({ version: SUPPORTED_VERSIONS[PENDING], ...next }, null, 2)}\n`);
}

/**
 * Asks for a module's local data to move to its signed version at the next
 * start, when no session has either open. Only a deliberate press in Settings
 * > Modules does this, never an install (the decision log, S5 rule 3).
 */
export async function queueLocalDataMove(userData: string, moduleId: string, to: string): Promise<void> {
  if (!isModuleId(moduleId) || !isOwnerId(to) || to === LOCAL_OWNER || to === OFFICIAL_OWNER) throw new Error("invalid move");
  await queue(userData, { moves: [{ moduleId, to }] });
}

/**
 * Carries out what was queued, before any module session or store opens:
 * local data moves to the signed owner workspace by workspace (a workspace where the signed
 * module already saved something keeps its own data, and the local copy stays),
 * and deleted modules' browser storage folders go.
 */
async function applyPending(userData: string, log: (line: string) => void, blobRoot?: string): Promise<void> {
  const pending = await readPending(userData);
  const partitions = path.join(userData, "Partitions");
  for (const { moduleId, to } of pending.moves ?? []) {
    for (const root of dataRoots(userData, blobRoot)) {
      const from = path.join(root, LOCAL_OWNER, moduleId);
      for (const workspace of await readdir(from).catch(() => [] as string[])) {
        // The settings shared by every workspace (storage.app) move like a workspace's.
        if (!isWorkspaceId(workspace) && workspace !== APP_DATA_DIR) continue;
        const target = path.join(root, to, moduleId, workspace);
        if (await exists(target)) {
          log(`${moduleId} already has data in ${workspace}; its local data there stays`);
          continue;
        }
        await mkdir(path.dirname(target), { recursive: true });
        await rename(path.join(from, workspace), target);
      }
      // Gone unless a workspace kept its local data.
      await rmdir(from).catch(() => undefined);
    }
    for (const name of await readdir(partitions).catch(() => [] as string[])) {
      const match = /^module:local:([a-z0-9.-]+)@([a-z0-9-]+)$/.exec(safeDecode(name));
      if (!match || match[1] !== moduleId || !isWorkspaceId(match[2])) continue;
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
