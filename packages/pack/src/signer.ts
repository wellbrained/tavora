// Who signs for the pack command: a key file. Developers publish from Tavora itself (Settings >
// Development), which keeps their publisher keys; the pack command is for CI, with a key exported from
// Tavora (decided 2026-10-21, "easier module publishing").
import { sign, type KeyObject } from "node:crypto";
import { PUBLISH_STATEMENT } from "./publish.ts";
import { fingerprint, rawPublicKey, signedBytes } from "./signature.ts";

export interface Signer {
  /** The raw 32-byte Ed25519 public key, base64. */
  publicKey: string;
  /** The key's owner id, as players see it. */
  fingerprint: string;
  /** The signature over a package's file hashes. `manifest` is the package's tavora.module.json. */
  signPackage(files: Record<string, string>, manifest: Buffer): Promise<Buffer>;
  /** The signature that lets the catalog list this zip (PUBLISH_STATEMENT and its SHA-256). */
  signPublish(zip: Buffer, sha256: string): Promise<Buffer>;
}

function isSigner(value: KeyObject | Signer): value is Signer {
  return typeof (value as Signer).signPackage === "function";
}

/** A key as a signer; a signer as it is. */
export function asSigner(key: KeyObject | Signer): Signer {
  return isSigner(key) ? key : keySigner(key);
}

/** Signing with a key in this process. */
export function keySigner(key: KeyObject): Signer {
  const publicKey = rawPublicKey(key).toString("base64");
  return {
    publicKey,
    fingerprint: fingerprint(key),
    signPackage: async (files) => sign(null, signedBytes(publicKey, files), key),
    signPublish: async (_zip, sha256) => sign(null, Buffer.from(`${PUBLISH_STATEMENT}\n${sha256}`, "utf8"), key),
  };
}
