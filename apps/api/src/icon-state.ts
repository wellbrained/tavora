import { DatabaseSync } from "node:sqlite";

/**
 * The one writable thing the service keeps: icons users have offered and
 * are waiting to be reviewed, icons that were approved, hashes that must never
 * come back, and hosted icons that were taken down. It lives in its own small
 * SQLite file, apart from the read-only game dataset. An offer records the
 * file, the game id, a counter and the account that sent it first; the account
 * goes with the offer once a person has approved or denied it. Accounts whose
 * offers were blocked are kept so they cannot offer again.
 */

export interface PendingRow {
  sha256: string;
  id: string;
  name: string;
  source: string;
  size: number;
  /** How many times this exact file was offered. */
  count: number;
  firstSeen: string;
  lastSeen: string;
}

export interface ApprovedRow {
  id: string;
  names: string[];
  sha256: string;
  size: number;
  source: string;
  approvedAt: string;
}

export interface NewSubmission {
  sha256: string;
  id: string;
  name: string;
  source: string;
  bytes: Uint8Array;
  /** The account id that sends it. */
  sender: string;
  now: Date;
}

interface PendingSql {
  sha256: string;
  id: string;
  name: string;
  source: string;
  size: number;
  count: number;
  first_seen: string;
  last_seen: string;
}

export class IconState {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      create table if not exists pending (
        sha256 text primary key, id text not null, name text not null, source text not null,
        bytes blob not null, size integer not null, count integer not null,
        first_seen text not null, last_seen text not null
      );
      create index if not exists pending_id on pending (id);
      create table if not exists blocked (sha256 text primary key, reason text not null, at text not null);
      create table if not exists blocked_senders (account text primary key, at text not null);
      create table if not exists approved (
        id text primary key, names text not null, sha256 text not null, bytes blob not null,
        size integer not null, source text not null, approved_at text not null
      );
      create table if not exists hidden (id text primary key, at text not null);
      create table if not exists replaceable (id text primary key, at text not null);
    `);
    // Offers from before sign-in was needed have no sender.
    const columns = this.db.prepare("pragma table_info(pending)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "sender")) this.db.exec("alter table pending add column sender text");
    this.db.exec("create index if not exists pending_sender on pending (sender)");
  }

  close(): void {
    this.db.close();
  }

  // ── Offered icons ──────────────────────────────────────────────────────

  /** Records an offered file, or counts one more offer of a file already waiting. */
  addPending(input: NewSubmission): "new" | "again" {
    const at = input.now.toISOString();
    const existing = this.db.prepare("select count from pending where sha256 = ?").get(input.sha256);
    if (existing) {
      this.db.prepare("update pending set count = count + 1, last_seen = ? where sha256 = ?").run(at, input.sha256);
      return "again";
    }
    this.db
      .prepare("insert into pending (sha256, id, name, source, bytes, size, count, first_seen, last_seen, sender) values (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)")
      .run(input.sha256, input.id, input.name, input.source, input.bytes, input.bytes.byteLength, at, at, input.sender);
    return "new";
  }

  pendingCount(id?: string): number {
    const row = (id === undefined
      ? this.db.prepare("select count(*) as n from pending").get()
      : this.db.prepare("select count(*) as n from pending where id = ?").get(id)) as { n: number };
    return row.n;
  }

  /** How many different offers from this account are waiting. */
  pendingCountFrom(sender: string): number {
    return (this.db.prepare("select count(*) as n from pending where sender = ?").get(sender) as { n: number }).n;
  }

  /** The account that sent a waiting offer, or null (none waiting, or one from before sign-in was needed). */
  pendingSender(sha256: string): string | null {
    const row = this.db.prepare("select sender from pending where sha256 = ?").get(sha256) as { sender: string | null } | undefined;
    return row?.sender ?? null;
  }

  /** Oldest first, so nothing waits forever behind newer offers. */
  listPending(): PendingRow[] {
    return (this.db.prepare("select sha256, id, name, source, size, count, first_seen, last_seen from pending order by first_seen, sha256").all() as unknown as PendingSql[]).map(
      (row) => ({ sha256: row.sha256, id: row.id, name: row.name, source: row.source, size: row.size, count: row.count, firstSeen: row.first_seen, lastSeen: row.last_seen }),
    );
  }

  pending(sha256: string): PendingRow | null {
    return this.listPending().find((row) => row.sha256 === sha256) ?? null;
  }

  pendingBytes(sha256: string): Uint8Array | null {
    const row = this.db.prepare("select bytes from pending where sha256 = ?").get(sha256) as { bytes: Uint8Array } | undefined;
    return row ? new Uint8Array(row.bytes) : null;
  }

  deletePending(sha256: string): boolean {
    return Number(this.db.prepare("delete from pending where sha256 = ?").run(sha256).changes) > 0;
  }

  // ── Blocked files ──────────────────────────────────────────────────────

  block(sha256: string, reason: string, now: Date): void {
    this.db.prepare("insert or replace into blocked (sha256, reason, at) values (?, ?, ?)").run(sha256, reason, now.toISOString());
    this.deletePending(sha256);
  }

  isBlocked(sha256: string): boolean {
    return this.db.prepare("select 1 from blocked where sha256 = ?").get(sha256) !== undefined;
  }

  /** Refuses every later offer from this account, and drops the ones it has waiting. */
  blockSender(account: string, now: Date): void {
    this.db.prepare("insert or replace into blocked_senders (account, at) values (?, ?)").run(account, now.toISOString());
    this.db.prepare("delete from pending where sender = ?").run(account);
  }

  /** The account is deleted: its waiting offers go, and so does its block, which a new account never matches. */
  forgetSender(account: string): void {
    this.db.prepare("delete from pending where sender = ?").run(account);
    this.db.prepare("delete from blocked_senders where account = ?").run(account);
  }

  isSenderBlocked(account: string): boolean {
    return this.db.prepare("select 1 from blocked_senders where account = ?").get(account) !== undefined;
  }

  // ── Approved icons ─────────────────────────────────────────────────────

  /** Publishes an offered file for a game, and drops every other offer for that game. */
  approve(sha256: string, names: string[], now: Date): ApprovedRow | null {
    const row = this.db.prepare("select id, bytes, size, source from pending where sha256 = ?").get(sha256) as
      | { id: string; bytes: Uint8Array; size: number; source: string }
      | undefined;
    if (!row) return null;
    const at = now.toISOString();
    this.db.exec("begin");
    try {
      this.db
        .prepare("insert or replace into approved (id, names, sha256, bytes, size, source, approved_at) values (?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, JSON.stringify(names), sha256, row.bytes, row.size, row.source, at);
      this.db.prepare("delete from pending where id = ?").run(row.id);
      // The new icon starts closed again: it was just picked to replace the old one.
      this.db.prepare("delete from replaceable where id = ?").run(row.id);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return { id: row.id, names, sha256, size: row.size, source: row.source, approvedAt: at };
  }

  approvedList(): ApprovedRow[] {
    return (
      this.db.prepare("select id, names, sha256, size, source, approved_at from approved order by id").all() as unknown as {
        id: string;
        names: string;
        sha256: string;
        size: number;
        source: string;
        approved_at: string;
      }[]
    ).map((row) => ({ id: row.id, names: JSON.parse(row.names) as string[], sha256: row.sha256, size: row.size, source: row.source, approvedAt: row.approved_at }));
  }

  approvedBytes(id: string): Uint8Array | null {
    const row = this.db.prepare("select bytes from approved where id = ?").get(id) as { bytes: Uint8Array } | undefined;
    return row ? new Uint8Array(row.bytes) : null;
  }

  removeApproved(id: string): boolean {
    this.db.prepare("delete from replaceable where id = ?").run(id);
    return Number(this.db.prepare("delete from approved where id = ?").run(id).changes) > 0;
  }

  // ── Icons open for replacements ────────────────────────────────────────

  /**
   * Marks a hosted icon open for replacements (or closes it again): users may offer another icon for its game,
   * and approving one replaces it. It is served as before until then.
   */
  setReplaceable(id: string, open: boolean, now: Date): void {
    if (open) this.db.prepare("insert or replace into replaceable (id, at) values (?, ?)").run(id, now.toISOString());
    else this.db.prepare("delete from replaceable where id = ?").run(id);
  }

  isReplaceable(id: string): boolean {
    return this.db.prepare("select 1 from replaceable where id = ?").get(id) !== undefined;
  }

  replaceableIds(): Set<string> {
    return new Set((this.db.prepare("select id from replaceable").all() as { id: string }[]).map((row) => row.id));
  }

  // ── Icons taken down ───────────────────────────────────────────────────

  /** Stops serving an icon that ships with the release (it is removed from the repository on the next deploy). */
  hide(id: string, now: Date): void {
    this.db.prepare("insert or replace into hidden (id, at) values (?, ?)").run(id, now.toISOString());
  }

  isHidden(id: string): boolean {
    return this.db.prepare("select 1 from hidden where id = ?").get(id) !== undefined;
  }
}
