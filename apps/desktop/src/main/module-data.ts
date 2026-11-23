import { mkdir, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { isModuleId, isOwnerId, LOCAL_OWNER, OFFICIAL_OWNER } from "@tavora/module-schema";
import { isWorkspaceId } from "./workspace-id";
import { writeFileAtomic } from "./fsutil";
import { keepNewerCopy, setAside, type SavedRecord } from "./json";
import { SAVED_FILES, SavedFile } from "./saved-file";
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
      const workspaceId = partitionWorkspace(name);
      return workspaceId !== null && pick(workspaceId);
    })
    .map((name) => path.join(root, name));
}

/** The workspace a module or Browser partition directory belongs to (lower case), or null for any other directory. */
export function partitionWorkspace(dir: string): string | null {
  const match = /^(?:module:(?:[a-z0-9]+:)?[a-z0-9.-]+|browser)@([a-z0-9-]+)$/.exec(safeDecode(path.basename(dir)));
  return match?.[1] ?? null;
}

/** In the data folder while some left-over browser storage and panel state is kept (holdLeftovers). */
export const SWEEP_HOLD_FILE = "sweep-hold.json";
const SWEEP_HOLD_VERSION = 1;

/** What the start sweep would delete: browser storage of workspaces not in the library, state of panels in no workspace. */
export interface Leftovers {
  workspaces: ReadonlySet<string>;
  panels: ReadonlySet<string>;
}

/**
 * Which leftovers this start keeps; the sweep deletes the rest. When library.json or workspace.json was missing or
 * unreadable this start (`filesRead` false), every leftover is most likely the user's, back once they restore the file:
 * all are kept, and the hold file names them, so later starts keep them too while Tavora saves new files meanwhile.
 * A later start keeps those that are still left over and sweeps everything else; once none is, the hold file goes.
 * A hold file that can't be read right now keeps everything this start. One that is damaged is set aside, and one a
 * newer Tavora wrote is copied aside; either way this start keeps everything and writes a fresh hold, which clears
 * the normal way later (so cleanup never stops for good).
 */
export async function holdLeftovers(userData: string, filesRead: boolean, leftovers: Leftovers): Promise<Leftovers> {
  const file = path.join(userData, SWEEP_HOLD_FILE);
  let held: { workspaces: string[]; panels: string[] } = { workspaces: [], panels: [] };
  let keepAll = !filesRead;
  let bytes: Buffer | null;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return leftovers;
    bytes = null;
  }
  if (bytes) {
    const text = bytes.toString("utf8");
    const saved = ((): { version?: unknown; workspaces?: unknown; panels?: unknown } | null => {
      try {
        return JSON.parse(text) as { version?: unknown; workspaces?: unknown; panels?: unknown } | null;
      } catch {
        return null;
      }
    })();
    const strings = (value: unknown) => (Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null);
    const workspaces = strings(saved?.workspaces);
    const panels = strings(saved?.panels);
    if (typeof saved?.version === "number" && saved.version > SWEEP_HOLD_VERSION) {
      await keepNewerCopy(file, saved.version, bytes);
      keepAll = true;
    }
    if (workspaces && panels) held = { workspaces, panels };
    else {
      await setAside(file);
      keepAll = true;
    }
  }
  const keep = (old: string[], now: ReadonlySet<string>) => new Set(keepAll ? [...old, ...now] : old.filter((id) => now.has(id)));
  const result = { workspaces: keep(held.workspaces, leftovers.workspaces), panels: keep(held.panels, leftovers.panels) };
  if (result.workspaces.size === 0 && result.panels.size === 0) await rm(file, { force: true });
  else await writeFileAtomic(file, JSON.stringify({ version: SWEEP_HOLD_VERSION, workspaces: [...result.workspaces], panels: [...result.panels] }));
  return result;
}

/**
 * Runs at every start before any module session or store is opened. First it
 * carries out what Settings > Modules queued (applyPending). Then it moves
 * data saved before modules had owners (keyed by id alone) under its owner:
 * `tavora.` ids are Tavora's own, everything else was an unsigned local
 * module. A backup copied back by hand is moved too; data already under an
 * owner is never overwritten, and the old copy then stays where it is.
 */
export async function migrateModuleData(userData: string, log: (line: string) => void = () => undefined, blobRoot?: string, isLoaded: (owner: string, moduleId: string) => boolean = () => false): Promise<void> {
  await applyPending(userData, log, blobRoot, isLoaded);
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
 * The file of what waits for the next start. A file a newer Tavora wrote is copied aside first, and a damaged one set
 * aside (SavedFile); one that can't be read right now throws, so nothing queued is written over. Changes to it run one
 * at a time, each read and written in one turn, so two at once can't drop each other's.
 */
const pendingFile = (userData: string) => new SavedFile(path.join(userData, PENDING), SAVED_FILES[PENDING]);

/** What waits for the next start. */
async function readPending(userData: string): Promise<PendingChanges> {
  return parsePending(await pendingFile(userData).read());
}

function parsePending(saved: SavedRecord | null): PendingChanges {
  const parsed = (saved ?? {}) as PendingChanges;
  return {
    moves: (Array.isArray(parsed.moves) ? parsed.moves : []).filter((move) => isModuleId(move?.moduleId) && isOwnerId(move?.to) && move.to !== LOCAL_OWNER && move.to !== OFFICIAL_OWNER),
    deletePartitions: (Array.isArray(parsed.deletePartitions) ? parsed.deletePartitions : []).filter((name) => typeof name === "string" && /^persist:module:[a-z0-9]+:[a-z0-9.-]+@[a-z0-9-]+$/.test(name)),
  };
}

function queue(userData: string, change: PendingChanges): Promise<void> {
  return pendingFile(userData).update((saved) => {
    const pending = parsePending(saved);
    return {
      moves: [...(pending.moves ?? []), ...(change.moves ?? [])],
      deletePartitions: [...new Set([...(pending.deletePartitions ?? []), ...(change.deletePartitions ?? [])])],
    };
  });
}

/** The (owner, module) a queued `persist:module:<owner>:<module>@<workspace>` belongs to. */
function partitionModule(partition: string): { owner: string; moduleId: string } | null {
  const match = /^persist:module:([a-z0-9]+):([a-z0-9.-]+)@[a-z0-9-]+$/.exec(partition);
  return match ? { owner: match[1]!, moduleId: match[2]! } : null;
}

/**
 * The module is installed again: its browser storage, cleared when its data was deleted, holds what it saved since, so
 * the delete queued for the next start is called off.
 */
export function cancelPartitionDeletes(userData: string, owner: string, moduleId: string): Promise<void> {
  return pendingFile(userData).update(async (saved) => {
    const pending = parsePending(saved);
    const kept = (pending.deletePartitions ?? []).filter((partition) => {
      const of = partitionModule(partition);
      return of?.owner !== owner || of.moduleId !== moduleId;
    });
    if (kept.length === (pending.deletePartitions ?? []).length) return null;
    if (kept.length > 0 || (pending.moves ?? []).length > 0) return { moves: pending.moves ?? [], deletePartitions: kept };
    await rm(path.join(userData, PENDING), { force: true });
    return null;
  });
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
 * and deleted modules' browser storage folders go, unless their module is back (any way it came: a zip, the catalog, a
 * development folder): what it saved since is in that folder.
 */
async function applyPending(userData: string, log: (line: string) => void, blobRoot: string | undefined, isLoaded: (owner: string, moduleId: string) => boolean): Promise<void> {
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
    const of = partitionModule(partition);
    if (of && isLoaded(of.owner, of.moduleId)) continue;
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
