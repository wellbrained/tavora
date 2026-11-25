import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "./hash.ts";
import { openStateDb } from "./sqlite.ts";

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
/**
 * Of CODE_MAX_TRIES, the wrong tries that may come from other networks than the one that asked for a code (audit
 * 2026-11-22): once they are used, others are refused without a check, so a stranger can't spend someone's code by
 * guessing, and the network that asked keeps at least 2 tries. A code still takes at most CODE_MAX_TRIES wrong tries in all.
 */
export const CODE_OTHER_TRIES = 3;
/**
 * Codes one address can be sent, in three groups that never use up each other's room:
 * - the account's own sign-in asking for its own address (changing it, deleting the account, connecting or removing
 *   Discord): 3 every 15 minutes and 10 a day;
 * - a sign-in code asked from a network the address signed in from in the last 30 days (KNOWN_NETWORK_MS): 3 every
 *   15 minutes and 5 a day per network;
 * - anyone else (a sign-in code from a new network, a code to a new address, a suspended account's delete code): 3
 *   every 15 minutes and 5 a day per network, and 10 a day from all of them together.
 * Strangers on other networks can only use up the last group: the owner still signs in from a network they used
 * before and still changes or deletes from inside the account, and strangers can mail the address at most 10 times a
 * day. An owner on a network they never signed in from shares that group with strangers. The 3 codes an address may
 * draw from the emails kept for accounts on a busy day (accounts.ts accountShareRateLimiter) are counted per group too
 * (codeGroup), so strangers can't use up those of the networks the owner signed in from either.
 */
export const CODES_PER_WINDOW = 3;
export const CODE_WINDOW_MS = 15 * 60_000;
export const CODES_PER_DAY = 10;
export const CODES_PER_ASKER_DAY = 5;
export const CODES_FROM_OTHERS_PER_DAY = 10;
/** How long a network an address signed in from counts as the owner's. */
export const KNOWN_NETWORK_MS = 30 * 24 * 60 * 60_000;
/** code_requests.owner: which group of an address's limits a request counts in. */
const ASKED_BY = { stranger: 0, owner: 1, known: 2 } as const;
type AskedBy = (typeof ASKED_BY)[keyof typeof ASKED_BY];
/** Networks and addresses whose requests are kept in memory at once; past this the oldest go first. */
const MAX_ASKERS = 100_000;
const DAY_MS = 24 * 60 * 60_000;
/** A sign-in unused for a year ends. */
export const SESSION_IDLE_MS = 365 * DAY_MS;
/** A publish token is good this long (decided 2026-10-20). */
export const PUBLISH_TOKEN_TTL_MS = 365 * DAY_MS;
export const MAX_PUBLISH_TOKENS = 10;
/** How long, and how many, notices that couldn't go out the app is told of (unsentNotices). */
export const UNSENT_NOTICE_MS = 30 * DAY_MS;
export const MAX_UNSENT_NOTICES = 50;

/** A notice about an account's publishing that couldn't go out: a version published, sent for review, or taken back. */
export interface UnsentNotice {
  kind: "published" | "waiting" | "withdrawn";
  id: string;
  name: string;
  version: string;
  at: number;
}
/** Publish tokens start like this, so they are told apart from sign-ins (and found by secret scanners). */
export const PUBLISH_TOKEN_PREFIX = "tvp_";
/** How often a session's last use is written, so every request is not a write. */
const SESSION_TOUCH_MS = 60 * 60_000;

export const DEVICE_OS = ["windows", "linux", "macos", "other"] as const;
export type DeviceOs = (typeof DEVICE_OS)[number];

/**
 * What a code is for. A sign-in code also creates the account when the address has none. Changing the address takes
 * two: "change-email" to the new address and "confirm-email-change" to the current one.
 */
export type CodePurpose = "sign-in" | "change-email" | "confirm-email-change" | "remove-email" | "connect-discord" | "remove-discord" | "delete";

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
/** What removing a way in gave: the new sign-in of the one who asked (null when it had none), or why nothing changed. */
export type MethodRemoved = { status: "ok"; token: string | null; session: Session | null } | { status: "last-method" };

/**
 * Who asks for a code to an address: the account's own sign-in for the account's own address (`owner`), or anyone
 * else, by the network they ask from (rate-limit.ts networkOf). The network is only held in memory, never written.
 */
export type CodeAsker = { owner: true } | { from: string };

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
  /** When the key was reported as leaked, which can be after the request; null when it wasn't, or for a report from before this was kept. */
  leakedAt: number | null;
  /** When the maintainer turned it down; null while it waits or once it is signed. */
  declinedAt: number | null;
  /**
   * Whether the account's address was told of the request as it is now (new, or marked leaked): false when no notice
   * went out, null for a request from before this was kept.
   */
  notified: boolean | null;
}

export type NameChange = { ok: true; developer: Developer } | { ok: false; reason: "name-taken" | "name-reserved" | "name-too-soon"; nextChangeAt?: number };

/** What prefixCheck asks the module catalog (CatalogStore). */
export interface PublishedModules {
  /** The publisher keys of every module, listed or not, whose id is under this prefix. */
  ownersUnder(prefix: string): string[];
}

/** How long a checked Discord login waits for the user's yes to a new account. */
export const DISCORD_TICKET_TTL_MS = 10 * 60_000;


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
const addressKey = (email: string) => sha256Hex(`address:${email}`);
const codeHash = (key: string, purpose: CodePurpose, code: string) => sha256Hex(`code:${key}:${purpose}:${code}`);
/** A code that holds only for one thing, such as the current address's code for one new address: that goes into its hash. */
const bound = (code: string, bind: string | undefined) => (bind === undefined ? code : `${code}:${bind}`);

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
  leaked_at?: number | null;
  declined_at: number | null;
  notified?: number | null;
}

const keyRequestOf = (row: KeyRequestRow): KeyRequest => ({
  old: row.old,
  new: row.new,
  accountId: row.account_id,
  leaked: row.leaked === 1,
  requestedAt: row.requested_at,
  leakedAt: row.leaked_at ?? null,
  declinedAt: row.declined_at,
  notified: row.notified === null || row.notified === undefined ? null : row.notified === 1,
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
  /**
   * When codes went to an address at someone else's request, per network and address (a hash of both), for the last
   * day. Only in memory, like the rate limits: nothing about where a request came from is written down.
   */
  private readonly askers = new Map<string, number[]>();
  private askersSweptAt = 0;

  constructor(path: string) {
    this.db = openStateDb(path);
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
      create table if not exists code_requests (address text not null, at integer not null, owner integer not null default 0);
      -- Networks an address signed in from lately: only a hash of both, and when it stops counting (KNOWN_NETWORK_MS).
      create table if not exists known_networks (hash text primary key, expires_at integer not null);
      create index if not exists code_requests_address on code_requests (address, at);
      create table if not exists sessions (
        id text primary key, token_hash text not null unique,
        account_id text not null references accounts (id) on delete cascade,
        os text not null, name text, created_at integer not null, last_used_at integer not null
      );
      create index if not exists sessions_account on sessions (account_id);
      create table if not exists mail_days (day text primary key, sent integer not null, new_full_at integer);
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
      -- Keys reported as leaked whose request went with the key's link or the account (key_requests rows go with the account).
      -- No foreign key and nothing about the account: the key stays leaked, its revocation still gets signed, and no account can link it.
      create table if not exists leaked_keys (fingerprint text primary key, requested_at integer not null);
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
    // Code requests by the account's own sign-in are counted apart from everyone else's; older ones count as anyone's.
    const requestColumns = (this.db.prepare("pragma table_info(code_requests)").all() as unknown as { name: string }[]).map((column) => column.name);
    if (!requestColumns.includes("owner")) this.db.exec("alter table code_requests add column owner integer not null default 0");
    // When the day's emails for new addresses ran out came later too.
    const mailColumns = (this.db.prepare("pragma table_info(mail_days)").all() as unknown as { name: string }[]).map((column) => column.name);
    if (!mailColumns.includes("new_full_at")) this.db.exec("alter table mail_days add column new_full_at integer");
    // Whether a key request's address was told of it (setKeyRequestNotified); null for requests from before it. An older
    // service writes requests without it, which then read as null.
    const keyRequestColumns = (this.db.prepare("pragma table_info(key_requests)").all() as unknown as { name: string }[]).map((column) => column.name);
    if (!keyRequestColumns.includes("notified")) this.db.exec("alter table key_requests add column notified integer");
    // When a key was reported as leaked: a report can come after the request. Older reports read as made at the request.
    if (!keyRequestColumns.includes("leaked_at")) this.db.exec("alter table key_requests add column leaked_at integer");
    // A leaked key's request and report dates, kept once its request is gone, for the versions listed between them (revocationEntries).
    const leakedColumns = (this.db.prepare("pragma table_info(leaked_keys)").all() as unknown as { name: string }[]).map((column) => column.name);
    if (!leakedColumns.includes("asked_at")) this.db.exec("alter table leaked_keys add column asked_at integer");
    if (!leakedColumns.includes("reported_at")) this.db.exec("alter table leaked_keys add column reported_at integer");
    // The sign-in that made a publish token, a link code or (through its link code) linked a key, so changing the address
    // can take back what other sign-ins made (changeEmail); null for those from before it, which count as made elsewhere.
    // A paused key (paused_at) stays the account's but signs nothing until it is linked again. An older service leaves
    // these alone (and would let a paused key sign again).
    const addColumn = (table: string, column: string, type: string) => {
      const present = (this.db.prepare(`pragma table_info(${table})`).all() as unknown as { name: string }[]).some((row) => row.name === column);
      if (!present) this.db.exec(`alter table ${table} add column ${column} ${type}`);
    };
    addColumn("publish_tokens", "session_id", "text");
    addColumn("link_codes", "session_id", "text");
    addColumn("publisher_keys", "session_id", "text");
    addColumn("publisher_keys", "paused_at", "integer");
    // Who asked for a code (a hash of their network and the address; null for the account's own sign-in and older codes),
    // and the wrong tries from everyone else (CODE_OTHER_TRIES).
    addColumn("codes", "asker", "text");
    addColumn("codes", "other_tries", "integer not null default 0");
    addColumn("codes", "known", "integer");
    // A code someone else asked for, kept beside the newest (requestCode): the same fields again. An older service
    // replaces the row without them, which drops the kept one, as it always did.
    addColumn("codes", "prev_hash", "text");
    addColumn("codes", "prev_asker", "text");
    addColumn("codes", "prev_known", "integer");
    addColumn("codes", "prev_expires_at", "integer");
    addColumn("codes", "prev_tries", "integer not null default 0");
    addColumn("codes", "prev_other_tries", "integer not null default 0");
    // Notices about publishing sent for an account on a day (takeNotice): their own share of the day's emails.
    this.db.exec("create table if not exists notice_days (day text not null, account_id text not null, sent integer not null, primary key (day, account_id))");
    // Notices about the account's publishing that couldn't go out (a busy day, a failed send), so the app can say so: the
    // developer then checks that those versions were theirs. Kept for UNSENT_NOTICE_MS.
    this.db.exec("create table if not exists unsent_notices (account_id text not null, kind text not null, module_id text not null, name text not null, version text not null, at integer not null)");
    this.db.exec("create index if not exists unsent_notices_account on unsent_notices (account_id, at)");
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

  /** How many accounts were made from `since` on (ms) that still exist. */
  accountsCreatedSince(since: number): number {
    return (this.db.prepare("select count(*) as n from accounts where created_at >= ?").get(since) as { n: number }).n;
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

  /**
   * Sets or changes the email address (a Discord-only account gets its first one this way). Every other sign-in of the
   * account ends, and every code still waiting for it or for the old address goes (decided 2026-11-13), so what a
   * stolen sign-in or an old mailbox started can't finish afterwards.
   *
   * Taking an account back (audit 2026-11-22): every sign-in ends, the one that made the change too, which gets a new one
   * in its place (`rotate`: its id), so a copy of its token is no use either. Everything made for publishing goes with them
   * (revokeMinted): every publish token and link code, and every key pauses until it is linked again.
   */
  changeEmail(id: string, email: string, rotate: string | null, now: number = Date.now()): { status: "taken" } | { status: "ok"; token: string | null; session: Session | null } {
    if (this.accountByEmail(email)) return { status: "taken" };
    let renewed: { token: string; session: Session } | null = null;
    this.db.exec("begin");
    try {
      const old = this.account(id)?.email ?? null;
      const current = rotate === null ? undefined : (this.db.prepare("select os, name from sessions where id = ? and account_id = ?").get(rotate, id) as { os: DeviceOs; name: string | null } | undefined);
      this.db.prepare("update accounts set email = ? where id = ?").run(email, id);
      this.db.prepare("delete from sessions where account_id = ?").run(id);
      this.db.prepare("delete from codes where account_id = ?").run(id);
      // Sign-in codes wait under the old address with no account id.
      if (old) this.db.prepare("delete from codes where address = ?").run(addressKey(old));
      this.revokeMinted(id, "all", now);
      if (current) renewed = this.createSession(id, current.os, now, current.name);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return { status: "ok", token: renewed?.token ?? null, session: renewed?.session ?? null };
  }

  /**
   * Takes back what was made for publishing (audit 2026-11-22), inside the caller's transaction: by every sign-in of the
   * account (`"all"`, tokens and keys from before sign-ins were kept with them too), or by one (`{ session }`). Their publish
   * tokens and link codes are deleted, and the keys linked through them are paused. A paused key stays the account's, so
   * nobody else can link it and its modules stay where they are, but it signs no upload until the owner links it again
   * (which takes its private half); a request to move a key onto a paused one goes too, a leaked report staying.
   */
  private revokeMinted(accountId: string, scope: "all" | { session: string }, now: number): void {
    const which = scope === "all" ? "" : " and session_id = ?";
    const values = scope === "all" ? [accountId] : [accountId, scope.session];
    this.db.prepare(`delete from publish_tokens where account_id = ?${which}`).run(...values);
    this.db.prepare(`delete from link_codes where account_id = ?${which}`).run(...values);
    this.db.prepare(`update publisher_keys set paused_at = ? where account_id = ? and paused_at is null${which}`).run(now, ...values);
    const ontoPaused = "account_id = ? and declined_at is null and new in (select fingerprint from publisher_keys where account_id = ? and paused_at is not null)";
    this.keepLeaked(ontoPaused, accountId, accountId);
    this.db.prepare(`delete from key_requests where ${ontoPaused}`).run(accountId, accountId);
  }

  /**
   * Removes the email address, only while a Discord login remains. Like an email change, every sign-in ends and what they
   * made for publishing goes (audit run 7): one made with the address, by someone who could read it, must not outlive it.
   * The one asking (`rotate`) gets a new sign-in in place of its own.
   */
  removeEmail(id: string, rotate: string | null = null, now: number = Date.now()): MethodRemoved {
    const old = this.account(id)?.email ?? null;
    return this.removeMethod(id, rotate, now, () => {
      if (Number(this.db.prepare("update accounts set email = null where id = ? and email is not null and discord_id is not null").run(id).changes) === 0) return false;
      // Sign-in codes wait under the address with no account id.
      if (old) this.db.prepare("delete from codes where address = ?").run(addressKey(old));
      return true;
    });
  }

  /** Ends every sign-in of the account after `remove` took a way in away, inside one transaction (removeEmail, removeDiscord). */
  private removeMethod(id: string, rotate: string | null, now: number, remove: () => boolean): MethodRemoved {
    let renewed: { token: string; session: Session } | null = null;
    this.db.exec("begin");
    try {
      if (!remove()) {
        this.db.exec("rollback");
        return { status: "last-method" };
      }
      const current = rotate === null ? undefined : (this.db.prepare("select os, name from sessions where id = ? and account_id = ?").get(rotate, id) as { os: DeviceOs; name: string | null } | undefined);
      this.db.prepare("delete from sessions where account_id = ?").run(id);
      this.db.prepare("delete from codes where account_id = ?").run(id);
      this.revokeMinted(id, "all", now);
      if (current) renewed = this.createSession(id, current.os, now, current.name);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return { status: "ok", token: renewed?.token ?? null, session: renewed?.session ?? null };
  }

  /** Connects a Discord login, unless another account has it. Never merges accounts. */
  setDiscord(id: string, discord: DiscordLogin): "ok" | "taken" {
    const owner = this.accountByDiscord(discord.id);
    if (owner && owner.id !== id) return "taken";
    this.db.prepare("update accounts set discord_id = ?, discord_name = ? where id = ?").run(discord.id, discord.name, id);
    return "ok";
  }

  /**
   * Disconnects Discord, only while an email address remains. Every sign-in ends, as for removeEmail: one made with a Discord
   * login someone else had stops working with it (audit run 7).
   */
  removeDiscord(id: string, rotate: string | null = null, now: number = Date.now()): MethodRemoved {
    return this.removeMethod(
      id,
      rotate,
      now,
      () => Number(this.db.prepare("update accounts set discord_id = null, discord_name = null where id = ? and discord_id is not null and email is not null").run(id).changes) > 0,
    );
  }

  // ── Discord logins waiting for a new account ───────────────────────────

  /** Holds a checked Discord login for 10 minutes while the app asks the user; the ticket goes to the app once, only its hash is kept. */
  holdDiscord(discord: DiscordLogin, now: number): string {
    this.db.prepare("delete from discord_tickets where expires_at <= ?").run(now);
    const ticket = randomBytes(32).toString("base64url");
    this.db.prepare("insert into discord_tickets (ticket_hash, discord_id, discord_name, expires_at) values (?, ?, ?, ?)").run(sha256Hex(`ticket:${ticket}`), discord.id, discord.name, now + DISCORD_TICKET_TTL_MS);
    return ticket;
  }

  /** The Discord login a ticket holds, without using it up; null when unknown or expired. */
  peekDiscord(ticket: string, now: number): DiscordLogin | null {
    const row = this.db.prepare("select discord_id, discord_name, expires_at from discord_tickets where ticket_hash = ?").get(sha256Hex(`ticket:${ticket}`)) as
      | { discord_id: string; discord_name: string; expires_at: number }
      | undefined;
    return row && row.expires_at > now ? { id: row.discord_id, name: row.discord_name } : null;
  }

  /** The Discord login a ticket holds, used up by taking it; null when unknown or expired. */
  takeDiscord(ticket: string, now: number): DiscordLogin | null {
    const hash = sha256Hex(`ticket:${ticket}`);
    const row = this.db.prepare("select discord_id, discord_name, expires_at from discord_tickets where ticket_hash = ?").get(hash) as
      | { discord_id: string; discord_name: string; expires_at: number }
      | undefined;
    this.db.prepare("delete from discord_tickets where ticket_hash = ?").run(hash);
    return row && row.expires_at > now ? { id: row.discord_id, name: row.discord_name } : null;
  }

  /**
   * Removes the account, every sign-in and every code waiting for it. Its developer name stays blocked for others for a while,
   * and a key it reported as leaked stays leaked (leaked_keys).
   */
  deleteAccount(id: string, now = Date.now()): void {
    this.db.exec("begin");
    try {
      this.keepLeaked("account_id = ?", id);
      const developer = this.developer(id);
      if (developer) this.release(nameKey(developer.name), id, now);
      this.db.prepare("delete from vaults where account_id = ?").run(id);
      this.db.prepare("delete from key_requests where account_id = ?").run(id);
      this.db.prepare("delete from publish_tokens where account_id = ?").run(id);
      this.db.prepare("delete from notice_days where account_id = ?").run(id);
      this.db.prepare("delete from unsent_notices where account_id = ?").run(id);
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

  /**
   * A new one-time code to link a publisher key; any earlier one of the account stops working. Only its hash is kept, with
   * the sign-in that asked for it (`sessionId`), which the key it links is kept with.
   */
  linkCode(accountId: string, now: number, sessionId: string | null = null): { code: string; expiresAt: number } | null {
    this.sweep(now);
    this.db.prepare("delete from link_codes where account_id = ?").run(accountId);
    const code = Array.from({ length: 8 }, () => LINK_ALPHABET[randomInt(0, LINK_ALPHABET.length)]).join("");
    const expiresAt = now + LINK_CODE_TTL_MS;
    // Only while the sign-in that asks still exists, as for publish tokens; null otherwise.
    const made = this.db
      .prepare("insert into link_codes (code_hash, account_id, expires_at, session_id) select ?, ?, ?, ? where ? is null or exists (select 1 from sessions where id = ? and account_id = ?)")
      .run(sha256Hex(`link:${code}`), accountId, expiresAt, sessionId, sessionId, sessionId, accountId);
    return Number(made.changes) > 0 ? { code, expiresAt } : null;
  }

  /** The account a link code was made for, used up by taking it; null when unknown or expired. */
  takeLinkCode(code: string, now: number): string | null {
    return this.takeLink(code, now)?.accountId ?? null;
  }

  /** The account a link code was made for and the sign-in that asked for it, used up by taking it; null when unknown or expired. */
  takeLink(code: string, now: number): { accountId: string; sessionId: string | null } | null {
    const hash = sha256Hex(`link:${code}`);
    const row = this.db.prepare("select account_id, expires_at, session_id from link_codes where code_hash = ?").get(hash) as
      | { account_id: string; expires_at: number; session_id: string | null }
      | undefined;
    this.db.prepare("delete from link_codes where code_hash = ?").run(hash);
    return row && row.expires_at > now ? { accountId: row.account_id, sessionId: row.session_id } : null;
  }

  /**
   * Links a publisher key (its public half only) to an account. A key belongs to one account; linking it again is fine,
   * and wakes it when it was paused (revokeMinted). "leaked": reported as leaked, so no account links it (the caller also
   * refuses a key the signed lists revoke). `sessionId`: the sign-in whose link code this is.
   */
  linkKey(accountId: string, fingerprint: string, publicKey: string, now: number, sessionId: string | null = null): "ok" | "taken" | "leaked" | "too-many" {
    const owner = this.db.prepare("select account_id from publisher_keys where fingerprint = ?").get(fingerprint) as { account_id: string } | undefined;
    if (owner) {
      if (owner.account_id !== accountId) return "taken";
      this.db.prepare("update publisher_keys set paused_at = null, session_id = ? where fingerprint = ? and paused_at is not null").run(sessionId, fingerprint);
      return "ok";
    }
    // A key of a banned developer is never linked again, not even after the account is deleted.
    if (this.isBannedKey(fingerprint)) return "taken";
    // Nor is a key reported as leaked, by any account, deleted or not: whoever has it now isn't its developer.
    if (this.isLeakedKey(fingerprint)) return "leaked";
    if (this.keys(accountId).length >= MAX_KEYS) return "too-many";
    this.db.prepare("insert into publisher_keys (fingerprint, account_id, public_key, linked_at, session_id) values (?, ?, ?, ?, ?)").run(fingerprint, accountId, publicKey, now, sessionId);
    return "ok";
  }

  /** The account's keys, paused ones too: they are still its own (revokeMinted). */
  keys(accountId: string): LinkedKey[] {
    return (
      this.db.prepare("select fingerprint, linked_at from publisher_keys where account_id = ? order by linked_at, rowid").all(accountId) as unknown as { fingerprint: string; linked_at: number }[]
    ).map((row) => ({ fingerprint: row.fingerprint, linkedAt: new Date(row.linked_at).toISOString() }));
  }

  /** The fingerprints of the account's paused keys (revokeMinted): they sign nothing until linked again. */
  pausedKeys(accountId: string): Set<string> {
    const rows = this.db.prepare("select fingerprint from publisher_keys where account_id = ? and paused_at is not null").all(accountId) as unknown as { fingerprint: string }[];
    return new Set(rows.map((row) => row.fingerprint));
  }

  // ── Bans (decided 2026-10-26) ──────────────────────────────────────────

  /** Bans a developer account and every key linked to it now. `modules` are the ids delisted with the ban, to list again on unban. */
  ban(accountId: string, reason: string, note: string | null, modules: readonly string[], now: number): void {
    const email = this.account(accountId)?.email ?? null;
    const name = this.developer(accountId)?.name ?? null;
    this.db.exec("begin");
    try {
      // Banning again (to finish a ban that stopped halfway) keeps the first ban: its reason, its time and the modules it named.
      const all = [...new Set([...(this.bannedModules(accountId) ?? []), ...modules])];
      this.db
        .prepare("insert into bans (account_id, reason, note, banned_at, modules, email, name) values (?, ?, ?, ?, ?, ?, ?) on conflict (account_id) do update set modules = excluded.modules")
        .run(accountId, reason, note, now, JSON.stringify(all), email, name);
      this.db.prepare("insert into banned_keys (fingerprint, account_id) select fingerprint, account_id from publisher_keys where account_id = ? on conflict (fingerprint) do nothing").run(accountId);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  /** The module ids a ban delisted, or null when the account is not banned. */
  bannedModules(accountId: string): string[] | null {
    const row = this.db.prepare("select modules from bans where account_id = ?").get(accountId) as { modules: string } | undefined;
    return row ? (JSON.parse(row.modules) as string[]) : null;
  }

  /** Lifts a ban; returns the module ids the ban delisted, or null when the account was not banned. */
  unban(accountId: string): string[] | null {
    const modules = this.bannedModules(accountId);
    if (modules === null) return null;
    this.db.exec("begin");
    try {
      this.db.prepare("delete from banned_keys where account_id = ?").run(accountId);
      this.db.prepare("delete from bans where account_id = ?").run(accountId);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return modules;
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

  /** The accounts that are suspended or banned now: public lists such as leaderboards leave them out. */
  suspendedOrBanned(): Set<string> {
    const rows = this.db.prepare("select account_id from suspensions union select account_id from bans").all() as { account_id: string }[];
    return new Set(rows.map((row) => row.account_id));
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

  /** Unlinks one of the account's keys; false when it has no such key. A key it reported as leaked stays leaked. */
  unlinkKey(accountId: string, fingerprint: string): boolean {
    this.db.exec("begin");
    try {
      const unlinked = Number(this.db.prepare("delete from publisher_keys where fingerprint = ? and account_id = ?").run(fingerprint, accountId).changes) > 0;
      if (unlinked) this.keepLeaked("account_id = ? and old = ?", accountId, fingerprint);
      this.db.exec("commit");
      return unlinked;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  /** Copies the leaked reports (not turned down) among the key requests `where` picks into leaked_keys, where they outlive the account. */
  private keepLeaked(where: string, ...values: string[]): void {
    this.db
      .prepare(`insert into leaked_keys (fingerprint, requested_at, asked_at, reported_at) select old, coalesce(leaked_at, requested_at), requested_at, leaked_at from key_requests where ${where} and leaked = 1 and declined_at is null on conflict (fingerprint) do nothing`)
      .run(...values);
  }

  /**
   * The keys of leakedKeys() with the time nobody can vouch for: from when the key was first asked about (`from`) to when it was
   * reported as leaked (`to`). `to` is null when that report's date wasn't kept (reports from before it was).
   */
  leakedKeyWindows(): { fingerprint: string; reportedAt: number; from: number; to: number | null }[] {
    const rows = this.db.prepare("select fingerprint, requested_at, asked_at, reported_at from leaked_keys order by requested_at, rowid").all() as unknown as { fingerprint: string; requested_at: number; asked_at: number | null; reported_at: number | null }[];
    return rows.map((row) => ({ fingerprint: row.fingerprint, reportedAt: row.requested_at, from: row.asked_at ?? row.requested_at, to: row.asked_at === null ? null : row.reported_at }));
  }

  /** Whether a key was reported as leaked and the report wasn't turned down, also after its account unlinked it or was deleted. */
  isLeakedKey(fingerprint: string): boolean {
    return (
      this.db.prepare("select 1 from leaked_keys where fingerprint = ?").get(fingerprint) !== undefined ||
      this.db.prepare("select 1 from key_requests where old = ? and leaked = 1 and declined_at is null").get(fingerprint) !== undefined
    );
  }

  /** Whether this account reported a key of its own as leaked and the report wasn't turned down, also when it has unlinked that key since. */
  hasLeakedReport(accountId: string): boolean {
    return this.db.prepare("select 1 from key_requests where account_id = ? and leaked = 1 and declined_at is null limit 1").get(accountId) !== undefined;
  }

  /** Keys reported as leaked whose request went with the key's link or its account, oldest first: their revocations still get signed. */
  leakedKeys(): { fingerprint: string; requestedAt: number }[] {
    return (this.db.prepare("select fingerprint, requested_at from leaked_keys order by requested_at, rowid").all() as unknown as { fingerprint: string; requested_at: number }[]).map((row) => ({
      fingerprint: row.fingerprint,
      requestedAt: row.requested_at,
    }));
  }

  // ── Replacing a lost key ───────────────────────────────────────────────

  /**
   * Asks to replace a linked key with another key linked to the same account. One request per old key:
   * asking again changes nothing, except that "leaked" can be added, and a turned-down request can be
   * asked again.
   */
  requestReplacement(
    accountId: string,
    old: string,
    next: string,
    leaked: boolean,
    now: number,
    pins?: { key: string; account: string },
    signed: ReadonlyArray<{ old: string; new: string }> = [],
  ): "ok" | "same" | "not-linked" | "open" | "pinned" {
    if (old === next) return "same";
    // Tavora's pinned publisher key (and the keys that succeeded it) moves only inside Tavora's own account, and nothing
    // moves onto it: its chain is changed by hand, never by a request.
    if (pins && pins.key !== "") {
      if (next === pins.key) return "pinned";
      if (accountId !== pins.account) {
        const chain = this.pinnedChain(pins.key, signed);
        if (chain.has(old) || chain.has(next)) return "pinned";
      }
    }
    // A paused key may still be replaced (its owner may have lost it), but nothing moves onto one.
    const linked = new Set(this.keys(accountId).map((key) => key.fingerprint));
    if (!linked.has(old) || !linked.has(next) || this.pausedKeys(accountId).has(next)) return "not-linked";
    const current = this.keyRequest(old);
    if (current && current.declinedAt === null) {
      if (current.new !== next) return "open";
      if (leaked && !current.leaked) this.db.prepare("update key_requests set leaked = 1, leaked_at = ? where old = ?").run(now, old);
      return "ok";
    }
    this.db
      .prepare(
        "insert into key_requests (old, account_id, new, leaked, requested_at, leaked_at, declined_at, notified) values (?, ?, ?, ?, ?, ?, null, null) on conflict (old) do update set account_id = excluded.account_id, new = excluded.new, leaked = excluded.leaked, requested_at = excluded.requested_at, leaked_at = excluded.leaked_at, declined_at = null, notified = null",
      )
      .run(old, accountId, next, leaked ? 1 : 0, now, leaked ? now : null);
    return "ok";
  }

  /** The pinned key and every key a request or a signed succession put in its place, directly or one after another. */
  private pinnedChain(pinned: string, signed: ReadonlyArray<{ old: string; new: string }>): Set<string> {
    const chain = new Set([pinned]);
    const steps = [...this.allKeyRequests(), ...signed];
    for (let grew = true; grew; ) {
      grew = false;
      for (const request of steps) {
        if (chain.has(request.old) && !chain.has(request.new)) {
          chain.add(request.new);
          grew = true;
        }
      }
    }
    return chain;
  }

  /** Keeps whether the account's address was told of the request as it is now. */
  setKeyRequestNotified(old: string, notified: boolean): void {
    this.db.prepare("update key_requests set notified = ? where old = ?").run(notified ? 1 : 0, old);
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

  /**
   * The maintainer turns a request down, or a leaked report whose request went with its account; false when there is
   * neither for the key. An open request goes first. A leak report kept in leaked_keys is forgotten only with a leaked
   * request, or once no request is open, never with a plain request asked for the same key later (audit run 2). The
   * caller checks first that it isn't signed yet (admin-app.ts).
   */
  declineKeyRequest(old: string, now: number): boolean {
    const open = this.db.prepare("select leaked from key_requests where old = ? and declined_at is null").get(old) as { leaked: number } | undefined;
    if (open) {
      this.db.prepare("update key_requests set declined_at = ? where old = ? and declined_at is null").run(now, old);
      if (open.leaked === 1) this.db.prepare("delete from leaked_keys where fingerprint = ?").run(old);
      return true;
    }
    return Number(this.db.prepare("delete from leaked_keys where fingerprint = ?").run(old).changes) > 0;
  }

  /** When a key was linked to an account, in ms, or null. */
  keyLinkedAt(fingerprint: string): number | null {
    return (this.db.prepare("select linked_at from publisher_keys where fingerprint = ?").get(fingerprint) as { linked_at: number } | undefined)?.linked_at ?? null;
  }

  /** The account a publisher key is linked to, with the key's public half (base64) and whether it is paused (revokeMinted), or null. */
  publisherKey(fingerprint: string): { accountId: string; publicKey: string; paused: boolean } | null {
    const row = this.db.prepare("select account_id, public_key, paused_at from publisher_keys where fingerprint = ?").get(fingerprint) as
      | { account_id: string; public_key: string; paused_at: number | null }
      | undefined;
    return row ? { accountId: row.account_id, publicKey: row.public_key, paused: row.paused_at !== null } : null;
  }

  // ── Module id prefixes ─────────────────────────────────────────────────

  /**
   * Whether an account may publish under a module id prefix: it holds it, or may reserve it now.
   * First come; words reserved for developer names (anything with "tavora", "official", "local", …)
   * are refused, and an account holds at most MAX_PREFIXES. Prefixes are not kept with the account:
   * a deleted account's prefixes stay held, so nobody can publish new modules under its name.
   * A prefix nobody holds is still taken while the catalog has a module under it whose key isn't
   * linked to this account (added by hand, or published before prefixes were kept): holding a
   * prefix makes an account the publisher of every module under it.
   */
  prefixCheck(accountId: string, prefix: string, catalog: PublishedModules | undefined): "held" | "free" | "taken" | "reserved" | "too-many" {
    const owner = this.db.prepare("select account_id from module_prefixes where prefix = ?").get(prefix) as { account_id: string } | undefined;
    if (owner) return owner.account_id === accountId ? "held" : "taken";
    if (isReservedName(nameKey(prefix))) return "reserved";
    if (catalog?.ownersUnder(prefix).some((key) => this.publisherKey(key)?.accountId !== accountId)) return "taken";
    return this.prefixes(accountId).length >= MAX_PREFIXES ? "too-many" : "free";
  }

  /** Reserves a prefix that prefixCheck called free. */
  reservePrefix(accountId: string, prefix: string, now: number): void {
    this.db.prepare("insert into module_prefixes (prefix, account_id, reserved_at) values (?, ?, ?)").run(prefix, accountId, now);
  }

  /** Gives back a prefix reservePrefix just reserved for an upload that then wasn't added. Only the account's own. */
  releasePrefix(accountId: string, prefix: string): void {
    this.db.prepare("delete from module_prefixes where prefix = ? and account_id = ?").run(prefix, accountId);
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

  /** Marks the day on which the emails for new addresses ran out; true only the first time that day. */
  markNewAddressMailFull(day: string, now: number): boolean {
    this.db.prepare("insert into mail_days (day, sent) values (?, 0) on conflict (day) do nothing").run(day);
    return this.db.prepare("update mail_days set new_full_at = ? where day = ? and new_full_at is null").run(now, day).changes > 0;
  }

  /** When the emails for new addresses ran out on a day (ms), or null. */
  newAddressMailFullAt(day: string): number | null {
    return (this.db.prepare("select new_full_at from mail_days where day = ?").get(day) as { new_full_at: number | null } | undefined)?.new_full_at ?? null;
  }

  countMail(day: string): void {
    this.db.prepare("insert into mail_days (day, sent) values (?, 1) on conflict (day) do update set sent = sent + 1").run(day);
    this.db.prepare("delete from mail_days where day < ?").run(new Date(Date.parse(`${day}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10));
  }

  /**
   * Gives back an email countMail counted for one that then didn't go out. A send is counted before it goes, so sends
   * at the same time see each other against the day's limit. Never below 0.
   */
  uncountMail(day: string): void {
    this.db.prepare("update mail_days set sent = sent - 1 where day = ? and sent > 0").run(day);
  }

  /**
   * Takes one of the day's notices about an account's publishing (catalog-publish.ts): false, counting nothing, when the
   * account had `perAccount` today or all accounts together `perDay`.
   */
  takeNotice(day: string, accountId: string, perAccount: number, perDay: number): boolean {
    const own = (this.db.prepare("select sent from notice_days where day = ? and account_id = ?").get(day, accountId) as { sent: number } | undefined)?.sent ?? 0;
    if (own >= perAccount) return false;
    const all = (this.db.prepare("select coalesce(sum(sent), 0) as n from notice_days where day = ?").get(day) as { n: number }).n;
    if (all >= perDay) return false;
    this.db.prepare("insert into notice_days (day, account_id, sent) values (?, ?, 1) on conflict (day, account_id) do update set sent = sent + 1").run(day, accountId);
    this.db.prepare("delete from notice_days where day < ?").run(day);
    return true;
  }

  /** Gives back a notice takeNotice took for one that then didn't go out (hunt 2026-11-25 E7). Never below 0. */
  giveBackNotice(day: string, accountId: string): void {
    this.db.prepare("update notice_days set sent = sent - 1 where day = ? and account_id = ? and sent > 0").run(day, accountId);
  }

  /** Keeps that a notice about the account's publishing couldn't go out (unsentNotices). */
  recordUnsentNotice(accountId: string, kind: UnsentNotice["kind"], module: { id: string; name: string; version: string }, at: number): void {
    this.db.prepare("insert into unsent_notices (account_id, kind, module_id, name, version, at) values (?, ?, ?, ?, ?, ?)").run(accountId, kind, module.id, module.name, module.version, at);
  }

  /** The account's notices that couldn't go out in the last UNSENT_NOTICE_MS, newest first, at most MAX_UNSENT_NOTICES. */
  unsentNotices(accountId: string, now: number): UnsentNotice[] {
    this.db.prepare("delete from unsent_notices where at <= ?").run(now - UNSENT_NOTICE_MS);
    const rows = this.db
      .prepare("select kind, module_id, name, version, at from unsent_notices where account_id = ? order by at desc, rowid desc limit ?")
      .all(accountId, MAX_UNSENT_NOTICES) as unknown as { kind: UnsentNotice["kind"]; module_id: string; name: string; version: string; at: number }[];
    return rows.map((row) => ({ kind: row.kind, id: row.module_id, name: row.name, version: row.version, at: row.at }));
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
   * signature. Null when the account has as many as it may, or `sessionId` ended. `sessionId`: the sign-in that made it, which changing the
   * address keeps it with (revokeMinted).
   */
  createPublishToken(accountId: string, name: string, now: number, sessionId: string | null = null): { token: string; publishToken: PublishToken } | null {
    if (this.publishTokens(accountId, now).length >= MAX_PUBLISH_TOKENS) return null;
    const token = `${PUBLISH_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const id = randomBytes(12).toString("base64url");
    const expiresAt = now + PUBLISH_TOKEN_TTL_MS;
    // Only while the sign-in that asks still exists, checked in the same statement (audit 2026-11-22): one ended meanwhile
    // (the email changed, the device was removed) makes no token that nothing would take back.
    const made = this.db
      .prepare(
        "insert into publish_tokens (id, account_id, token_hash, name, created_at, expires_at, session_id) select ?, ?, ?, ?, ?, ?, ? where ? is null or exists (select 1 from sessions where id = ? and account_id = ?)",
      )
      .run(id, accountId, sha256Hex(`publish:${token}`), name, now, expiresAt, sessionId, sessionId, sessionId, accountId);
    if (Number(made.changes) === 0) return null;
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
    const row = this.db.prepare("select id, account_id, name, expires_at from publish_tokens where token_hash = ?").get(sha256Hex(`publish:${token}`)) as
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

  /** Only the profile's name, or null without a profile. */
  profileName(accountId: string): string | null {
    const row = this.db.prepare("select name from profiles where account_id = ?").get(accountId) as { name: string } | undefined;
    return row?.name ?? null;
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
   * Seconds until `asker` may have another code sent to the address; 0 when it may now (CODES_PER_WINDOW and the
   * limits below it). A step that mails two addresses asks first, so it sends both or neither.
   */
  codeWait(email: string, now: number, asker: CodeAsker): number {
    const group = this.askedBy(email, now, asker);
    const recent = (
      this.db.prepare("select at from code_requests where address = ? and owner = ? and at > ? order by at").all(addressKey(email), group, now - DAY_MS) as unknown as {
        at: number;
      }[]
    ).map((row) => row.at);
    if (group === ASKED_BY.owner) return limitWait(recent, now, [CODES_PER_WINDOW, CODE_WINDOW_MS], [CODES_PER_DAY, DAY_MS]);
    const mine = "from" in asker ? (this.askers.get(askerKey(asker.from, email)) ?? []).filter((at) => at > now - DAY_MS) : [];
    const network = limitWait(mine, now, [CODES_PER_WINDOW, CODE_WINDOW_MS], [CODES_PER_ASKER_DAY, DAY_MS]);
    return group === ASKED_BY.known ? network : Math.max(network, limitWait(recent, now, [CODES_FROM_OTHERS_PER_DAY, DAY_MS]));
  }

  /** Which group of an address's limits `asker` counts in (see CODES_PER_WINDOW): its own account, a network it signed in from, or anyone else. */
  codeGroup(email: string, now: number, asker: CodeAsker): "owner" | "known" | "stranger" {
    const group = this.askedBy(email, now, asker);
    return group === ASKED_BY.owner ? "owner" : group === ASKED_BY.known ? "known" : "stranger";
  }

  /** Which group of an address's limits a request counts in (see CODES_PER_WINDOW). */
  private askedBy(email: string, now: number, asker: CodeAsker): AskedBy {
    if ("owner" in asker) return ASKED_BY.owner;
    const row = this.db.prepare("select expires_at from known_networks where hash = ?").get(knownKey(asker.from, email)) as { expires_at: number } | undefined;
    return row && row.expires_at > now ? ASKED_BY.known : ASKED_BY.stranger;
  }

  /** Remembers that the address signed in from this network, for KNOWN_NETWORK_MS from now (only a hash of both is kept). */
  rememberNetwork(email: string, from: string, now: number): void {
    this.db
      .prepare("insert into known_networks (hash, expires_at) values (?, ?) on conflict (hash) do update set expires_at = excluded.expires_at")
      .run(knownKey(from, email), now + KNOWN_NETWORK_MS);
  }

  /**
   * Counts a request for a code to an address against its limits without making one: 0, or the seconds to wait. For
   * a request that is answered as if a code went out but sends none, so the limits behave the same either way.
   */
  countCodeRequest(email: string, now: number, asker: CodeAsker): number {
    this.sweep(now);
    const wait = this.codeWait(email, now, asker);
    if (wait > 0) return wait;
    this.db.prepare("insert into code_requests (address, at, owner) values (?, ?, ?)").run(addressKey(email), now, this.askedBy(email, now, asker));
    if ("from" in asker) {
      const key = askerKey(asker.from, email);
      const times = this.askers.get(key);
      // Full: forget the oldest, which a Map keeps first. The address's own limit (in the database) still holds.
      if (!times && this.askers.size >= MAX_ASKERS) this.askers.delete(this.askers.keys().next().value!);
      this.askers.set(key, [...(times ?? []).filter((at) => at > now - DAY_MS), now]);
    }
    return 0;
  }

  /**
   * Makes a new code for an address, replacing one still waiting for the same purpose, unless the address was sent
   * too many lately (codeWait). The limits count the purposes together (the owner's own apart from everyone else's),
   * so nobody can flood an inbox by switching between them.
   *
   * A code someone else asked for (another network) still waiting is kept beside the new one (audit 2026-11-22), so a
   * stranger asking for a code doesn't take away the owner's: two at most, and of two others the one from a network the
   * address signed in from stays, else the newer. A request by the account's own sign-in replaces them all.
   */
  requestCode(email: string, purpose: CodePurpose, accountId: string | null, now: number, asker: CodeAsker, bind?: string): CodeRequest {
    const address = addressKey(email);
    const wait = this.countCodeRequest(email, now, asker);
    if (wait > 0) return { ok: false, retryAfter: wait };
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const from = "from" in asker ? codeAskerKey(asker.from, email) : null;
    const fresh: CodeSlot = {
      hash: codeHash(address, purpose, bound(code, bind)),
      asker: from,
      known: from !== null && this.askedBy(email, now, asker) === ASKED_BY.known,
      expiresAt: now + CODE_TTL_MS,
      tries: 0,
      otherTries: 0,
    };
    let others: CodeSlot[] = [];
    if (from !== null) {
      const row = this.codeRow(address, purpose);
      if (row && row.accountId === accountId) others = row.slots.filter((slot) => slot.expiresAt > now && slot.asker !== null && slot.asker !== from);
      // Two others: the one from a network the address signed in from stays, else the newer (listed first).
      if (others.length > 1) others = [others.find((slot) => slot.known) ?? others[0]!];
    }
    this.writeCode(address, purpose, accountId, [fresh, ...others]);
    return { ok: true, code };
  }

  /** The codes waiting for an address and purpose: the newest first, then the one kept beside it (requestCode). */
  private codeRow(address: string, purpose: CodePurpose): { accountId: string | null; slots: CodeSlot[] } | null {
    const row = this.db.prepare("select * from codes where address = ? and purpose = ?").get(address, purpose) as CodeRowSql | undefined;
    if (!row) return null;
    const slots: CodeSlot[] = [{ hash: row.code_hash, asker: row.asker, known: row.known === 1, expiresAt: row.expires_at, tries: row.tries, otherTries: row.other_tries }];
    if (row.prev_hash !== null && row.prev_expires_at !== null) {
      slots.push({ hash: row.prev_hash, asker: row.prev_asker, known: row.prev_known === 1, expiresAt: row.prev_expires_at, tries: row.prev_tries, otherTries: row.prev_other_tries });
    }
    return { accountId: row.account_id, slots };
  }

  /** Keeps up to two codes for an address and purpose (codeRow); none deletes the row. */
  private writeCode(address: string, purpose: CodePurpose, accountId: string | null, slots: CodeSlot[]): void {
    const [first, second] = slots;
    if (!first) {
      this.db.prepare("delete from codes where address = ? and purpose = ?").run(address, purpose);
      return;
    }
    this.db
      .prepare(
        `insert or replace into codes (address, purpose, account_id, code_hash, expires_at, tries, asker, other_tries, known,
         prev_hash, prev_asker, prev_known, prev_expires_at, prev_tries, prev_other_tries) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        address,
        purpose,
        accountId,
        first.hash,
        first.expiresAt,
        first.tries,
        first.asker,
        first.otherTries,
        first.known ? 1 : 0,
        second?.hash ?? null,
        second?.asker ?? null,
        second ? (second.known ? 1 : 0) : null,
        second?.expiresAt ?? null,
        second?.tries ?? 0,
        second?.otherTries ?? 0,
      );
  }

  /**
   * Checks a code. A wrong one counts a try, and the last allowed try spends it.
   * A right one is spent only when asked, so the app can learn that an address
   * has no account yet and ask the user before it creates one.
   * `from`: the network that types it in, for a code anyone may type (a sign-in code). Each waiting code (requestCode keeps
   * up to two) counts the wrong tries of the network that asked for it apart from everyone else's (CODE_OTHER_TRIES): others
   * get at most 3 and never the last, so only the network that asked can spend it, and no code takes more than
   * CODE_MAX_TRIES wrong tries in all.
   */
  checkCode(email: string, purpose: CodePurpose, accountId: string | null, code: string, now: number, spend: boolean, bind?: string, from?: string): boolean {
    const address = addressKey(email);
    const row = this.codeRow(address, purpose);
    if (!row || row.accountId !== accountId) return false;
    const typed = Buffer.from(codeHash(address, purpose, bound(code, bind)), "hex");
    const by = from === undefined ? null : codeAskerKey(from, email);
    const live = row.slots.filter((slot) => slot.expiresAt > now);
    // Someone else than who asked for a code: once others' tries on it are used, or a wrong one would be its last, it isn't
    // checked for them at all.
    const isOther = (slot: CodeSlot) => by !== null && slot.asker !== null && slot.asker !== by;
    const checked = live.filter((slot) => !isOther(slot) || (slot.otherTries < CODE_OTHER_TRIES && slot.tries + slot.otherTries + 1 < CODE_MAX_TRIES));
    if (checked.some((slot) => timingSafeEqual(Buffer.from(slot.hash, "hex"), typed))) {
      if (spend) this.writeCode(address, purpose, accountId, []);
      return true;
    }
    if (checked.length === 0) return false;
    // A wrong try counts on every code it was checked against; one with CODE_MAX_TRIES wrong tries goes.
    const after = live
      .map((slot) => (checked.includes(slot) ? (isOther(slot) ? { ...slot, otherTries: slot.otherTries + 1 } : { ...slot, tries: slot.tries + 1 }) : slot))
      .filter((slot) => slot.tries + slot.otherTries < CODE_MAX_TRIES);
    this.writeCode(address, purpose, accountId, after);
    return false;
  }

  // ── Sessions ───────────────────────────────────────────────────────────

  /** A new sign-in. The token goes to the app once; only its hash is kept. */
  createSession(accountId: string, os: DeviceOs, now: number, name: string | null = null): { token: string; session: Session } {
    const token = randomBytes(32).toString("base64url");
    const id = randomBytes(12).toString("base64url");
    this.db
      .prepare("insert into sessions (id, token_hash, account_id, os, name, created_at, last_used_at) values (?, ?, ?, ?, ?, ?, ?)")
      .run(id, sha256Hex(`session:${token}`), accountId, os, name, now, now);
    return { token, session: { id, accountId } };
  }

  /** The sign-in a token belongs to, or null when it is unknown or has gone unused for a year. */
  sessionByToken(token: string, now: number): Session | null {
    const row = this.db.prepare("select id, account_id, last_used_at from sessions where token_hash = ?").get(sha256Hex(`session:${token}`)) as
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

  /** Whether a sign-in still exists (sign-in.ts stillSignedIn). */
  sessionAlive(id: string): boolean {
    return this.db.prepare("select 1 from sessions where id = ?").get(id) !== undefined;
  }

  /**
   * Signs out one device of an account; false when the account has no such device. `revoke`: it was signed out from another
   * device, so what it made for publishing goes too (revokeMinted): its publish tokens stop working and the keys it linked
   * pause. Signing yourself out keeps them.
   */
  deleteSession(accountId: string, id: string, revoke = false, now: number = Date.now()): boolean {
    this.db.exec("begin");
    try {
      const deleted = Number(this.db.prepare("delete from sessions where id = ? and account_id = ?").run(id, accountId).changes) > 0;
      if (deleted && revoke) this.revokeMinted(accountId, { session: id }, now);
      this.db.exec("commit");
      return deleted;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  /** Plain numbers for the daily snapshot: all accounts, and those with a sign-in used in the last 7 and 30 days. Nobody is named. */
  activity(now: number): { total: number; active7: number; active30: number } {
    const count = (sql: string, ...args: number[]) => (this.db.prepare(sql).get(...args) as { n: number }).n;
    const active = (days: number) => count("select count(distinct account_id) as n from sessions where last_used_at > ?", now - days * DAY_MS);
    return { total: count("select count(*) as n from accounts"), active7: active(7), active30: active(30) };
  }

  // ── Housekeeping ───────────────────────────────────────────────────────

  private sweep(now: number): void {
    // Once an hour is enough for the requests kept in memory: what is older than a day no longer counts anyway.
    if (now - this.askersSweptAt > 60 * 60_000) {
      this.askersSweptAt = now;
      for (const [key, times] of this.askers) if (times[times.length - 1]! <= now - DAY_MS) this.askers.delete(key);
    }
    this.db.prepare("delete from codes where expires_at <= ?").run(now);
    this.db.prepare("delete from code_requests where at <= ?").run(now - DAY_MS);
    this.db.prepare("delete from known_networks where expires_at <= ?").run(now);
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

/** Seconds until one more fits every [count, window] limit over `times` (oldest first); 0 when it fits now. */
function limitWait(times: number[], now: number, ...limits: [count: number, windowMs: number][]): number {
  let wait = 0;
  for (const [count, windowMs] of limits) {
    const inWindow = times.filter((at) => at > now - windowMs);
    if (inWindow.length >= count) wait = Math.max(wait, secondsUntil(inWindow[inWindow.length - count]! + windowMs, now));
  }
  return wait;
}

/** One code waiting for an address and purpose (AccountStore.codeRow). */
interface CodeSlot {
  hash: string;
  /** Who asked for it (codeAskerKey); null for the account's own sign-in and codes from before it was kept. */
  asker: string | null;
  /** Whether it was asked for from a network the address signed in from. */
  known: boolean;
  expiresAt: number;
  /** Wrong tries by whoever asked for it, and by everyone else (CODE_OTHER_TRIES). */
  tries: number;
  otherTries: number;
}

interface CodeRowSql {
  account_id: string | null;
  code_hash: string;
  expires_at: number;
  tries: number;
  asker: string | null;
  other_tries: number;
  known: number | null;
  prev_hash: string | null;
  prev_asker: string | null;
  prev_known: number | null;
  prev_expires_at: number | null;
  prev_tries: number;
  prev_other_tries: number;
}

/** One network asking for codes to one address, as a hash, so memory holds no address. */
const askerKey = (from: string, email: string) => sha256Hex(`asker:${from}:${email}`);
/** Who asked for a code, as the code keeps it: a hash of their network and the address. */
const codeAskerKey = (from: string, email: string) => sha256Hex(`code-asker:${from}:${email}`);
/** A network an address signed in from, as known_networks keeps it. */
const knownKey = (from: string, email: string) => sha256Hex(`known:${from}:${email}`);
