import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

// The cloud copy's encryption (decided 2026-10-19): only the user can read
// the copy. A random 256-bit copy key (since 2026-10-20 the account's root key,
// account-key.ts) is made on the PC and never leaves it except as the recovery
// key the user keeps.
// Everything sent is sealed with AES-256-GCM under a key derived from it; each
// part is named by an HMAC of its content under a second derived key, so equal
// content is stored once and the service cannot tell which file a part is.

export const COPY_KEY_BYTES = 32;
export const PART_ID_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** Bound into every seal, so a sealed thing from another purpose or version never opens as a copy. */
const AAD = Buffer.from("tavora-copy-1");

export interface CopyKeys {
  seal: Buffer;
  id: Buffer;
}

export const newCopyKey = (): Buffer => randomBytes(COPY_KEY_BYTES);

export function copyKeys(copyKey: Uint8Array): CopyKeys {
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", copyKey, Buffer.alloc(0), info, 32));
  return { seal: derive("tavora-copy-seal"), id: derive("tavora-copy-part-id") };
}

/** A part's name: the HMAC of its plain content, so it says nothing to anyone without the key. */
export const partId = (keys: CopyKeys, plain: Uint8Array): Buffer => createHmac("sha256", keys.id).update(plain).digest();

/** Compressed when that helps (settings and documents do, pictures don't), then sealed: nonce, ciphertext, tag. */
export function seal(keys: CopyKeys, plain: Uint8Array): Buffer {
  return sealWith(keys.seal, AAD, plain);
}

/** The plain content back; throws for anything not sealed with this key, or changed since. */
export function open(keys: CopyKeys, sealed: Uint8Array): Buffer {
  return openWith(keys.seal, AAD, sealed);
}

// The key vault (account-key.ts) is sealed the same way, under its own key derived from the same root
// key and with its own bound purpose, so a part of the copy never opens as a vault, nor the other way.
const VAULT_AAD = Buffer.from("tavora-vault-1");
const vaultKey = (rootKey: Uint8Array) => Buffer.from(hkdfSync("sha256", rootKey, Buffer.alloc(0), "tavora-vault-seal", 32));

export const sealVault = (rootKey: Uint8Array, plain: Uint8Array): Buffer => sealWith(vaultKey(rootKey), VAULT_AAD, plain);
export const openVault = (rootKey: Uint8Array, sealed: Uint8Array): Buffer => openWith(vaultKey(rootKey), VAULT_AAD, sealed);

// Approving a new PC from an old one (pairing.ts): each side makes a one-time X25519 key. The old PC seals
// the root key under a key both derive from the two one-time keys, and both show a short code made from
// them, so the user sees that nobody swapped one on the way.
const PAIRING_AAD = Buffer.from("tavora-pair-1");
/** What comes before a raw X25519 public key in its DER form. */
const X25519_SPKI = Buffer.from("302a300506032b656e032100", "hex");

export interface PairingKey {
  privateKey: KeyObject;
  /** The raw 32 bytes, as sent. */
  publicKey: Buffer;
}

export function newPairingKey(): PairingKey {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return { privateKey, publicKey: publicKey.export({ format: "der", type: "spki" }).subarray(X25519_SPKI.length) };
}

/** What the new PC sends first: a hash of its one-time key, so it can't pick the key after seeing the old PC's. */
export const pairingCommit = (newPc: Uint8Array): Buffer => createHash("sha256").update("tavora-pair-commit").update(newPc).digest();

/** The code both screens show: 6 characters from both one-time keys, "XXX-XXX". */
export function pairingCode(newPc: Uint8Array, oldPc: Uint8Array): string {
  const text = base32(createHash("sha256").update("tavora-pair-code").update(newPc).update(oldPc).digest().subarray(0, 4)).slice(0, 6);
  return `${text.slice(0, 3)}-${text.slice(3)}`;
}

function pairingSealKey(own: KeyObject, theirs: Uint8Array, newPc: Uint8Array, oldPc: Uint8Array): Buffer {
  if (theirs.length !== 32) throw new Error("not a one-time key");
  const shared = diffieHellman({ privateKey: own, publicKey: createPublicKey({ key: Buffer.concat([X25519_SPKI, theirs]), format: "der", type: "spki" }) });
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([newPc, oldPc]), "tavora-pair-seal", 32));
}

/** On the old PC: the root key, sealed for the new PC. */
export function sealForPc(own: PairingKey, newPc: Uint8Array, rootKey: Uint8Array): Buffer {
  return sealWith(pairingSealKey(own.privateKey, newPc, newPc, own.publicKey), PAIRING_AAD, rootKey);
}

/** On the new PC: the root key back; throws for anything else. */
export function openFromPc(own: PairingKey, oldPc: Uint8Array, sealed: Uint8Array): Buffer {
  const key = openWith(pairingSealKey(own.privateKey, oldPc, own.publicKey, oldPc), PAIRING_AAD, sealed);
  if (key.length !== COPY_KEY_BYTES) throw new Error("not a key");
  return key;
}

function sealWith(key: Buffer, aad: Buffer, plain: Uint8Array): Buffer {
  const packed = deflateRawSync(plain);
  const body = packed.length < plain.length ? Buffer.concat([Buffer.from([1]), packed]) : Buffer.concat([Buffer.from([0]), plain]);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce).setAAD(aad);
  return Buffer.concat([nonce, cipher.update(body), cipher.final(), cipher.getAuthTag()]);
}

function openWith(key: Buffer, aad: Buffer, sealed: Uint8Array): Buffer {
  if (sealed.length < NONCE_BYTES + TAG_BYTES + 1) throw new Error("not a sealed part");
  const data = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, NONCE_BYTES)).setAAD(aad);
  decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
  const body = Buffer.concat([decipher.update(data.subarray(NONCE_BYTES, data.length - TAG_BYTES)), decipher.final()]);
  if (body[0] === 0) return body.subarray(1);
  if (body[0] === 1) return inflateRawSync(body.subarray(1));
  throw new Error("unknown part format");
}

// The recovery key: the copy key in Crockford's base 32 (no I, L, O or U, so it reads and types cleanly),
// with two check characters, in groups of four: 54 characters, "XXXX-XXXX-…".
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

const checkOf = (copyKey: Uint8Array) => base32(createHash("sha256").update("tavora-recovery-key").update(copyKey).digest().subarray(0, 2)).slice(0, 2);

export function recoveryKey(copyKey: Uint8Array): string {
  const text = base32(copyKey) + checkOf(copyKey);
  return text.match(/.{1,4}/g)!.join("-");
}

/**
 * The copy key from what the user typed, or null when it isn't one. Spaces, dashes and case don't
 * matter, and the letters people mix up are read as the digits they look like (O as 0, I and L as 1).
 */
export function parseRecoveryKey(text: string): Buffer | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  const digits = Math.ceil((COPY_KEY_BYTES * 8) / 5);
  if (clean.length !== digits + 2 || [...clean].some((char) => !ALPHABET.includes(char))) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean.slice(0, digits)) {
    value = ((value << 5) | ALPHABET.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const copyKey = Buffer.from(out.slice(0, COPY_KEY_BYTES));
  return copyKey.length === COPY_KEY_BYTES && checkOf(copyKey) === clean.slice(digits) ? copyKey : null;
}
