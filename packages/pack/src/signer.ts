// Who signs for the pack command: a key file, or Tavora itself (decided 2026-10-20, "one recovery key").
// Tavora keeps the developer's publisher keys in the account's sealed key vault and signs on request,
// over a local pipe only the same OS user can open, after the developer allowed that one request with a
// click in Tavora. The secret key never reaches this process then. A key file (--key) still works, for
// publishing from CI.
import { sign, type KeyObject } from "node:crypto";
import { connect } from "node:net";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { PUBLISH_STATEMENT } from "./publish.ts";
import { fingerprint, publicKeyFromRaw, rawPublicKey, signedBytes } from "./signature.ts";

export interface Signer {
  /** The raw 32-byte Ed25519 public key, base64. */
  publicKey: string;
  /** The key's owner id, as players see it. */
  fingerprint: string;
  /** The signature over a package's file hashes. `manifest` is the package's tavora.module.json, so Tavora can show what it signs. */
  signPackage(files: Record<string, string>, manifest: Buffer): Promise<Buffer>;
  /** The signature that lets the catalog list this zip (PUBLISH_STATEMENT and its SHA-256). */
  signPublish(zip: Buffer, sha256: string): Promise<Buffer>;
}

export class SignerError extends Error {}

function isSigner(value: KeyObject | Signer): value is Signer {
  return typeof (value as Signer).signPackage === "function";
}

/** A key as a signer; a signer as it is. */
export function asSigner(key: KeyObject | Signer): Signer {
  return isSigner(key) ? key : keySigner(key);
}

/** Signing with a key in this process: a key file. */
export function keySigner(key: KeyObject): Signer {
  const publicKey = rawPublicKey(key).toString("base64");
  return {
    publicKey,
    fingerprint: fingerprint(key),
    signPackage: async (files) => sign(null, signedBytes(publicKey, files), key),
    signPublish: async (_zip, sha256) => sign(null, Buffer.from(`${PUBLISH_STATEMENT}\n${sha256}`, "utf8"), key),
  };
}

// ── Tavora's signer ──────────────────────────────────────────────────

/**
 * Where Tavora listens: a named pipe on Windows (only this Windows user may write to it), else a socket in
 * ~/.tavora. TAVORA_SIGNER_ADDRESS points at another one, for testing against an unpackaged Tavora.
 */
export function signerAddress(): string {
  const test = process.env.TAVORA_SIGNER_ADDRESS;
  if (test) return test;
  return process.platform === "win32" ? `\\\\.\\pipe\\tavora-signer-${userInfo().username}` : path.join(homedir(), ".tavora", "signer.sock");
}

/** The most one request may hold: a 50 MB zip in base64 and its framing. */
export const MAX_SIGNER_MESSAGE = 72 * 1024 * 1024;

export type SignerRequest =
  | { v: 1; op: "keys" }
  | { v: 1; op: "sign-package"; publicKey: string; files: Record<string, string>; manifest: string }
  | { v: 1; op: "sign-publish"; zip: string };

export type SignerAnswer =
  | { ok: true; keys: { publicKey: string }[] }
  | { ok: true; signature: string }
  | { ok: false; reason: "no-recovery-key" | "signed-out" | "unknown-key" | "refused" | "busy" | "bad-request" | "failed" };

const REASONS: Record<string, string> = {
  "no-recovery-key": "Tavora on this PC doesn't have your recovery key yet. Type it in under Settings > Account, then try again.",
  "signed-out": "Sign in to Tavora, then try again.",
  "unknown-key": "Tavora doesn't keep this publisher key. Add it under Settings > Account > Module developer, or pass --key <file>.",
  refused: "Not signed: the request was turned down in Tavora.",
  busy: "Tavora is already asking about another request. Answer it there, then try again.",
  "bad-request": "Tavora could not read the request.",
  failed: "Tavora could not sign. Try again.",
};

/** One request to Tavora, one answer. Null when Tavora is not running on this PC. */
export async function askTavora(request: SignerRequest, address = signerAddress(), timeoutMs = 5 * 60_000): Promise<SignerAnswer | null> {
  return new Promise((resolve, reject) => {
    const socket = connect(address);
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error: Error | null, answer?: SignerAnswer | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(answer ?? null);
    };
    socket.setTimeout(timeoutMs, () => finish(new SignerError("Tavora didn't answer. Allow or turn down the request there, then try again.")));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) return finish(new SignerError("Tavora's answer was too long."));
      chunks.push(chunk);
    });
    socket.on("end", () => {
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")) as SignerAnswer);
      } catch {
        finish(new SignerError("Tavora's answer could not be read."));
      }
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") finish(null, null);
      else finish(new SignerError(`Tavora could not be reached: ${error.message}`));
    });
  });
}

function answerError(answer: SignerAnswer): SignerError {
  return new SignerError(!answer.ok ? (REASONS[answer.reason] ?? REASONS.failed!) : REASONS.failed!);
}

/**
 * Signing through Tavora, with one of the publisher keys it keeps: the one whose fingerprint starts with
 * `publisher`, or the only one. Null when Tavora is not running on this PC.
 */
export async function tavoraSigner(options: { publisher?: string; address?: string } = {}): Promise<Signer | null> {
  const address = options.address ?? signerAddress();
  const answer = await askTavora({ v: 1, op: "keys" }, address);
  if (!answer) return null;
  if (!answer.ok || !("keys" in answer)) throw answerError(answer);
  const keys = answer.keys.flatMap((key) => {
    const object = publicKeyFromRaw(key.publicKey);
    return object ? [{ publicKey: key.publicKey, fingerprint: fingerprint(object) }] : [];
  });
  const wanted = options.publisher?.toLowerCase();
  const matching = wanted ? keys.filter((key) => key.fingerprint.startsWith(wanted)) : keys;
  if (keys.length === 0) throw new SignerError("Tavora has no publisher key yet. Make one under Settings > Account > Module developer.");
  if (matching.length === 0) throw new SignerError(`Tavora keeps no publisher key starting with ${wanted}. It has: ${keys.map((key) => key.fingerprint).join(", ")}.`);
  if (matching.length > 1) throw new SignerError(`Tavora keeps more than one publisher key. Pick one with --publisher <fingerprint>: ${keys.map((key) => key.fingerprint).join(", ")}.`);
  const chosen = matching[0]!;
  const signature = async (request: SignerRequest) => {
    const signed = await askTavora(request, address);
    if (!signed) throw new SignerError("Tavora was closed. Open it and try again.");
    if (!signed.ok || !("signature" in signed)) throw answerError(signed);
    return Buffer.from(signed.signature, "base64");
  };
  return {
    ...chosen,
    signPackage: (files, manifest) => signature({ v: 1, op: "sign-package", publicKey: chosen.publicKey, files, manifest: manifest.toString("base64") }),
    signPublish: (zip) => signature({ v: 1, op: "sign-publish", zip: zip.toString("base64") }),
  };
}
