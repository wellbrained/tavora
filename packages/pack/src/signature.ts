// Publisher signatures for module zips (docs/decisions.md, publisher row of
// 2026-10-16). The publisher is an Ed25519 key; the owner of a module's data
// is the fingerprint of that key. The zip carries tavora.signature.json with
// the public key, a SHA-256 of every other file and a signature over them.
import { createHash, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { isOwnerId, LOCAL_OWNER } from "@tavora/module-schema";
import type { ZipFile } from "./zip.ts";

export const SIGNATURE_FILE = "tavora.signature.json";
const FORMAT = "tavora-signature-1";
// DER prefix of an Ed25519 public key in SubjectPublicKeyInfo form; the raw key follows.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

export interface PackageSignature {
  format: typeof FORMAT;
  /** The raw 32-byte Ed25519 public key, base64. */
  publicKey: string;
  /** SHA-256 (hex) of every file in the zip except this one. */
  files: Record<string, string>;
  /** Ed25519 signature (base64) over signedBytes(). */
  signature: string;
}

export type VerifyResult = { ok: true; owner: string; signed: boolean } | { ok: false; reason: string };

/** The owner id of a key (either half): the first 16 bytes of the SHA-256 of the raw public key, in hex. */
export function fingerprint(key: KeyObject): string {
  return createHash("sha256").update(rawPublicKey(key)).digest("hex").slice(0, 32);
}

function rawPublicKey(key: KeyObject): Buffer {
  const der = (key.type === "private" ? createPublicKey(key) : key).export({ format: "der", type: "spki" });
  if (der.length !== 44 || !der.subarray(0, 12).equals(ED25519_SPKI)) throw new Error("not an Ed25519 public key");
  return der.subarray(12);
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** What is signed: the format, the key and every file's hash in path order, as JSON. */
function signedBytes(publicKey: string, files: Record<string, string>): Buffer {
  const sorted = Object.keys(files)
    .sort()
    .map((name) => [name, files[name]]);
  return Buffer.from(JSON.stringify({ format: FORMAT, publicKey, files: sorted }), "utf8");
}

/** The tavora.signature.json for these files, signed with the publisher's private key. */
export function signFiles(files: readonly ZipFile[], privateKey: KeyObject): ZipFile {
  const publicKey = rawPublicKey(privateKey).toString("base64");
  const hashes: Record<string, string> = {};
  for (const file of files) {
    if (file.name === SIGNATURE_FILE) throw new Error(`${SIGNATURE_FILE} is made by the pack command`);
    hashes[file.name] = sha256(file.data);
  }
  const signature = sign(null, signedBytes(publicKey, hashes), privateKey).toString("base64");
  const body: PackageSignature = { format: FORMAT, publicKey, files: hashes, signature };
  return { name: SIGNATURE_FILE, data: Buffer.from(`${JSON.stringify(body, null, 2)}\n`, "utf8") };
}

/**
 * Who owns a package's data. A zip without a signature belongs to `local`,
 * like an unsigned folder. A signature must cover exactly the zip's other
 * files, each with its hash, or the zip is refused.
 */
export function verifyFiles(files: readonly ZipFile[]): VerifyResult {
  const signatureFile = files.find((file) => file.name === SIGNATURE_FILE);
  if (!signatureFile) return { ok: true, owner: LOCAL_OWNER, signed: false };
  let body: unknown;
  try {
    body = JSON.parse(signatureFile.data.toString("utf8"));
  } catch {
    return { ok: false, reason: "its signature file cannot be read" };
  }
  if (!isSignature(body)) return { ok: false, reason: "its signature file is not in a format this Tavora knows" };

  const raw = Buffer.from(body.publicKey, "base64");
  if (raw.length !== 32 || raw.toString("base64") !== body.publicKey) return { ok: false, reason: "its signature has no valid key" };
  const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: "der", type: "spki" });
  const signature = Buffer.from(body.signature, "base64");
  if (signature.length !== 64 || !verify(null, signedBytes(body.publicKey, body.files), publicKey, signature)) {
    return { ok: false, reason: "its signature does not match" };
  }

  const others = files.filter((file) => file !== signatureFile);
  const listed = Object.keys(body.files);
  if (listed.length !== others.length) return { ok: false, reason: "its files do not match what was signed" };
  for (const file of others) {
    if (!Object.hasOwn(body.files, file.name) || body.files[file.name] !== sha256(file.data)) {
      return { ok: false, reason: "its files do not match what was signed" };
    }
  }
  const owner = fingerprint(publicKey);
  if (!isOwnerId(owner)) return { ok: false, reason: "its signature has no valid key" };
  return { ok: true, owner, signed: true };
}

function isSignature(value: unknown): value is PackageSignature {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join() !== "files,format,publicKey,signature") return false;
  if (body.format !== FORMAT || typeof body.publicKey !== "string" || typeof body.signature !== "string") return false;
  const files = body.files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) return false;
  return Object.values(files).every((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash));
}
