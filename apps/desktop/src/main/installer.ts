// Installs a module from a zip into the user's modules folder, following
// "Rules for a future zip installer" in the threat model: the zip is read
// and checked in memory (readZip), the manifest validated and the signature
// verified before anything is written, then the files go to a staging folder
// that is renamed into place. Nothing from the zip is ever run.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isModuleId, isOwnerId, LOCAL_OWNER, manifestFiles, needsNewerTavora, OFFICIAL_OWNER, validateManifest, type ModuleManifest } from "@tavora/module-schema";
import { MANIFEST_FILE, readZip, SIGNATURE_FILE, signedHash, verifyFiles, ZIP_LIMITS, ZipError, type ZipFile } from "@tavora/pack";
import { compareModuleVersions } from "../shared/module-version";
import { SerialQueue, writeFileAtomic } from "./fsutil";
import { HeldError, isDamaged, look, lookJson, lookNames, lookStat, unlessHeld } from "./file-look";
import { renameHeld } from "./rename-held";
import { readSavedFile } from "./json";
import { SUPPORTED_VERSIONS } from "./saved-versions";
import { UserError } from "./messages";
import { cancelPartitionDeletes } from "./module-data";
import { MOVED_MODULES } from "./moved-modules";
import { FolderChecks, readFolderOrThrow, verifyFolder, type Verified } from "./module-folder-check";
import { OFFICIAL_UPDATES_FILE, readOfficialRecords, type OfficialRecords, type OfficialUpdates } from "./official-updates";
import { OFFICIAL_PREFIX, type InstalledModule, type ModuleProblem } from "./registry";
import type { SafetyCheck } from "./safety-lists";

export { compareModuleVersions };

export class InstallError extends UserError {}

/**
 * Who signed each module the installer put into the user's modules folder, by folder name.
 * `owner` is whose data it uses: the first key of the publisher's account. `signer` is the key
 * that signed the zip installed now, when a succession made it another key, and `sha256` the
 * zip's hash and `signedSha256` the hash of what its signature covers (signedHash), so a blocked
 * zip can be stopped (catalog threat model, C7, C14); records from before have no `signedSha256`.
 * `catalog` marks a module installed from the catalog: only those are kept up to date from it
 * (catalog-updates.ts).
 */
export type OwnerRecords = Record<string, { id: string; owner: string; signer?: string; sha256?: string; signedSha256?: string; catalog?: true }>;

export const OWNER_RECORDS_FILE = "module-owners.json";
const RECORDS = OWNER_RECORDS_FILE;

/**
 * The owners the installer recorded. Kept by the host in its own file, never
 * in the module's folder, so a folder cannot name its own owner.
 */
export async function readOwnerRecords(userData: string): Promise<OwnerRecords> {
  return parseOwnerRecords(await readSavedFile(path.join(userData, RECORDS), { version: SUPPORTED_VERSIONS[OWNER_RECORDS_FILE] }));
}

function parseOwnerRecords(parsed: Record<string, unknown> | null): OwnerRecords {
  const records: OwnerRecords = {};
  const folders = parsed?.folders;
  if (typeof folders !== "object" || folders === null) return records;
  for (const [folder, value] of Object.entries(folders)) {
    const { id, owner, signer, sha256, signedSha256, catalog } = (value ?? {}) as { id?: unknown; owner?: unknown; signer?: unknown; sha256?: unknown; signedSha256?: unknown; catalog?: unknown };
    if (!isModuleId(folder) || !isModuleId(id) || !isOwnerId(owner)) continue;
    records[folder] = { id, owner };
    if (isOwnerId(signer) && signer !== owner) records[folder].signer = signer;
    if (typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256)) records[folder].sha256 = sha256;
    if (typeof signedSha256 === "string" && /^[0-9a-f]{64}$/.test(signedSha256)) records[folder].signedSha256 = signedSha256;
    if (catalog === true) records[folder].catalog = true;
  }
  return records;
}

/** Changes to the records, one at a time: two installs at once would otherwise each write back what they read, and one record would be lost. */
const recordChanges = new SerialQueue();

/** Reads the records, lets `change` edit them (false: nothing to write) and writes them back, after any change before it. */
function changeOwnerRecords(userData: string, change: (records: OwnerRecords) => boolean | void): Promise<void> {
  return recordChanges.run(async () => {
    const records = await readOwnerRecords(userData);
    if (change(records) === false) return;
    await writeFileAtomic(path.join(userData, RECORDS), `${JSON.stringify({ version: SUPPORTED_VERSIONS[OWNER_RECORDS_FILE], folders: records }, null, 2)}\n`);
  });
}

/**
 * Gives modules in the user's modules folder the owner the installer recorded for them, when the folder's files are
 * still exactly what that owner's key signed (security audit 2026-11-20). A folder put there by hand, or one whose
 * module id no longer matches the record, stays `local`. One whose files were changed, replaced or signed by another
 * key is answered (by id) and keeps `local` here: the caller stops it (installed-modules.ts), so it never runs with
 * the recorded owner's data or grants, nor writes data of its own that would later sit apart from them. `checks` keeps
 * what it found by each folder's stamp, so an unchanged folder is not hashed again. A record from before
 * `signedSha256` gets it here, in memory, from the files that were checked.
 */
export async function applyOwners(modules: Map<string, InstalledModule>, userModulesRoot: string, records: OwnerRecords, checks: FolderChecks = new FolderChecks()): Promise<string[]> {
  const changed: string[] = [];
  for (const [id, module] of modules) {
    if (module.provenance !== "local" || path.dirname(module.root) !== userModulesRoot) continue;
    const record = records[path.basename(module.root)];
    if (record?.id !== id) continue;
    const verified = await checks.check(module.root);
    // The installer records the first key of the account as the owner, and the key that signed as `signer` when they differ.
    const signedBy = record.signer ?? record.owner;
    if (!verified || verified.id !== id || verified.signer !== signedBy || (record.signedSha256 !== undefined && record.signedSha256 !== verified.signedSha256)) {
      changed.push(id);
      continue;
    }
    module.owner = record.owner;
    record.signedSha256 ??= verified.signedSha256;
  }
  return changed;
}

/** Forgets the recorded owner of a folder that was removed. Its data stays under that owner. */
export async function forgetOwner(userData: string, folder: string): Promise<void> {
  await changeOwnerRecords(userData, (records) => {
    if (!(folder in records)) return false;
    delete records[folder];
  });
}

export interface InstallOptions {
  userData: string;
  /** The user's modules folder (real path). */
  userModules: string;
  /** Every module loaded now, with the folder it came from, and those stopped because their zip is blocked. */
  modules: ReadonlyMap<string, InstalledModule>;
  /** This Tavora's version; a zip whose `minTavora` is newer is refused before anything is unpacked. */
  tavoraVersion: string;
  /** The catalog's signed safety lists: blocked zips, revoked keys and successions. None: nothing is revoked or blocked. */
  safety?: SafetyCheck;
  /**
   * What the zip must be, checked before anything is written: a catalog install asks for the module
   * id and publisher key its listing named, so a zip signed by anyone else is refused.
   */
  expect?: { id: string; owner: string };
  /** It comes from the catalog, so the catalog keeps it up to date; any other install stops that. */
  catalog?: boolean;
  /**
   * The official path, used only by the catalogue updater: the zip is an update of a shipped `tavora.*` module, accepted
   * only from the pinned Tavora key. Without it a `tavora.*` zip is always refused.
   */
  official?: OfficialUpdates;
}

export interface Installed {
  manifest: ModuleManifest;
  /** Whose data it uses: the signing key, or the first key of its account after a succession. */
  owner: string;
  /** SHA-256 of the zip. */
  sha256: string;
  /** It replaced an earlier version from the same publisher. */
  updated: boolean;
}

export async function installZip(zipFile: string, options: InstallOptions): Promise<Installed> {
  const size = await stat(zipFile).then((info) => (info.isFile() ? info.size : -1));
  if (size < 0) throw new InstallError("error.installNotZip");
  if (size > ZIP_LIMITS.maxArchiveBytes) throw new InstallError("error.installRefused", { reason: "the zip is too big" });
  return installZipData(await readFile(zipFile), options);
}

/** Installs a zip already in memory, such as one downloaded from the catalog, by the same rules as a picked file. */
export async function installZipData(zip: Buffer, options: InstallOptions): Promise<Installed> {
  return writeChecked(await checkZipData(zip, options), options);
}

/** A zip that passed every check of the installer, ready to be written. Nothing is on disk yet. */
export interface CheckedZip extends Installed {
  files: ZipFile[];
  /** An update of a shipped module: it goes to the official-updates folder, not the user's modules. */
  official?: true;
  /** The key that signed it, when a succession makes it another key than `owner`. */
  signer: string;
  /** SHA-256 of what its signature covers (signedHash), for a signed zip. */
  signedSha256?: string;
}

/**
 * Every check of the installer, with nothing written: what the zip is, who signed it, whether the
 * safety lists allow it and whether it may replace what is installed. A catalog update is checked
 * like this before the user is asked.
 */
export async function checkZipData(zip: Buffer, { userModules, modules, tavoraVersion, expect, safety, official }: InstallOptions): Promise<CheckedZip> {
  if (zip.length > ZIP_LIMITS.maxArchiveBytes) throw new InstallError("error.installRefused", { reason: "the zip is too big" });
  const sha256 = createHash("sha256").update(zip).digest("hex");
  let files;
  try {
    files = readZip(zip);
  } catch (error) {
    if (error instanceof ZipError) throw new InstallError("error.installRefused", { reason: error.message });
    throw error;
  }

  const manifestFile = files.find((file) => file.name === MANIFEST_FILE);
  if (!manifestFile) throw new InstallError("error.installRefused", { reason: `it has no ${MANIFEST_FILE}` });
  let raw: unknown;
  try {
    raw = JSON.parse(manifestFile.data.toString("utf8"));
  } catch {
    throw new InstallError("error.installRefused", { reason: `its ${MANIFEST_FILE} is not valid JSON` });
  }
  const result = validateManifest(raw);
  if (!result.ok) throw new InstallError("error.installRefused", { reason: result.errors.slice(0, 2).join("; ") });
  const { manifest } = result;
  if (needsNewerTavora(manifest, tavoraVersion)) throw new InstallError("error.installNeedsNewer", { name: manifest.name, needed: manifest.minTavora!, current: tavoraVersion });
  const names = new Set(files.map((file) => file.name));
  const { entries, icons } = manifestFiles(manifest);
  for (const entry of entries) if (!names.has(entry)) throw new InstallError("error.installRefused", { reason: `the entry page ${entry} is missing` });
  for (const icon of icons) if (!names.has(icon)) throw new InstallError("error.installRefused", { reason: `the icon ${icon} is missing` });
  const claimsOfficial = manifest.id.startsWith(OFFICIAL_PREFIX);
  if (claimsOfficial && !official) throw new InstallError("error.installRefused", { reason: "its id is reserved for Tavora's own modules" });
  // The official path takes nothing else, so a community zip can never use its rules.
  if (official && !claimsOfficial) throw new InstallError("error.installRefused", { reason: "it is not one of Tavora's own modules" });

  // By the zip's hash or by what its signature covers, so packing the same signed files again doesn't lift a block.
  const signedSha256 = signedHash(files) ?? undefined;
  const block = safety?.blocked(sha256, signedSha256);
  if (block) throw new InstallError("error.installBlocked", { name: manifest.name, reason: block.reason });

  const verified = verifyFiles(files);
  if (!verified.ok) throw new InstallError("error.installRefused", { reason: verified.reason });
  const signer = verified.owner;
  const signed = signer !== LOCAL_OWNER;
  if (official) return checkOfficial({ official, manifest, files, sha256, signedSha256, signer, modules, expect, safety });
  // A revoked key installs only what it signed before (C6); a successor key's modules use its first key's data (C7).
  if (signed && safety?.revoked(signer, sha256)) throw new InstallError("error.installRevoked", { name: manifest.name });
  const owner = signed && safety ? safety.firstKey(signer) : signer;
  if (expect && manifest.id !== expect.id) throw new InstallError("error.installRefused", { reason: `it is ${manifest.id}, not the module that was listed` });
  if (expect && signer !== expect.owner) throw new InstallError("error.installRefused", { reason: "it is not signed by the publisher key that was listed" });

  // An id already loaded is replaced only by a newer zip from the same
  // publisher in the user's own folder (an update); two modules with one id never run together.
  const existing = modules.get(manifest.id);
  const folder = manifest.id;
  const target = path.join(userModules, folder);
  let updated = false;
  if (existing) {
    const own = existing.provenance === "local" && path.dirname(existing.root) === userModules && path.basename(existing.root) === folder;
    if (!own) {
      // Say where the other copy comes from, so the user knows what to remove.
      const name = existing.manifest.name;
      if (existing.developmentFolder) throw new InstallError("error.installTakenDevelopment", { name, folder: existing.developmentFolder });
      if (existing.provenance === "official") throw new InstallError("error.installTakenOfficial", { name });
      throw new InstallError("error.installTaken", { name, folder: existing.root });
    }
    if (existing.owner !== owner) throw new InstallError("error.installOtherPublisher", { name: existing.manifest.name });
    // A changed folder's own version says nothing (its files aren't the publisher's): a zip of theirs repairs it, at any version.
    if (!existing.changed && compareModuleVersions(manifest.version, existing.manifest.version) <= 0) {
      throw new InstallError("error.installNotNewer", { name: existing.manifest.name, installed: existing.manifest.version, version: manifest.version });
    }
    updated = true;
  } else if (await exists(target)) {
    throw new InstallError("error.installFolderTaken", { folder });
  }

  return { manifest, owner, sha256, updated, files, signer, ...(signed && signedSha256 ? { signedSha256 } : {}) };
}

/**
 * The official path: an update of a shipped module of Tavora, signed by the pinned key. It is taken only for a shipped
 * id (never one that moved to the catalog), when it is not blocked, its signer is trusted, it names the oldest Tavora it
 * needs, and its version is newer than the shipped copy, the one running and the newest ever installed.
 */
function checkOfficial({ official, manifest, files, sha256, signedSha256, signer, modules, expect, safety }: { official: OfficialUpdates; manifest: ModuleManifest; files: ZipFile[]; sha256: string; signedSha256: string | undefined; signer: string; modules: ReadonlyMap<string, InstalledModule>; expect: InstallOptions["expect"]; safety: InstallOptions["safety"] }): CheckedZip {
  const refuse = (reason: string) => new InstallError("error.installRefused", { reason });
  if (!official.on || !safety) throw refuse("Tavora's own modules do not update from the catalog");
  if (!expect || expect.id !== manifest.id || expect.owner !== signer) throw refuse("it is not the module and publisher key that was listed");
  if (MOVED_MODULES.some((moved) => moved.from === manifest.id)) throw refuse("it moved to the catalog and is not bundled any more");
  const running = modules.get(manifest.id);
  if (running?.provenance !== "official" || running.builtIn || running.shippedVersion === undefined) throw refuse("it is not bundled with this Tavora");
  if (!manifest.minTavora) throw refuse("it does not name the oldest Tavora it needs (minTavora)");
  // Only plain x.y.z versions are recorded, so a pre-release never becomes the newest.
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw refuse("its version is not a plain x.y.z");
  const block = safety.blocked(sha256, signedSha256);
  if (block) throw new InstallError("error.installBlocked", { name: manifest.name, reason: block.reason });
  if (signer === LOCAL_OWNER || !official.signerTrusted(signer, sha256)) throw refuse("it is not signed by Tavora's publisher key");
  const mark = official.highWater(manifest.id);
  for (const installed of [running.shippedVersion, running.manifest.version, ...(mark ? [mark] : [])]) {
    if (compareModuleVersions(manifest.version, installed) <= 0) throw new InstallError("error.installNotNewer", { name: running.manifest.name, installed, version: manifest.version });
  }
  // The running module's panels reload with the new copy, also the first time.
  return { manifest, owner: OFFICIAL_OWNER, sha256, updated: true, files, signer, official: true, ...(signedSha256 ? { signedSha256 } : {}) };
}

/** Writes a checked zip into place and records its owner. */
async function writeChecked(checked: CheckedZip, options: InstallOptions): Promise<Installed> {
  const { official } = options;
  return checked.official && official ? official.install(checked.manifest.id, () => writeFiles(checked, options)) : writeFiles(checked, options);
}

async function writeFiles({ files, manifest, owner, signer, sha256, signedSha256, updated, official: downloaded }: CheckedZip, { userData, userModules, catalog, official }: InstallOptions): Promise<Installed> {
  const folder = manifest.id;
  const target = downloaded && official ? path.join(official.dir, folder) : path.join(userModules, folder);
  if (downloaded && !official) throw new InstallError("error.installRefused", { reason: "it is not one of Tavora's own modules" });
  // Staged next to the modules folder, so the rename into place stays on one disk.
  const stagingRoot = path.join(userData, "module-staging");
  await mkdir(stagingRoot, { recursive: true });
  // Installed again: a note that it was removed no longer holds for a copy this install leaves.
  await rm(path.join(stagingRoot, `${REMOVED}${folder}`), { force: true }).catch(() => undefined);
  const staging = await mkdtemp(path.join(stagingRoot, "install-"));
  /** The folder this update replaced: it goes once the new one is recorded, or recoverInstalls sorts it out. */
  let replaced: string | null = null;
  try {
    // On the disk before the record says this copy is the module: a power cut can't leave a recorded folder half empty.
    for (let at = 0; at < files.length; at += FLUSH_AT_ONCE) {
      await Promise.all(files.slice(at, at + FLUSH_AT_ONCE).map(async (file) => {
        const destination = path.join(staging, ...file.name.split("/"));
        await mkdir(path.dirname(destination), { recursive: true });
        const handle = await open(destination, "wx");
        try {
          await handle.writeFile(file.data);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }));
    }
    await mkdir(path.dirname(target), { recursive: true });
    if (downloaded ? await exists(target) : updated) {
      const old = path.join(stagingRoot, `old-${randomUUID()}`);
      // Says this copy is an update on its way, so recovery can tell it from one a module's removal left behind.
      await writeFile(`${old}${UPDATING}`, JSON.stringify({ id: manifest.id }));
      try {
        await renameHeld(target, old);
        try {
          await renameHeld(staging, target);
        } catch (error) {
          // Neither copy in place: the module isn't gone, so its panels wait for the next start to put it back.
          await renameHeld(old, target).catch(() => strand(userData, { folder, path: old, message: "an update of this module was cut off", kind: "unreadable", about: { name: manifest.id, version: null, id: manifest.id }, official: true }));
          throw error;
        }
      } catch (error) {
        // Still there, the old copy keeps its mark, so the next start puts it back.
        if (!(await exists(old).catch(() => true))) await rm(`${old}${UPDATING}`, { force: true }).catch(() => undefined);
        throw error;
      }
      replaced = old;
    } else {
      await renameHeld(staging, target);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  if (downloaded && official) {
    // The folder is in place first: a record without it is ignored, and a folder without its record is not used.
    await official.save({ id: manifest.id, version: manifest.version, sha256, signer, ...(signedSha256 ? { signedSha256 } : {}) });
  } else {
    await changeOwnerRecords(userData, (records) => {
      if (owner === LOCAL_OWNER) delete records[folder];
      else records[folder] = { id: manifest.id, owner, ...(signer !== owner ? { signer } : {}), sha256, ...(signedSha256 ? { signedSha256 } : {}), ...(catalog ? { catalog: true as const } : {}) };
    });
  }
  // The update counts from here. A locked file can't undo it: what is left of the old folder goes at the next start.
  if (replaced) await retireOldCopy(replaced);
  await cancelPartitionDeletes(userData, owner, manifest.id).catch((error: unknown) => console.warn("[tavora] calling off a queued storage delete failed", error));
  return { manifest, owner, sha256, updated };
}

/** Whether a folder's files are the ones its record names. */
function matchesRecord(verified: Verified | null, id: string, record: { signer: string; signedSha256?: string; version?: string }): boolean {
  return verified !== null && verified.id === id && verified.signer === record.signer && (record.signedSha256 === undefined || record.signedSha256 === verified.signedSha256) && (record.version === undefined || record.version === verified.version);
}

/** The signature check of a folder; null when it isn't a signed module's. One that is held stops the work. */
async function verifiedFolder(dir: string): Promise<Verified | null> {
  const read = unlessHeld(await look(() => readFolderOrThrow(dir, true)));
  return read && verifyFolder(read.files);
}

/** Files written and flushed at once while a module is unpacked: a flush per file, one at a time, is slow on a big module. */
const FLUSH_AT_ONCE = 16;
/** Next to `old-<id>`: this Tavora moved it there for an update that hasn't finished. */
const UPDATING = ".updating";
const DONE = ".done";
const isOldCopy = (name: string) => name.startsWith("old-") && !name.endsWith(DONE) && !name.endsWith(UPDATING);

/** A note in the staging folder: this module was removed, though a copy of it couldn't be told apart at the time. */
const REMOVED = "removed-";
/** A cloud copy going in (cloud-copy-swap.ts): it may have moved the records, so nothing here decides from them. */
const COPY_STATUS_FILE = "cloud-copy-status.json";

/** What a previous copy must match to come back. */
type CopyRecord = { signer: string; signedSha256?: string; version?: string };

/** Per data folder, the modules that aren't in place right now but aren't gone: their panels wait (installed-modules.ts). */
const stranded = new Map<string, ModuleProblem[]>();

export function strandedModules(userData: string): readonly ModuleProblem[] {
  return stranded.get(userData) ?? [];
}

function strand(userData: string, problem: ModuleProblem): void {
  stranded.set(userData, [...strandedModules(userData), problem]);
}

/**
 * A previous copy that is finished with. The `.done` file goes first: if a locked file stops the delete, the next start
 * knows this copy must never come back, whatever happens to the module meanwhile.
 */
async function retireOldCopy(old: string): Promise<void> {
  await writeFile(`${old}${DONE}`, "").catch(() => undefined);
  await rm(`${old}${UPDATING}`, { force: true }).catch(() => undefined);
  await rm(old, { recursive: true, force: true }).catch(() => undefined);
  if (!(await exists(old).catch(() => true))) await rm(`${old}${DONE}`, { force: true }).catch(() => undefined);
}

/**
 * The module a previous copy is of, from its manifest or else the mark an update left next to it. Null when it isn't a
 * module's. A manifest that is busy, with no mark to go by, stops the work (HeldError).
 */
async function oldCopyId(old: string): Promise<string | null> {
  const manifest = await lookJson(path.join(old, MANIFEST_FILE));
  if (manifest.status === "present" && isModuleId(manifest.value.id)) return manifest.value.id;
  const mark = await lookJson(`${old}${UPDATING}`);
  if (mark.status === "present" && isModuleId(mark.value.id)) return mark.value.id;
  if (manifest.status === "held" && !isDamaged(manifest)) throw new HeldError(manifest.error);
  return null;
}

/**
 * A module was removed: any previous copy of it left in the staging folder goes too, and can't come back. A copy that
 * can't be told apart right now is left alone, and a note says this module is gone, for the next start to go by.
 */
export async function dropOldCopies(userData: string, moduleId: string): Promise<void> {
  const stagingRoot = path.join(userData, "module-staging");
  const listed = await lookNames(stagingRoot);
  let unsure = listed.status === "held";
  for (const name of listed.status === "present" ? listed.value : []) {
    if (!isOldCopy(name)) continue;
    const old = path.join(stagingRoot, name);
    const id = await look(() => oldCopyId(old));
    if (id.status === "held") unsure = true;
    else if (id.status === "present" && id.value === moduleId) await retireOldCopy(old);
  }
  if (unsure) await writeFile(path.join(stagingRoot, `${REMOVED}${moduleId}`), "").catch(() => undefined);
  stranded.set(userData, strandedModules(userData).filter((problem) => problem.about?.id !== moduleId));
}

/**
 * One previous copy, at start. It comes back only as what it was: the copy the records still name, or an unsigned local
 * module (which never has a record) whose update this Tavora marked as on its way. A signed copy no record names belongs
 * to a module that was removed: as an unsigned folder it would load past the signature and block checks, so it goes.
 * Records that can't be trusted (`known` false) decide nothing: the copy stays and its panels wait. A marked copy that
 * can't be verified, or an unsigned one from an older Tavora, doesn't come back, and its files stay as `left-*`. With a
 * new copy in place, the new one stays when it is what the records name; when they still name the old one, the update
 * never finished and the old one goes back. What is held throws: this may be the module's only copy.
 */
async function recoverOldCopy(id: string, old: string, target: string, record: CopyRecord | undefined, known: boolean, updating: boolean, stagingRoot: string, log: (line: string) => void): Promise<void> {
  const read = unlessHeld(await look(() => readFolderOrThrow(old, true)));
  const recorded = record !== undefined && matchesRecord(read && verifyFolder(read.files), id, record);
  const plainLocal = record === undefined && !id.startsWith(OFFICIAL_PREFIX) && read !== null && !read.files.some((file) => file.name === SIGNATURE_FILE);
  const leave = async () => {
    log(`a previous copy of ${id} can't be verified, so it doesn't come back; its files stay in module-staging`);
    await renameHeld(old, path.join(stagingRoot, path.basename(old).replace(/^old-/, "left-")));
    await rm(`${old}${UPDATING}`, { force: true }).catch(() => undefined);
  };
  if (!(await exists(target))) {
    if (recorded || (plainLocal && updating)) {
      await mkdir(path.dirname(target), { recursive: true });
      await renameHeld(old, target);
      await rm(`${old}${UPDATING}`, { force: true }).catch(() => undefined);
      log(`an update of ${id} was cut off; its previous copy is back`);
      return;
    }
    if (read === null && updating) return leave();
    if (!known && !plainLocal) throw new Error("its records can't be trusted");
    if (updating || plainLocal) return leave();
    log(`a previous copy of ${id} isn't what its records name, so it doesn't come back`);
    return retireOldCopy(old);
  }
  if (!known && !plainLocal) throw new Error("its records can't be trusted");
  if (!recorded || matchesRecord(await verifiedFolder(target), id, record)) return retireOldCopy(old);
  const unfinished = path.join(stagingRoot, `unfinished-${randomUUID()}`);
  await renameHeld(target, unfinished);
  try {
    await renameHeld(old, target);
  } catch (error) {
    await renameHeld(unfinished, target);
    throw error;
  }
  await rm(`${old}${UPDATING}`, { force: true }).catch(() => undefined);
  await rm(unfinished, { recursive: true, force: true }).catch(() => undefined);
  log(`an update of ${id} was cut off before it was recorded; its previous copy is back`);
}

/**
 * Puts right module updates that were cut off, at start, before modules are looked for (recoverOldCopy). A copy that
 * can't go back yet (a held file, records that can't be trusted, a cloud copy still going in) is reported, so its
 * module's panels wait instead of being dropped, and is tried again at the next start. Half-unpacked installs go too.
 * Nothing here touches what modules saved.
 */
export async function recoverInstalls({ userData, userModules, officialDir, log }: { userData: string; userModules: string; officialDir: string; log: (line: string) => void }): Promise<void> {
  const stagingRoot = path.join(userData, "module-staging");
  stranded.set(userData, []);
  /** Can't tell whose this is right now: without an id, every panel waits (panelsWait), until the next start looks again. */
  const unsure = (where: string) => strand(userData, { folder: path.basename(where), path: where, message: "a module update can't be read right now", kind: "unreadable", official: true });
  const listed = await lookNames(stagingRoot);
  if (listed.status === "held") return unsure(stagingRoot);
  if (listed.status === "missing") return;
  const names = listed.value;
  for (const name of names.filter((item) => item.startsWith("install-"))) await rm(path.join(stagingRoot, name), { recursive: true, force: true }).catch(() => undefined);
  for (const name of names.filter((item) => item.startsWith("old-") && item.endsWith(DONE))) await retireOldCopy(path.join(stagingRoot, name.slice(0, -DONE.length)));
  // A mark whose folder never moved: the update stopped before it began.
  for (const name of names.filter((item) => item.startsWith("old-") && item.endsWith(UPDATING) && !names.includes(item.slice(0, -UPDATING.length)))) await rm(path.join(stagingRoot, name), { force: true }).catch(() => undefined);
  const leftovers = names.filter((item) => isOldCopy(item) && !names.includes(`${item}${DONE}`));
  if (leftovers.length > 0 && (await lookStat(path.join(userData, COPY_STATUS_FILE))).status !== "missing") {
    log("a cloud copy is still going in; cut-off module updates wait for it");
    return unsure(stagingRoot);
  }
  const removed = new Set(names.filter((item) => item.startsWith(REMOVED)).map((item) => item.slice(REMOVED.length)));
  // Only a file that holds records says what they are. Damaged, busy or gone, they decide nothing about a signed copy.
  const ownerFile = await lookJson(path.join(userData, RECORDS));
  const owners = ownerFile.status === "present" ? parseOwnerRecords(ownerFile.value) : {};
  const officialFile = await lookJson(path.join(userData, OFFICIAL_UPDATES_FILE));
  const officials: OfficialRecords = officialFile.status === "present" ? await readOfficialRecords(userData) : {};
  for (const name of leftovers) {
    const old = path.join(stagingRoot, name);
    const id = await look(() => oldCopyId(old));
    if (id.status === "held") {
      log(`${name} in module-staging can't be read now: ${id.error instanceof Error ? id.error.message : String(id.error)}`);
      unsure(old);
      continue;
    }
    if (id.status === "missing" || id.value === null) {
      log(`${name} in module-staging isn't a module; it stays`);
      continue;
    }
    const moduleId = id.value;
    if (removed.has(moduleId)) {
      await retireOldCopy(old);
      continue;
    }
    const isOfficial = moduleId.startsWith(OFFICIAL_PREFIX);
    const target = path.join(isOfficial ? officialDir : userModules, moduleId);
    const owner = owners[moduleId];
    const record: CopyRecord | undefined = isOfficial ? officials[moduleId] : owner?.id === moduleId ? { signer: owner.signer ?? owner.owner, ...(owner.signedSha256 ? { signedSha256: owner.signedSha256 } : {}) } : undefined;
    const known = isOfficial ? officialFile.status !== "held" : ownerFile.status === "present";
    try {
      await recoverOldCopy(moduleId, old, target, record, known, names.includes(`${name}${UPDATING}`), stagingRoot, log);
    } catch (error) {
      log(`an update of ${moduleId} can't be put right yet: ${error instanceof Error ? error.message : String(error)}`);
      if (!(await exists(target).catch(() => false))) strand(userData, { folder: moduleId, path: old, message: "an update of this module was cut off", kind: "unreadable", about: { name: moduleId, version: null, id: moduleId }, official: true });
    }
  }
  if (strandedModules(userData).length === 0) for (const id of removed) await rm(path.join(stagingRoot, `${REMOVED}${id}`), { force: true }).catch(() => undefined);
  for (const name of names.filter((item) => item.startsWith("unfinished-"))) await rm(path.join(stagingRoot, name), { recursive: true, force: true }).catch(() => undefined);
}

/** Whether a file is there. One that is held stops the work (file-look.ts). */
async function exists(target: string): Promise<boolean> {
  return unlessHeld(await lookStat(target)) !== null;
}
