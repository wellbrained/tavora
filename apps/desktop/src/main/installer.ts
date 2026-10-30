// Installs a module from a zip into the user's modules folder, following
// "Rules for a future zip installer" in the threat model: the zip is read
// and checked in memory (readZip), the manifest validated and the signature
// verified before anything is written, then the files go to a staging folder
// that is renamed into place. Nothing from the zip is ever run.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isModuleId, isOwnerId, LOCAL_OWNER, manifestFiles, needsNewerTavora, OFFICIAL_OWNER, validateManifest, type ModuleManifest } from "@tavora/module-schema";
import { MANIFEST_FILE, readZip, verifyFiles, ZIP_LIMITS, ZipError, type ZipFile } from "@tavora/pack";
import { compareModuleVersions } from "../shared/module-version";
import { writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside } from "./json";
import { UserError } from "./messages";
import { MOVED_MODULES } from "./moved-modules";
import type { OfficialUpdates } from "./official-updates";
import { OFFICIAL_PREFIX, type InstalledModule } from "./registry";
import type { SafetyCheck } from "./safety-lists";

export { compareModuleVersions };

export class InstallError extends UserError {}

/**
 * Who signed each module the installer put into the user's modules folder, by folder name.
 * `owner` is whose data it uses: the first key of the publisher's account. `signer` is the key
 * that signed the zip installed now, when a succession made it another key, and `sha256` the
 * zip's hash, so a blocked zip can be stopped (catalog threat model, C7, C14). `catalog` marks a
 * module installed from the catalog: only those are kept up to date from it (catalog-updates.ts).
 */
export type OwnerRecords = Record<string, { id: string; owner: string; signer?: string; sha256?: string; catalog?: true }>;

export const OWNER_RECORDS_FILE = "module-owners.json";
const RECORDS = OWNER_RECORDS_FILE;

/**
 * The owners the installer recorded. Kept by the host in its own file, never
 * in the module's folder, so a folder cannot name its own owner.
 */
export async function readOwnerRecords(userData: string): Promise<OwnerRecords> {
  const parsed = await readJsonOrSetAside<{ folders?: unknown }>(path.join(userData, RECORDS));
  const records: OwnerRecords = {};
  const folders = parsed?.folders;
  if (typeof folders !== "object" || folders === null) return records;
  for (const [folder, value] of Object.entries(folders)) {
    const { id, owner, signer, sha256, catalog } = (value ?? {}) as { id?: unknown; owner?: unknown; signer?: unknown; sha256?: unknown; catalog?: unknown };
    if (!isModuleId(folder) || !isModuleId(id) || !isOwnerId(owner)) continue;
    records[folder] = { id, owner };
    if (isOwnerId(signer) && signer !== owner) records[folder].signer = signer;
    if (typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256)) records[folder].sha256 = sha256;
    if (catalog === true) records[folder].catalog = true;
  }
  return records;
}

async function writeOwnerRecords(userData: string, records: OwnerRecords): Promise<void> {
  await writeFileAtomic(path.join(userData, RECORDS), `${JSON.stringify({ version: 1, folders: records }, null, 2)}\n`);
}

/**
 * Gives modules in the user's modules folder the owner the installer
 * recorded for them. A folder put there by hand, or one whose module id no
 * longer matches the record, stays `local`.
 */
export function applyOwners(modules: Map<string, InstalledModule>, userModulesRoot: string, records: OwnerRecords): void {
  for (const [id, module] of modules) {
    if (module.provenance !== "local" || path.dirname(module.root) !== userModulesRoot) continue;
    const record = records[path.basename(module.root)];
    if (record?.id === id) module.owner = record.owner;
  }
}

/** Forgets the recorded owner of a folder that was removed. Its data stays under that owner. */
export async function forgetOwner(userData: string, folder: string): Promise<void> {
  const records = await readOwnerRecords(userData);
  if (!(folder in records)) return;
  delete records[folder];
  await writeOwnerRecords(userData, records);
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

  const block = safety?.blocked(sha256);
  if (block) throw new InstallError("error.installBlocked", { name: manifest.name, reason: block.reason });

  const verified = verifyFiles(files);
  if (!verified.ok) throw new InstallError("error.installRefused", { reason: verified.reason });
  const signer = verified.owner;
  const signed = signer !== LOCAL_OWNER;
  if (official) return checkOfficial({ official, manifest, files, sha256, signer, modules, expect, safety });
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
    if (compareModuleVersions(manifest.version, existing.manifest.version) <= 0) {
      throw new InstallError("error.installNotNewer", { name: existing.manifest.name, installed: existing.manifest.version, version: manifest.version });
    }
    updated = true;
  } else if (await exists(target)) {
    throw new InstallError("error.installFolderTaken", { folder });
  }

  return { manifest, owner, sha256, updated, files, signer };
}

/**
 * The official path: an update of a shipped module of Tavora, signed by the pinned key. It is taken only for a shipped
 * id (never one that moved to the catalog), when it is not blocked, its signer is trusted, it names the oldest Tavora it
 * needs, and its version is newer than the shipped copy, the one running and the newest ever installed.
 */
function checkOfficial({ official, manifest, files, sha256, signer, modules, expect, safety }: { official: OfficialUpdates; manifest: ModuleManifest; files: ZipFile[]; sha256: string; signer: string; modules: ReadonlyMap<string, InstalledModule>; expect: InstallOptions["expect"]; safety: InstallOptions["safety"] }): CheckedZip {
  const refuse = (reason: string) => new InstallError("error.installRefused", { reason });
  if (!official.on || !safety) throw refuse("Tavora's own modules do not update from the catalog");
  if (!expect || expect.id !== manifest.id || expect.owner !== signer) throw refuse("it is not the module and publisher key that was listed");
  if (MOVED_MODULES.some((moved) => moved.from === manifest.id)) throw refuse("it moved to the catalog and is not bundled any more");
  const running = modules.get(manifest.id);
  if (running?.provenance !== "official" || running.builtIn || running.shippedVersion === undefined) throw refuse("it is not bundled with this Tavora");
  if (!manifest.minTavora) throw refuse("it does not name the oldest Tavora it needs (minTavora)");
  // Only plain x.y.z versions are recorded, so a pre-release never becomes the newest.
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw refuse("its version is not a plain x.y.z");
  const block = safety.blocked(sha256);
  if (block) throw new InstallError("error.installBlocked", { name: manifest.name, reason: block.reason });
  if (signer === LOCAL_OWNER || !official.signerTrusted(signer, sha256)) throw refuse("it is not signed by Tavora's publisher key");
  const mark = official.highWater(manifest.id);
  for (const installed of [running.shippedVersion, running.manifest.version, ...(mark ? [mark] : [])]) {
    if (compareModuleVersions(manifest.version, installed) <= 0) throw new InstallError("error.installNotNewer", { name: running.manifest.name, installed, version: manifest.version });
  }
  // The running module's panels reload with the new copy, also the first time.
  return { manifest, owner: OFFICIAL_OWNER, sha256, updated: true, files, signer, official: true };
}

/** Writes a checked zip into place and records its owner. */
async function writeChecked({ files, manifest, owner, signer, sha256, updated, official: downloaded }: CheckedZip, { userData, userModules, catalog, official }: InstallOptions): Promise<Installed> {
  const folder = manifest.id;
  const target = downloaded && official ? path.join(official.dir, folder) : path.join(userModules, folder);
  if (downloaded && !official) throw new InstallError("error.installRefused", { reason: "it is not one of Tavora's own modules" });
  // Staged next to the modules folder, so the rename into place stays on one disk.
  const stagingRoot = path.join(userData, "module-staging");
  await mkdir(stagingRoot, { recursive: true });
  const staging = await mkdtemp(path.join(stagingRoot, "install-"));
  try {
    for (const file of files) {
      const destination = path.join(staging, ...file.name.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.data, { flag: "wx" });
    }
    await mkdir(path.dirname(target), { recursive: true });
    if (downloaded ? await exists(target) : updated) {
      const old = path.join(stagingRoot, `old-${randomUUID()}`);
      await rename(target, old);
      try {
        await rename(staging, target);
      } catch (error) {
        await rename(old, target);
        throw error;
      }
      await rm(old, { recursive: true, force: true });
    } else {
      await rename(staging, target);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  if (downloaded && official) {
    // The folder is in place first: a record without it is ignored, and a folder without its record is not used.
    await official.save({ id: manifest.id, version: manifest.version, sha256, signer });
    return { manifest, owner, sha256, updated };
  }
  const records = await readOwnerRecords(userData);
  if (owner === LOCAL_OWNER) delete records[folder];
  else records[folder] = { id: manifest.id, owner, ...(signer !== owner ? { signer } : {}), sha256, ...(catalog ? { catalog: true as const } : {}) };
  await writeOwnerRecords(userData, records);
  return { manifest, owner, sha256, updated };
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}
