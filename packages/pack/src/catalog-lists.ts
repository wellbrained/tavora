// Lists signed by Tavora's catalogue key (catalog threat model, C2, C6, C7,
// C14). The key stays offline on a PC and signs with the tavora-catalog-sign
// script; the service only serves the signed files, and the app checks them
// against the catalogue public key built into it. Each file holds the list as
// a JSON string and an Ed25519 signature over exactly those bytes, so nothing
// depends on how JSON is written out.
import { sign, verify, type KeyObject } from "node:crypto";
import { publicKeyFromRaw, rawPublicKey } from "./signature.ts";

const FORMAT = "tavora-catalog-list-1";
/** Bigger files are not read. */
export const MAX_CATALOG_LIST_BYTES = 1024 * 1024;
const MAX_ENTRIES = 10_000;
const FINGERPRINT = /^[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export const CATALOG_LIST_KINDS = ["revocations", "blocks", "successions"] as const;
export type CatalogListKind = (typeof CATALOG_LIST_KINDS)[number];

/** A publisher key that no longer signs, and the zips (SHA-256) it signed that stay accepted (C6). */
export interface Revocation {
  fingerprint: string;
  /** When the account revoked it. */
  revoked: string;
  allow: string[];
}

/** A zip (SHA-256) that Tavora stopped, and why, in words a user can read (C14). */
export interface Block {
  sha256: string;
  reason: string;
}

/** The account's new key replaces its lost one; data stays with the first key (C7). */
export interface Succession {
  old: string;
  new: string;
  account: string;
}

interface Head {
  /** Goes up by one with every list of this kind; an older list is ignored. */
  sequence: number;
  /** When it was signed. */
  issued: string;
}
export interface RevocationList extends Head {
  kind: "revocations";
  revoked: Revocation[];
}
export interface BlockList extends Head {
  kind: "blocks";
  blocked: Block[];
}
export interface SuccessionList extends Head {
  kind: "successions";
  successions: Succession[];
}
export type CatalogList = RevocationList | BlockList | SuccessionList;
export type CatalogListOf<K extends CatalogListKind> = Extract<CatalogList, { kind: K }>;

const ENTRIES = { revocations: "revoked", blocks: "blocked", successions: "successions" } as const;

/** Plain text of one line: no control or direction characters. */
function isPlain(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\p{Cc}‎‏‪-‮⁦-⁩]/u.test(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(value));
}

function hasKeys(value: unknown, keys: string): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join() === keys;
}

function isEntry(kind: CatalogListKind, entry: unknown): boolean {
  if (kind === "revocations") {
    return (
      hasKeys(entry, "allow,fingerprint,revoked") &&
      FINGERPRINT.test(String(entry.fingerprint)) &&
      isDate(entry.revoked) &&
      Array.isArray(entry.allow) &&
      entry.allow.length <= MAX_ENTRIES &&
      entry.allow.every((hash) => typeof hash === "string" && SHA256.test(hash))
    );
  }
  if (kind === "blocks") return hasKeys(entry, "reason,sha256") && SHA256.test(String(entry.sha256)) && isPlain(entry.reason, 300);
  return hasKeys(entry, "account,new,old") && FINGERPRINT.test(String(entry.old)) && FINGERPRINT.test(String(entry.new)) && entry.old !== entry.new && isPlain(entry.account, 100);
}

/** Whether a value is a list of this kind, exactly in the format above. */
export function isCatalogList<K extends CatalogListKind>(kind: K, value: unknown): value is CatalogListOf<K> {
  const field = ENTRIES[kind];
  if (!hasKeys(value, ["issued", "kind", "sequence", field].sort().join())) return false;
  if (value.kind !== kind || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 || !isDate(value.issued)) return false;
  const entries = value[field];
  return Array.isArray(entries) && entries.length <= MAX_ENTRIES && entries.every((entry) => isEntry(kind, entry));
}

/** The signed file for a list, as text. Throws when the list is not in the format. */
export function signCatalogList(list: CatalogList, privateKey: KeyObject): string {
  if (!isCatalogList(list.kind, list)) throw new Error(`not a valid ${(list as CatalogList).kind} list`);
  const payload = JSON.stringify(list);
  const signature = sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");
  const text = `${JSON.stringify({ format: FORMAT, payload, signature }, null, 2)}\n`;
  if (Buffer.byteLength(text) > MAX_CATALOG_LIST_BYTES) throw new Error(`the ${list.kind} list is bigger than ${MAX_CATALOG_LIST_BYTES} bytes`);
  return text;
}

/**
 * The list in a signed file, or null unless it is a list of this kind signed
 * by this catalogue key (its raw public half, base64). A list signed by any
 * other key is ignored, whatever it says (C2).
 */
export function readCatalogList<K extends CatalogListKind>(kind: K, text: string, catalogueKey: string): CatalogListOf<K> | null {
  const publicKey = publicKeyFromRaw(catalogueKey);
  if (!publicKey || Buffer.byteLength(text) > MAX_CATALOG_LIST_BYTES) return null;
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  if (!hasKeys(file, "format,payload,signature") || file.format !== FORMAT || typeof file.payload !== "string" || typeof file.signature !== "string") return null;
  const signature = Buffer.from(file.signature, "base64");
  if (signature.length !== 64 || !verify(null, Buffer.from(file.payload, "utf8"), publicKey, signature)) return null;
  let list: unknown;
  try {
    list = JSON.parse(file.payload);
  } catch {
    return null;
  }
  return isCatalogList(kind, list) ? list : null;
}

/** Whether `next` may replace `held`: a higher sequence number, and not issued before it. */
export function isNewerCatalogList(next: CatalogList, held: CatalogList | null): boolean {
  return held === null || (next.sequence > held.sequence && Date.parse(next.issued) >= Date.parse(held.issued));
}

/** The catalogue public key to build into the app: the raw public half, base64. */
export function catalogPublicKey(key: KeyObject): string {
  return rawPublicKey(key).toString("base64");
}

/**
 * The next list of a kind: these entries, the sequence number after the
 * previous list's (1 for the first), issued now. Throws when the entries are
 * not in the format, so a typo is never signed.
 */
export function nextCatalogList<K extends CatalogListKind>(kind: K, entries: unknown, previous: CatalogListOf<K> | null, now: Date): CatalogListOf<K> {
  const issued = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const list = { kind, sequence: (previous?.sequence ?? 0) + 1, issued, [ENTRIES[kind]]: entries };
  if (!isCatalogList(kind, list)) throw new Error(`the entries are not a valid ${kind} list; see the format in scripts/catalog-sign.ts`);
  if (previous && !isNewerCatalogList(list, previous)) throw new Error(`the previous ${kind} list was issued after ${issued}; check this PC's clock`);
  return list;
}
