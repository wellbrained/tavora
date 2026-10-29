import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DatabaseSync } from "node:sqlite";
import type { AccountStore } from "./account-store.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
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
  | { ok: false; reason: "copy-full"; size: number };

export class CopyStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
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

  /** Stores the parts the account does not have yet; false when they would pass STORED_LIMIT (nothing is stored then). */
  addParts(accountId: string, parts: { id: Uint8Array; data: Uint8Array }[]): boolean {
    const has = this.db.prepare("select 1 from parts where account_id = ? and id = ?");
    const seen = new Set<string>();
    const fresh = parts.filter((part) => {
      const key = Buffer.from(part.id).toString("hex");
      if (seen.has(key)) return false;
      seen.add(key);
      return !has.get(accountId, part.id);
    });
    const adding = fresh.reduce((total, part) => total + part.data.length, 0);
    if (this.stored(accountId) + adding > STORED_LIMIT) return false;
    const insert = this.db.prepare("insert into parts (account_id, id, data, size) values (?, ?, ?, ?)");
    this.db.exec("begin");
    try {
      for (const part of fresh) insert.run(accountId, part.id, part.data, part.data.length);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return true;
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
   * (0 when there is none). Parts no longer used are dropped.
   */
  swap(accountId: string, base: number, manifest: Uint8Array, parts: Uint8Array[], now: number): SwapResult {
    const current = this.info(accountId);
    if ((current?.version ?? 0) !== base) return { ok: false, reason: "copy-changed", version: current?.version ?? 0 };
    const sizeOf = this.db.prepare("select size from parts where account_id = ? and id = ?");
    const keep = new Map<string, Uint8Array>();
    for (const id of parts) keep.set(Buffer.from(id).toString("hex"), id);
    let size = manifest.length;
    let missing = 0;
    for (const id of keep.values()) {
      const row = sizeOf.get(accountId, id) as { size: number } | undefined;
      if (row) size += row.size;
      else missing++;
    }
    if (missing > 0) return { ok: false, reason: "missing-parts", missing };
    if (size > COPY_LIMIT) return { ok: false, reason: "copy-full", size };
    // After a delete, numbers go on from the deleted copy's, so a PC that still knows that one never takes a new copy for it.
    const version = Math.max(base, this.retired(accountId)) + 1;
    this.db.exec("begin");
    try {
      this.db
        .prepare("insert into copies (account_id, version, manifest, size, updated_at) values (?, ?, ?, ?, ?) on conflict (account_id) do update set version = excluded.version, manifest = excluded.manifest, size = excluded.size, updated_at = excluded.updated_at")
        .run(accountId, version, manifest, size, now);
      const stored = this.db.prepare("select id from parts where account_id = ?").all(accountId) as { id: Uint8Array }[];
      const drop = this.db.prepare("delete from parts where account_id = ? and id = ?");
      for (const { id } of stored) if (!keep.has(Buffer.from(id).toString("hex"))) drop.run(accountId, id);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    this.db.exec("pragma incremental_vacuum");
    return { ok: true, version, size };
  }

  /** The version of the account's last deleted copy, 0 when none was. */
  private retired(accountId: string): number {
    return (this.db.prepare("select version from retired where account_id = ?").get(accountId) as { version: number } | undefined)?.version ?? 0;
  }

  /** Removes the account's copy and every part it stored; with the copy button or with the account (`forever`: its version number goes too). */
  remove(accountId: string, forever = false): void {
    this.db.exec("begin");
    try {
      const version = Math.max(this.info(accountId)?.version ?? 0, this.retired(accountId));
      if (forever || version === 0) this.db.prepare("delete from retired where account_id = ?").run(accountId);
      else this.db.prepare("insert into retired (account_id, version) values (?, ?) on conflict (account_id) do update set version = excluded.version").run(accountId, version);
      this.db.prepare("delete from parts where account_id = ?").run(accountId);
      this.db.prepare("delete from copies where account_id = ?").run(accountId);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
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
    if (!copies.addParts(account.id, parts)) return context.json({ error: "The cloud copy is full.", reason: "copy-full", limit: COPY_LIMIT }, 413);
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
    const result = copies.swap(context.get("account").id, swap.base, swap.manifest, swap.parts, now());
    if (result.ok) return context.json({ version: result.version, size: result.size });
    if (result.reason === "copy-changed") return context.json({ error: "The cloud copy changed on another PC.", reason: result.reason, version: result.version }, 409);
    if (result.reason === "missing-parts") return context.json({ error: "Some parts are missing; upload them again.", reason: result.reason, missing: result.missing }, 409);
    return context.json({ error: "The cloud copy is full.", reason: result.reason, size: result.size, limit: COPY_LIMIT }, 413);
  });

  app.delete("/", (context) => {
    copies.remove(context.get("account").id);
    return context.body(null, 204);
  });

  return app;
}
