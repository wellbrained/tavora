import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { statfsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AccountStore } from "./account-store.ts";
import { createRateLimiter, networkOf, type RateLimiter } from "./rate-limit.ts";
import { requireSignIn, tooMany, type SignedInEnv } from "./sign-in.ts";

/**
 * The cloud copy (decided 2026-10-19): one copy of a user's Tavora data per account, which only the
 * user can read. The PC encrypts everything before it leaves; the service sees opaque **parts** (named
 * by an id the PC derives with its own key, so equal content is stored once and nothing links an id to a
 * file) and an encrypted **manifest** that says which parts make up the copy. A new version replaces the
 * manifest only when the PC started from the current one, so a PC that missed an update never
 * overwrites newer work. The copies live in their own SQLite file, which the daily backup leaves out.
 */

/** The most a copy may hold: its manifest and the parts it uses. */
export const COPY_LIMIT = 100 * 1024 * 1024;
/** Parts stored while a new version is uploaded, before the old one's are dropped. */
export const STORED_LIMIT = 2 * COPY_LIMIT;
/** Parts of every account together (COPY_TOTAL_LIMIT_GB), so many accounts can't fill the server's disk. */
export const TOTAL_LIMIT = 20 * 1024 * 1024 * 1024;
/** Free space on the disk that new parts never take (COPY_FREE_FLOOR_GB): the accounts and the other stores share that disk. */
export const FREE_FLOOR = 2 * 1024 * 1024 * 1024;
/** An account this young (COPY_NEW_ACCOUNT_DAYS) draws from the new accounts' slice of the total. */
export const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000;
/** The share of the total that accounts younger than NEW_ACCOUNT_MS may hold together (COPY_NEW_ACCOUNT_SHARE). */
export const NEW_ACCOUNT_SHARE = 0.25;
/** Bytes one network (an IPv4 /24, an IPv6 /48) may add to the total a day (COPY_NETWORK_DAY_GB). */
export const NETWORK_DAY_LIMIT = 2 * 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Networks counted at once for NETWORK_DAY_LIMIT; past this the oldest go first. */
const MAX_NETWORKS = 100_000;
/** Parts no saved version uses are dropped once they are this old (sweep()): an upload that never got saved. */
export const UNUSED_PART_MS = 24 * 60 * 60 * 1000;
/** A copy without room sweeps at most this often before it refuses, so a full service doesn't sweep on every upload. */
const SWEEP_GAP_MS = 60_000;
/** One part: 4 MB of the user's data plus its encryption. */
export const MAX_PART_BYTES = 4 * 1024 * 1024 + 1024;
/** One upload or one download: about 8 MB of parts. */
export const BATCH_BYTES = 8 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
/** Parts one copy may use. */
export const MAX_PARTS = 50_000;
/** Parts one download may ask for. */
export const MAX_ASK = 2048;
const ID_BYTES = 32;
/** A request body: a batch with its framing, or a manifest with its part list. */
const MAX_BODY = BATCH_BYTES + 64 * 1024 + 1024 * 1024;

export interface CopyInfo {
  version: number;
  /** The manifest and the parts it uses, in bytes. */
  size: number;
  updatedAt: number;
}

export type SwapResult =
  | { ok: true; version: number; size: number }
  | { ok: false; reason: "copy-changed"; version: number }
  | { ok: false; reason: "missing-parts"; missing: number }
  | { ok: false; reason: "copy-full"; size: number }
  | { ok: false; reason: "unavailable" };

export interface CopyStoreOptions {
  /** Bytes of parts all accounts may store together; TOTAL_LIMIT by default. */
  totalLimit?: number;
  /** Free bytes on the disk the copies are on; null when it can't be read. Absent: not checked. */
  freeBytes?: () => number | null;
  /** Free bytes new parts leave on that disk; FREE_FLOOR by default. */
  freeFloor?: number;
  /** How young an account draws from the new accounts' slice (ms); NEW_ACCOUNT_MS by default, 0 turns the slice off. */
  newAccountMs?: number;
  /** The share of the total (0 to 1) that young accounts may hold together; NEW_ACCOUNT_SHARE by default. */
  newAccountShare?: number;
  /** Bytes one network may add to the total a day; NETWORK_DAY_LIMIT by default, 0 turns the check off. */
  networkDayLimit?: number;
}

/** Who adds bytes, for the shares of the total: when their account was made (ms) and their network. Absent: an account of long ago, on no network. */
export interface CopyHolder {
  since: number;
  network?: string;
}

const GIB = 1024 * 1024 * 1024;

/**
 * The limits from the environment: COPY_TOTAL_LIMIT_GB (20 by default), COPY_FREE_FLOOR_GB (2 by default, 0 turns the
 * free-space check off) and COPY_NETWORK_DAY_GB (2 by default, 0 turns it off), in GiB, fractions allowed;
 * COPY_NEW_ACCOUNT_DAYS (7 by default, 0 turns the slice off) and COPY_NEW_ACCOUNT_SHARE (0.25 by default, 0 to 1). A
 * value that is not a number in its range keeps the default. The free space is read from the disk that holds `dir`.
 */
export function copyLimitsFromEnv(env: Record<string, string | undefined>, dir: string, warn: (message: string) => void = console.warn): Required<CopyStoreOptions> {
  const number = (name: string, fallback: number, scale: number, max = Number.POSITIVE_INFINITY, unit = "GiB") => {
    const text = env[name]?.trim();
    if (!text) return fallback;
    const value = Number(text);
    if (Number.isFinite(value) && value >= 0 && value <= max) return scale === 1 ? value : Math.floor(value * scale);
    warn(`[tavora-api] ${name} is not a number of ${unit}; using ${fallback / scale}.`);
    return fallback;
  };
  const gib = (name: string, fallback: number) => number(name, fallback, GIB);
  return {
    totalLimit: gib("COPY_TOTAL_LIMIT_GB", TOTAL_LIMIT),
    freeFloor: gib("COPY_FREE_FLOOR_GB", FREE_FLOOR),
    networkDayLimit: gib("COPY_NETWORK_DAY_GB", NETWORK_DAY_LIMIT),
    newAccountMs: number("COPY_NEW_ACCOUNT_DAYS", NEW_ACCOUNT_MS, DAY_MS, Number.POSITIVE_INFINITY, "days"),
    newAccountShare: number("COPY_NEW_ACCOUNT_SHARE", NEW_ACCOUNT_SHARE, 1, 1, "0 to 1"),
    freeBytes: () => {
      try {
        const disk = statfsSync(dir);
        return disk.bavail * disk.bsize;
      } catch {
        return null;
      }
    },
  };
}

/** Why parts were not stored: this account's copy is full, or the copies of all accounts have no room. */
export type AddPartsResult = "ok" | "copy-full" | "no-room";

export class CopyStore {
  private readonly db: DatabaseSync;
  private readonly totalLimit: number;
  private readonly freeBytes: (() => number | null) | undefined;
  private readonly freeFloor: number;
  private readonly newAccountMs: number;
  private readonly newAccountShare: number;
  private readonly networkDayLimit: number;
  /** Bytes of parts and manifests of every account, counted once at the start and kept up to date by every change. */
  private total: number;
  /** Bytes each network added to the total in its current day: in memory only, like the rate limits. */
  private readonly networkBytes = new Map<string, { bytes: number; resetAt: number }>();
  private warned = false;
  private lastSweep = Number.NEGATIVE_INFINITY;

  constructor(
    path: string,
    { totalLimit = TOTAL_LIMIT, freeBytes, freeFloor = FREE_FLOOR, newAccountMs = NEW_ACCOUNT_MS, newAccountShare = NEW_ACCOUNT_SHARE, networkDayLimit = NETWORK_DAY_LIMIT }: CopyStoreOptions = {},
  ) {
    this.totalLimit = totalLimit;
    this.freeBytes = freeBytes;
    this.freeFloor = freeFloor;
    this.newAccountMs = newAccountMs;
    this.newAccountShare = newAccountShare;
    this.networkDayLimit = networkDayLimit;
    this.db = new DatabaseSync(path);
    // Freed pages go back to the disk after a version or a copy is dropped (set before the first table).
    this.db.exec("pragma auto_vacuum = incremental");
    this.db.exec(`
      create table if not exists copies (
        account_id text primary key, version integer not null, manifest blob not null, size integer not null, updated_at integer not null
      );
      create table if not exists retired (account_id text primary key, version integer not null);
      create table if not exists parts (
        account_id text not null, id blob not null, data blob not null, size integer not null, primary key (account_id, id)
      ) without rowid;
    `);
    // When a part was stored, so one no saved version uses can go after a while (sweep()); null for parts from before it.
    const columns = (this.db.prepare("pragma table_info(parts)").all() as unknown as { name: string }[]).map((column) => column.name);
    if (!columns.includes("created_at")) this.db.exec("alter table parts add column created_at integer");
    // The sizes and times on their own, so adding them up and finding unused parts never reads the parts' bytes. Building it
    // reads copies.sqlite once, at the first start with it.
    this.db.exec("drop index if exists parts_size");
    this.db.exec("create index if not exists parts_meta on parts (account_id, created_at, size)");
    // When each account that stored something was made, so young accounts' bytes can be added up (NEW_ACCOUNT_MS). Accounts
    // from before it have no row and count as old; an older service leaves it alone.
    this.db.exec("create table if not exists holders (account_id text primary key, since integer not null)");
    this.db.exec("create index if not exists holders_since on holders (since)");
    const parts = (this.db.prepare("select coalesce(sum(size), 0) as total from parts").get() as { total: number }).total;
    const manifests = (this.db.prepare("select coalesce(sum(length(manifest)), 0) as total from copies").get() as { total: number }).total;
    this.total = parts + manifests;
  }

  /** Bytes of parts and manifests of every account. */
  storedTotal(): number {
    return this.total;
  }

  /** The accounts storing the most parts, used by a version or not, most first. */
  biggest(limit: number): { accountId: string; stored: number }[] {
    return (this.db.prepare("select account_id as accountId, sum(size) as stored from parts group by account_id order by stored desc, account_id limit ?").all(limit) as unknown as {
      accountId: string;
      stored: number;
    }[]).map((row) => ({ ...row }));
  }

  /**
   * Whether `adding` more bytes fit: they always leave the disk's free space, and the `pooled` part of them (what is not
   * the account's own next version, replacing()) stays within the total, within the young accounts' slice of it for a young
   * account, and within its network's bytes for the day. "full" when the total or the disk is the reason.
   */
  private fits(adding: number, pooled: number, who: CopyHolder | undefined, now: number): "ok" | "full" | "share" {
    if (adding <= 0) return "ok";
    const free = this.freeBytes?.() ?? null;
    if (free !== null && free - adding < this.freeFloor) return "full";
    if (pooled <= 0) return "ok";
    if (this.total + pooled > this.totalLimit) return "full";
    if (who && this.isYoung(who, now) && this.youngBytes(now) + pooled > Math.floor(this.totalLimit * this.newAccountShare)) return "share";
    if (who?.network !== undefined && this.networkDayLimit > 0 && this.networkUsed(who.network, now) + pooled > this.networkDayLimit) return "share";
    return "ok";
  }

  /**
   * Room for `adding` more bytes (fits()): when there is none, unused parts are swept first (at most once a minute), then it
   * checks again. The log hears once when the total or the disk is full, not for one account's or network's share.
   */
  private room(adding: number, pooled: () => number, who: CopyHolder | undefined, now: number): boolean {
    if (this.fits(adding, pooled(), who, now) !== "ok" && now - this.lastSweep >= SWEEP_GAP_MS) this.sweep(now);
    const fits = this.fits(adding, pooled(), who, now);
    if (fits === "ok") {
      this.warned = false;
      return true;
    }
    if (fits === "full") {
      if (!this.warned) console.warn("[tavora-api] The cloud copies have no room: new parts and versions are refused until there is some.");
      this.warned = true;
    }
    return false;
  }

  private isYoung(who: CopyHolder, now: number): boolean {
    return this.newAccountMs > 0 && who.since > now - this.newAccountMs;
  }

  /** Bytes of parts and manifests of the accounts younger than newAccountMs. */
  private youngBytes(now: number): number {
    const since = now - this.newAccountMs;
    const parts = (this.db.prepare("select coalesce(sum(p.size), 0) as total from holders h join parts p on p.account_id = h.account_id where h.since > ?").get(since) as { total: number }).total;
    const manifests = (this.db.prepare("select coalesce(sum(length(c.manifest)), 0) as total from holders h join copies c on c.account_id = h.account_id where h.since > ?").get(since) as { total: number })
      .total;
    return parts + manifests;
  }

  private networkUsed(network: string, now: number): number {
    const entry = this.networkBytes.get(network);
    return entry && entry.resetAt > now ? entry.bytes : 0;
  }

  private countNetwork(who: CopyHolder | undefined, bytes: number, now: number): void {
    if (who?.network === undefined || bytes <= 0) return;
    const entry = this.networkBytes.get(who.network);
    if (entry && entry.resetAt > now) {
      entry.bytes += bytes;
      return;
    }
    // Full: forget the oldest, which a Map keeps first (as the rate limits do).
    if (!entry && this.networkBytes.size >= MAX_NETWORKS) this.networkBytes.delete(this.networkBytes.keys().next().value!);
    this.networkBytes.set(who.network, { bytes, resetAt: now + DAY_MS });
  }

  private remember(accountId: string, who: CopyHolder | undefined): void {
    if (who) this.db.prepare("insert into holders (account_id, since) values (?, ?) on conflict (account_id) do nothing").run(accountId, who.since);
  }

  /**
   * Bytes of parts the account may add outside the total: as much as its saved version's parts, less the parts it stored
   * since, so an account with a copy can always upload its next version of the same size, however full the total is (its
   * old parts go once it is saved, and unsaved ones after a day). Only growth draws from the total. 0 without a copy.
   */
  private replacing(accountId: string): number {
    const copy = this.db.prepare("select size, length(manifest) as manifest from copies where account_id = ?").get(accountId) as { size: number; manifest: number } | undefined;
    if (!copy) return 0;
    const saved = copy.size - copy.manifest;
    return Math.max(0, saved - (this.stored(accountId) - saved));
  }

  /**
   * Drops the parts no saved version uses that are older than UNUSED_PART_MS: those of an account without a copy, and those
   * stored after its copy was last saved (a save drops every part it doesn't use, so what came after it is unused). Parts
   * from before created_at count as old; with a copy they stay until its next save, as they did. Answers what went.
   */
  sweep(now: number = Date.now()): { parts: number; bytes: number } {
    this.lastSweep = now;
    const unused = this.db
      .prepare(
        `select p.account_id as accountId, p.id as id, p.size as size from parts p left join copies c on c.account_id = p.account_id
         where coalesce(p.created_at, 0) < ? and (c.account_id is null or (p.created_at is not null and p.created_at > c.updated_at))`,
      )
      .all(now - UNUSED_PART_MS) as unknown as { accountId: string; id: Uint8Array; size: number }[];
    if (unused.length === 0) return { parts: 0, bytes: 0 };
    let bytes = 0;
    const drop = this.db.prepare("delete from parts where account_id = ? and id = ?");
    this.db.exec("begin");
    try {
      for (const part of unused) {
        drop.run(part.accountId, part.id);
        bytes += part.size;
      }
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    this.total -= bytes;
    this.db.exec("pragma incremental_vacuum");
    return { parts: unused.length, bytes };
  }

  info(accountId: string): CopyInfo | null {
    const row = this.db.prepare("select version, size, updated_at from copies where account_id = ?").get(accountId) as { version: number; size: number; updated_at: number } | undefined;
    return row ? { version: row.version, size: row.size, updatedAt: row.updated_at } : null;
  }

  manifest(accountId: string): { version: number; manifest: Uint8Array } | null {
    const row = this.db.prepare("select version, manifest from copies where account_id = ?").get(accountId) as { version: number; manifest: Uint8Array } | undefined;
    return row ? { version: row.version, manifest: row.manifest } : null;
  }

  /** Bytes of parts stored for the account, used by a version or not. */
  stored(accountId: string): number {
    return (this.db.prepare("select coalesce(sum(size), 0) as total from parts where account_id = ?").get(accountId) as { total: number }).total;
  }

  /**
   * Stores the parts the account does not have yet. Nothing is stored when they would pass STORED_LIMIT (`copy-full`), or
   * eat into the free space the disk keeps, or draw more than fits from the total (`no-room`): beyond what the account's
   * next version may take (replacing()), they need room in the total of every account, in the young accounts' slice of it
   * when `who` is young, and in their network's bytes for the day. Without `who`, an account of long ago on no network.
   */
  addParts(accountId: string, parts: { id: Uint8Array; data: Uint8Array }[], now: number = Date.now(), who?: CopyHolder): AddPartsResult {
    const has = this.db.prepare("select 1 from parts where account_id = ? and id = ?");
    const freshOf = () => {
      const seen = new Set<string>();
      return parts.filter((part) => {
        const key = Buffer.from(part.id).toString("hex");
        if (seen.has(key)) return false;
        seen.add(key);
        return !has.get(accountId, part.id);
      });
    };
    const bytesOf = (list: { data: Uint8Array }[]) => list.reduce((total, part) => total + part.data.length, 0);
    let fresh = freshOf();
    if (bytesOf(fresh) === 0) return "ok";
    if (this.stored(accountId) + bytesOf(fresh) > STORED_LIMIT) return "copy-full";
    const pooled = (bytes: number) => Math.max(0, bytes - this.replacing(accountId));
    if (!this.room(bytesOf(fresh), () => pooled(bytesOf(fresh)), who, now)) return "no-room";
    // A sweep for room may have dropped old unused parts of this account too: those are stored again.
    fresh = freshOf();
    const adding = bytesOf(fresh);
    if (this.stored(accountId) + adding > STORED_LIMIT) return "copy-full";
    const drawn = pooled(adding);
    if (this.fits(adding, drawn, who, now) !== "ok") return "no-room";
    const insert = this.db.prepare("insert into parts (account_id, id, data, size, created_at) values (?, ?, ?, ?, ?)");
    this.db.exec("begin");
    try {
      for (const part of fresh) insert.run(accountId, part.id, part.data, part.data.length, now);
      this.remember(accountId, who);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    this.total += adding;
    this.countNetwork(who, drawn, now);
    return "ok";
  }

  /** The asked parts the account has, in the order asked, until about `maxBytes` (always at least one). */
  parts(accountId: string, ids: Uint8Array[], maxBytes = BATCH_BYTES): { id: Uint8Array; data: Uint8Array }[] {
    const get = this.db.prepare("select data from parts where account_id = ? and id = ?");
    const found: { id: Uint8Array; data: Uint8Array }[] = [];
    let total = 0;
    for (const id of ids) {
      const row = get.get(accountId, id) as { data: Uint8Array } | undefined;
      if (!row) continue;
      if (found.length > 0 && total + row.data.length > maxBytes) break;
      found.push({ id, data: row.data });
      total += row.data.length;
    }
    return found;
  }

  /**
   * Makes `manifest` with `parts` the account's copy, if the PC started from the current version
   * (0 when there is none). Parts no longer used are dropped. A manifest bigger than the one it replaces needs room like new
   * parts do (addParts, `who` too).
   */
  swap(accountId: string, base: number, manifest: Uint8Array, parts: Uint8Array[], now: number, who?: CopyHolder): SwapResult {
    const current = this.info(accountId);
    if ((current?.version ?? 0) !== base) return { ok: false, reason: "copy-changed", version: current?.version ?? 0 };
    const previous = (this.db.prepare("select length(manifest) as bytes from copies where account_id = ?").get(accountId) as { bytes: number } | undefined)?.bytes ?? 0;
    const growth = manifest.length - previous;
    // Before the parts are looked up: a sweep for room may drop old unused ones, which then count as missing.
    if (!this.room(growth, () => growth, who, now)) return { ok: false, reason: "unavailable" };
    const sizeOf = this.db.prepare("select size, created_at from parts where account_id = ? and id = ?");
    const keep = new Map<string, Uint8Array>();
    for (const id of parts) keep.set(Buffer.from(id).toString("hex"), id);
    let size = manifest.length;
    let missing = 0;
    // Saved no earlier than its newest part, so sweep() never takes a part this version uses for one stored after it.
    let savedAt = now;
    for (const id of keep.values()) {
      const row = sizeOf.get(accountId, id) as { size: number; created_at: number | null } | undefined;
      if (!row) {
        missing++;
        continue;
      }
      size += row.size;
      if (row.created_at !== null) savedAt = Math.max(savedAt, row.created_at);
    }
    if (missing > 0) return { ok: false, reason: "missing-parts", missing };
    if (size > COPY_LIMIT) return { ok: false, reason: "copy-full", size };
    // After a delete, numbers go on from the deleted copy's, so a PC that still knows that one never takes a new copy for it.
    const version = Math.max(base, this.retired(accountId)) + 1;
    let dropped = 0;
    this.db.exec("begin");
    try {
      this.db
        .prepare("insert into copies (account_id, version, manifest, size, updated_at) values (?, ?, ?, ?, ?) on conflict (account_id) do update set version = excluded.version, manifest = excluded.manifest, size = excluded.size, updated_at = excluded.updated_at")
        .run(accountId, version, manifest, size, savedAt);
      const stored = this.db.prepare("select id, size from parts where account_id = ?").all(accountId) as { id: Uint8Array; size: number }[];
      const drop = this.db.prepare("delete from parts where account_id = ? and id = ?");
      for (const part of stored) {
        if (keep.has(Buffer.from(part.id).toString("hex"))) continue;
        drop.run(accountId, part.id);
        dropped += part.size;
      }
      this.remember(accountId, who);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    this.total += growth - dropped;
    this.countNetwork(who, growth, now);
    this.db.exec("pragma incremental_vacuum");
    return { ok: true, version, size };
  }

  /** The version of the account's last deleted copy, 0 when none was. */
  private retired(accountId: string): number {
    return (this.db.prepare("select version from retired where account_id = ?").get(accountId) as { version: number } | undefined)?.version ?? 0;
  }

  /** Removes the account's copy and every part it stored; with the copy button or with the account (`forever`: its version number goes too). */
  remove(accountId: string, forever = false): void {
    let freed = 0;
    this.db.exec("begin");
    try {
      freed = this.stored(accountId) + ((this.db.prepare("select length(manifest) as bytes from copies where account_id = ?").get(accountId) as { bytes: number } | undefined)?.bytes ?? 0);
      const version = Math.max(this.info(accountId)?.version ?? 0, this.retired(accountId));
      if (forever || version === 0) this.db.prepare("delete from retired where account_id = ?").run(accountId);
      else this.db.prepare("insert into retired (account_id, version) values (?, ?) on conflict (account_id) do update set version = excluded.version").run(accountId, version);
      this.db.prepare("delete from parts where account_id = ?").run(accountId);
      this.db.prepare("delete from copies where account_id = ?").run(accountId);
      if (forever) this.db.prepare("delete from holders where account_id = ?").run(accountId);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    this.total -= freed;
    this.db.exec("pragma incremental_vacuum");
  }
}

/** A part id: 32 bytes the PC derives from the part's content with its own key. */
const readId = (bytes: Uint8Array, at: number) => bytes.subarray(at, at + ID_BYTES);

/** An upload: parts one after another, each its 32-byte id, its length (4 bytes, big-endian) and its bytes. Null when anything is off. */
export function readParts(body: Uint8Array): { id: Uint8Array; data: Uint8Array }[] | null {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const parts: { id: Uint8Array; data: Uint8Array }[] = [];
  let at = 0;
  let total = 0;
  while (at < body.length) {
    if (at + ID_BYTES + 4 > body.length) return null;
    const id = readId(body, at);
    const length = view.getUint32(at + ID_BYTES);
    at += ID_BYTES + 4;
    if (length === 0 || length > MAX_PART_BYTES || at + length > body.length) return null;
    total += length;
    if (total > BATCH_BYTES + MAX_PART_BYTES) return null;
    parts.push({ id, data: body.subarray(at, at + length) });
    at += length;
  }
  return parts.length > 0 ? parts : null;
}

/** Parts in the same framing as an upload. */
export function writeParts(parts: { id: Uint8Array; data: Uint8Array }[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + ID_BYTES + 4 + part.data.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const part of parts) {
    out.set(part.id, at);
    view.setUint32(at + ID_BYTES, part.data.length);
    out.set(part.data, at + ID_BYTES + 4);
    at += ID_BYTES + 4 + part.data.length;
  }
  return out;
}

/** A new version: the version it started from and the part count (4 bytes each, big-endian), the part ids, then the manifest. */
export function readSwap(body: Uint8Array): { base: number; parts: Uint8Array[]; manifest: Uint8Array } | null {
  if (body.length < 8) return null;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const base = view.getUint32(0);
  const count = view.getUint32(4);
  if (count > MAX_PARTS) return null;
  const start = 8 + count * ID_BYTES;
  const manifest = body.subarray(start);
  if (body.length < start || manifest.length === 0 || manifest.length > MAX_MANIFEST_BYTES) return null;
  const parts: Uint8Array[] = [];
  for (let index = 0; index < count; index++) parts.push(readId(body, 8 + index * ID_BYTES));
  return { base, parts, manifest };
}

export interface CopyOptions {
  copies: CopyStore;
  accounts: AccountStore;
  clientKey: (request: Request) => string;
  /** Copy requests per client: 300 a minute by default, so a first upload of many parts fits. */
  rateLimiter?: RateLimiter;
  now?: () => number;
}

type Env = SignedInEnv;

/** The routes under /v1/account/copy. Bodies are application/octet-stream, which a web page cannot send without a preflight this service refuses. */
export function copyRoutes({ copies, accounts, clientKey, rateLimiter, now = Date.now }: CopyOptions) {
  const limiter = rateLimiter ?? createRateLimiter({ limit: 300, windowMs: 60_000 });
  const app = new Hono<Env>();
  const bad = (context: Context, error: string) => context.json({ error, reason: "bad-request" }, 400);

  app.use("*", async (context, next) => {
    const wait = limiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    if ((context.req.method === "POST" || context.req.method === "PUT") && (context.req.header("content-type") ?? "").toLowerCase() !== "application/octet-stream") {
      return context.json({ error: "Send application/octet-stream.", reason: "bad-request" }, 415);
    }
    await next();
  });
  app.use("*", requireSignIn(accounts, now));
  app.use("*", bodyLimit({ maxSize: MAX_BODY, onError: (context) => context.json({ error: "Too big.", reason: "too-big" }, 413) }));
  const bytes = async (context: Context) => new Uint8Array(await context.req.arrayBuffer());
  /** Who adds bytes, for the shares of the total: when the account was made, and the request's network. */
  const holder = (context: Context<Env>): CopyHolder => ({ since: Date.parse(context.get("account").createdAt), network: networkOf(clientKey(context.req.raw)) });

  app.get("/", (context) => {
    const info = copies.info(context.get("account").id);
    return context.json({ copy: info ? { version: info.version, size: info.size, updatedAt: new Date(info.updatedAt).toISOString() } : null, limit: COPY_LIMIT });
  });

  app.get("/manifest", (context) => {
    const copy = copies.manifest(context.get("account").id);
    if (!copy) return context.json({ error: "There is no cloud copy.", reason: "no-copy" }, 404);
    context.header("X-Copy-Version", String(copy.version));
    context.header("Content-Type", "application/octet-stream");
    return context.body(new Uint8Array(copy.manifest));
  });

  app.post("/parts", async (context) => {
    const parts = readParts(await bytes(context));
    if (!parts) return bad(context, "Send parts: a 32-byte id, a 4-byte length and the bytes, one after another.");
    const account = context.get("account");
    const added = copies.addParts(account.id, parts, now(), holder(context));
    if (added === "copy-full") return context.json({ error: "The cloud copy is full.", reason: "copy-full", limit: COPY_LIMIT }, 413);
    // The service's own room, not this account's: the app keeps its data and tries again later, as for any 503.
    if (added === "no-room") return context.json({ error: "The cloud copy has no room right now. Try again later.", reason: "unavailable" }, 503);
    return context.json({ stored: parts.length });
  });

  // Asked by POST, so a long list of ids fits; the answer holds the parts it has, up to about 8 MB.
  app.post("/parts/get", async (context) => {
    const body = await bytes(context);
    if (body.length === 0 || body.length % ID_BYTES !== 0 || body.length / ID_BYTES > MAX_ASK) return bad(context, `Send 1 to ${MAX_ASK} part ids of 32 bytes.`);
    const ids: Uint8Array[] = [];
    for (let at = 0; at < body.length; at += ID_BYTES) ids.push(readId(body, at));
    context.header("Content-Type", "application/octet-stream");
    return context.body(new Uint8Array(writeParts(copies.parts(context.get("account").id, ids))));
  });

  app.put("/", async (context) => {
    const swap = readSwap(await bytes(context));
    if (!swap) return bad(context, "Send the version it started from, the part ids and the manifest.");
    const result = copies.swap(context.get("account").id, swap.base, swap.manifest, swap.parts, now(), holder(context));
    if (result.ok) return context.json({ version: result.version, size: result.size });
    if (result.reason === "copy-changed") return context.json({ error: "The cloud copy changed on another PC.", reason: result.reason, version: result.version }, 409);
    if (result.reason === "missing-parts") return context.json({ error: "Some parts are missing; upload them again.", reason: result.reason, missing: result.missing }, 409);
    if (result.reason === "unavailable") return context.json({ error: "The cloud copy has no room right now. Try again later.", reason: result.reason }, 503);
    return context.json({ error: "The cloud copy is full.", reason: result.reason, size: result.size, limit: COPY_LIMIT }, 413);
  });

  app.delete("/", (context) => {
    copies.remove(context.get("account").id);
    return context.body(null, 204);
  });

  return app;
}
