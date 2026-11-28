// Tavora's own signature on app updates (CoreHub #476, decided 2026-11-10). The update feed alone is not trusted:
// `pnpm release` signs every release offline on the maintainer's PC with the update key (scripts/update-key.mjs),
// the signature goes into latest.yml as one more field, and the app installs a downloaded update only when that
// signature covers exactly the version it is installing, the installer's file name and the SHA-512 of the bytes it
// downloaded, made by one of the two keys pinned in update-keys.ts.
//
// Used by the main process (updates.ts, host.ts) and by Node scripts (release.mjs, update-key.mjs, update-check.mjs),
// so it imports nothing but Node's own modules and the dependency-free shared/plain-version.ts.
import { createHash, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { closeSync, createReadStream, openSync, readSync } from "node:fs";
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

/**
 * `feed`: what the feed's second signature said for the downloaded file, when checkDownloadedUpdate was asked to check it.
 * `installer`: the file checkDownloadedUpdate hashed and its SHA-512, so the update manager can hash it again right before
 * it runs (audit L6).
 */
export type UpdateCheck = { ok: true; key: UpdateKeyName; feed?: FeedFreshness; installer?: { file: string; sha512: string } } | { ok: false; reason: string };

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

// --- The second signature (docs: the vault's update-signature-binding.md, Option A) -------------------------------
//
// `tavoraSignature2` binds what v1 can't: the channel the feed is for, the platform, when the release key vouched for
// the feed (issuedAt) and until when (expiresAt). It sits in latest.yml next to v1, which stays byte for byte as it is:
// apps from 0.24.105 on rebuild the v1 bytes themselves and ignore keys they don't name, so the new line is invisible
// to them. The feed line is one single-quoted string, so YAML reads it as text (an unquoted time would become a Date):
//   tavoraSignature2: '<channel> <platform> <issuedAt> <expiresAt> <signature>'
// over
//   tavora-update-v2\n<version>\n<file>\n<sha512>\n<channel>\n<platform>\n<issuedAt>\n<expiresAt>

/** The first line of what the second signature covers. */
export const UPDATE_SIGNATURE2_FORMAT = "tavora-update-v2";
/** The field in latest.yml that carries it. */
export const UPDATE_SIGNATURE2_FIELD = "tavoraSignature2";
/** The channels a feed can be for: latest.yml is `stable`; a preview channel would get a feed (and a v2 line) of its own. */
export const UPDATE_CHANNELS = ["stable", "preview"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];
/** The platforms an installer can be for. */
export const UPDATE_PLATFORMS = ["win-x64"] as const;
export type UpdatePlatform = (typeof UPDATE_PLATFORMS)[number];
/** How long a release or a refresh vouches for the feed (Nik, 2026-11-24). */
export const FEED_FRESH_DAYS = 30;
/** The longest a signed statement may vouch for the feed: anything longer is refused, whoever signed it. */
export const FEED_MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the second signature covers on top of v1's fields. */
export interface FeedStatement {
  channel: UpdateChannel;
  platform: UpdatePlatform;
  /** UTC, `YYYY-MM-DDTHH:MM:SSZ`. */
  issuedAt: string;
  /** Same form; later than issuedAt, by at most FEED_MAX_DAYS. */
  expiresAt: string;
}

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** The signature2 value exactly: channel, platform, two times and 64 bytes of canonical base64. */
const SIGNATURE2_VALUE = /^([a-z]+) ([a-z0-9-]+) (\S+) (\S+) ([A-Za-z0-9+/]{85}[AQgw]==)$/;

/** A time in the one form the signature uses (UTC, whole seconds, `Z`), from a Date. */
export function feedTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Whether `value` is a real UTC time written the one way feedTime writes it (so 2026-02-30 is not). */
function isFeedTime(value: unknown): value is string {
  return typeof value === "string" && TIME.test(value) && !Number.isNaN(Date.parse(value)) && feedTime(new Date(value)) === value;
}

/** Why these fields can't be signed or checked as a v2 statement, or null. */
export function statementProblem(statement: { channel: unknown; platform: unknown; issuedAt: unknown; expiresAt: unknown }): string | null {
  if (!UPDATE_CHANNELS.includes(statement.channel as UpdateChannel)) return `the channel is not one of ${UPDATE_CHANNELS.join(", ")}`;
  if (!UPDATE_PLATFORMS.includes(statement.platform as UpdatePlatform)) return `the platform is not one of ${UPDATE_PLATFORMS.join(", ")}`;
  if (!isFeedTime(statement.issuedAt)) return "the issue time is not a UTC time like 2026-11-24T10:00:00Z";
  if (!isFeedTime(statement.expiresAt)) return "the expiry is not a UTC time like 2026-12-24T10:00:00Z";
  const span = Date.parse(statement.expiresAt) - Date.parse(statement.issuedAt);
  if (span <= 0) return "the expiry is not after the issue time";
  if (span > FEED_MAX_DAYS * DAY_MS) return `the expiry is more than ${FEED_MAX_DAYS} days after the issue time`;
  return null;
}

/** Exactly what the second signature covers. Throws on fields that can't be signed. */
export function signedUpdate2Bytes(update: SignedUpdate & FeedStatement): Buffer {
  const problem = updateProblem(update) ?? statementProblem(update);
  if (problem) throw new Error(`can't sign this update: ${problem}`);
  const lines = [UPDATE_SIGNATURE2_FORMAT, update.version, update.file, update.sha512, update.channel, update.platform, update.issuedAt, update.expiresAt];
  return Buffer.from(lines.join("\n"), "utf8");
}

/** The statement and its signature as the one value of the feed's tavoraSignature2 line (without the quotes). */
export function signUpdate2(update: SignedUpdate & FeedStatement, privateKey: KeyObject): string {
  if (privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") throw new Error("the update key must be an Ed25519 private key");
  const signature = sign(null, signedUpdate2Bytes(update), privateKey).toString("base64");
  return [update.channel, update.platform, update.issuedAt, update.expiresAt, signature].join(" ");
}

/** The statement and signature in a tavoraSignature2 value, or why it is not one. A YAML Date or number is not. */
export function readSignature2(value: unknown): { ok: true; statement: FeedStatement; signature: string } | { ok: false; reason: string } {
  if (value === undefined || value === null || value === "") return { ok: false, reason: "latest.yml has no second Tavora signature" };
  if (typeof value !== "string") return { ok: false, reason: "the second Tavora signature is not text" };
  const match = SIGNATURE2_VALUE.exec(value);
  if (!match) return { ok: false, reason: "the second Tavora signature is not channel, platform, issue time, expiry and 64 bytes of base64" };
  const [, channel, platform, issuedAt, expiresAt, signature] = match;
  const statement = { channel, platform, issuedAt, expiresAt };
  const problem = statementProblem(statement);
  if (problem) return { ok: false, reason: problem };
  if (!isBase64Of(signature, 64)) return { ok: false, reason: "the second Tavora signature is not 64 bytes of base64" };
  return { ok: true, statement: statement as FeedStatement, signature };
}

export type Signature2Check = { ok: true; key: UpdateKeyName; statement: FeedStatement } | { ok: false; reason: string };

/** Which pinned key signed this tavoraSignature2 value for these fields, and what it says; or why it does not hold. */
export function verifyUpdateSignature2(update: { version: unknown; file: unknown; sha512: unknown }, value: unknown, keys: PinnedUpdateKeys): Signature2Check {
  const problem = updateProblem(update);
  if (problem) return { ok: false, reason: problem };
  const read = readSignature2(value);
  if (!read.ok) return read;
  const bytes = signedUpdate2Bytes({ ...(update as SignedUpdate), ...read.statement });
  const signed = Buffer.from(read.signature, "base64");
  for (const key of ["release", "backup"] as const) {
    if (verify(null, bytes, keys[key], signed)) return { ok: true, key, statement: read.statement };
  }
  return { ok: false, reason: "the second Tavora signature does not match this version, file, SHA-512 and statement under either pinned key" };
}

/**
 * How far this PC's clock may be off before a feed's times count against it: the expiry counts only this long after
 * it passed, and a clock this far behind the issue time can't tell whether the feed expired at all.
 */
export const FEED_CLOCK_LEEWAY_MS = DAY_MS;

/**
 * What a feed's second signature says about it, for this app:
 * - `fresh`: a pinned key vouched for it, for this channel and platform, not older than any statement this Tavora saw,
 *   and its expiry hasn't passed (give or take FEED_CLOCK_LEEWAY_MS).
 * - `expired`: all that, but the expiry passed more than FEED_CLOCK_LEEWAY_MS ago: the feed may be held back. Soft:
 *   a newer signed version still installs; Tavora only can't confirm it is up to date.
 * - `clock-behind`: all that, but this PC's clock is more than FEED_CLOCK_LEEWAY_MS before the issue time, so whether
 *   the feed expired can't be told. Counts as fresh.
 * - `refused`: no second signature, a broken one, one for another channel or platform, or one issued before the newest
 *   statement this Tavora has seen (a replay).
 */
export type FeedFreshness =
  | { status: "fresh" | "expired" | "clock-behind"; key: UpdateKeyName; statement: FeedStatement }
  | { status: "refused"; reason: string };

/** What the freshness check expects: the pins, this app's channel and platform, the newest issue time it saw, now. */
export interface FeedExpectations {
  pinned: unknown;
  channel: UpdateChannel;
  platform: string;
  /** The newest issuedAt this Tavora verified before, or null. */
  newestIssuedAt: string | null;
  now: Date;
}

/** Whether a feed's second signature holds for these fields and this app, and whether the feed is fresh. */
export function checkFeedFreshness(update: { version: unknown; file: unknown; sha512: unknown; signature2: unknown }, expect: FeedExpectations): FeedFreshness {
  const keys = readPinnedUpdateKeys(expect.pinned);
  if (!keys.ok) return { status: "refused", reason: keys.problem };
  const signed = verifyUpdateSignature2(update, update.signature2, keys.keys);
  if (!signed.ok) return { status: "refused", reason: signed.reason };
  const { statement, key } = signed;
  if (statement.channel !== expect.channel) return { status: "refused", reason: `the feed is for the ${statement.channel} channel, not ${expect.channel}` };
  if (statement.platform !== expect.platform) return { status: "refused", reason: `the feed is for ${statement.platform}, not ${expect.platform}` };
  // The replay check needs no clock: an older statement than one already verified is an old feed served again.
  if (expect.newestIssuedAt !== null && Date.parse(statement.issuedAt) < Date.parse(expect.newestIssuedAt)) {
    return { status: "refused", reason: `the feed was signed at ${statement.issuedAt}, before one this Tavora already saw (${expect.newestIssuedAt})` };
  }
  const now = expect.now.getTime();
  if (now < Date.parse(statement.issuedAt) - FEED_CLOCK_LEEWAY_MS) return { status: "clock-behind", key, statement };
  if (now > Date.parse(statement.expiresAt) + FEED_CLOCK_LEEWAY_MS) return { status: "expired", key, statement };
  return { status: "fresh", key, statement };
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

/** SHA-512 of a file, base64, read in 1 MiB parts without giving up the thread: for the hash right before the installer runs, also while Tavora quits. */
export function sha512OfFileSync(file: string): string {
  const hash = createHash("sha512");
  const part = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(file, "r");
  try {
    for (let read = readSync(fd, part, 0, part.length, null); read > 0; read = readSync(fd, part, 0, part.length, null)) hash.update(part.subarray(0, read));
  } finally {
    closeSync(fd);
  }
  return hash.digest("base64");
}

/**
 * checkUpdate for the file the updater saved: hashes it first. A file that can't be read is refused. `checkFeed`, when
 * given, also checks the feed's second signature for that file's name and hash once v1 passed; its outcome comes back
 * as `feed` and never changes `ok` here (the update manager decides what it means).
 */
export async function checkDownloadedUpdate(
  update: DownloadedUpdate,
  pinned: unknown,
  currentVersion: string,
  checkFeed?: (installer: { file: string; sha512: string }) => FeedFreshness,
): Promise<UpdateCheck> {
  if (typeof update.downloadedFile !== "string" || update.downloadedFile === "") return { ok: false, reason: "the updater named no downloaded file" };
  let sha512: string;
  try {
    sha512 = await sha512OfFile(update.downloadedFile);
  } catch (error) {
    return { ok: false, reason: `the downloaded file can't be read (${error instanceof Error ? error.message : String(error)})` };
  }
  const checked = checkUpdate(update, sha512, pinned, currentVersion);
  if (!checked.ok) return checked;
  const check = { ...checked, installer: { file: update.downloadedFile, sha512 } };
  if (!checkFeed) return check;
  let feed: FeedFreshness;
  try {
    feed = checkFeed({ file: baseName(update.downloadedFile), sha512 });
  } catch (error) {
    feed = { status: "refused", reason: `the feed check failed (${error instanceof Error ? error.message : String(error)})` };
  }
  return { ...check, feed };
}
