import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

// The cloud copy's encryption (decided 2026-10-19): only the player can read
// the copy. A random 256-bit copy key is made on the PC when the player turns
// the copy on and never leaves it except as the recovery key the player keeps.
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
  const packed = deflateRawSync(plain);
  const body = packed.length < plain.length ? Buffer.concat([Buffer.from([1]), packed]) : Buffer.concat([Buffer.from([0]), plain]);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keys.seal, nonce).setAAD(AAD);
  return Buffer.concat([nonce, cipher.update(body), cipher.final(), cipher.getAuthTag()]);
}

/** The plain content back; throws for anything not sealed with this key, or changed since. */
export function open(keys: CopyKeys, sealed: Uint8Array): Buffer {
  if (sealed.length < NONCE_BYTES + TAG_BYTES + 1) throw new Error("not a sealed part");
  const data = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", keys.seal, data.subarray(0, NONCE_BYTES)).setAAD(AAD);
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
 * The copy key from what the player typed, or null when it isn't one. Spaces, dashes and case don't
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
