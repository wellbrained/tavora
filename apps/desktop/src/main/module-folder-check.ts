// Checks a module's folder on disk against its signature: its files must be exactly what tavora.signature.json covers.
// Used for the folders the installer unpacked (installer.ts applyOwners: a folder gets its recorded owner only when its
// files still carry that owner's signature) and for Tavora's own modules downloaded from the catalogue
// (official-updates.ts). Hashing every file at every start would slow it down, so a check is kept with a stamp of the
// folder (every file's name, size, change times and file id) and done again only when the stamp changes.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { validateManifest } from "@tavora/module-schema";
import { MANIFEST_FILE, signedHash, verifyFiles, ZIP_LIMITS, type ZipFile } from "@tavora/pack";
import { writeFileAtomic } from "./fsutil";

/** What the folder holds: its files (when read) and a stamp that changes when any of them does. */
export interface FolderRead {
  files: ZipFile[];
  stamp: string;
}

/**
 * Walks a module's folder. Null when it holds a link or odd file (never part of a signed package) or more than a module
 * may. With `read` off no file is opened: only the stamp is made, to see whether the folder changed since it was checked.
 */
export async function readFolder(root: string, read: boolean): Promise<FolderRead | null> {
  try {
    return await readFolderOrThrow(root, read);
  } catch {
    return null;
  }
}

/** readFolder for a caller that must tell "not a module's folder" (null) from "can't be read right now" (it throws). */
export async function readFolderOrThrow(root: string, read: boolean): Promise<FolderRead | null> {
  const files: ZipFile[] = [];
  const stamp: string[] = [];
  let total = 0;
  const walk = async (dir: string, prefix: string): Promise<boolean> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const info = await lstat(full);
      const name = `${prefix}${entry.name}`;
      if (info.isDirectory()) {
        if (!(await walk(full, `${name}/`))) return false;
        continue;
      }
      if (!info.isFile()) return false;
      total += info.size;
      if (stamp.length >= ZIP_LIMITS.maxFiles || total > ZIP_LIMITS.maxUnpackedBytes) return false;
      // The change time and file id too: a file put back with its old size and date is still seen as changed.
      stamp.push(`${name}\0${info.size}\0${info.mtimeMs}\0${info.ctimeMs}\0${info.ino}`);
      if (read) files.push({ name, data: await readFile(full) });
    }
    return true;
  };
  return (await walk(root, "")) ? { files, stamp: stamp.sort().join("\n") } : null;
}

/** What the signature check found in a folder. */
export interface Verified {
  /** The key that signed it (its fingerprint). */
  signer: string;
  id: string;
  version: string;
  /** The hash of what the signature covers (signedHash). */
  signedSha256: string;
}

/** The signer, id and version of a folder whose files are exactly what its signature covers; null otherwise. */
export function verifyFolder(files: readonly ZipFile[]): Verified | null {
  const verified = verifyFiles(files);
  if (!verified.ok || !verified.signed) return null;
  const manifest = files.find((file) => file.name === MANIFEST_FILE);
  if (!manifest) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(manifest.data.toString("utf8"));
  } catch {
    return null;
  }
  const result = validateManifest(raw);
  const signedSha256 = signedHash(files);
  return result.ok && signedSha256 ? { signer: verified.owner, id: result.manifest.id, version: result.manifest.version, signedSha256 } : null;
}

interface Check {
  /** SHA-256 of the folder's stamp when it was checked. */
  stamp: string;
  verified: Verified | null;
}

const SHA256 = /^[0-9a-f]{64}$/;

function isVerified(value: unknown): value is Verified {
  if (typeof value !== "object" || value === null) return false;
  const { signer, id, version, signedSha256 } = value as Record<string, unknown>;
  return typeof signer === "string" && typeof id === "string" && typeof version === "string" && typeof signedSha256 === "string" && SHA256.test(signedSha256);
}

/**
 * Folder checks, kept by folder: a folder whose stamp did not change is not read and hashed again. With a file, the
 * checks last across starts (module-checks.json, a cache: losing it only costs one more hash of each folder). The file
 * is no weaker than the owner records next to it, which say who a folder belongs to in the first place.
 */
export class FolderChecks {
  private checks = new Map<string, Check>();
  /** Folders checked or looked up since the file was read: only those are written back. */
  private readonly used = new Set<string>();
  private loaded: Promise<void> | null = null;
  private changed = false;
  /** Folders looked at, and those read and hashed (not taken from the kept check), for the log. */
  looked = 0;
  hashed = 0;

  constructor(private readonly file?: string) {}

  /** The signature check of `dir`'s files now; null when they are not exactly what a valid signature covers. */
  async check(dir: string): Promise<Verified | null> {
    await this.load();
    this.used.add(dir);
    this.looked++;
    const seen = await readFolder(dir, false);
    if (seen === null) return this.forget(dir);
    const cached = this.checks.get(dir);
    if (cached?.stamp === stampHash(seen.stamp)) return cached.verified;
    const read = await readFolder(dir, true);
    if (read === null) return this.forget(dir);
    this.hashed++;
    // What was read is what is checked; a folder that changed between the two is checked again next time.
    const verified = verifyFolder(read.files);
    this.checks.set(dir, { stamp: stampHash(read.stamp), verified });
    this.changed = true;
    return verified;
  }

  /** Writes the checks of the folders looked at since it was read, when any changed or one is gone. Never throws. */
  async save(): Promise<void> {
    if (!this.file || !this.loaded) return;
    const kept = [...this.checks].filter(([dir]) => this.used.has(dir));
    if (!this.changed && kept.length === this.checks.size) return;
    this.checks = new Map(kept);
    this.changed = false;
    const folders = Object.fromEntries(kept);
    await writeFileAtomic(this.file, `${JSON.stringify({ folders })}\n`).catch(() => undefined);
  }

  private forget(dir: string): null {
    if (this.checks.delete(dir)) this.changed = true;
    return null;
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      if (!this.file) return;
      try {
        const parsed = JSON.parse(await readFile(this.file, "utf8")) as { folders?: unknown };
        const folders = typeof parsed.folders === "object" && parsed.folders !== null ? Object.entries(parsed.folders) : [];
        for (const [dir, value] of folders) {
          const { stamp, verified } = (value ?? {}) as Record<string, unknown>;
          if (typeof stamp === "string" && SHA256.test(stamp) && (verified === null || isVerified(verified))) this.checks.set(dir, { stamp, verified });
        }
      } catch {
        // Missing or unreadable: every folder is checked again.
      }
    })();
    return this.loaded;
  }
}

function stampHash(stamp: string): string {
  return createHash("sha256").update(stamp).digest("hex");
}
