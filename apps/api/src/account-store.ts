import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Accounts: the only player data the service keeps (decided 2026-10-16). An
 * account is an email address; a player signs in with a code sent to it, never
 * a password. It lives in its own SQLite file, apart from the icons. Nothing
 * here records a connection address or a PC's name: a signed-in device is its
 * operating system and two dates.
 */

export const CODE_TTL_MS = 10 * 60_000;
/** Wrong tries that spend a code. */
export const CODE_MAX_TRIES = 5;
/** Codes one address can be sent: 3 every 15 minutes, 10 a day. */
export const CODES_PER_WINDOW = 3;
export const CODE_WINDOW_MS = 15 * 60_000;
export const CODES_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60_000;
/** A sign-in unused for a year ends. */
export const SESSION_IDLE_MS = 365 * DAY_MS;
/** How often a session's last use is written, so every request is not a write. */
const SESSION_TOUCH_MS = 60 * 60_000;

export const DEVICE_OS = ["windows", "linux", "macos", "other"] as const;
export type DeviceOs = (typeof DEVICE_OS)[number];

/** What a code is for. A sign-in code also creates the account when the address has none. */
export type CodePurpose = "sign-in" | "change-email" | "delete";

export interface Account {
  id: string;
  email: string;
  createdAt: string;
}

export interface Device {
  id: string;
  os: DeviceOs;
  createdAt: string;
  lastUsedAt: string;
}

/** The player's profile as the account keeps it: private to its owner (decided 2026-10-16). */
export interface StoredProfile {
  name: string;
  initials: string;
  /** A 256 px PNG, or null for initials. */
  picture: Uint8Array | null;
  /** When the player last changed it, in ms; the newest change wins. */
  updatedAt: number;
}

export interface Session {
  id: string;
  accountId: string;
}

export type CodeRequest = { ok: true; code: string } | { ok: false; retryAfter: number };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
// Codes and counters are kept by a hash of the address, so an address that
// never became an account is not written down in the clear.
const addressKey = (email: string) => sha256(`address:${email}`);
const codeHash = (key: string, purpose: CodePurpose, code: string) => sha256(`code:${key}:${purpose}:${code}`);

/** Lower case and trimmed: the one form an address is stored and matched in. Dots and +tags are kept. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  return /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/.test(email) ? email : null;
}

export class AccountStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma foreign_keys = on;
      create table if not exists accounts (id text primary key, email text not null unique, created_at integer not null);
      create table if not exists codes (
        address text not null, purpose text not null, account_id text, code_hash text not null,
        expires_at integer not null, tries integer not null default 0, primary key (address, purpose)
      );
      create table if not exists code_requests (address text not null, at integer not null);
      create index if not exists code_requests_address on code_requests (address, at);
      create table if not exists sessions (
        id text primary key, token_hash text not null unique,
        account_id text not null references accounts (id) on delete cascade,
        os text not null, created_at integer not null, last_used_at integer not null
      );
      create index if not exists sessions_account on sessions (account_id);
      create table if not exists profiles (
        account_id text primary key references accounts (id) on delete cascade,
        name text not null, initials text not null, picture blob, updated_at integer not null
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // ── Accounts ───────────────────────────────────────────────────────────

  accountByEmail(email: string): Account | null {
    return toAccount(this.db.prepare("select id, email, created_at from accounts where email = ?").get(email));
  }

  account(id: string): Account | null {
    return toAccount(this.db.prepare("select id, email, created_at from accounts where id = ?").get(id));
  }

  createAccount(email: string, now: number): Account {
    const id = randomBytes(16).toString("base64url");
    this.db.prepare("insert into accounts (id, email, created_at) values (?, ?, ?)").run(id, email, now);
    return { id, email, createdAt: new Date(now).toISOString() };
  }

  changeEmail(id: string, email: string): "ok" | "taken" {
    if (this.accountByEmail(email)) return "taken";
    this.db.prepare("update accounts set email = ? where id = ?").run(email, id);
    return "ok";
  }

  /** Removes the account, every sign-in and every code waiting for it. */
  deleteAccount(id: string): void {
    this.db.exec("begin");
    try {
      this.db.prepare("delete from codes where account_id = ?").run(id);
      this.db.prepare("delete from sessions where account_id = ?").run(id);
      this.db.prepare("delete from profiles where account_id = ?").run(id);
      this.db.prepare("delete from accounts where id = ?").run(id);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  // ── Profile ────────────────────────────────────────────────────────────

  profile(accountId: string): StoredProfile | null {
    const row = this.db.prepare("select name, initials, picture, updated_at from profiles where account_id = ?").get(accountId) as
      | { name: string; initials: string; picture: Uint8Array | null; updated_at: number }
      | undefined;
    return row ? { name: row.name, initials: row.initials, picture: row.picture ? new Uint8Array(row.picture) : null, updatedAt: row.updated_at } : null;
  }

  /** Keeps a profile unless the account already has a newer one; returns what the account has now. */
  setProfile(accountId: string, profile: StoredProfile): StoredProfile {
    const current = this.profile(accountId);
    if (current && current.updatedAt >= profile.updatedAt) return current;
    this.db
      .prepare("insert or replace into profiles (account_id, name, initials, picture, updated_at) values (?, ?, ?, ?, ?)")
      .run(accountId, profile.name, profile.initials, profile.picture, profile.updatedAt);
    return profile;
  }

  // ── Codes ──────────────────────────────────────────────────────────────

  /**
   * Makes a new code for an address, replacing one still waiting for the same
   * purpose, unless the address was sent too many lately. The limits count every
   * purpose together, so nobody can flood an inbox by switching between them.
   */
  requestCode(email: string, purpose: CodePurpose, accountId: string | null, now: number): CodeRequest {
    this.sweep(now);
    const address = addressKey(email);
    const recent = this.db.prepare("select at from code_requests where address = ? and at > ? order by at").all(address, now - DAY_MS) as unknown as { at: number }[];
    if (recent.length >= CODES_PER_DAY) return { ok: false, retryAfter: secondsUntil(recent[recent.length - CODES_PER_DAY]!.at + DAY_MS, now) };
    const inWindow = recent.filter((row) => row.at > now - CODE_WINDOW_MS);
    if (inWindow.length >= CODES_PER_WINDOW) {
      return { ok: false, retryAfter: secondsUntil(inWindow[inWindow.length - CODES_PER_WINDOW]!.at + CODE_WINDOW_MS, now) };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.db.prepare("insert into code_requests (address, at) values (?, ?)").run(address, now);
    this.db
      .prepare("insert or replace into codes (address, purpose, account_id, code_hash, expires_at, tries) values (?, ?, ?, ?, ?, 0)")
      .run(address, purpose, accountId, codeHash(address, purpose, code), now + CODE_TTL_MS);
    return { ok: true, code };
  }

  /**
   * Checks a code. A wrong one counts a try, and the last allowed try spends it.
   * A right one is spent only when asked, so the app can learn that an address
   * has no account yet and ask the player before it creates one.
   */
  checkCode(email: string, purpose: CodePurpose, accountId: string | null, code: string, now: number, spend: boolean): boolean {
    const address = addressKey(email);
    const row = this.db.prepare("select account_id, code_hash, expires_at, tries from codes where address = ? and purpose = ?").get(address, purpose) as
      | { account_id: string | null; code_hash: string; expires_at: number; tries: number }
      | undefined;
    if (!row || row.expires_at <= now || row.account_id !== accountId) return false;
    const right = timingSafeEqual(Buffer.from(row.code_hash, "hex"), Buffer.from(codeHash(address, purpose, code), "hex"));
    if (!right) {
      if (row.tries + 1 >= CODE_MAX_TRIES) this.db.prepare("delete from codes where address = ? and purpose = ?").run(address, purpose);
      else this.db.prepare("update codes set tries = tries + 1 where address = ? and purpose = ?").run(address, purpose);
      return false;
    }
    if (spend) this.db.prepare("delete from codes where address = ? and purpose = ?").run(address, purpose);
    return true;
  }

  // ── Sessions ───────────────────────────────────────────────────────────

  /** A new sign-in. The token goes to the app once; only its hash is kept. */
  createSession(accountId: string, os: DeviceOs, now: number): { token: string; session: Session } {
    const token = randomBytes(32).toString("base64url");
    const id = randomBytes(12).toString("base64url");
    this.db
      .prepare("insert into sessions (id, token_hash, account_id, os, created_at, last_used_at) values (?, ?, ?, ?, ?, ?)")
      .run(id, sha256(`session:${token}`), accountId, os, now, now);
    return { token, session: { id, accountId } };
  }

  /** The sign-in a token belongs to, or null when it is unknown or has gone unused for a year. */
  sessionByToken(token: string, now: number): Session | null {
    const row = this.db.prepare("select id, account_id, last_used_at from sessions where token_hash = ?").get(sha256(`session:${token}`)) as
      | { id: string; account_id: string; last_used_at: number }
      | undefined;
    if (!row) return null;
    if (row.last_used_at <= now - SESSION_IDLE_MS) {
      this.db.prepare("delete from sessions where id = ?").run(row.id);
      return null;
    }
    if (now - row.last_used_at > SESSION_TOUCH_MS) this.db.prepare("update sessions set last_used_at = ? where id = ?").run(now, row.id);
    return { id: row.id, accountId: row.account_id };
  }

  devices(accountId: string): Device[] {
    return (
      this.db.prepare("select id, os, created_at, last_used_at from sessions where account_id = ? order by created_at, rowid").all(accountId) as unknown as {
        id: string;
        os: DeviceOs;
        created_at: number;
        last_used_at: number;
      }[]
    ).map((row) => ({ id: row.id, os: row.os, createdAt: new Date(row.created_at).toISOString(), lastUsedAt: new Date(row.last_used_at).toISOString() }));
  }

  /** Signs out one device of an account; false when the account has no such device. */
  deleteSession(accountId: string, id: string): boolean {
    return Number(this.db.prepare("delete from sessions where id = ? and account_id = ?").run(id, accountId).changes) > 0;
  }

  // ── Housekeeping ───────────────────────────────────────────────────────

  private sweep(now: number): void {
    this.db.prepare("delete from codes where expires_at <= ?").run(now);
    this.db.prepare("delete from code_requests where at <= ?").run(now - DAY_MS);
    this.db.prepare("delete from sessions where last_used_at <= ?").run(now - SESSION_IDLE_MS);
  }
}

function toAccount(row: unknown): Account | null {
  if (!row) return null;
  const { id, email, created_at } = row as { id: string; email: string; created_at: number };
  return { id, email, createdAt: new Date(created_at).toISOString() };
}

const secondsUntil = (at: number, now: number) => Math.max(1, Math.ceil((at - now) / 1000));
