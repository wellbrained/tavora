import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Accounts: the only user data the service keeps (decided 2026-10-16). An
 * account has one or two sign-in methods: an email address (a code sent to it,
 * never a password) and a Discord login (known by the Discord user id; the
 * username is only a label). It lives in its own SQLite file, apart from the icons. Nothing
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
/** A publish token is good this long (decided 2026-10-20). */
export const PUBLISH_TOKEN_TTL_MS = 365 * DAY_MS;
export const MAX_PUBLISH_TOKENS = 10;
/** Publish tokens start like this, so they are told apart from sign-ins (and found by secret scanners). */
export const PUBLISH_TOKEN_PREFIX = "tvp_";
/** How often a session's last use is written, so every request is not a write. */
const SESSION_TOUCH_MS = 60 * 60_000;

export const DEVICE_OS = ["windows", "linux", "macos", "other"] as const;
export type DeviceOs = (typeof DEVICE_OS)[number];

/** What a code is for. A sign-in code also creates the account when the address has none. */
export type CodePurpose = "sign-in" | "change-email" | "remove-email" | "connect-discord" | "remove-discord" | "delete";

/** A Discord login: the user id is the identity, the username only a label shown to the owner. */
export interface DiscordLogin {
  id: string;
  name: string;
}

export interface Account {
  id: string;
  /** Null for an account that signs in with Discord only. */
  email: string | null;
  discord: DiscordLogin | null;
  createdAt: string;
}

export interface PublishToken {
  id: string;
  /** What the developer called it, such as "GitHub Actions". */
  name: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
}

export interface Device {
  id: string;
  os: DeviceOs;
  /** The PC's name, as the app sent it or the user renamed it; null for a sign-in from before names. */
  name: string | null;
  createdAt: string;
  lastUsedAt: string;
}

/** The user's profile as the account keeps it: private to its owner (decided 2026-10-16). */
export interface StoredProfile {
  name: string;
  initials: string;
  /** A 256 px PNG, or null for initials. */
  picture: Uint8Array | null;
  /** When the user last changed it, in ms; the newest change wins. */
  updatedAt: number;
}

export interface Session {
  id: string;
  accountId: string;
}

export type CodeRequest = { ok: true; code: string } | { ok: false; retryAfter: number };

/** A developer name can change once in this long, and a name given up stays blocked for others as long. */
export const NAME_HOLD_MS = 30 * 24 * 60 * 60_000;
/** How long a code for linking a publisher key lasts. */
export const LINK_CODE_TTL_MS = 10 * 60_000;
/** Publisher keys one account can link. */
export const MAX_KEYS = 20;
/** Module id prefixes (the part before the first dot) an account may hold in the catalog (C5). */
export const MAX_PREFIXES = 3;
/** The letters a link code is made of: no 0/O, 1/I/L, so it can be typed from the screen. */
const LINK_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const LINK_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

/** An account's public name as a module developer: shown to users as "by <name>". */
export interface Developer {
  name: string;
  /** When it was last set, in ms; it can change again NAME_HOLD_MS later. */
  changedAt: number;
}

/** A publisher key linked to an account: its fingerprint (the owner id in module data) and when. */
export interface LinkedKey {
  fingerprint: string;
  linkedAt: string;
}

/**
 * A developer's request to replace a lost or leaked publisher key with another key of the same
 * account. Tavora's maintainer signs it offline as a succession (and a leaked key also as a
 * revocation), so the service never vouches for a key on its own.
 */
export interface KeyRequest {
  old: string;
  new: string;
  accountId: string;
  leaked: boolean;
  requestedAt: number;
  /** When the maintainer turned it down; null while it waits or once it is signed. */
  declinedAt: number | null;
}

export type NameChange = { ok: true; developer: Developer } | { ok: false; reason: "name-taken" | "name-reserved" | "name-too-soon"; nextChangeAt?: number };

/** How long a checked Discord login waits for the user's yes to a new account. */
export const DISCORD_TICKET_TTL_MS = 10 * 60_000;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * What makes two developer names the same: case, spaces, dots, dashes and underscores do not
 * count, so "Well Brained" cannot pose as "wellbrained".
 */
export const nameKey = (name: string) => name.toLowerCase().replace(/[ ._-]/g, "");

/** Names nobody can take, and anything that claims to be Tavora. */
const RESERVED = new Set(["official", "admin", "administrator", "support", "help", "moderator", "mod", "system", "root", "staff", "team", "security", "local", "unknown", "anonymous", "everyone", "nobody", "developer"]);
export const isReservedName = (key: string) => key.includes("tavora") || RESERVED.has(key);

/** 3 to 32 characters: letters, digits, spaces, dots, dashes and underscores, starting and ending with a letter or digit, no two separators in a row. */
export function cleanDeveloperName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim();
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,30}[A-Za-z0-9]$/.test(name) && !/[ ._-]{2}/.test(name) ? name : null;
}
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

interface KeyRequestRow {
  old: string;
  account_id: string;
  new: string;
  leaked: number;
  requested_at: number;
  declined_at: number | null;
}

const keyRequestOf = (row: KeyRequestRow): KeyRequest => ({
  old: row.old,
  new: row.new,
  accountId: row.account_id,
  leaked: row.leaked === 1,
  requestedAt: row.requested_at,
  declinedAt: row.declined_at,
});

/** Why an account is suspended, as the maintainer recorded it. */
export interface Suspension {
  reason: string;
  note: string | null;
  suspendedAt: number;
  /** When the account was last used before it was suspended (its sign-ins are deleted by the suspension). */
  lastActiveAt: number | null;
}

/** One line of the admin panel's account list. Never a secret, never the picture itself. */
export interface AccountRow {
  id: string;
  email: string | null;
  discordName: string | null;
  createdAt: number;
  profileName: string | null;
  initials: string | null;
  hasPicture: boolean;
  developerName: string | null;
  devices: number;
  lastActiveAt: number | null;
  banned: boolean;
  suspended: boolean;
}

/** What the admin panel shows about accounts: counts only. */
export interface AccountCounts {
  total: number;
  perDay: { day: string; count: number }[];
  active7: number;
  active30: number;
}

export class AccountStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma foreign_keys = on;
      create table if not exists accounts (
        id text primary key, email text unique, discord_id text unique, discord_name text, created_at integer not null,
        check (email is not null or discord_id is not null)
      );
      create table if not exists codes (
        address text not null, purpose text not null, account_id text, code_hash text not null,
        expires_at integer not null, tries integer not null default 0, primary key (address, purpose)
      );
      create table if not exists code_requests (address text not null, at integer not null);
      create index if not exists code_requests_address on code_requests (address, at);
      create table if not exists sessions (
        id text primary key, token_hash text not null unique,
        account_id text not null references accounts (id) on delete cascade,
        os text not null, name text, created_at integer not null, last_used_at integer not null
      );
      create index if not exists sessions_account on sessions (account_id);
      create table if not exists mail_days (day text primary key, sent integer not null);
      create table if not exists profiles (
        account_id text primary key references accounts (id) on delete cascade,
        name text not null, initials text not null, picture blob, updated_at integer not null
      );
      create table if not exists discord_tickets (ticket_hash text primary key, discord_id text not null, discord_name text not null, expires_at integer not null);
      create table if not exists developers (
        account_id text primary key references accounts (id) on delete cascade,
        name text not null, name_key text not null unique, changed_at integer not null
      );
      create table if not exists released_names (name_key text primary key, account_id text not null, released_at integer not null);
      create table if not exists publisher_keys (
        fingerprint text primary key, account_id text not null references accounts (id) on delete cascade,
        public_key text not null, linked_at integer not null
      );
      create index if not exists publisher_keys_account on publisher_keys (account_id);
      create table if not exists module_prefixes (prefix text primary key, account_id text not null, reserved_at integer not null);
      create index if not exists module_prefixes_account on module_prefixes (account_id);
      create table if not exists link_codes (
        code_hash text primary key, account_id text not null references accounts (id) on delete cascade, expires_at integer not null
      );
      create table if not exists key_requests (
        old text primary key, account_id text not null references accounts (id) on delete cascade,
        new text not null, leaked integer not null, requested_at integer not null, declined_at integer
      );
      create index if not exists key_requests_account on key_requests (account_id);
      create table if not exists vaults (
        account_id text primary key references accounts (id) on delete cascade,
        version integer not null, data blob not null, updated_at integer not null
      );
      create table if not exists publish_tokens (
        id text primary key, account_id text not null references accounts (id) on delete cascade, token_hash text not null unique,
        name text not null, created_at integer not null, expires_at integer not null, last_used_at integer
      );
      create index if not exists publish_tokens_account on publish_tokens (account_id);
      -- Banned developers (decided 2026-10-26). No foreign key: deleting the account does not lift the ban, and its keys stay banned.
      create table if not exists bans (
        account_id text primary key, reason text not null, note text, banned_at integer not null, modules text not null, email text, name text
      );
      create table if not exists banned_keys (fingerprint text primary key, account_id text not null);
      -- Suspended accounts (decided 2026-10-26): reversible. last_active_at keeps when the account was last used, because its sessions are deleted.
      create table if not exists suspensions (
        account_id text primary key references accounts (id) on delete cascade,
        reason text not null, note text, suspended_at integer not null, last_active_at integer
      );
    `);
    this.migrate();
  }

  /**
   * Accounts from before Discord logins required an email. SQLite cannot drop a
   * NOT NULL, so the table is rebuilt once: in one transaction, keeping every
   * id, so sign-ins and profiles stay attached; it checks the result and rolls
   * everything back on any problem.
   */
  private migrate(): void {
    // Device names came later; older sign-ins have none.
    const sessionColumns = (this.db.prepare("pragma table_info(sessions)").all() as unknown as { name: string }[]).map((column) => column.name);
    if (!sessionColumns.includes("name")) this.db.exec("alter table sessions add column name text");
    const columns = (this.db.prepare("pragma table_info(accounts)").all() as unknown as { name: string }[]).map((column) => column.name);
    if (columns.includes("discord_id")) return;
    const before = (this.db.prepare("select count(*) as n from accounts").get() as { n: number }).n;
    this.db.exec("pragma foreign_keys = off");
    try {
      this.db.exec("begin");
      try {
        this.db.exec(`
          create table accounts_new (
            id text primary key, email text unique, discord_id text unique, discord_name text, created_at integer not null,
            check (email is not null or discord_id is not null)
          );
          insert into accounts_new (id, email, created_at) select id, email, created_at from accounts;
          drop table accounts;
          alter table accounts_new rename to accounts;
        `);
        const after = (this.db.prepare("select count(*) as n from accounts").get() as { n: number }).n;
        const broken = this.db.prepare("pragma foreign_key_check").all();
        if (after !== before || broken.length > 0) throw new Error(`accounts migration check failed (${before} -> ${after}, ${broken.length} broken links)`);
        this.db.exec("commit");
      } catch (error) {
        this.db.exec("rollback");
        throw error;
      }
    } finally {
      this.db.exec("pragma foreign_keys = on");
    }
  }

  close(): void {
    this.db.close();
  }

  // ── Accounts ───────────────────────────────────────────────────────────

  accountByEmail(email: string): Account | null {
    return toAccount(this.db.prepare(`select ${ACCOUNT_COLUMNS} from accounts where email = ?`).get(email));
  }

  accountByDiscord(discordId: string): Account | null {
    return toAccount(this.db.prepare(`select ${ACCOUNT_COLUMNS} from accounts where discord_id = ?`).get(discordId));
  }

  account(id: string): Account | null {
    return toAccount(this.db.prepare(`select ${ACCOUNT_COLUMNS} from accounts where id = ?`).get(id));
  }

  /** A new account with an email address, a Discord login or both (at least one). */
  createAccount(methods: { email?: string; discord?: DiscordLogin }, now: number): Account {
    if (!methods.email && !methods.discord) throw new Error("an account needs a sign-in method");
    const id = randomBytes(16).toString("base64url");
    this.db
      .prepare("insert into accounts (id, email, discord_id, discord_name, created_at) values (?, ?, ?, ?, ?)")
      .run(id, methods.email ?? null, methods.discord?.id ?? null, methods.discord?.name ?? null, now);
    return { id, email: methods.email ?? null, discord: methods.discord ?? null, createdAt: new Date(now).toISOString() };
  }

  /** Sets or changes the email address (a Discord-only account gets its first one this way). */
  changeEmail(id: string, email: string): "ok" | "taken" {
    if (this.accountByEmail(email)) return "taken";
    this.db.prepare("update accounts set email = ? where id = ?").run(email, id);
    return "ok";
  }

  /** Removes the email address, only while a Discord login remains. */
  removeEmail(id: string): "ok" | "last-method" {
    return Number(this.db.prepare("update accounts set email = null where id = ? and email is not null and discord_id is not null").run(id).changes) > 0 ? "ok" : "last-method";
  }

  /** Connects a Discord login, unless another account has it. Never merges accounts. */
  setDiscord(id: string, discord: DiscordLogin): "ok" | "taken" {
    const owner = this.accountByDiscord(discord.id);
    if (owner && owner.id !== id) return "taken";
    this.db.prepare("update accounts set discord_id = ?, discord_name = ? where id = ?").run(discord.id, discord.name, id);
    return "ok";
  }

  /** Disconnects Discord, only while an email address remains. */
  removeDiscord(id: string): "ok" | "last-method" {
    return Number(this.db.prepare("update accounts set discord_id = null, discord_name = null where id = ? and discord_id is not null and email is not null").run(id).changes) > 0 ? "ok" : "last-method";
  }

  // ── Discord logins waiting for a new account ───────────────────────────

  /** Holds a checked Discord login for 10 minutes while the app asks the user; the ticket goes to the app once, only its hash is kept. */
  holdDiscord(discord: DiscordLogin, now: number): string {
    this.db.prepare("delete from discord_tickets where expires_at <= ?").run(now);
    const ticket = randomBytes(32).toString("base64url");
    this.db.prepare("insert into discord_tickets (ticket_hash, discord_id, discord_name, expires_at) values (?, ?, ?, ?)").run(sha256(`ticket:${ticket}`), discord.id, discord.name, now + DISCORD_TICKET_TTL_MS);
    return ticket;
  }

  /** The Discord login a ticket holds, used up by taking it; null when unknown or expired. */
  takeDiscord(ticket: string, now: number): DiscordLogin | null {
    const hash = sha256(`ticket:${ticket}`);
    const row = this.db.prepare("select discord_id, discord_name, expires_at from discord_tickets where ticket_hash = ?").get(hash) as
      | { discord_id: string; discord_name: string; expires_at: number }
      | undefined;
    this.db.prepare("delete from discord_tickets where ticket_hash = ?").run(hash);
    return row && row.expires_at > now ? { id: row.discord_id, name: row.discord_name } : null;
  }

  /** Removes the account, every sign-in and every code waiting for it. Its developer name stays blocked for others for a while. */
  deleteAccount(id: string, now = Date.now()): void {
    this.db.exec("begin");
    try {
      const developer = this.developer(id);
      if (developer) this.release(nameKey(developer.name), id, now);
      this.db.prepare("delete from vaults where account_id = ?").run(id);
      this.db.prepare("delete from key_requests where account_id = ?").run(id);
      this.db.prepare("delete from publish_tokens where account_id = ?").run(id);
      this.db.prepare("delete from link_codes where account_id = ?").run(id);
      this.db.prepare("delete from publisher_keys where account_id = ?").run(id);
      this.db.prepare("delete from developers where account_id = ?").run(id);
      this.db.prepare("delete from codes where account_id = ?").run(id);
      this.db.prepare("delete from sessions where account_id = ?").run(id);
      this.db.prepare("delete from profiles where account_id = ?").run(id);
      this.db.prepare("delete from suspensions where account_id = ?").run(id);
      this.db.prepare("delete from accounts where id = ?").run(id);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  // ── Developer name and publisher keys ──────────────────────────────────

  developer(accountId: string): Developer | null {
    const row = this.db.prepare("select name, changed_at from developers where account_id = ?").get(accountId) as { name: string; changed_at: number } | undefined;
    return row ? { name: row.name, changedAt: row.changed_at } : null;
  }

  /**
   * Sets the account's developer name (checked with cleanDeveloperName first). Unique by nameKey
   * among developers and among names given up in the last NAME_HOLD_MS (except the account's own),
   * and changed at most once in that time.
   */
  setDeveloperName(accountId: string, name: string, now: number): NameChange {
    const key = nameKey(name);
    if (isReservedName(key)) return { ok: false, reason: "name-reserved" };
    const current = this.developer(accountId);
    if (current?.name === name) return { ok: true, developer: current };
    if (current && now - current.changedAt < NAME_HOLD_MS) return { ok: false, reason: "name-too-soon", nextChangeAt: current.changedAt + NAME_HOLD_MS };
    const owner = this.db.prepare("select account_id from developers where name_key = ?").get(key) as { account_id: string } | undefined;
    if (owner && owner.account_id !== accountId) return { ok: false, reason: "name-taken" };
    const held = this.db.prepare("select account_id from released_names where name_key = ? and released_at > ?").get(key, now - NAME_HOLD_MS) as { account_id: string } | undefined;
    if (held && held.account_id !== accountId) return { ok: false, reason: "name-taken" };
    this.db.exec("begin");
    try {
      if (current && nameKey(current.name) !== key) this.release(nameKey(current.name), accountId, now);
      this.db.prepare("delete from released_names where name_key = ? and account_id = ?").run(key, accountId);
      this.db
        .prepare(
          "insert into developers (account_id, name, name_key, changed_at) values (?, ?, ?, ?) on conflict (account_id) do update set name = excluded.name, name_key = excluded.name_key, changed_at = excluded.changed_at",
        )
        .run(accountId, name, key, now);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      // Taken a moment ago by another account.
      if (error instanceof Error && /UNIQUE/.test(error.message)) return { ok: false, reason: "name-taken" };
      throw error;
    }
    return { ok: true, developer: { name, changedAt: now } };
  }

  private release(key: string, accountId: string, now: number): void {
    this.db.prepare("insert or replace into released_names (name_key, account_id, released_at) values (?, ?, ?)").run(key, accountId, now);
  }

  /** A new one-time code to link a publisher key; any earlier one of the account stops working. Only its hash is kept. */
  linkCode(accountId: string, now: number): { code: string; expiresAt: number } {
    this.sweep(now);
    this.db.prepare("delete from link_codes where account_id = ?").run(accountId);
    const code = Array.from({ length: 8 }, () => LINK_ALPHABET[randomInt(0, LINK_ALPHABET.length)]).join("");
    const expiresAt = now + LINK_CODE_TTL_MS;
    this.db.prepare("insert into link_codes (code_hash, account_id, expires_at) values (?, ?, ?)").run(sha256(`link:${code}`), accountId, expiresAt);
    return { code, expiresAt };
  }

  /** The account a link code was made for, used up by taking it; null when unknown or expired. */
  takeLinkCode(code: string, now: number): string | null {
    const hash = sha256(`link:${code}`);
    const row = this.db.prepare("select account_id, expires_at from link_codes where code_hash = ?").get(hash) as { account_id: string; expires_at: number } | undefined;
    this.db.prepare("delete from link_codes where code_hash = ?").run(hash);
    return row && row.expires_at > now ? row.account_id : null;
  }

  /** Links a publisher key (its public half only) to an account. A key belongs to one account; linking it again is fine. */
  linkKey(accountId: string, fingerprint: string, publicKey: string, now: number): "ok" | "taken" | "too-many" {
    const owner = this.db.prepare("select account_id from publisher_keys where fingerprint = ?").get(fingerprint) as { account_id: string } | undefined;
    if (owner) return owner.account_id === accountId ? "ok" : "taken";
    // A key of a banned developer is never linked again, not even after the account is deleted.
    if (this.isBannedKey(fingerprint)) return "taken";
    if (this.keys(accountId).length >= MAX_KEYS) return "too-many";
    this.db.prepare("insert into publisher_keys (fingerprint, account_id, public_key, linked_at) values (?, ?, ?, ?)").run(fingerprint, accountId, publicKey, now);
    return "ok";
  }

  keys(accountId: string): LinkedKey[] {
    return (
      this.db.prepare("select fingerprint, linked_at from publisher_keys where account_id = ? order by linked_at, rowid").all(accountId) as unknown as { fingerprint: string; linked_at: number }[]
    ).map((row) => ({ fingerprint: row.fingerprint, linkedAt: new Date(row.linked_at).toISOString() }));
  }

  // ── Bans (decided 2026-10-26) ──────────────────────────────────────────

  /** Bans a developer account and every key linked to it now. `modules` are the ids delisted with the ban, to list again on unban. */
  ban(accountId: string, reason: string, note: string | null, modules: readonly string[], now: number): void {
    const email = this.account(accountId)?.email ?? null;
    const name = this.developer(accountId)?.name ?? null;
    this.db.exec("begin");
    try {
      this.db
        .prepare("insert into bans (account_id, reason, note, banned_at, modules, email, name) values (?, ?, ?, ?, ?, ?, ?) on conflict (account_id) do update set reason = excluded.reason, note = excluded.note, banned_at = excluded.banned_at, modules = excluded.modules")
        .run(accountId, reason, note, now, JSON.stringify(modules), email, name);
      this.db.prepare("insert into banned_keys (fingerprint, account_id) select fingerprint, account_id from publisher_keys where account_id = ? on conflict (fingerprint) do nothing").run(accountId);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  /** Lifts a ban; returns the module ids the ban delisted, or null when the account was not banned. */
  unban(accountId: string): string[] | null {
    const row = this.db.prepare("select modules from bans where account_id = ?").get(accountId) as { modules: string } | undefined;
    if (!row) return null;
    this.db.prepare("delete from banned_keys where account_id = ?").run(accountId);
    this.db.prepare("delete from bans where account_id = ?").run(accountId);
    return JSON.parse(row.modules) as string[];
  }

  /** Whether an account is banned. */
  isBanned(accountId: string): boolean {
    return this.db.prepare("select 1 from bans where account_id = ?").get(accountId) !== undefined;
  }

  /** Whether a key was linked to an account when it was banned: it can never be linked to another account. */
  /** The account a publisher key is linked to, or null. */
  accountOfKey(fingerprint: string): string | null {
    const row = this.db.prepare("select account_id from publisher_keys where fingerprint = ?").get(fingerprint) as { account_id: string } | undefined;
    return row?.account_id ?? null;
  }

  isBannedKey(fingerprint: string): boolean {
    return this.db.prepare("select 1 from banned_keys where fingerprint = ?").get(fingerprint) !== undefined;
  }

  bans(): { accountId: string; reason: string; note: string | null; bannedAt: number; modules: string[]; email: string | null; name: string | null }[] {
    return (this.db.prepare("select account_id, reason, note, banned_at, modules, email, name from bans order by banned_at desc").all() as unknown as { account_id: string; reason: string; note: string | null; banned_at: number; modules: string; email: string | null; name: string | null }[]).map(
      (row) => ({ accountId: row.account_id, reason: row.reason, note: row.note, bannedAt: row.banned_at, modules: JSON.parse(row.modules) as string[], email: row.email, name: row.name }),
    );
  }

  // ── Suspension (decided 2026-10-26) ────────────────────────────────────

  /**
   * Suspends an account: every sign-in and every code waiting for it is deleted at once, and from now on
   * nothing signs in. Returns how many devices were signed out. The person signs in again after unsuspend().
   */
  suspend(accountId: string, reason: string, note: string | null, now: number): number {
    this.db.exec("begin");
    try {
      const last = (this.db.prepare("select max(last_used_at) as at from sessions where account_id = ?").get(accountId) as { at: number | null }).at;
      this.db
        .prepare(
          "insert into suspensions (account_id, reason, note, suspended_at, last_active_at) values (?, ?, ?, ?, ?) on conflict (account_id) do update set reason = excluded.reason, note = excluded.note, suspended_at = excluded.suspended_at",
        )
        .run(accountId, reason, note, now, last);
      const signedOut = Number(this.db.prepare("delete from sessions where account_id = ?").run(accountId).changes);
      this.db.prepare("delete from codes where account_id = ?").run(accountId);
      // Sign-in codes wait under the hash of the address with no account id: they go too, so a code sent before can't be used.
      const email = (this.db.prepare("select email from accounts where id = ?").get(accountId) as { email: string | null } | undefined)?.email;
      if (email) this.db.prepare("delete from codes where address = ?").run(addressKey(email));
      this.db.prepare("delete from link_codes where account_id = ?").run(accountId);
      this.db.exec("commit");
      return signedOut;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  /** Lifts a suspension; false when the account was not suspended. The deleted sign-ins stay deleted. */
  unsuspend(accountId: string): boolean {
    return Number(this.db.prepare("delete from suspensions where account_id = ?").run(accountId).changes) > 0;
  }

  isSuspended(accountId: string): boolean {
    return this.db.prepare("select 1 from suspensions where account_id = ?").get(accountId) !== undefined;
  }

  suspension(accountId: string): Suspension | null {
    const row = this.db.prepare("select reason, note, suspended_at, last_active_at from suspensions where account_id = ?").get(accountId) as
      | { reason: string; note: string | null; suspended_at: number; last_active_at: number | null }
      | undefined;
    return row ? { reason: row.reason, note: row.note, suspendedAt: row.suspended_at, lastActiveAt: row.last_active_at } : null;
  }

  /** The ban of one account, or null. */
  banOf(accountId: string): { reason: string; note: string | null; bannedAt: number; modules: string[] } | null {
    const row = this.db.prepare("select reason, note, banned_at, modules from bans where account_id = ?").get(accountId) as
      | { reason: string; note: string | null; banned_at: number; modules: string }
      | undefined;
    return row ? { reason: row.reason, note: row.note, bannedAt: row.banned_at, modules: JSON.parse(row.modules) as string[] } : null;
  }

  // ── The maintainer's account list ──────────────────────────────────────

  /** Every account, newest first, for the admin panel. Includes the email and Discord name; no hash, token or picture. */
  accountRows(): AccountRow[] {
    const rows = this.db
      .prepare(
        `select a.id, a.email, a.discord_name, a.created_at, p.name as profile_name, p.initials, (p.picture is not null) as has_picture, d.name as developer_name,
           (select count(*) from sessions s where s.account_id = a.id) as devices,
           coalesce((select max(last_used_at) from sessions s where s.account_id = a.id), x.last_active_at) as last_active_at,
           (b.account_id is not null) as banned, (x.account_id is not null) as suspended
         from accounts a
         left join profiles p on p.account_id = a.id
         left join developers d on d.account_id = a.id
         left join bans b on b.account_id = a.id
         left join suspensions x on x.account_id = a.id
         order by a.created_at desc, a.rowid desc`,
      )
      .all() as unknown as {
      id: string;
      email: string | null;
      discord_name: string | null;
      created_at: number;
      profile_name: string | null;
      initials: string | null;
      has_picture: number;
      developer_name: string | null;
      devices: number;
      last_active_at: number | null;
      banned: number;
      suspended: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      discordName: row.discord_name,
      createdAt: row.created_at,
      profileName: row.profile_name,
      initials: row.initials,
      hasPicture: row.has_picture === 1,
      developerName: row.developer_name,
      devices: row.devices,
      lastActiveAt: row.last_active_at,
      banned: row.banned === 1,
      suspended: row.suspended === 1,
    }));
  }

  /** Every account's linked key fingerprints and held prefixes, for searching the list. */
  keysAndPrefixes(): Map<string, { keys: string[]; prefixes: string[] }> {
    const map = new Map<string, { keys: string[]; prefixes: string[] }>();
    const entry = (id: string) => map.get(id) ?? map.set(id, { keys: [], prefixes: [] }).get(id)!;
    for (const row of this.db.prepare("select account_id, fingerprint from publisher_keys").all() as unknown as { account_id: string; fingerprint: string }[]) entry(row.account_id).keys.push(row.fingerprint);
    for (const row of this.db.prepare("select account_id, prefix from module_prefixes").all() as unknown as { account_id: string; prefix: string }[]) entry(row.account_id).prefixes.push(row.prefix);
    return map;
  }

  /** Unlinks one of the account's keys; false when it has no such key. */
  unlinkKey(accountId: string, fingerprint: string): boolean {
    return Number(this.db.prepare("delete from publisher_keys where fingerprint = ? and account_id = ?").run(fingerprint, accountId).changes) > 0;
  }

  // ── Replacing a lost key ───────────────────────────────────────────────

  /**
   * Asks to replace a linked key with another key linked to the same account. One request per old key:
   * asking again changes nothing, except that "leaked" can be added, and a turned-down request can be
   * asked again.
   */
  requestReplacement(accountId: string, old: string, next: string, leaked: boolean, now: number): "ok" | "same" | "not-linked" | "open" {
    if (old === next) return "same";
    const linked = new Set(this.keys(accountId).map((key) => key.fingerprint));
    if (!linked.has(old) || !linked.has(next)) return "not-linked";
    const current = this.keyRequest(old);
    if (current && current.declinedAt === null) {
      if (current.new !== next) return "open";
      if (leaked && !current.leaked) this.db.prepare("update key_requests set leaked = 1 where old = ?").run(old);
      return "ok";
    }
    this.db
      .prepare(
        "insert into key_requests (old, account_id, new, leaked, requested_at, declined_at) values (?, ?, ?, ?, ?, null) on conflict (old) do update set account_id = excluded.account_id, new = excluded.new, leaked = excluded.leaked, requested_at = excluded.requested_at, declined_at = null",
      )
      .run(old, accountId, next, leaked ? 1 : 0, now);
    return "ok";
  }

  keyRequest(old: string): KeyRequest | null {
    const row = this.db.prepare("select * from key_requests where old = ?").get(old) as KeyRequestRow | undefined;
    return row ? keyRequestOf(row) : null;
  }

  keyRequests(accountId: string): KeyRequest[] {
    return (this.db.prepare("select * from key_requests where account_id = ? order by requested_at, rowid").all(accountId) as unknown as KeyRequestRow[]).map(keyRequestOf);
  }

  /** Every request, oldest first, for the maintainer's review page. */
  allKeyRequests(): KeyRequest[] {
    return (this.db.prepare("select * from key_requests order by requested_at, rowid").all() as unknown as KeyRequestRow[]).map(keyRequestOf);
  }

  /** The maintainer turns a request down; false when there is no open request for the key. */
  declineKeyRequest(old: string, now: number): boolean {
    return Number(this.db.prepare("update key_requests set declined_at = ? where old = ? and declined_at is null").run(now, old).changes) > 0;
  }

  /** When a key was linked to an account, in ms, or null. */
  keyLinkedAt(fingerprint: string): number | null {
    return (this.db.prepare("select linked_at from publisher_keys where fingerprint = ?").get(fingerprint) as { linked_at: number } | undefined)?.linked_at ?? null;
  }

  /** The account a publisher key is linked to, with the key's public half (base64), or null. */
  publisherKey(fingerprint: string): { accountId: string; publicKey: string } | null {
    const row = this.db.prepare("select account_id, public_key from publisher_keys where fingerprint = ?").get(fingerprint) as { account_id: string; public_key: string } | undefined;
    return row ? { accountId: row.account_id, publicKey: row.public_key } : null;
  }

  // ── Module id prefixes ─────────────────────────────────────────────────

  /**
   * Whether an account may publish under a module id prefix: it holds it, or may reserve it now.
   * First come; words reserved for developer names (anything with "tavora", "official", "local", …)
   * are refused, and an account holds at most MAX_PREFIXES. Prefixes are not kept with the account:
   * a deleted account's prefixes stay held, so nobody can publish new modules under its name.
   */
  prefixCheck(accountId: string, prefix: string): "held" | "free" | "taken" | "reserved" | "too-many" {
    const owner = this.db.prepare("select account_id from module_prefixes where prefix = ?").get(prefix) as { account_id: string } | undefined;
    if (owner) return owner.account_id === accountId ? "held" : "taken";
    if (isReservedName(nameKey(prefix))) return "reserved";
    return this.prefixes(accountId).length >= MAX_PREFIXES ? "too-many" : "free";
  }

  /** Reserves a prefix that prefixCheck called free. */
  reservePrefix(accountId: string, prefix: string, now: number): void {
    this.db.prepare("insert into module_prefixes (prefix, account_id, reserved_at) values (?, ?, ?)").run(prefix, accountId, now);
  }

  /** The prefixes an account holds, with when each was reserved (by a claim or its first publish). */
  heldPrefixes(accountId: string): { prefix: string; reservedAt: number }[] {
    return (this.db.prepare("select prefix, reserved_at from module_prefixes where account_id = ? order by prefix").all(accountId) as unknown as { prefix: string; reserved_at: number }[]).map(
      (row) => ({ prefix: row.prefix, reservedAt: row.reserved_at }),
    );
  }

  /** The account that holds a module id prefix, or null. */
  prefixHolder(prefix: string): string | null {
    return (this.db.prepare("select account_id from module_prefixes where prefix = ?").get(prefix) as { account_id: string } | undefined)?.account_id ?? null;
  }

  prefixes(accountId: string): string[] {
    return (this.db.prepare("select prefix from module_prefixes where account_id = ? order by prefix").all(accountId) as unknown as { prefix: string }[]).map((row) => row.prefix);
  }

  /** The developer name users see for a key, or null when the key is not linked or its account has no name. */
  publisherName(fingerprint: string): string | null {
    const row = this.db.prepare("select d.name from publisher_keys k join developers d on d.account_id = k.account_id where k.fingerprint = ?").get(fingerprint) as { name: string } | undefined;
    return row?.name ?? null;
  }

  // ── Counts for the admin panel ─────────────────────────────────────────

  /**
   * Numbers only, for the admin panel: accounts in total, made per day (the last 30 UTC days, oldest first),
   * and how many accounts have a sign-in used in the last 7 and 30 days. No address, name or id leaves here.
   */
  counts(now: number): AccountCounts {
    const total = (this.db.prepare("select count(*) as n from accounts").get() as { n: number }).n;
    const first = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) - 29 * DAY_MS;
    const made = this.db.prepare("select created_at from accounts where created_at >= ?").all(first) as unknown as { created_at: number }[];
    const perDay = Array.from({ length: 30 }, (_, index) => ({ day: new Date(first + index * DAY_MS).toISOString().slice(0, 10), count: 0 }));
    for (const { created_at } of made) {
      const slot = perDay[Math.floor((created_at - first) / DAY_MS)];
      if (slot) slot.count++;
    }
    const active = (days: number) =>
      (this.db.prepare("select count(distinct account_id) as n from sessions where last_used_at >= ?").get(now - days * DAY_MS) as { n: number }).n;
    return { total, perDay, active7: active(7), active30: active(30) };
  }

  // ── Mail sent per day ──────────────────────────────────────────────────

  /** How many emails went out on a day (YYYY-MM-DD, UTC): a number only, no addresses. */
  mailsSent(day: string): number {
    return (this.db.prepare("select sent from mail_days where day = ?").get(day) as { sent: number } | undefined)?.sent ?? 0;
  }

  countMail(day: string): void {
    this.db.prepare("insert into mail_days (day, sent) values (?, 1) on conflict (day) do update set sent = sent + 1").run(day);
    this.db.prepare("delete from mail_days where day < ?").run(new Date(Date.parse(`${day}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10));
  }

  // ── Key vault ──────────────────────────────────────────────────────────

  /** The account's sealed key vault (vault.ts): bytes only the user's recovery key opens. */
  vault(accountId: string): { version: number; data: Uint8Array; updatedAt: number } | null {
    const row = this.db.prepare("select version, data, updated_at from vaults where account_id = ?").get(accountId) as { version: number; data: Uint8Array; updated_at: number } | undefined;
    return row ? { version: row.version, data: row.data, updatedAt: row.updated_at } : null;
  }

  /** Stores a new vault, if the PC started from the current version (0 when there is none). */
  putVault(accountId: string, base: number, data: Uint8Array, now: number): { ok: true; version: number } | { ok: false; version: number } {
    const current = this.vault(accountId)?.version ?? 0;
    if (current !== base) return { ok: false, version: current };
    this.db
      .prepare("insert into vaults (account_id, version, data, updated_at) values (?, ?, ?, ?) on conflict (account_id) do update set version = excluded.version, data = excluded.data, updated_at = excluded.updated_at")
      .run(accountId, base + 1, data, now);
    return { ok: true, version: base + 1 };
  }

  removeVault(accountId: string): void {
    this.db.prepare("delete from vaults where account_id = ?").run(accountId);
  }

  // ── Publish tokens ─────────────────────────────────────────────────────

  /**
   * A token for publishing from CI (decided 2026-10-20): shown once, kept here only as a hash, good for a
   * year. It publishes under the account's prefixes, never a new one, and only together with the key's
   * signature. Null when the account has as many as it may.
   */
  createPublishToken(accountId: string, name: string, now: number): { token: string; publishToken: PublishToken } | null {
    if (this.publishTokens(accountId, now).length >= MAX_PUBLISH_TOKENS) return null;
    const token = `${PUBLISH_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const id = randomBytes(12).toString("base64url");
    const expiresAt = now + PUBLISH_TOKEN_TTL_MS;
    this.db.prepare("insert into publish_tokens (id, account_id, token_hash, name, created_at, expires_at) values (?, ?, ?, ?, ?, ?)").run(id, accountId, sha256(`publish:${token}`), name, now, expiresAt);
    return { token, publishToken: { id, name, createdAt: now, expiresAt, lastUsedAt: null } };
  }

  /** The account's publish tokens that haven't run out; those that have are dropped. */
  publishTokens(accountId: string, now: number): PublishToken[] {
    this.db.prepare("delete from publish_tokens where account_id = ? and expires_at <= ?").run(accountId, now);
    const rows = this.db.prepare("select id, name, created_at, expires_at, last_used_at from publish_tokens where account_id = ? order by created_at, rowid").all(accountId) as unknown as {
      id: string;
      name: string;
      created_at: number;
      expires_at: number;
      last_used_at: number | null;
    }[];
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: row.last_used_at }));
  }

  /** The account a publish token belongs to, while it is good; marks it used. */
  publishTokenAccount(token: string, now: number): { accountId: string; name: string } | null {
    if (!token.startsWith(PUBLISH_TOKEN_PREFIX)) return null;
    const row = this.db.prepare("select id, account_id, name, expires_at from publish_tokens where token_hash = ?").get(sha256(`publish:${token}`)) as
      | { id: string; account_id: string; name: string; expires_at: number }
      | undefined;
    if (!row || row.expires_at <= now) return null;
    // A suspended account's tokens publish nothing and are not marked used (a ban is refused by the routes, with its own answer).
    if (this.isSuspended(row.account_id)) return null;
    this.db.prepare("update publish_tokens set last_used_at = ? where id = ?").run(now, row.id);
    return { accountId: row.account_id, name: row.name };
  }

  /** False when the account has no such token. */
  deletePublishToken(accountId: string, id: string): boolean {
    return this.db.prepare("delete from publish_tokens where account_id = ? and id = ?").run(accountId, id).changes > 0;
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
   * has no account yet and ask the user before it creates one.
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
  createSession(accountId: string, os: DeviceOs, now: number, name: string | null = null): { token: string; session: Session } {
    const token = randomBytes(32).toString("base64url");
    const id = randomBytes(12).toString("base64url");
    this.db
      .prepare("insert into sessions (id, token_hash, account_id, os, name, created_at, last_used_at) values (?, ?, ?, ?, ?, ?, ?)")
      .run(id, sha256(`session:${token}`), accountId, os, name, now, now);
    return { token, session: { id, accountId } };
  }

  /** The sign-in a token belongs to, or null when it is unknown or has gone unused for a year. */
  sessionByToken(token: string, now: number): Session | null {
    const row = this.db.prepare("select id, account_id, last_used_at from sessions where token_hash = ?").get(sha256(`session:${token}`)) as
      | { id: string; account_id: string; last_used_at: number }
      | undefined;
    if (!row) return null;
    // A suspended account has no sign-ins left; this is the second lock should one ever appear.
    if (this.isSuspended(row.account_id)) return null;
    if (row.last_used_at <= now - SESSION_IDLE_MS) {
      this.db.prepare("delete from sessions where id = ?").run(row.id);
      return null;
    }
    if (now - row.last_used_at > SESSION_TOUCH_MS) this.db.prepare("update sessions set last_used_at = ? where id = ?").run(now, row.id);
    return { id: row.id, accountId: row.account_id };
  }

  devices(accountId: string): Device[] {
    return (
      this.db.prepare("select id, os, name, created_at, last_used_at from sessions where account_id = ? order by created_at, rowid").all(accountId) as unknown as {
        id: string;
        os: DeviceOs;
        name: string | null;
        created_at: number;
        last_used_at: number;
      }[]
    ).map((row) => ({ id: row.id, os: row.os, name: row.name, createdAt: new Date(row.created_at).toISOString(), lastUsedAt: new Date(row.last_used_at).toISOString() }));
  }

  /** Names one device of an account; false when the account has no such device. */
  renameSession(accountId: string, id: string, name: string): boolean {
    return Number(this.db.prepare("update sessions set name = ? where id = ? and account_id = ?").run(name, id, accountId).changes) > 0;
  }

  /** Signs out one device of an account; false when the account has no such device. */
  deleteSession(accountId: string, id: string): boolean {
    return Number(this.db.prepare("delete from sessions where id = ? and account_id = ?").run(id, accountId).changes) > 0;
  }

  /** Plain numbers for the daily snapshot: all accounts, and those with a sign-in used in the last 7 and 30 days. Nobody is named. */
  activity(now: number): { total: number; active7: number; active30: number } {
    const count = (sql: string, ...args: number[]) => (this.db.prepare(sql).get(...args) as { n: number }).n;
    const active = (days: number) => count("select count(distinct account_id) as n from sessions where last_used_at > ?", now - days * DAY_MS);
    return { total: count("select count(*) as n from accounts"), active7: active(7), active30: active(30) };
  }

  // ── Housekeeping ───────────────────────────────────────────────────────

  private sweep(now: number): void {
    this.db.prepare("delete from codes where expires_at <= ?").run(now);
    this.db.prepare("delete from code_requests where at <= ?").run(now - DAY_MS);
    this.db.prepare("delete from discord_tickets where expires_at <= ?").run(now);
    this.db.prepare("delete from sessions where last_used_at <= ?").run(now - SESSION_IDLE_MS);
    this.db.prepare("delete from link_codes where expires_at <= ?").run(now);
    this.db.prepare("delete from released_names where released_at <= ?").run(now - NAME_HOLD_MS);
  }
}

const ACCOUNT_COLUMNS = "id, email, discord_id, discord_name, created_at";

function toAccount(row: unknown): Account | null {
  if (!row) return null;
  const { id, email, discord_id, discord_name, created_at } = row as { id: string; email: string | null; discord_id: string | null; discord_name: string | null; created_at: number };
  return { id, email, discord: discord_id ? { id: discord_id, name: discord_name ?? "" } : null, createdAt: new Date(created_at).toISOString() };
}

const secondsUntil = (at: number, now: number) => Math.max(1, Math.ceil((at - now) / 1000));
