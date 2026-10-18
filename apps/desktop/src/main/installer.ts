// Installs a module from a zip into the player's modules folder, following
// "Rules for a future zip installer" in the threat model: the zip is read
// and checked in memory (readZip), the manifest validated and the signature
// verified before anything is written, then the files go to a staging folder
// that is renamed into place. Nothing from the zip is ever run.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isModuleId, isOwnerId, LOCAL_OWNER, manifestFiles, needsNewerTavora, validateManifest, type ModuleManifest } from "@tavora/module-schema";
import { MANIFEST_FILE, readZip, verifyFiles, ZIP_LIMITS, ZipError } from "@tavora/pack";
import { writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside } from "./json";
import { PlayerError } from "./messages";
import { OFFICIAL_PREFIX, type InstalledModule } from "./registry";
import type { SafetyCheck } from "./safety-lists";

export class InstallError extends PlayerError {}

/**
 * Semver order of two valid manifest versions: below 0 when a is older, 0 when they are the same,
 * above 0 when a is newer. A pre-release (1.0.0-beta.1) comes before its release, and pre-release
 * parts compare as semver says: numbers by value, below words, words by their characters.
 */
export function compareModuleVersions(a: string, b: string): number {
  const split = (version: string) => {
    const [core = "", pre] = version.split(/-(.*)/s);
    return { core: core.split(".").map(Number), pre: pre === undefined ? [] : pre.split(".") };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!;
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]!;
    const q = y.pre[i]!;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

/**
 * Who signed each module the installer put into the player's modules folder, by folder name.
 * `owner` is whose data it uses: the first key of the publisher's account. `signer` is the key
 * that signed the zip installed now, when a succession made it another key, and `sha256` the
 * zip's hash, so a blocked zip can be stopped (catalog threat model, C7, C14).
 */
export type OwnerRecords = Record<string, { id: string; owner: string; signer?: string; sha256?: string }>;

const RECORDS = "module-owners.json";

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
    const { id, owner, signer, sha256 } = (value ?? {}) as { id?: unknown; owner?: unknown; signer?: unknown; sha256?: unknown };
    if (!isModuleId(folder) || !isModuleId(id) || !isOwnerId(owner)) continue;
    records[folder] = { id, owner };
    if (isOwnerId(signer) && signer !== owner) records[folder].signer = signer;
    if (typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256)) records[folder].sha256 = sha256;
  }
  return records;
}

async function writeOwnerRecords(userData: string, records: OwnerRecords): Promise<void> {
  await writeFileAtomic(path.join(userData, RECORDS), `${JSON.stringify({ version: 1, folders: records }, null, 2)}\n`);
}

/**
 * Gives modules in the player's modules folder the owner the installer
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
  /** The player's modules folder (real path). */
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
export async function installZipData(zip: Buffer, { userData, userModules, modules, tavoraVersion, expect, safety }: InstallOptions): Promise<Installed> {
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
  if (manifest.id.startsWith(OFFICIAL_PREFIX)) throw new InstallError("error.installRefused", { reason: "its id is reserved for Tavora's own modules" });

  const block = safety?.blocked(sha256);
  if (block) throw new InstallError("error.installBlocked", { name: manifest.name, reason: block.reason });

  const verified = verifyFiles(files);
  if (!verified.ok) throw new InstallError("error.installRefused", { reason: verified.reason });
  const signer = verified.owner;
  const signed = signer !== LOCAL_OWNER;
  // A revoked key installs only what it signed before (C6); a successor key's modules use its first key's data (C7).
  if (signed && safety?.revoked(signer, sha256)) throw new InstallError("error.installRevoked", { name: manifest.name });
  const owner = signed && safety ? safety.firstKey(signer) : signer;
  if (expect && manifest.id !== expect.id) throw new InstallError("error.installRefused", { reason: `it is ${manifest.id}, not the module that was listed` });
  if (expect && signer !== expect.owner) throw new InstallError("error.installRefused", { reason: "it is not signed by the publisher key that was listed" });

  // An id already loaded is replaced only by a newer zip from the same
  // publisher in the player's own folder (an update); two modules with one id never run together.
  const existing = modules.get(manifest.id);
  const folder = manifest.id;
  const target = path.join(userModules, folder);
  let updated = false;
  if (existing) {
    const own = existing.provenance === "local" && path.dirname(existing.root) === userModules && path.basename(existing.root) === folder;
    if (!own) {
      // Say where the other copy comes from, so the player knows what to remove.
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
    await mkdir(userModules, { recursive: true });
    if (updated) {
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

  const records = await readOwnerRecords(userData);
  if (owner === LOCAL_OWNER) delete records[folder];
  else records[folder] = { id: manifest.id, owner, ...(signer !== owner ? { signer } : {}), sha256 };
  await writeOwnerRecords(userData, records);
  return { manifest, owner, sha256, updated };
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}
