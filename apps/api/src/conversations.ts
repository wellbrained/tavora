import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AccountStore } from "./account-store.ts";
import { isOfficialId, type CatalogStore } from "./catalog.ts";
import { mailLanguage, type Mail, type MailLanguage } from "./mail.ts";
import type { Notifier } from "./moderation-mail.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { banned, requireSignIn, tooMany, type SignedInEnv } from "./sign-in.ts";
import { checkReviewText } from "./review-filter.ts";
import { MIN_ACCOUNT_AGE_MS, ownsModule } from "./reviews.ts";
import { BUILT_IN_TEXTS, CONTACT_KINDS, cleanContactValue, contactFromLegacy, contactToLegacy, type Contact, type ContactKind } from "../../desktop/src/shared/conversations.ts";

/**
 * Conversations (decided 2026-10-27, "Conversations" in the design doc). Two kinds exist and nothing else, so
 * this is no open messaging between users:
 *
 * - `developer`: a user asks the developer of a published module (a bug report, a feature request or a question);
 *   the developer answers. Developers never start one.
 * - `tavora`: the admin writes to an account (from a report, an account or a review) and the account answers.
 *
 * Both sides stay anonymous: the developer sees the user as "User · K7" (a label per conversation, so the same user
 * can't be linked across modules), the user sees "Developer of <module> (<developer name>)", and the admin is
 * "Tavora". An answer for a user or developer never holds the other side's account id, email, profile name or picture.
 * Messages are plain text, at most 2,000 characters, with no attachments; links, email addresses and slurs are refused
 * (review-filter.ts) in everything the two sides write. The admin's own messages may hold links.
 *
 * Closing: the developer closes with an outcome, the user closes their own ("Closed by you"), either side can Block
 * (closes with `blocked`) and Report (the admin then reads the whole conversation; the other side is not told). Nobody
 * but the admin closes a Tavora conversation. 30 days without a message closes a developer conversation (`timeout`), and
 * a closed one is deleted 180 days after closing unless it is reported. Closed is read-only; a new conversation links to
 * the closed one (`previousId`). Deleting an account closes its conversations with `left`, removes the text of its
 * messages and deletes its reports.
 *
 * Limits: the 24 h minimum account age (as for ratings), 5 new conversations and 50 messages per account in 24 h, one
 * open conversation per user and module, and the per-client hourly limit.
 *
 * Read marks are message numbers, not times, so two messages in the same millisecond can't hide each other.
 * The admin reads only the conversations it is part of and the reported ones (conversations-admin.ts).
 */

export const KINDS = ["developer", "tavora"] as const;
export type Kind = (typeof KINDS)[number];
export const TYPES = ["bug", "feature", "question"] as const;
export type RequestType = (typeof TYPES)[number];
export const OUTCOMES = ["fixed", "added", "not-planned", "not-a-bug", "none"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type CloseReason = Outcome | "user" | "timeout" | "blocked" | "tavora" | "left";
export const REPORT_REASONS = ["insults", "hateful", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const ABOUT_TYPES = ["module-report", "review-report", "review", "account", "conversation-report"] as const;
export type About = { type: (typeof ABOUT_TYPES)[number]; id: string };
/** The texts the admin can edit (English and German), and the placeholders they may hold. */
export const TEXT_KEYS = ["inbox.appeared.developerReply", "inbox.appeared.tavora", "inbox.appeared.sent", "inbox.gone", "mail.newRequest", "mail.newReply", "mail.tavora"] as const;
export const TEXT_PLACEHOLDERS = ["module", "developer", "days", "reason"] as const;

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_NOTE_LENGTH = 500;
/** New conversations an account may start, and messages it may send, in 24 hours. */
export const DAILY_CONVERSATIONS = 5;
export const DAILY_MESSAGES = 50;
/** Email copies of messages a day, a share of the mail budget so sign-in codes always have room. */
export const DAILY_MAIL_COPIES = 100;
/** Days without a message after which a developer conversation closes, how many days before that it says so, and how long a closed one is kept. */
export const IDLE_DAYS = 30;
export const WARN_DAYS = 3;
export const KEEP_DAYS = 180;
const DAY_MS = 24 * 3_600_000;

export interface Conversation {
  id: string;
  kind: Kind;
  moduleId: string | null;
  moduleName: string | null;
  developerAccountId: string | null;
  userAccountId: string | null;
  type: RequestType | null;
  label: string;
  state: "open" | "closed";
  closeReason: CloseReason | null;
  closedAt: number | null;
  createdAt: number;
  lastMessageAt: number;
  previousId: string | null;
  deletedByUser: boolean;
  deletedByOther: boolean;
  about: About | null;
}

export interface Message {
  id: number;
  conversationId: string;
  from: "user" | "developer" | "tavora";
  text: string;
  createdAt: number;
  versions: { tavora: string; module: string } | null;
}

export interface ConversationReport {
  conversationId: string;
  reporterAccountId: string;
  reason: ReportReason;
  note: string | null;
  at: number;
}

interface ConversationSql {
  id: string;
  kind: Kind;
  module_id: string | null;
  module_name: string | null;
  developer_account_id: string | null;
  user_account_id: string | null;
  type: RequestType | null;
  label: string;
  state: "open" | "closed";
  close_reason: CloseReason | null;
  closed_at: number | null;
  created_at: number;
  last_message_at: number;
  previous_id: string | null;
  deleted_by_user: number;
  deleted_by_other: number;
  about_type: About["type"] | null;
  about_id: string | null;
}

const toConversation = (row: ConversationSql): Conversation => ({
  id: row.id,
  kind: row.kind,
  moduleId: row.module_id,
  moduleName: row.module_name,
  developerAccountId: row.developer_account_id,
  userAccountId: row.user_account_id,
  type: row.type,
  label: row.label,
  state: row.state,
  closeReason: row.close_reason,
  closedAt: row.closed_at,
  createdAt: row.created_at,
  lastMessageAt: row.last_message_at,
  previousId: row.previous_id,
  deletedByUser: row.deleted_by_user === 1,
  deletedByOther: row.deleted_by_other === 1,
  about: row.about_type && row.about_id ? { type: row.about_type, id: row.about_id } : null,
});

/** Letters and digits without look-alikes, so a label reads well aloud: "K7". Leaderboards use the same (leaderboards.ts). */
const LABEL_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const LABEL_DIGITS = "23456789";
export const newLabel = () => LABEL_LETTERS[randomBytes(1)[0]! % LABEL_LETTERS.length]! + LABEL_DIGITS[randomBytes(1)[0]! % LABEL_DIGITS.length]!;

/** The conversations, messages, reports, contact settings and editable texts, in `conversations.sqlite` of the state directory. */
export class ConversationStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma journal_mode = wal;
      pragma foreign_keys = on;
      create table if not exists conversations (
        id text primary key, kind text not null, module_id text, module_name text,
        developer_account_id text, user_account_id text, type text, label text not null,
        state text not null default 'open', close_reason text, closed_at integer,
        created_at integer not null, last_message_at integer not null, previous_id text,
        deleted_by_user integer not null default 0, deleted_by_other integer not null default 0,
        about_type text, about_id text,
        user_read integer not null default 0, other_read integer not null default 0
      );
      create index if not exists conversations_user on conversations (user_account_id);
      create index if not exists conversations_developer on conversations (developer_account_id);
      create table if not exists messages (
        id integer primary key autoincrement, conversation_id text not null references conversations (id) on delete cascade,
        sender text not null, text text not null, created_at integer not null, versions text
      );
      create index if not exists messages_conversation on messages (conversation_id);
      create table if not exists conversation_reports (
        conversation_id text not null references conversations (id) on delete cascade, reporter_account_id text not null,
        reason text not null, note text, at integer not null,
        primary key (conversation_id, reporter_account_id)
      );
      create table if not exists limits (account_id text not null, kind text not null, at integer not null);
      create table if not exists mail_copies (day text primary key, count integer not null);
      create index if not exists limits_account on limits (account_id, kind, at);
      create table if not exists module_contact (module_id text primary key, enabled integer not null, link text);
      create table if not exists account_contact (account_id text primary key, kind text not null, value text);
      create table if not exists account_settings (account_id text primary key, email_copies integer not null);
      create table if not exists texts (key text primary key, en text not null, de text not null);
    `);
    // Contact kinds (2026-10-30): a row from before has only enabled and link, read as a kind (contactFromLegacy).
    const columns = (this.db.prepare("pragma table_info(module_contact)").all() as { name: string }[]).map((column) => column.name);
    if (!columns.includes("kind")) this.db.exec("alter table module_contact add column kind text; alter table module_contact add column value text;");
  }

  close(): void {
    this.db.close();
  }

  // ── Reading ────────────────────────────────────────────────────────────

  get(id: string): Conversation | null {
    const row = this.db.prepare("select * from conversations where id = ?").get(id) as ConversationSql | undefined;
    return row ? toConversation(row) : null;
  }

  messages(conversationId: string): Message[] {
    return (this.db.prepare("select * from messages where conversation_id = ? order by id").all(conversationId) as unknown as { id: number; conversation_id: string; sender: Message["from"]; text: string; created_at: number; versions: string | null }[]).map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      from: row.sender,
      text: row.text,
      createdAt: row.created_at,
      versions: row.versions ? (JSON.parse(row.versions) as Message["versions"]) : null,
    }));
  }

  /** The conversations an account is a side of and has not deleted, newest activity first. */
  listFor(accountId: string): Conversation[] {
    return (
      this.db
        .prepare("select * from conversations where (user_account_id = ? and deleted_by_user = 0) or (developer_account_id = ? and deleted_by_other = 0) order by last_message_at desc, rowid desc")
        .all(accountId, accountId) as unknown as ConversationSql[]
    ).map(toConversation);
  }

  /** Whether the side has a message it has not read: for the user side, a message from someone else; for the other side, one from the user. */
  unread(conversation: Conversation, side: "user" | "other"): boolean {
    const row = this.db
      .prepare(
        side === "user"
          ? "select 1 from messages m join conversations c on c.id = m.conversation_id where c.id = ? and m.sender != 'user' and m.id > c.user_read limit 1"
          : "select 1 from messages m join conversations c on c.id = m.conversation_id where c.id = ? and m.sender = 'user' and m.id > c.other_read limit 1",
      )
      .get(conversation.id);
    return row !== undefined;
  }

  /** Marks everything in the conversation as read by one side. */
  markRead(conversationId: string, side: "user" | "other"): void {
    this.db
      .prepare(`update conversations set ${side === "user" ? "user_read" : "other_read"} = coalesce((select max(id) from messages where conversation_id = ?), 0) where id = ?`)
      .run(conversationId, conversationId);
  }

  /** The open developer conversation of a user about a module, if any. */
  /** Whether a conversation of this user about this module was blocked (by either side): no new one then. */
  blockedFor(userAccountId: string, moduleId: string): boolean {
    return this.db.prepare("select 1 from conversations where user_account_id = ? and module_id = ? and kind = 'developer' and close_reason = 'blocked' limit 1").get(userAccountId, moduleId) !== undefined;
  }

  /** How many messages one side has not read yet. */
  unreadCount(conversationId: string, side: "user" | "other"): number {
    const sql = side === "user"
      ? "select count(*) as n from messages m join conversations c on c.id = m.conversation_id where c.id = ? and m.sender != 'user' and m.id > c.user_read"
      : "select count(*) as n from messages m join conversations c on c.id = m.conversation_id where c.id = ? and m.sender = 'user' and m.id > c.other_read";
    return (this.db.prepare(sql).get(conversationId) as { n: number }).n;
  }

  /** Counts one email copy for the day; false (and nothing counted) once the day's share is used up. */
  takeMailCopy(day: string): boolean {
    const row = this.db.prepare("select count from mail_copies where day = ?").get(day) as { count: number } | undefined;
    if ((row?.count ?? 0) >= DAILY_MAIL_COPIES) return false;
    this.db.prepare("insert into mail_copies (day, count) values (?, 1) on conflict (day) do update set count = count + 1").run(day);
    this.db.prepare("delete from mail_copies where day < ?").run(new Date(Date.parse(`${day}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10));
    return true;
  }

  openFor(userAccountId: string, moduleId: string): Conversation | null {
    const row = this.db
      .prepare("select * from conversations where kind = 'developer' and user_account_id = ? and module_id = ? and state = 'open' limit 1")
      .get(userAccountId, moduleId) as ConversationSql | undefined;
    return row ? toConversation(row) : null;
  }

  /** How many of a kind an account did in the last 24 hours, and when the oldest was. */
  countToday(accountId: string, kind: "conversation" | "message", now: number): { count: number; oldest: number | null } {
    const row = this.db.prepare("select count(*) as n, min(at) as oldest from limits where account_id = ? and kind = ? and at > ?").get(accountId, kind, now - DAY_MS) as { n: number; oldest: number | null };
    return { count: row.n, oldest: row.oldest };
  }

  // ── Writing ────────────────────────────────────────────────────────────

  /** Starts a developer conversation with its first message. */
  startDeveloper(input: { moduleId: string; moduleName: string; developerAccountId: string; userAccountId: string; type: RequestType; text: string; versions: { tavora: string; module: string }; previousId: string | null }, now: number): Conversation {
    const id = randomBytes(12).toString("base64url");
    this.db
      .prepare(
        "insert into conversations (id, kind, module_id, module_name, developer_account_id, user_account_id, type, label, state, created_at, last_message_at, previous_id) values (?, 'developer', ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)",
      )
      .run(id, input.moduleId, input.moduleName, input.developerAccountId, input.userAccountId, input.type, newLabel(), now, now, input.previousId);
    this.db.prepare("insert into messages (conversation_id, sender, text, created_at, versions) values (?, 'user', ?, ?, ?)").run(id, input.text, now, JSON.stringify(input.versions));
    this.log(input.userAccountId, "conversation", now);
    this.log(input.userAccountId, "message", now);
    return this.get(id)!;
  }

  /** The admin starts a conversation with an account. */
  startTavora(input: { userAccountId: string; text: string; about: About | null; moduleId: string | null; moduleName: string | null }, now: number): Conversation {
    const id = randomBytes(12).toString("base64url");
    this.db
      .prepare("insert into conversations (id, kind, module_id, module_name, user_account_id, label, state, created_at, last_message_at, about_type, about_id) values (?, 'tavora', ?, ?, ?, ?, 'open', ?, ?, ?, ?)")
      .run(id, input.moduleId, input.moduleName, input.userAccountId, newLabel(), now, now, input.about?.type ?? null, input.about?.id ?? null);
    this.db.prepare("insert into messages (conversation_id, sender, text, created_at) values (?, 'tavora', ?, ?)").run(id, input.text, now);
    // Tavora wrote it, so Tavora's side has nothing new in it.
    this.markRead(id, "other");
    return this.get(id)!;
  }

  /** Adds a message and moves the conversation's last activity; `account` is the sender's account, null for Tavora. */
  addMessage(conversationId: string, from: Message["from"], account: string | null, text: string, now: number): Message {
    const result = this.db.prepare("insert into messages (conversation_id, sender, text, created_at) values (?, ?, ?, ?)").run(conversationId, from, text, now);
    this.db.prepare("update conversations set last_message_at = ? where id = ?").run(now, conversationId);
    // A user who deleted a Tavora conversation sees it again when Tavora writes.
    if (from === "tavora") this.db.prepare("update conversations set deleted_by_user = 0 where id = ?").run(conversationId);
    if (account) this.log(account, "message", now);
    return this.messages(conversationId).find((message) => message.id === Number(result.lastInsertRowid))!;
  }

  private log(accountId: string, kind: "conversation" | "message", now: number): void {
    this.db.prepare("insert into limits (account_id, kind, at) values (?, ?, ?)").run(accountId, kind, now);
  }

  /** Closes an open conversation. False when it was not open. */
  closeConversation(id: string, reason: CloseReason, now: number): boolean {
    return Number(this.db.prepare("update conversations set state = 'closed', close_reason = ?, closed_at = ? where id = ? and state = 'open'").run(reason, now, id).changes) > 0;
  }

  /** The admin reopens its own conversation. Its last activity moves to now. */
  reopen(id: string, now: number): boolean {
    return Number(this.db.prepare("update conversations set state = 'open', close_reason = null, closed_at = null, last_message_at = ? where id = ? and kind = 'tavora' and state = 'closed'").run(now, id).changes) > 0;
  }

  /** Files or updates the account's report of a conversation. */
  report(conversationId: string, reporterAccountId: string, reason: ReportReason, note: string | null, now: number): void {
    this.db
      .prepare(
        "insert into conversation_reports (conversation_id, reporter_account_id, reason, note, at) values (?, ?, ?, ?, ?) on conflict (conversation_id, reporter_account_id) do update set reason = excluded.reason, note = excluded.note, at = excluded.at",
      )
      .run(conversationId, reporterAccountId, reason, note, now);
  }

  reports(conversationId: string): ConversationReport[] {
    return (this.db.prepare("select * from conversation_reports where conversation_id = ? order by at, rowid").all(conversationId) as unknown as { conversation_id: string; reporter_account_id: string; reason: ReportReason; note: string | null; at: number }[]).map((row) => ({
      conversationId: row.conversation_id,
      reporterAccountId: row.reporter_account_id,
      reason: row.reason,
      note: row.note,
      at: row.at,
    }));
  }

  /** Deletes a conversation's report rows (the admin dismissed it) and the conversation too if both sides had deleted it already. */
  dismissReports(conversationId: string): boolean {
    const changed = Number(this.db.prepare("delete from conversation_reports where conversation_id = ?").run(conversationId).changes) > 0;
    if (changed) this.purgeIfDone(conversationId);
    return changed;
  }

  /** Deletes the conversation for one side. When nobody keeps it any more and it is not reported, it goes for good. */
  deleteFor(id: string, side: "user" | "other"): void {
    this.db.prepare(`update conversations set ${side === "user" ? "deleted_by_user" : "deleted_by_other"} = 1 where id = ?`).run(id);
    this.purgeIfDone(id);
  }

  private purgeIfDone(id: string): boolean {
    const conversation = this.get(id);
    if (!conversation) return false;
    const userGone = conversation.deletedByUser || conversation.userAccountId === null;
    // Tavora's side is the admin's and never deleted by the account: the admin keeps the conversation (the sweep removes it 180 days after closing).
    const otherGone = conversation.kind !== "tavora" && (conversation.deletedByOther || conversation.developerAccountId === null);
    if (!userGone || !otherGone || this.reports(id).length > 0) return false;
    this.db.prepare("delete from conversations where id = ?").run(id);
    return true;
  }

  // ── Retention ──────────────────────────────────────────────────────────

  /**
   * The hourly sweep: developer conversations with no message for 30 days close (`timeout`), closed ones are deleted 180 days
   * after closing unless they are reported, and the daily-limit log keeps only two days.
   */
  sweep(now: number): { closed: number; deleted: number } {
    const closed = Number(this.db.prepare("update conversations set state = 'closed', close_reason = 'timeout', closed_at = ? where kind = 'developer' and state = 'open' and last_message_at <= ?").run(now, now - IDLE_DAYS * DAY_MS).changes);
    const deleted = Number(
      this.db.prepare("delete from conversations where state = 'closed' and closed_at <= ? and id not in (select conversation_id from conversation_reports)").run(now - KEEP_DAYS * DAY_MS).changes,
    );
    this.db.prepare("delete from limits where at <= ?").run(now - 2 * DAY_MS);
    return { closed, deleted };
  }

  /** Days until an open developer conversation closes by itself, once that is at most WARN_DAYS away; otherwise null. */
  closesInDays(conversation: Conversation, now: number): number | null {
    if (conversation.kind !== "developer" || conversation.state !== "open") return null;
    const left = conversation.lastMessageAt + IDLE_DAYS * DAY_MS - now;
    if (left > WARN_DAYS * DAY_MS) return null;
    return Math.max(1, Math.ceil(left / DAY_MS));
  }

  /**
   * The developer is banned: the open conversations users have with them close, as if Tavora closed them (`tavora`),
   * so nobody waits for an answer. They stay closed after an unban. Returns how many closed.
   */
  closeForBannedDeveloper(accountId: string, now: number): number {
    return Number(this.db.prepare("update conversations set state = 'closed', close_reason = 'tavora', closed_at = ? where kind = 'developer' and developer_account_id = ? and state = 'open'").run(now, accountId).changes);
  }

  /** The account is deleted: its conversations close with `left`, its message texts go, its reports go. */
  forget(accountId: string, now = Date.now()): void {
    for (const row of this.db.prepare("select * from conversations where user_account_id = ? or developer_account_id = ?").all(accountId, accountId) as unknown as ConversationSql[]) {
      const asUser = row.user_account_id === accountId;
      // Nothing to keep of a Tavora conversation once its account is gone.
      if (row.kind === "tavora") {
        this.db.prepare("delete from conversations where id = ?").run(row.id);
        continue;
      }
      this.db.prepare("update messages set text = '', versions = null where conversation_id = ? and sender = ?").run(row.id, asUser ? "user" : "developer");
      this.db.prepare(`update conversations set ${asUser ? "user_account_id = null, deleted_by_user = 1" : "developer_account_id = null, deleted_by_other = 1"} where id = ?`).run(row.id);
      if (!this.closeConversation(row.id, "left", now)) this.db.prepare("update conversations set close_reason = 'left' where id = ?").run(row.id);
    }
    this.db.prepare("delete from conversation_reports where reporter_account_id = ?").run(accountId);
    // A conversation whose reports just went, and whose sides are both gone, goes too.
    for (const row of this.db.prepare("select id from conversations").all() as unknown as { id: string }[]) this.purgeIfDone(row.id);
    this.db.prepare("delete from limits where account_id = ?").run(accountId);
    this.db.prepare("delete from account_settings where account_id = ?").run(accountId);
    this.db.prepare("delete from account_contact where account_id = ?").run(accountId);
  }

  // ── Settings and texts ─────────────────────────────────────────────────

  /**
   * How users reach a module's developer: what the developer set for the module, else the default of the developer's
   * account (`developerId`), else in Tavora. `own` says the module has its own.
   */
  contact(moduleId: string, developerId: string | null = null): Contact & { own: boolean } {
    const row = this.db.prepare("select enabled, link, kind, value from module_contact where module_id = ?").get(moduleId) as
      | { enabled: number; link: string | null; kind: string | null; value: string | null }
      | undefined;
    if (row) return { ...(isContactKind(row.kind) ? { kind: row.kind, value: row.value } : contactFromLegacy(row.enabled === 1, row.link)), own: true };
    return { ...this.contactDefault(developerId), own: false };
  }

  setContact(moduleId: string, contact: Contact): void {
    const legacy = contactToLegacy(contact);
    this.db
      .prepare(
        "insert into module_contact (module_id, enabled, link, kind, value) values (?, ?, ?, ?, ?) on conflict (module_id) do update set enabled = excluded.enabled, link = excluded.link, kind = excluded.kind, value = excluded.value",
      )
      .run(moduleId, legacy.enabled ? 1 : 0, legacy.link, contact.kind, contact.value);
  }

  /** The contact an account's modules have until one gets its own: in Tavora unless the developer chose another. */
  contactDefault(accountId: string | null): Contact {
    const row = accountId ? (this.db.prepare("select kind, value from account_contact where account_id = ?").get(accountId) as { kind: string; value: string | null } | undefined) : undefined;
    return row && isContactKind(row.kind) ? { kind: row.kind, value: row.value } : { kind: "tavora", value: null };
  }

  setContactDefault(accountId: string, contact: Contact): void {
    this.db.prepare("insert into account_contact (account_id, kind, value) values (?, ?, ?) on conflict (account_id) do update set kind = excluded.kind, value = excluded.value").run(accountId, contact.kind, contact.value);
  }

  /** Whether the account wants an email copy of new messages; `fallback` is the default when it never chose. */
  emailCopies(accountId: string, fallback: boolean): boolean {
    const row = this.db.prepare("select email_copies from account_settings where account_id = ?").get(accountId) as { email_copies: number } | undefined;
    return row ? row.email_copies === 1 : fallback;
  }

  setEmailCopies(accountId: string, value: boolean): void {
    this.db.prepare("insert into account_settings (account_id, email_copies) values (?, ?) on conflict (account_id) do update set email_copies = excluded.email_copies").run(accountId, value ? 1 : 0);
  }

  /** The texts the admin saved, by key. */
  texts(): Record<string, { en: string; de: string }> {
    return Object.fromEntries((this.db.prepare("select key, en, de from texts order by key").all() as unknown as { key: string; en: string; de: string }[]).map((row) => [row.key, { en: row.en, de: row.de }]));
  }

  /** Saves a text; empty English and German delete the override. */
  setText(key: string, en: string, de: string): void {
    if (!en && !de) this.db.prepare("delete from texts where key = ?").run(key);
    else this.db.prepare("insert into texts (key, en, de) values (?, ?, ?) on conflict (key) do update set en = excluded.en, de = excluded.de").run(key, en, de);
  }

  // ── For the admin ──────────────────────────────────────────────────────

  /** The admin's own conversations, newest activity first. */
  tavoraConversations(): Conversation[] {
    return (this.db.prepare("select * from conversations where kind = 'tavora' order by last_message_at desc, rowid desc").all() as unknown as ConversationSql[]).map(toConversation);
  }

  /** Conversations with an open report, newest report first. */
  reportedConversations(): Conversation[] {
    return (
      this.db
        .prepare("select c.* from conversations c where c.id in (select conversation_id from conversation_reports) order by (select max(at) from conversation_reports where conversation_id = c.id) desc, c.rowid desc")
        .all() as unknown as ConversationSql[]
    ).map(toConversation);
  }

  /** What waits for the admin: its conversations with an unread answer, and reported conversations. */
  waiting(): { unreadReplies: number; openReports: number } {
    const unreadReplies = (
      this.db
        .prepare("select count(*) as n from conversations c where kind = 'tavora' and exists (select 1 from messages m where m.conversation_id = c.id and m.sender = 'user' and m.id > c.other_read)")
        .get() as { n: number }
    ).n;
    const openReports = (this.db.prepare("select count(distinct conversation_id) as n from conversation_reports").get() as { n: number }).n;
    return { unreadReplies, openReports };
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MODULE_ID = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*){1,4}$/;
const CONVERSATION_ID = /^[A-Za-z0-9_-]{16}$/;
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);

/** A message as typed: trimmed, without controls, at most two blank lines in a row. Null for an empty one, undefined for one that is too long or not text. */
export function cleanMessage(value: unknown, max = MAX_MESSAGE_LENGTH): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return [...text].length <= max ? text : undefined;
}

const isContactKind = (kind: unknown): kind is ContactKind => (CONTACT_KINDS as readonly unknown[]).includes(kind);

/**
 * A contact as the developer sends it, checked: `{ kind, value }`, or `{ enabled, link }` from an older app. Undefined
 * when it doesn't fit. The value is shown on the module page, so the slur filter applies to it.
 */
export function cleanContact(input: Record<string, unknown> | null): Contact | undefined {
  if (!input) return undefined;
  const keys = Object.keys(input);
  if (keys.every((key) => key === "enabled" || key === "link") && typeof input.enabled === "boolean") {
    const link = cleanContactLink(input.link);
    return link === undefined ? undefined : contactFromLegacy(input.enabled, link);
  }
  if (keys.some((key) => key !== "kind" && key !== "value") || !isContactKind(input.kind)) return undefined;
  const value = cleanContactValue(input.kind, input.value);
  if (value === undefined || (value && checkReviewText(value.replace(/[./:?#=&_@-]+/g, " ")) === "words")) return undefined;
  return { kind: input.kind, value };
}

/** A developer's one public link: an https address of at most 200 characters, no spaces, no sign-in part. */
export function cleanContactLink(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const link = value.trim();
  if (link.length > 200 || /[\s\u0000-\u001f\u007f-\u009f]/.test(link)) return undefined;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return undefined;
    // It is shown on the module page, so the slur filter applies (its link rule does not: it is a link on purpose).
    if (checkReviewText(link.replace(/[./:?#=&_-]+/g, " ")) === "words") return undefined;
  } catch {
    return undefined;
  }
  return link;
}

/** Account name for the admin: profile name, else developer name, else email. */
export function accountName(accounts: AccountStore, accountId: string): string | null {
  return accounts.profile(accountId)?.name.trim() || accounts.developer(accountId)?.name || accounts.account(accountId)?.email || null;
}

/** The account that takes a module's messages: the one whose publisher key owns it, else the holder of its id prefix. */
export function developerOf(accounts: AccountStore, moduleId: string, owner: string): string | null {
  return accounts.publisherKey(owner)?.accountId ?? accounts.prefixHolder(moduleId.split(".")[0]!) ?? null;
}

/**
 * A module's contact settings as users see them. A suspended developer takes no new conversations, a banned one
 * none and shows no link either; both come back on their own with unsuspend or unban (account-lifecycle.ts).
 */
export function publicContact(conversations: ConversationStore, accounts: AccountStore, moduleId: string, owner: string): Contact & { enabled: boolean; link: string | null } {
  const developer = developerOf(accounts, moduleId, owner);
  const { kind, value } = conversations.contact(moduleId, developer);
  const shown: Contact = developer && accounts.isBanned(developer) ? { kind: "none", value: null } : developer && accounts.isSuspended(developer) && kind === "tavora" ? { kind: "none", value: null } : { kind, value };
  // enabled and link are what apps before contact kinds read.
  return { ...shown, ...contactToLegacy(shown) };
}

/** The published modules an account is the developer of. */
export function publishedModulesOf(catalog: CatalogStore, accounts: AccountStore, accountId: string) {
  return catalog.index().filter((entry) => ownsModule(accounts, accountId, entry.id, entry.owner));
}

/** Fills {module}, {developer}, {days} and {reason}; a placeholder with no value is left empty. */
export function fillPlaceholders(text: string, values: Partial<Record<(typeof TEXT_PLACEHOLDERS)[number], string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => ((TEXT_PLACEHOLDERS as readonly string[]).includes(name) ? (values[name as (typeof TEXT_PLACEHOLDERS)[number]] ?? "") : whole));
}

/** Whether every {...} in a text is one of the allowed placeholders. */
export function placeholdersOk(text: string): boolean {
  return [...text.matchAll(/\{([^{}]*)\}/g)].every((match) => (TEXT_PLACEHOLDERS as readonly string[]).includes(match[1]!));
}

/** How the other side of a conversation is named for the viewer; never an account id, name or email. */
export function titleFor(accounts: AccountStore, conversation: Conversation, role: "user" | "developer"): string {
  if (conversation.kind === "tavora") return "Tavora";
  if (role === "developer") return `User · ${conversation.label}`;
  const developer = conversation.developerAccountId ? accounts.developer(conversation.developerAccountId)?.name : null;
  const module = conversation.moduleName ?? conversation.moduleId ?? "";
  return developer ? `Developer of ${module} (${developer})` : `Developer of ${module}`;
}

// ── Email copies ─────────────────────────────────────────────────────────

const MAIL_TEXTS: Record<"newRequest" | "newReply" | "tavora", Record<MailLanguage, { subject: string; lead: string }>> = {
  newRequest: {
    en: { subject: "New message in Tavora", lead: "You have a new request for {module}." },
    de: { subject: "Neue Nachricht in Tavora", lead: "Du hast eine neue Anfrage zu {module}." },
  },
  newReply: {
    en: { subject: "New message in Tavora", lead: "You have a new reply." },
    de: { subject: "Neue Nachricht in Tavora", lead: "Du hast eine neue Antwort." },
  },
  tavora: {
    en: { subject: "New message from Tavora", lead: "Tavora wrote to you." },
    de: { subject: "Neue Nachricht von Tavora", lead: "Tavora hat dir geschrieben." },
  },
};

/** The built-in text of every editable key in English and German: the app's inbox notes and the opening line of each email copy. */
export function builtInTexts(): Record<(typeof TEXT_KEYS)[number], { en: string; de: string }> {
  const lead = (kind: keyof typeof MAIL_TEXTS) => ({ en: MAIL_TEXTS[kind].en.lead, de: MAIL_TEXTS[kind].de.lead });
  return { ...BUILT_IN_TEXTS, "mail.newRequest": lead("newRequest"), "mail.newReply": lead("newReply"), "mail.tavora": lead("tavora") };
}

export interface ConversationNotifier {
  /** Sends the receiving side an email copy of a new message when it wants one and has an address. Never throws; best effort. */
  message(conversation: Conversation, from: Message["from"], text: string, first: boolean): Promise<boolean>;
}

/**
 * Email copies (decided 2026-10-27): the receiving side gets the full text, who it is from as the pseudonym only, and a line
 * to answer in the Tavora app, if its `emailCopies` is on and it has an address. The editable text (`mail.newRequest`,
 * `mail.newReply`, `mail.tavora`) replaces the opening line. The daily mail limit applies, with the reserved mails left alone.
 */
export function createConversationNotifier({ conversations, accounts, catalog, notifier }: { conversations: ConversationStore; accounts: AccountStore; catalog: CatalogStore; notifier: Notifier }): ConversationNotifier {
  return {
    async message(conversation, from, text, first) {
      try {
        const receiverId = from === "user" ? conversation.developerAccountId : conversation.userAccountId;
        if (!receiverId) return false;
        // One copy until the receiver reads: later messages wait in the app, so nobody can flood an inbox or the mail budget.
        if (conversations.unreadCount(conversation.id, from === "user" ? "other" : "user") > 1) return false;
        const account = accounts.account(receiverId);
        if (!account?.email) return false;
        const fallback = publishedModulesOf(catalog, accounts, receiverId).length === 0;
        if (!conversations.emailCopies(receiverId, fallback)) return false;
        const language = mailLanguage(catalog.languageOf(receiverId));
        const kind = from === "tavora" ? "tavora" : first && from === "user" ? "newRequest" : "newReply";
        const base = MAIL_TEXTS[kind][language];
        const saved = conversations.texts()[`mail.${kind}`]?.[language]?.trim();
        const sender = titleFor(accounts, conversation, from === "user" ? "developer" : "user");
        const values = { module: conversation.moduleName ?? conversation.moduleId ?? "", developer: conversation.developerAccountId ? (accounts.developer(conversation.developerAccountId)?.name ?? "") : "" };
        const lead = fillPlaceholders(saved || base.lead, values);
        const from_ = language === "de" ? "Von" : "From";
        const answer = language === "de" ? "Antworte in der Tavora-App." : "Answer in the Tavora app.";
        const mail: Mail = { to: account.email, subject: base.subject, text: `${lead}\n\n${from_}: ${sender}\n\n${text}\n\n${answer}\n\nTavora\n` };
        // Copies get their own share of the day's mails, so sign-in codes always have room.
        if (!conversations.takeMailCopy(new Date().toISOString().slice(0, 10))) return false;
        return await notifier.send(mail);
      } catch {
        return false;
      }
    },
  };
}

// ── The routes ───────────────────────────────────────────────────────────

export interface ConversationOptions {
  conversations: ConversationStore;
  catalog: CatalogStore;
  accounts: AccountStore;
  clientKey: (request: Request) => string;
  /** Writes per client: 30 an hour by default. */
  writeRateLimiter?: RateLimiter;
  /** Sends the email copies. Absent: none are sent. */
  notifier?: ConversationNotifier;
  now?: () => number;
}

type Env = SignedInEnv;

/**
 * The user routes under /v1/conversations, the developer's contact settings (mounted under /v1/catalog) and the public
 * editable texts (/v1/texts). Everything but the texts needs a sign-in and is never cached; bodies are JSON of at most 8 KB.
 */
export function conversationRoutes({ conversations, catalog, accounts, clientKey, writeRateLimiter, notifier, now = Date.now }: ConversationOptions) {
  const writeLimiter = writeRateLimiter ?? createRateLimiter({ limit: 30, windowMs: 3_600_000 });
  const user = new Hono<Env>();
  const contact = new Hono<Env>();
  const texts = new Hono();

  const bad = (context: Context, message: string, reason = "bad-request") => context.json({ error: message, reason }, 400);
  const notFound = (context: Context) => context.json({ error: "Not found.", reason: "not-found" }, 404);
  const hoursUntil = (time: number) => Math.max(1, Math.ceil((time - now()) / 3_600_000));

  const signedIn = requireSignIn(accounts, now);
  const writes = async (context: Context<Env>, next: () => Promise<void>) => {
    if (context.req.method === "GET") return next();
    const wait = writeLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    await next();
  };
  const small = bodyLimit({ maxSize: 16_000, onError: (context) => context.json({ error: "Too big.", reason: "bad-request" }, 413) });
  /** The JSON body: an empty one is `{}`, anything else must be a JSON object sent as JSON. Null when it is not. */
  const body = async (context: Context): Promise<Record<string, unknown> | null> => {
    const text = await context.req.text();
    if (!text.trim()) return {};
    if (!(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) return null;
    try {
      const value = JSON.parse(text) as unknown;
      return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const filterRefusal = (context: Context, text: string) => {
    const result = checkReviewText(text);
    if (result === "link") return context.json({ error: "Messages can't hold links or email addresses.", reason: "message-link" }, 400);
    if (result === "words") return context.json({ error: "Some words in it aren't allowed.", reason: "message-words" }, 400);
    return null;
  };

  /** Which side of the conversation the account is, or null (also for a conversation it deleted). */
  const roleOf = (conversation: Conversation, accountId: string): "user" | "developer" | null => {
    if (conversation.userAccountId === accountId && !conversation.deletedByUser) return "user";
    if (conversation.developerAccountId === accountId && !conversation.deletedByOther) return "developer";
    return null;
  };
  const sideOf = (role: "user" | "developer") => (role === "user" ? "user" : "other");
  const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString());

  /** One conversation as its viewer sees it: the other side only as a title. */
  const item = (conversation: Conversation, role: "user" | "developer") => ({
    id: conversation.id,
    kind: conversation.kind,
    role,
    module: conversation.moduleId ? { id: conversation.moduleId, name: conversation.moduleName ?? conversation.moduleId } : null,
    type: conversation.type,
    label: conversation.label,
    title: titleFor(accounts, conversation, role),
    state: conversation.state,
    closeReason: conversation.closeReason,
    createdAt: iso(conversation.createdAt),
    lastMessageAt: iso(conversation.lastMessageAt),
    closedAt: iso(conversation.closedAt),
    unread: conversations.unread(conversation, sideOf(role)),
    previousId: conversation.previousId,
    closesInDays: conversations.closesInDays(conversation, now()),
  });
  const detail = (conversation: Conversation, role: "user" | "developer") => ({
    conversation: item(conversation, role),
    messages: conversations.messages(conversation.id).map((message) => ({
      id: message.id,
      from: message.from,
      mine: message.from === role,
      text: message.text,
      at: iso(message.createdAt),
      ...(message.versions ? { versions: message.versions } : {}),
    })),
  });

  const ownsPublished = (accountId: string) => publishedModulesOf(catalog, accounts, accountId);
  const wantsCopies = (accountId: string) => conversations.emailCopies(accountId, ownsPublished(accountId).length === 0);

  // Settings first: "/settings" must not be read as a conversation id.
  user.use("*", writes, signedIn);
  // The email copies, and the contact a developer's modules have until one gets its own.
  const settingsOf = (account: { id: string; email?: string | null }) => ({ emailCopies: wantsCopies(account.id), hasEmail: Boolean(account.email), contact: conversations.contactDefault(account.id) });
  user.get("/settings", (context) => context.json(settingsOf(context.get("account"))));
  user.put("/settings", small, async (context) => {
    const input = await body(context);
    const account = context.get("account");
    if (input && Object.keys(input).join() === "contact") {
      if (accounts.isBanned(account.id)) return banned(context);
      const settings = cleanContact(typeof input.contact === "object" && input.contact !== null ? (input.contact as Record<string, unknown>) : null);
      if (!settings || !("kind" in (input.contact as object))) return bad(context, "Send { contact: { kind, value } }.", "bad-link");
      conversations.setContactDefault(account.id, settings);
      return context.json(settingsOf(account));
    }
    if (!input || Object.keys(input).join() !== "emailCopies" || typeof input.emailCopies !== "boolean") return bad(context, "Send { emailCopies: true or false } or { contact: { kind, value } }.");
    conversations.setEmailCopies(account.id, input.emailCopies);
    return context.json(settingsOf(account));
  });

  user.get("/", (context) => {
    const account = context.get("account");
    const list = conversations.listFor(account.id).flatMap((conversation) => {
      const role = roleOf(conversation, account.id);
      return role ? [item(conversation, role)] : [];
    });
    const developer = ownsPublished(account.id).some((entry) => conversations.contact(entry.id, account.id).kind === "tavora");
    return context.json({ conversations: list, inbox: { open: list.filter((entry) => entry.state === "open").length, unread: list.filter((entry) => entry.unread).length, developer } });
  });

  // Starts a conversation with the developer of a module.
  user.post("/", small, async (context) => {
    const account = context.get("account");
    const input = await body(context);
    if (!input) return bad(context, "Send JSON.");
    if (typeof input.moduleId !== "string" || !MODULE_ID.test(input.moduleId)) return bad(context, "Send { moduleId, type, text, versions }.");
    const listed = isOfficialId(input.moduleId) ? null : catalog.module(input.moduleId);
    if (!listed) return notFound(context);
    if (ownsModule(accounts, account.id, input.moduleId, listed.module.owner)) return context.json({ error: "You can't write to yourself.", reason: "own-module" }, 403);
    const settings = publicContact(conversations, accounts, input.moduleId, listed.module.owner);
    const developerId = developerOf(accounts, input.moduleId, listed.module.owner);
    if (!settings.enabled || !developerId) return context.json({ error: "The developer doesn't take messages in Tavora.", reason: "contact-off", link: settings.link }, 403);
    const text = cleanMessage(input.text);
    const versions = input.versions as Record<string, unknown> | null | undefined;
    if (
      Object.keys(input).some((key) => !["moduleId", "type", "text", "versions", "previousId"].includes(key)) ||
      !isOneOf(TYPES, input.type) ||
      typeof text !== "string" ||
      typeof versions !== "object" ||
      versions === null ||
      typeof versions.tavora !== "string" ||
      typeof versions.module !== "string" ||
      !SEMVER.test(versions.tavora) ||
      !SEMVER.test(versions.module) ||
      versions.tavora.length > 64 ||
      versions.module.length > 64 ||
      (input.previousId !== undefined && input.previousId !== null && typeof input.previousId !== "string")
    ) {
      return bad(context, `Send { moduleId, type: one of ${TYPES.join(", ")}, text: 1 to ${MAX_MESSAGE_LENGTH} characters, versions: { tavora, module } }.`);
    }
    const at = now();
    const age = at - Date.parse(account.createdAt);
    if (age < MIN_ACCOUNT_AGE_MS) return context.json({ error: "New accounts can write after a day.", reason: "account-too-new", hours: hoursUntil(at - age + MIN_ACCOUNT_AGE_MS) }, 403);
    const today = conversations.countToday(account.id, "conversation", at);
    if (today.count >= DAILY_CONVERSATIONS) {
      return context.json({ error: `You can start ${DAILY_CONVERSATIONS} conversations a day.`, reason: "daily-limit", hours: hoursUntil((today.oldest ?? at) + DAY_MS) }, 429);
    }
    if (conversations.blockedFor(account.id, input.moduleId)) return context.json({ error: "This conversation was blocked, so you can't start a new one about this module.", reason: "blocked" }, 403);
    const open = conversations.openFor(account.id, input.moduleId);
    if (open) return context.json({ error: "You already have an open conversation about this module.", reason: "already-open", id: open.id }, 409);
    const refused = filterRefusal(context, text);
    if (refused) return refused;
    let previousId: string | null = null;
    if (typeof input.previousId === "string") {
      const previous = CONVERSATION_ID.test(input.previousId) ? conversations.get(input.previousId) : null;
      if (!previous || previous.kind !== "developer" || previous.userAccountId !== account.id || previous.moduleId !== input.moduleId || previous.state !== "closed") return bad(context, "previousId must be your own closed conversation about this module.");
      previousId = previous.id;
    }
    const conversation = conversations.startDeveloper(
      { moduleId: input.moduleId, moduleName: listed.module.name, developerAccountId: developerId, userAccountId: account.id, type: input.type, text, versions: { tavora: versions.tavora, module: versions.module }, previousId },
      at,
    );
    conversations.markRead(conversation.id, "user");
    void notifier?.message(conversation, "user", text, true).catch(() => undefined);
    return context.json(detail(conversation, "user"), 201);
  });

  /** The conversation and the caller's side of it, or the refusal to send. */
  const mine = (context: Context<Env>) => {
    const id = context.req.param("id") ?? "";
    const conversation = CONVERSATION_ID.test(id) ? conversations.get(id) : null;
    const role = conversation ? roleOf(conversation, context.get("account").id) : null;
    return conversation && role ? { conversation, role } : null;
  };

  user.get("/:id", (context) => {
    const found = mine(context);
    if (!found) return notFound(context);
    conversations.markRead(found.conversation.id, sideOf(found.role));
    return context.json(detail(found.conversation, found.role));
  });

  user.post("/:id/messages", small, async (context) => {
    const found = mine(context);
    if (!found) return notFound(context);
    const input = await body(context);
    const text = cleanMessage(input?.text);
    if (!input || Object.keys(input).join() !== "text" || typeof text !== "string") return bad(context, `Send { text: 1 to ${MAX_MESSAGE_LENGTH} characters }.`);
    if (found.conversation.state !== "open") return context.json({ error: "This conversation is closed.", reason: "closed" }, 409);
    const at = now();
    const today = conversations.countToday(context.get("account").id, "message", at);
    if (today.count >= DAILY_MESSAGES) return context.json({ error: `You can send ${DAILY_MESSAGES} messages a day.`, reason: "daily-limit", hours: hoursUntil((today.oldest ?? at) + DAY_MS) }, 429);
    const refused = filterRefusal(context, text);
    if (refused) return refused;
    const from = found.role === "user" ? "user" : "developer";
    conversations.addMessage(found.conversation.id, from, context.get("account").id, text, at);
    conversations.markRead(found.conversation.id, sideOf(found.role));
    void notifier?.message(found.conversation, from, text, false).catch(() => undefined);
    return context.json(detail(conversations.get(found.conversation.id)!, found.role));
  });

  user.post("/:id/close", small, async (context) => {
    const found = mine(context);
    if (!found) return notFound(context);
    if (found.conversation.kind === "tavora") return context.json({ error: "Only Tavora closes this conversation.", reason: "tavora-only" }, 403);
    const input = await body(context);
    if (!input || Object.keys(input).some((key) => key !== "outcome") || (input.outcome !== undefined && !isOneOf(OUTCOMES, input.outcome))) return bad(context, `Send { outcome? } with outcome one of ${OUTCOMES.join(", ")}.`);
    if (found.conversation.state !== "open") return context.json({ error: "This conversation is closed.", reason: "closed" }, 409);
    // The user's own close is "Closed by you"; only the developer picks an outcome.
    const reason: CloseReason = found.role === "user" ? "user" : ((input.outcome as Outcome | undefined) ?? "none");
    conversations.closeConversation(found.conversation.id, reason, now());
    return context.json(detail(conversations.get(found.conversation.id)!, found.role));
  });

  /** The optional report of a conversation, from `{ reason, note? }`; a string is the refusal. */
  const reportInput = (value: unknown): { reason: ReportReason; note: string | null } | null => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const { reason, note, ...rest } = value as Record<string, unknown>;
    const text = note === undefined ? null : cleanMessage(note, MAX_NOTE_LENGTH);
    return Object.keys(rest).length === 0 && isOneOf(REPORT_REASONS, reason) && text !== undefined ? { reason, note: text } : null;
  };
  const reportError = `Send { reason: one of ${REPORT_REASONS.join(", ")}, note?: at most ${MAX_NOTE_LENGTH} characters }.`;

  user.post("/:id/block", small, async (context) => {
    const found = mine(context);
    if (!found) return notFound(context);
    if (found.conversation.kind === "tavora") return context.json({ error: "You can't block Tavora.", reason: "tavora-only" }, 403);
    const input = await body(context);
    if (!input || Object.keys(input).some((key) => key !== "report")) return bad(context, "Send { report?: { reason, note? } }.");
    const report = input.report === undefined || input.report === null ? null : reportInput(input.report);
    if (input.report !== undefined && input.report !== null && !report) return bad(context, reportError);
    conversations.closeConversation(found.conversation.id, "blocked", now());
    if (report) conversations.report(found.conversation.id, context.get("account").id, report.reason, report.note, now());
    return context.json(detail(conversations.get(found.conversation.id)!, found.role));
  });

  user.post("/:id/report", small, async (context) => {
    const found = mine(context);
    if (!found) return notFound(context);
    if (found.conversation.kind === "tavora") return context.json({ error: "You can't report Tavora.", reason: "tavora-only" }, 403);
    const input = await body(context);
    const report = reportInput(input);
    if (!report) return bad(context, reportError);
    conversations.report(found.conversation.id, context.get("account").id, report.reason, report.note, now());
    return context.json({ status: "received" }, 202);
  });

  // Deletes it for the caller. An open developer conversation closes first, so the other side isn't left waiting.
  user.delete("/:id", (context) => {
    const found = mine(context);
    if (!found) return notFound(context);
    if (found.conversation.state === "open" && found.conversation.kind === "developer") conversations.closeConversation(found.conversation.id, found.role === "user" ? "user" : "none", now());
    conversations.deleteFor(found.conversation.id, sideOf(found.role));
    return context.body(null, 204);
  });

  // The developer's contact settings for a module.
  contact.use("/modules/:id/contact", writes, signedIn);
  const developerOnly = (context: Context<Env>) => {
    const id = context.req.param("id") ?? "";
    const listed = MODULE_ID.test(id) ? catalog.module(id) : null;
    if (!listed) return { error: notFound(context) };
    if (!ownsModule(accounts, context.get("account").id, id, listed.module.owner)) return { error: context.json({ error: "Only the module's developer can change this.", reason: "not-publisher" }, 403) };
    return { id };
  };
  // What the developer set, with enabled and link for apps before contact kinds.
  const developerView = (moduleId: string, accountId: string) => {
    const settings = conversations.contact(moduleId, accountId);
    return { ...settings, ...contactToLegacy(settings) };
  };
  contact.get("/modules/:id/contact", (context) => {
    const checked = developerOnly(context);
    return checked.error ?? context.json(developerView(checked.id!, context.get("account").id));
  });
  contact.put("/modules/:id/contact", bodyLimit({ maxSize: 1000, onError: (context) => context.json({ error: "Too big.", reason: "bad-request" }, 413) }), async (context) => {
    const checked = developerOnly(context);
    if (checked.error) return checked.error;
    // A banned developer no longer acts as the publisher (decided 2026-10-29).
    if (accounts.isBanned(context.get("account").id)) return banned(context);
    const settings = cleanContact(await body(context));
    if (!settings) return bad(context, "Send { kind, value }: the value fits the kind (an email address, a GitHub or Discord invite link, a Discord user name, an https link) or is null.", "bad-link");
    conversations.setContact(checked.id!, settings);
    return context.json(developerView(checked.id!, context.get("account").id));
  });

  // The explanation notes and mails the admin edited; the app falls back to its built-in texts for the rest.
  texts.get("/", (context) => {
    context.header("Cache-Control", "public, max-age=300");
    return context.json({ texts: conversations.texts() });
  });

  return { user, contact, texts };
}
