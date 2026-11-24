// Tavora's own signature on app updates (CoreHub #476, decided 2026-11-10). The update feed alone is not trusted:
// `pnpm release` signs every release offline on the maintainer's PC with the update key (scripts/update-key.mjs),
// the signature goes into latest.yml as one more field, and the app installs a downloaded update only when that
// signature covers exactly the version it is installing, the installer's file name and the SHA-512 of the bytes it
// downloaded, made by one of the two keys pinned in update-keys.ts.
//
// Used by the main process (updates.ts, host.ts) and by Node scripts (release.mjs, update-key.mjs, update-check.mjs),
// so it imports nothing but Node's own modules and the dependency-free shared/plain-version.ts.
import { createHash, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { createReadStream } from "node:fs";
import { comparePlainVersions, parsePlainVersion } from "../shared/plain-version.ts";

/** The first line of what is signed: a signature over anything else (a catalog list, a module) never counts here. */
export const UPDATE_SIGNATURE_FORMAT = "tavora-update-v1";
/** The field in latest.yml that carries the signature. */
export const UPDATE_SIGNATURE_FIELD = "tavoraSignature";

/** The two pinned public keys: the release key signs; the backup key's private half is kept apart for a lost one. */
export type UpdateKeyName = "release" | "backup";
export type PinnedUpdateKeys = Record<UpdateKeyName, KeyObject>;

/** What the signature covers. */
export interface SignedUpdate {
  version: string;
  /** The installer's file name, as the updater saves it (no folder). */
  file: string;
  /** SHA-512 of the installer, base64, as in latest.yml. */
  sha512: string;
}

export type UpdateCheck = { ok: true; key: UpdateKeyName } | { ok: false; reason: string };

const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
// DER prefix of an Ed25519 public key in SubjectPublicKeyInfo form; the raw 32 bytes follow.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** Base64 that decodes to exactly `bytes` bytes and is written the one canonical way. */
function isBase64Of(value: unknown, bytes: number): value is string {
  if (typeof value !== "string") return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === bytes && decoded.toString("base64") === value;
}

/** Why these fields can't be signed or checked, or null. Each field is one plain line, so the signed text can't be read two ways. */
export function updateProblem(update: { version: unknown; file: unknown; sha512: unknown }): string | null {
  if (parsePlainVersion(update.version) === null) return `the version is not a plain x.y.z version`;
  if (typeof update.file !== "string" || !FILE.test(update.file)) return `the file name is not a plain file name`;
  if (!isBase64Of(update.sha512, 64)) return `the SHA-512 is not 64 bytes of base64`;
  return null;
}

/** Exactly what is signed: the format, the version, the file name and the SHA-512, one per line. Throws on fields that can't be signed. */
export function signedUpdateBytes(update: SignedUpdate): Buffer {
  const problem = updateProblem(update);
  if (problem) throw new Error(`can't sign this update: ${problem}`);
  return Buffer.from([UPDATE_SIGNATURE_FORMAT, update.version, update.file, update.sha512].join("\n"), "utf8");
}

/** The signature (base64) for latest.yml, made with an update key's private half. */
export function signUpdate(update: SignedUpdate, privateKey: KeyObject): string {
  if (privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") throw new Error("the update key must be an Ed25519 private key");
  return sign(null, signedUpdateBytes(update), privateKey).toString("base64");
}

/** The raw 32-byte public half (base64) of an Ed25519 key, either half: what update-keys.ts pins. */
export function rawUpdatePublicKey(key: KeyObject): string {
  const der = (key.type === "private" ? createPublicKey(key) : key).export({ format: "der", type: "spki" });
  if (der.length !== 44 || !der.subarray(0, 12).equals(ED25519_SPKI)) throw new Error("not an Ed25519 key");
  return der.subarray(12).toString("base64");
}

/** A new update key pair (for scripts/update-key.mjs and throwaway test keys). */
export function makeUpdateKey(): { privateKey: KeyObject; publicKey: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey: rawUpdatePublicKey(privateKey) };
}

function publicKeyFromRaw(base64: string): KeyObject {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(base64, "base64")]), format: "der", type: "spki" });
}

/**
 * The pinned keys as key objects, or why they can't be used: both must be real Ed25519 public keys (an empty
 * placeholder is not), and two different ones. With no usable keys the app installs no update at all, so `pnpm
 * release` and the Release build refuse to ship such a build (scripts/update-key.mjs check).
 */
export function readPinnedUpdateKeys(value: unknown): { ok: true; keys: PinnedUpdateKeys } | { ok: false; problem: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, problem: "the pinned update keys are not an object" };
  const fields = Object.keys(value).sort().join(",");
  if (fields !== "backup,release") return { ok: false, problem: `the pinned update keys must be exactly "release" and "backup" (found: ${fields || "none"})` };
  const raw = value as Record<UpdateKeyName, unknown>;
  for (const name of ["release", "backup"] as const) {
    if (raw[name] === "") return { ok: false, problem: `the ${name} update key is still empty: paste its public key into apps/desktop/src/main/update-keys.ts` };
    if (!isBase64Of(raw[name], 32)) return { ok: false, problem: `the ${name} update key is not a raw Ed25519 public key (32 bytes of base64)` };
  }
  if (raw.release === raw.backup) return { ok: false, problem: "the release and backup update keys are the same key; the backup must be a key of its own" };
  try {
    return { ok: true, keys: { release: publicKeyFromRaw(raw.release as string), backup: publicKeyFromRaw(raw.backup as string) } };
  } catch {
    return { ok: false, problem: "a pinned update key is not a valid Ed25519 public key" };
  }
}

/** Which pinned key signed these fields, or why the signature does not hold. */
export function verifyUpdateSignature(update: { version: unknown; file: unknown; sha512: unknown }, signature: unknown, keys: PinnedUpdateKeys): UpdateCheck {
  const problem = updateProblem(update);
  if (problem) return { ok: false, reason: problem };
  if (signature === undefined || signature === null || signature === "") return { ok: false, reason: "latest.yml has no Tavora signature" };
  if (!isBase64Of(signature, 64)) return { ok: false, reason: "the Tavora signature is not 64 bytes of base64" };
  const bytes = signedUpdateBytes(update as SignedUpdate);
  const signed = Buffer.from(signature, "base64");
  for (const key of ["release", "backup"] as const) {
    if (verify(null, bytes, keys[key], signed)) return { ok: true, key };
  }
  return { ok: false, reason: "the Tavora signature does not match this version, file and SHA-512 under either pinned key" };
}

/** What the updater says it downloaded: the parsed latest.yml plus the downloaded file's path (electron-updater's update-downloaded event). */
export interface DownloadedUpdate {
  version?: unknown;
  downloadedFile?: unknown;
  /** Unsigned feed fields that change how the installer runs; Tavora's feed never has them. */
  files?: unknown;
  packages?: unknown;
  isAdminRightsRequired?: unknown;
  [UPDATE_SIGNATURE_FIELD]?: unknown;
}

/** The file's name without its folder, for Windows and POSIX paths alike. */
function baseName(file: string): string {
  return file.split(/[\\/]/).pop() ?? "";
}

/**
 * Whether a downloaded update may be installed: the signature in latest.yml must cover the version the updater is
 * about to install, the name of the file it saved and the SHA-512 of the bytes in that file (`sha512`, worked out from
 * the file itself, never read from latest.yml), under a pinned key; and the version must be newer than this one.
 */
export function checkUpdate(update: DownloadedUpdate, sha512: string, pinned: unknown, currentVersion: string): UpdateCheck {
  const keys = readPinnedUpdateKeys(pinned);
  if (!keys.ok) return { ok: false, reason: keys.problem };
  if (typeof update.downloadedFile !== "string" || update.downloadedFile === "") return { ok: false, reason: "the updater named no downloaded file" };
  // The signature doesn't cover these, and Tavora (installed per user, one full installer) never needs them: a feed
  // that asks to run the installer as admin or to fetch an extra package is refused.
  const files = Array.isArray(update.files) ? update.files : [];
  if (update.isAdminRightsRequired || files.some((file) => typeof file === "object" && file !== null && (file as { isAdminRightsRequired?: unknown }).isAdminRightsRequired)) {
    return { ok: false, reason: "the feed asks to install with admin rights" };
  }
  if (update.packages !== undefined && update.packages !== null) return { ok: false, reason: "the feed names an extra package to download" };
  const fields = { version: update.version, file: baseName(update.downloadedFile), sha512 };
  const signed = verifyUpdateSignature(fields, update[UPDATE_SIGNATURE_FIELD], keys.keys);
  if (!signed.ok) return signed;
  // Only a strictly newer plain x.y.z passes: a malformed version on either side is null, never "newer".
  if (comparePlainVersions(fields.version, currentVersion) !== 1) {
    return { ok: false, reason: `${String(fields.version)} is not newer than this version (${currentVersion})` };
  }
  return signed;
}

/** SHA-512 of a file, base64, read as a stream. */
export function sha512OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("base64")));
  });
}

/** checkUpdate for the file the updater saved: hashes it first. A file that can't be read is refused. */
export async function checkDownloadedUpdate(update: DownloadedUpdate, pinned: unknown, currentVersion: string): Promise<UpdateCheck> {
  if (typeof update.downloadedFile !== "string" || update.downloadedFile === "") return { ok: false, reason: "the updater named no downloaded file" };
  let sha512: string;
  try {
    sha512 = await sha512OfFile(update.downloadedFile);
  } catch (error) {
    return { ok: false, reason: `the downloaded file can't be read (${error instanceof Error ? error.message : String(error)})` };
  }
  return checkUpdate(update, sha512, pinned, currentVersion);
}
