import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { accountLifecycle, type AccountLifecycle } from "./account-lifecycle.ts";
import { cleanDeveloperName, DEVICE_OS, MAX_PREFIXES, NAME_HOLD_MS, normalizeEmail, type Account, type AccountStore, type CodeAsker, type DeviceOs, type StoredProfile } from "./account-store.ts";
import type { CatalogStore } from "./catalog.ts";
import { OFFICIAL_PINS, type CatalogTrust, type OfficialPins } from "./catalog-trust.ts";
import type { CopyStore } from "./cloud-copy.ts";
import { DiscordError, isDiscordCode, isPkceVerifier, type DiscordClient, type DiscordIdentity } from "./discord.ts";
import { keyRequestStatus } from "./key-requests.ts";
import { codeMail, confirmEmailChangeMail, emailChangedMail, keyRequestMail, MailLimitError, mailLanguage, type Mail, type Mailer } from "./mail.ts";
import { inspectPng } from "./png.ts";
import { checkAll, createRateLimiter, networkOf, type RateLimiter } from "./rate-limit.ts";
import { requireSignIn, tooMany, type SignedInEnv } from "./sign-in.ts";
import type { ReviewStore } from "./reviews.ts";
import type { ConversationStore } from "./conversations.ts";
import type { LeaderboardStore } from "./leaderboards.ts";

/**
 * The account routes under /v1/account. Every answer that could tell whether
 * an address has an account is the same either way until the code for it was
 * right, which only the owner of the address can know. Errors carry a `reason`
 * the app translates.
 */

export interface AccountOptions {
  store: AccountStore;
  mailer: Mailer;
  /** Requests for a code per client: 10 an hour by default. */
  codeRateLimiter?: RateLimiter;
  /** Signed-out requests for a code per client, a day: 20 by default, so nobody spends the day's emails alone. */
  codeDayRateLimiter?: RateLimiter;
  /** The same per network (an IPv4 /24, an IPv6 /48): 40 a day by default. */
  codeNetworkRateLimiter?: RateLimiter;
  /** New accounts a day (UTC), by email and Discord together: 500 by default. */
  accountDailyLimit?: number;
  /** New accounts per network a day: 20 by default. */
  accountNetworkRateLimiter?: RateLimiter;
  /** Codes for changing the address per account, a day: 3 by default. */
  changeEmailRateLimiter?: RateLimiter;
  /**
   * Sign-in codes one address may draw a day from the emails kept for accounts (MAIL_FOR_ACCOUNTS_SHARE): 3 by default,
   * counted apart for the networks the address signed in from and for everyone else.
   */
  accountShareRateLimiter?: RateLimiter;
  /**
   * Emails one account asks for to its own address a day: codes to delete it or to connect or remove a sign-in method,
   * and the notice of a key replacement. 5 by default, for all of them together.
   */
  ownerMailRateLimiter?: RateLimiter;
  /** Delete codes one account may draw a day from the reserved emails (MAIL_RESERVED) once sign-in codes ran out: 1 by default. */
  reserveRateLimiter?: RateLimiter;
  /** The same per network (an IPv4 /24, an IPv6 /48): 2 a day by default. */
  reserveNetworkRateLimiter?: RateLimiter;
  /** Waits this long (ms); a test passes its own so nothing really waits. */
  pause?: (ms: number) => Promise<void>;
  /** A number from 0 up to 1 for the jitter of a pause (Math.random by default). */
  random?: () => number;
  /** Code checks per client: 20 in 15 minutes by default. */
  verifyRateLimiter?: RateLimiter;
  now?: () => number;
  /** The provider's emails a day (Brevo's free plan: 300). Unset: no limit (the test inbox). */
  mailDailyLimit?: number;
  /** Discord login. Absent: its routes answer 503 and email sign-in works as before. */
  discord?: DiscordClient;
  /** The cloud copies (cloud-copy.ts), deleted with their account. Absent: the copy routes answer 503. */
  copies?: CopyStore;
  /** Ratings and reviews of catalog modules (reviews.ts), deleted with their account. Absent: listings have no rating and the review routes answer 503. */
  reviews?: ReviewStore;
  /** Conversations (conversations.ts), closed with `left` and emptied of the account's texts when it is deleted. Absent: the conversation routes answer 503. */
  conversations?: ConversationStore;
  /** Leaderboards (leaderboards.ts), deleted with their account. Absent: the leaderboard routes answer 503. */
  leaderboards?: LeaderboardStore;
  /** The signed lists as served (catalog-trust.ts), to tell when a key replacement was signed. Absent: requests stay waiting. */
  trust?: CatalogTrust;
  /** The module catalog, to tell which held prefixes have a module. Absent: none has. */
  catalog?: CatalogStore;
  /** Tavora's pinned publisher key and account (OFFICIAL_PINS by default): no key request touches the pinned key's chain from another account. */
  officialPins?: OfficialPins;
  /** Prefix claims per client: 30 an hour by default, like uploads. */
  prefixRateLimiter?: RateLimiter;
  /** What deleting the account reaches (account-lifecycle.ts); the server passes the one built over every store. Absent: built from the stores above. */
  lifecycle?: AccountLifecycle;
}

/**
 * Of the day's emails, the last ones are kept for deleting an account: once sign-in codes ran out, an account made before
 * today may still draw one delete code a day from them, and one network two a day. Everything else an owner asks for
 * (connecting or removing a sign-in method, a key replacement's notice) stops with the sign-in codes, so no number of
 * accounts spends these by asking for those.
 */
export const MAIL_RESERVED = 20;
/**
 * Of the emails left for sign-in codes, this share (rounded down) only goes to addresses that already have an account:
 * a flood of codes to made-up addresses can't stop existing users signing in. At Brevo's 300: 20 reserved, 93 for
 * accounts, so new addresses get codes until 187 went out.
 */
export const MAIL_FOR_ACCOUNTS_SHARE = 1 / 3;
/** New accounts a day by default, by email and Discord together. */
export const ACCOUNTS_PER_DAY = 500;
/**
 * An answer that sends no mail waits about as long as one that does, so the time doesn't tell which addresses have an
 * account: the running average of recent sends (starting here), give or take a quarter, within these bounds.
 */
export const SEND_PAUSE = { startMs: 500, minMs: 50, maxMs: 3000 } as const;
const DAY_MS = 24 * 60 * 60_000;
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
/** An address and who asks for it (account-store.ts codeGroup) as a limiter key: a hash, so memory holds no address. */
const addressLimitKey = (email: string, group: string) => createHash("sha256").update(`share:${group}:${email}`).digest("hex");
const nextUtcDay = (at: number) => {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
};

type Env = SignedInEnv;

const CODE = /^\d{6}$/;
/** A module id prefix: the first part of a module id (module-schema's MODULE_ID), which is at most 128 characters with a dot and a second part. */
const PREFIX = /^[a-z][a-z0-9]{0,125}$/;
/** The profile's limits, the same as the app's: a name of 32 characters, 3 initials, a 256 px PNG of at most 512 KB. */
const MAX_NAME = 32;
const MAX_INITIALS = 3;
const MAX_PICTURE_BYTES = 512 * 1024;
const PICTURE_SIZE = 256;
const PROFILE_BODY = Math.ceil((MAX_PICTURE_BYTES * 4) / 3) + 2000;

/** A profile the app sent, or null when any part of it is off. Its time is never later than now. */
function parseProfile(input: Record<string, unknown>, now: number): StoredProfile | null {
  const { name, initials, picture, updatedAt } = input;
  if (typeof name !== "string" || [...name].length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(name)) return null;
  if (typeof initials !== "string" || [...initials].length > MAX_INITIALS || /\s/.test(initials)) return null;
  const at = typeof updatedAt === "string" ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isFinite(at)) return null;
  let bytes: Uint8Array | null = null;
  if (picture !== null) {
    if (typeof picture !== "string" || picture.length > PROFILE_BODY || !/^[A-Za-z0-9+/]+={0,2}$/.test(picture)) return null;
    bytes = new Uint8Array(Buffer.from(picture, "base64"));
    const size = inspectPng(bytes, MAX_PICTURE_BYTES);
    if (size?.width !== PICTURE_SIZE || size.height !== PICTURE_SIZE) return null;
  }
  return { name, initials, picture: bytes, updatedAt: Math.min(at, now) };
}

const profileAnswer = (profile: StoredProfile | null) =>
  profile
    ? { name: profile.name, initials: profile.initials, picture: profile.picture ? Buffer.from(profile.picture).toString("base64") : null, updatedAt: new Date(profile.updatedAt).toISOString() }
    : null;
const deviceOs = (input: unknown): DeviceOs => (DEVICE_OS.includes(input as DeviceOs) ? (input as DeviceOs) : "other");
/** Most characters a device name keeps. */
export const MAX_DEVICE_NAME = 40;
/** A device's name: printable text, trimmed, at most MAX_DEVICE_NAME characters; null for anything else. */
export const deviceName = (input: unknown): string | null => {
  if (typeof input !== "string") return null;
  const name = [...input.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()].slice(0, MAX_DEVICE_NAME).join("").trim();
  return name || null;
};
/** What the owner sees of their account: never the Discord id, only its username as a label. */
const accountAnswer = (account: Account) => ({ email: account.email, discord: account.discord ? { name: account.discord.name } : null, createdAt: account.createdAt });
const lastMethod = (context: Context) => context.json({ error: "An account keeps at least one way to sign in.", reason: "last-method" }, 409);
const discordConnected = (context: Context) =>
  context.json({ error: "This account already has a Discord login; disconnect it first.", reason: "discord-connected" }, 409);
const noEmail = (context: Context) => context.json({ error: "This account has no email address.", reason: "no-email" }, 409);
const noDiscord = (context: Context) => context.json({ error: "This account has no Discord login.", reason: "no-discord" }, 409);
/** A suspended account (the maintainer did it, reversible): nothing signs in, and the app says so. */
const suspended = (context: Context) => context.json({ error: "This account is suspended.", reason: "suspended" }, 403);
const discordUnavailable = (context: Context) => context.json({ error: "Discord sign-in is not available right now.", reason: "unavailable" }, 503);
const wrongCode = (context: Context) => context.json({ error: "That code is wrong or has expired.", reason: "wrong-code" }, 400);
const wrongCurrentCode = (context: Context) => context.json({ error: "The code sent to your current address is wrong or has expired.", reason: "wrong-current-code" }, 400);
/**
 * An app from before the email change needed proof of the current address. Older apps show the `error` of an
 * `invalid` answer as it is ("Tavora said no: …"), so it is in the user's language.
 */
const updateToChange = (context: Context, language: "en" | "de") =>
  context.json({ error: language === "de" ? "Aktualisiere Tavora, um deine E-Mail zu ändern." : "Update Tavora to change your email.", reason: "invalid" }, 400);

export function accountRoutes(options: AccountOptions, limiter: RateLimiter, clientKey: (request: Request) => string) {
  const { store, mailer } = options;
  const now = options.now ?? Date.now;
  const codeLimiter = options.codeRateLimiter ?? createRateLimiter({ limit: 10, windowMs: 3_600_000 });
  const verifyLimiter = options.verifyRateLimiter ?? createRateLimiter({ limit: 20, windowMs: 15 * 60_000 });
  const prefixLimiter = options.prefixRateLimiter ?? createRateLimiter({ limit: 30, windowMs: 3_600_000 });
  // A day's share of sign-in codes: 20 per client and 40 per network (two clients' worth, so one office or household
  // isn't stopped by one busy PC), far above what one person needs and far below the day's emails.
  const codeDayLimiter = options.codeDayRateLimiter ?? createRateLimiter({ limit: 20, windowMs: DAY_MS });
  const codeNetworkLimiter = options.codeNetworkRateLimiter ?? createRateLimiter({ limit: 40, windowMs: DAY_MS });
  const accountDailyLimit = options.accountDailyLimit ?? ACCOUNTS_PER_DAY;
  const accountNetworkLimiter = options.accountNetworkRateLimiter ?? createRateLimiter({ limit: 20, windowMs: DAY_MS });
  const changeEmailLimiter = options.changeEmailRateLimiter ?? createRateLimiter({ limit: 3, windowMs: DAY_MS });
  const accountShareLimiter = options.accountShareRateLimiter ?? createRateLimiter({ limit: 3, windowMs: DAY_MS });
  // Half the owner group's day (account-store.ts CODES_PER_DAY), for every purpose together: a person deletes an account or
  // changes a sign-in method a few times at most, and an account made only to spend the day's emails yields few.
  const ownerMailLimiter = options.ownerMailRateLimiter ?? createRateLimiter({ limit: 5, windowMs: DAY_MS });
  const reserveLimiter = options.reserveRateLimiter ?? createRateLimiter({ limit: 1, windowMs: DAY_MS });
  // Two a network: a household where two people delete on a full day, never the 20 for accounts made on one network.
  const reserveNetworkLimiter = options.reserveNetworkRateLimiter ?? createRateLimiter({ limit: 2, windowMs: DAY_MS });
  const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const app = new Hono<Env>();
  const lifecycle =
    options.lifecycle ??
    accountLifecycle({ accounts: store, catalog: options.catalog, copies: options.copies, reviews: options.reviews, conversations: options.conversations, leaderboards: options.leaderboards, icons: undefined });
  /** Everything on the server goes at once (account-lifecycle.ts). */
  const deleteAccount = (id: string) => lifecycle.delete(id, now());

  /**
   * The day's emails can't take `count` more: `important` ones (a delete code, within reserveLimiter) may use all of them,
   * sign-in codes and everything else all but the reserved ones, and codes to `new` addresses also leave the share kept
   * for accounts.
   */
  const usedUp = (kind: "important" | "sign-in" | "new", count = 1) => {
    if (options.mailDailyLimit === undefined) return false;
    const signIn = Math.max(0, options.mailDailyLimit - MAIL_RESERVED);
    const room = kind === "important" ? options.mailDailyLimit : kind === "sign-in" ? signIn : signIn - Math.floor(signIn * MAIL_FOR_ACCOUNTS_SHARE);
    return store.mailsSent(utcDay(now())) + count > room;
  };
  const usedUpAnswer = (context: Context) =>
    context.json({ error: "Today's emails are used up. Try again tomorrow.", reason: "daily-limit", retryAt: new Date(nextUtcDay(now())).toISOString() }, 503);

  /** Who asks for a code to an address that isn't their own account's: their network, held in memory only. */
  const stranger = (context: Context): CodeAsker => ({ from: networkOf(clientKey(context.req.raw)) });
  const OWNER: CodeAsker = { owner: true };

  /** The client's and its network's day shares of codes (as for sign-in codes): 0 and both counted, or the wait, counting neither. */
  const dayShares = (context: Context, ...more: [RateLimiter, string][]) => {
    const client = clientKey(context.req.raw);
    return checkAll([[codeDayLimiter, client], [codeNetworkLimiter, networkOf(client)], ...more]);
  };
  /**
   * Seconds before the signed-in account may have another email sent to its own address, or 0 and counted. The same
   * day's shares per client and network as sign-in codes, and ownerMailLimiter per account, so accounts made for it
   * can't spend the day's emails: owners' emails take at most 5 an account and 40 a network a day. A refusal counts in
   * none of them.
   */
  const ownerShare = (context: Context, accountId: string) => dayShares(context, [ownerMailLimiter, accountId]);
  /**
   * Whether a delete code may come out of the reserved emails (MAIL_RESERVED) for the account: only for one made before
   * today, once a day per account and twice per network, so neither accounts nor a network made for it can spend them.
   * Counts only when it may.
   */
  const drawReserve = (context: Context, account: Account) =>
    !usedUp("important") &&
    Date.parse(account.createdAt) < dayStart(now()) &&
    checkAll([
      [reserveLimiter, account.id],
      [reserveNetworkLimiter, networkOf(clientKey(context.req.raw))],
    ]) === 0;
  /** No room for an owner's code today: everything stops with the sign-in codes, but a delete code (drawReserve). */
  const ownerMailFull = (context: Context, account: Account, purpose: "delete" | "other") => usedUp("sign-in") && (purpose === "other" || !drawReserve(context, account));

  const dayStart = (at: number) => nextUtcDay(at) - DAY_MS;

  /** No room for another new account today, by email or Discord together: the answer to send, or null. Counts nothing. */
  const accountsFull = (context: Context): Response | null => {
    const at = now();
    if (store.accountsCreatedSince(dayStart(at)) < accountDailyLimit) return null;
    // Apps that don't know this case show "Accounts aren't working right now" for `unavailable`.
    return context.json({ error: "Tavora can't take more new accounts today. Try again tomorrow.", reason: "unavailable", retryAt: new Date(nextUtcDay(at)).toISOString() }, 503);
  };
  /** This network's share of the day's new accounts: counts one, so it is asked only right before an account is made. */
  const networkAccountsFull = (context: Context): Response | null => {
    const wait = accountNetworkLimiter.check(networkOf(clientKey(context.req.raw)), now());
    return wait > 0 ? tooMany(context, wait, "Too many new accounts from here today. Try again later.") : null;
  };

  /** The day's emails for new addresses ran out: the log hears it once a day, and Tavora Admin shows it for the day. */
  const newAddressesFull = () => {
    const at = now();
    if (store.markNewAddressMailFull(utcDay(at), at)) {
      console.warn("[tavora-api] Today's sign-in emails for new addresses are used up; the rest is kept for existing accounts. Raise MAIL_DAILY_LIMIT if this keeps happening.");
    }
  };

  /** How long a mail takes to send lately (ms), so an answer without one can wait as long. */
  let sendMs: number = SEND_PAUSE.startMs;
  /** Waits about as long as a send, for an answer that sends nothing (SEND_PAUSE). */
  const likeASend = () => pause(Math.round(Math.min(SEND_PAUSE.maxMs, Math.max(SEND_PAUSE.minMs, sendMs * (0.75 + random() * 0.5)))));

  const send = async (context: Context, mail: Mail) => {
    try {
      const started = now();
      await mailer.send(mail);
      sendMs = sendMs * 0.8 + Math.min(SEND_PAUSE.maxMs, Math.max(0, now() - started)) * 0.2;
      store.countMail(utcDay(now()));
      return null;
    } catch (error) {
      if (error instanceof MailLimitError) return usedUpAnswer(context);
      return context.json({ error: "The email could not be sent. Try again later.", reason: "mail-failed" }, 502);
    }
  };

  // Every account call: the general limit per client, and JSON only for a body,
  // which a web page on another site cannot send without a preflight this
  // service refuses. A body is small: an address, a code and a language.
  app.use("*", async (context, next) => {
    const wait = limiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    if ((context.req.method === "POST" || context.req.method === "PUT") && !(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return context.json({ error: "Send JSON.", reason: "bad-request" }, 415);
    }
    await next();
  });
  const small = bodyLimit({ maxSize: 2000, onError: (context) => context.json({ error: "Too big.", reason: "bad-request" }, 413) });
  const profileSize = bodyLimit({ maxSize: PROFILE_BODY, onError: (context) => context.json({ error: "Too big.", reason: "bad-request" }, 413) });
  // A body is small (an address, a code and a language), except a profile with its picture.
  app.use("*", (context, next) => (context.req.path.endsWith("/profile") ? profileSize(context, next) : small(context, next)));

  const body = async (context: Context): Promise<Record<string, unknown>> => {
    try {
      const parsed: unknown = JSON.parse(await context.req.text());
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  // ── Signed out: a code, then sign in or create ───────────────────────

  app.post("/code", async (context) => {
    const client = clientKey(context.req.raw);
    const wait = codeLimiter.check(client);
    if (wait > 0) return tooMany(context, wait);
    // A day's share per client and per network, so no one requester spends the day's emails.
    const dayWait = Math.max(codeDayLimiter.check(client), codeNetworkLimiter.check(networkOf(client)));
    if (dayWait > 0) return tooMany(context, dayWait);
    const input = await body(context);
    const email = normalizeEmail(input.email);
    if (!email) return context.json({ error: "Send { email, language }.", reason: "bad-email" }, 400);
    if (usedUp("sign-in")) return usedUpAnswer(context);
    const at = now();
    const account = store.accountByEmail(email);
    const asker = stranger(context);
    // Once new addresses' share is used up, the rest of the sign-in emails is kept for accounts made before today, and
    // one address draws at most 3 codes from it, so accounts made for it can't spend it either. The 3 are counted apart
    // for the networks the address signed in from and for everyone else, and only for a request the address's limits let
    // through for that asker, so strangers can't use up the owner's.
    const quiet = usedUp("new");
    if (quiet) newAddressesFull();
    const mails =
      !quiet ||
      (account !== null &&
        Date.parse(account.createdAt) < dayStart(at) &&
        store.codeWait(email, at, asker) === 0 &&
        accountShareLimiter.check(addressLimitKey(email, store.codeGroup(email, at, asker)), at) === 0);
    if (!mails) {
      // Answered the same as a code that went out, after about as long, and counted against the same limits, so neither
      // the answer nor its time tells which addresses have an account; no mail goes out.
      const refused = store.countCodeRequest(email, at, asker);
      if (refused > 0) return tooMany(context, refused);
      await likeASend();
      return context.json({ status: "sent" }, 202);
    }
    const request = store.requestCode(email, "sign-in", null, at, asker);
    if (!request.ok) return tooMany(context, request.retryAfter);
    // The mail differs for a new address, but only its owner reads it; the answer is the same.
    const failed = await send(context, codeMail(account ? "sign-in" : "create", email, request.code, mailLanguage(input.language)));
    // While some addresses get no mail, a failed one is answered like those.
    return failed && !quiet ? failed : context.json({ status: "sent" }, 202);
  });

  app.post("/verify", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const email = normalizeEmail(input.email);
    if (!email || typeof input.code !== "string" || !CODE.test(input.code)) {
      return context.json({ error: "Send { email, code, os, create }.", reason: "bad-request" }, 400);
    }
    const at = now();
    const existing = store.accountByEmail(email);
    const create = input.create === true;
    // A new address keeps its code until the user said yes to an account and there is room for it today.
    if (!store.checkCode(email, "sign-in", null, input.code, at, Boolean(existing))) return wrongCode(context);
    if (!existing && !create) return context.json({ status: "no-account" });
    // Said only after the code was right, so the answer never tells whether an address has an account.
    if (existing && store.isSuspended(existing.id)) return suspended(context);
    let account = existing;
    if (!account) {
      const full = accountsFull(context) ?? networkAccountsFull(context);
      if (full) return full;
      // Right a moment ago, so this spends it.
      if (!store.checkCode(email, "sign-in", null, input.code, at, true)) return wrongCode(context);
      try {
        account = store.createAccount({ email }, at);
      } catch {
        // Created a moment ago by another sign-in with the same address.
        account = store.accountByEmail(email);
        if (!account) throw new Error("account could not be created");
      }
    }
    // From here on this network counts as the owner's for the address's code limits (account-store.ts CODES_PER_WINDOW).
    store.rememberNetwork(email, networkOf(clientKey(context.req.raw)), at);
    const { token, session } = store.createSession(account.id, deviceOs(input.os), at, deviceName(input.name));
    return context.json({ status: existing ? "signed-in" : "created", token, device: session.id, account: accountAnswer(account) });
  });

  // ── A suspended account can still be deleted (decided 2026-10-26) ─────
  // Suspending keeps the person out of everything but this: they prove the account is theirs with a code to its address
  // (or a fresh Discord sign-in) and it is deleted, without ever getting a sign-in. Any other address, and any account
  // that is not suspended, gets the same answers, so nothing here tells whether an address has an account or is suspended.

  app.post("/delete/suspended/code", async (context) => {
    const wait = codeLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const email = normalizeEmail(input.email);
    if (!email) return context.json({ error: "Send { email, language }.", reason: "bad-email" }, 400);
    // The same day's shares as sign-in codes, for every address alike.
    const dayWait = dayShares(context);
    if (dayWait > 0) return tooMany(context, dayWait);
    if (usedUp("important")) return usedUpAnswer(context);
    const account = store.accountByEmail(email);
    // Once sign-in codes ran out, a suspended account's code comes out of the reserved emails like an owner's delete code
    // (drawReserve); when it may not, it is answered like any other address, so this doesn't tell that one is suspended.
    if (!account || !store.isSuspended(account.id) || (usedUp("sign-in") && !drawReserve(context, account))) {
      // As long as a send would take, so the time doesn't tell either.
      await likeASend();
      return context.json({ status: "sent" }, 202);
    }
    const request = store.requestCode(email, "delete", account.id, now(), stranger(context));
    if (!request.ok) return tooMany(context, request.retryAfter);
    return (await send(context, codeMail("delete", email, request.code, mailLanguage(input.language)))) ?? context.json({ status: "sent" }, 202);
  });

  app.post("/delete/suspended", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const email = normalizeEmail(input.email);
    if (!email || typeof input.code !== "string" || !CODE.test(input.code)) return context.json({ error: "Send { email, code }.", reason: "bad-request" }, 400);
    const account = store.accountByEmail(email);
    if (!account || !store.isSuspended(account.id) || !store.checkCode(email, "delete", account.id, input.code, now(), true)) return wrongCode(context);
    deleteAccount(account.id);
    return context.body(null, 204);
  });

  // ── Signed in ─────────────────────────────────────────────────────────

  const signedIn = new Hono<Env>();
  signedIn.use("*", requireSignIn(store, now));

  signedIn.get("/", (context) => {
    const account = context.get("account");
    const current = context.get("session").id;
    return context.json({ account: accountAnswer(account), devices: store.devices(account.id).map((device) => ({ ...device, current: device.id === current })) });
  });

  signedIn.post("/sign-out", (context) => {
    store.deleteSession(context.get("account").id, context.get("session").id);
    return context.body(null, 204);
  });

  signedIn.put("/devices/:id/name", async (context) => {
    const name = deviceName((await body(context)).name);
    if (!name) return context.json({ error: "Send { name }.", reason: "bad-request" }, 400);
    if (!store.renameSession(context.get("account").id, context.req.param("id") ?? "", name)) return context.json({ error: "Not found.", reason: "not-found" }, 404);
    return context.body(null, 204);
  });

  signedIn.delete("/devices/:id", (context) => {
    if (!store.deleteSession(context.get("account").id, context.req.param("id") ?? "")) return context.json({ error: "Not found.", reason: "not-found" }, 404);
    return context.body(null, 204);
  });

  // The profile: private to the account's owner. The newest change wins, so
  // two PCs that changed it while offline end with the later one.
  signedIn.get("/profile", (context) => context.json({ profile: profileAnswer(store.profile(context.get("account").id)) }));

  signedIn.put("/profile", async (context) => {
    const profile = parseProfile(await body(context), now());
    if (!profile) return context.json({ error: "Send { name, initials, picture, updatedAt }.", reason: "bad-request" }, 400);
    return context.json({ profile: profileAnswer(store.setProfile(context.get("account").id, profile)) });
  });

  // The developer side: a public name for modules, and the publisher keys linked to it. Only the
  // public half of a key ever reaches the service (publishers.ts links it with a code from here).
  const developerAnswer = (accountId: string) => {
    const developer = store.developer(accountId);
    return {
      developer: developer ? { name: developer.name, changedAt: new Date(developer.changedAt).toISOString(), nextChangeAt: new Date(developer.changedAt + NAME_HOLD_MS).toISOString() } : null,
      keys: store.keys(accountId),
      requests: store.keyRequests(accountId).map((request) => ({
        old: request.old,
        new: request.new,
        leaked: request.leaked,
        requestedAt: new Date(request.requestedAt).toISOString(),
        status: keyRequestStatus(request, options.trust ?? null),
      })),
      publishTokens: store.publishTokens(accountId, now()).map((token) => ({
        id: token.id,
        name: token.name,
        createdAt: new Date(token.createdAt).toISOString(),
        expiresAt: new Date(token.expiresAt).toISOString(),
        lastUsedAt: token.lastUsedAt === null ? null : new Date(token.lastUsedAt).toISOString(),
      })),
    };
  };
  /** Whether a key is in a replacement that still waits to be signed. */
  const inOpenRequest = (accountId: string, fingerprint: string) =>
    store.keyRequests(accountId).some((request) => (request.old === fingerprint || request.new === fingerprint) && keyRequestStatus(request, options.trust ?? null) === "waiting");

  signedIn.get("/developer", (context) => context.json(developerAnswer(context.get("account").id)));

  signedIn.put("/developer", async (context) => {
    const name = cleanDeveloperName((await body(context)).name);
    if (!name) return context.json({ error: "A name is 3 to 32 letters, digits, spaces, dots, dashes or underscores.", reason: "bad-name" }, 400);
    const account = context.get("account");
    const result = store.setDeveloperName(account.id, name, now());
    if (!result.ok) {
      const messages = { "name-taken": "That name is taken.", "name-reserved": "That name cannot be used.", "name-too-soon": "The name can change once in 30 days." } as const;
      return context.json({ error: messages[result.reason], reason: result.reason, ...(result.nextChangeAt ? { nextChangeAt: new Date(result.nextChangeAt).toISOString() } : {}) }, 409);
    }
    return context.json(developerAnswer(account.id));
  });

  // A one-time code the developer types into `tavora-pack link`, which signs it with the key.
  signedIn.post("/keys/code", (context) => {
    const account = context.get("account");
    if (!store.developer(account.id)) return context.json({ error: "Choose a developer name first.", reason: "no-developer-name" }, 409);
    const { code, expiresAt } = store.linkCode(account.id, now());
    return context.json({ code, expiresAt: new Date(expiresAt).toISOString() });
  });

  // Module id prefixes: checked and claimed before the first publish, so the app can show whether an id
  // is free and CI can publish a first version under a claimed one. Publishing still reserves a free one.
  signedIn.get("/prefixes", (context) => {
    const held = store.heldPrefixes(context.get("account").id);
    return context.json({
      prefixes: held.map(({ prefix, reservedAt }) => ({ prefix, claimedAt: reservedAt, published: options.catalog?.hasModuleUnder(prefix) ?? false })),
      max: MAX_PREFIXES,
    });
  });

  /** What a prefix is to this account: held, free, taken, reserved, too-many or invalid. */
  const prefixState = (accountId: string, prefix: string) => (PREFIX.test(prefix) ? store.prefixCheck(accountId, prefix, options.catalog) : "invalid");

  signedIn.get("/prefixes/:prefix", (context) => {
    const prefix = context.req.param("prefix") ?? "";
    return context.json({ prefix, state: prefixState(context.get("account").id, prefix) });
  });

  signedIn.post("/prefixes/:prefix", (context) => {
    const wait = prefixLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const account = context.get("account");
    const prefix = context.req.param("prefix") ?? "";
    const state = prefixState(account.id, prefix);
    if (state === "invalid") return context.json({ error: "A prefix is lowercase letters and digits, starting with a letter.", reason: "invalid" }, 400);
    if (state === "taken") return context.json({ error: `The id prefix "${prefix}" belongs to another developer.`, reason: "prefix-taken" }, 403);
    if (state === "reserved") return context.json({ error: `The id prefix "${prefix}" is reserved.`, reason: "prefix-reserved" }, 403);
    if (state === "too-many") return context.json({ error: `Your account holds ${MAX_PREFIXES} id prefixes, as many as it can.`, reason: "too-many-prefixes" }, 403);
    if (state === "free") store.reservePrefix(account.id, prefix, now());
    return context.json({ prefix, state: "held" });
  });

  // "I lost this key" (or "it was leaked"): asks to move what the old key owns to another key of the
  // account. Tavora's maintainer signs it offline (key-requests.ts); the account's address hears of it.
  signedIn.post("/keys/:fingerprint/replace", async (context) => {
    const account = context.get("account");
    const old = context.req.param("fingerprint") ?? "";
    const input = await body(context);
    if (!/^[0-9a-f]{32}$/.test(old) || typeof input.new !== "string" || !/^[0-9a-f]{32}$/.test(input.new) || typeof input.leaked !== "boolean") {
      return context.json({ error: "Send { new, leaked, language }.", reason: "bad-request" }, 400);
    }
    const before = store.keyRequest(old);
    const result = store.requestReplacement(account.id, old, input.new, input.leaked, now(), options.officialPins ?? OFFICIAL_PINS, options.trust?.signed("successions")?.successions ?? []);
    if (result === "same") return context.json({ error: "Pick another key to replace it with.", reason: "bad-request" }, 400);
    if (result === "not-linked") return context.json({ error: "Both keys must be linked to this account.", reason: "not-found" }, 404);
    if (result === "pinned") return context.json({ error: "Both keys must be linked to this account.", reason: "not-found" }, 404);
    if (result === "open") return context.json({ error: "This key already waits to be replaced.", reason: "key-in-request" }, 409);
    const after = store.keyRequest(old);
    const isNew = !before || before.declinedAt !== null || before.leaked !== after?.leaked;
    // Best effort: the request stands even when the day's emails, or the account's own share of them, are used up. Only
    // the account's share counts, not its client's or network's, so nobody stops the notice by spending those first.
    if (isNew && account.email && !usedUp("sign-in") && ownerMailLimiter.check(account.id) === 0) {
      await send(context, keyRequestMail(account.email, old, input.leaked, mailLanguage(input.language)));
    }
    return context.json(developerAnswer(account.id));
  });

  // A token for publishing from CI, shown this once; the service keeps only its hash.
  signedIn.post("/publish-tokens", async (context) => {
    const account = context.get("account");
    const raw = (await body(context)).name;
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) return context.json({ error: "A token's name is 1 to 40 characters.", reason: "bad-name" }, 400);
    if (!store.developer(account.id)) return context.json({ error: "Choose a developer name first.", reason: "no-developer-name" }, 409);
    const created = store.createPublishToken(account.id, name, now());
    if (!created) return context.json({ error: "This account has as many publish tokens as it can. Remove one first.", reason: "too-many-tokens" }, 409);
    return context.json({ token: created.token, ...developerAnswer(account.id) }, 201);
  });

  signedIn.delete("/publish-tokens/:id", (context) => {
    if (!store.deletePublishToken(context.get("account").id, context.req.param("id") ?? "")) return context.json({ error: "Not found.", reason: "not-found" }, 404);
    return context.json(developerAnswer(context.get("account").id));
  });

  signedIn.delete("/keys/:fingerprint", (context) => {
    if (inOpenRequest(context.get("account").id, context.req.param("fingerprint") ?? "")) {
      return context.json({ error: "This key waits to be replaced.", reason: "key-in-request" }, 409);
    }
    if (!store.unlinkKey(context.get("account").id, context.req.param("fingerprint") ?? "")) return context.json({ error: "Not found.", reason: "not-found" }, 404);
    return context.json(developerAnswer(context.get("account").id));
  });

  // Change the address (decided 2026-11-13): a code to the new address, and proof of the current one, a code sent
  // there or, for a Discord-only account, a fresh Discord sign-in, so a stolen sign-in alone cannot move the account
  // to another mailbox. Whether the new address already has an account is only said once the codes were right. On
  // the change every other sign-in ends and the codes still waiting for the old address go (account-store.ts).
  // A Tavora from before this sends no `confirmCurrent` and is told to update, in words it shows as they are.
  signedIn.post("/email/code", async (context) => {
    const client = clientKey(context.req.raw);
    const wait = codeLimiter.check(client);
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const email = normalizeEmail(input.email);
    const account = context.get("account");
    const language = mailLanguage(input.language);
    if (!email) return context.json({ error: "Send { email, confirmCurrent, language }.", reason: "bad-email" }, 400);
    if (input.confirmCurrent !== true) return updateToChange(context, language);
    if (email === account.email) return context.json({ error: "That is the address the account has.", reason: "same-email" }, 400);
    // A Discord-only account proves itself with Discord at the end: the code would be no use without it.
    if (!account.email && !options.discord) return discordUnavailable(context);
    // A code to another address each time would dodge every address's own limit, and Discord-only accounts cost no
    // mail to make: the same day's shares as sign-in codes (per client and network), and 3 changes a day per account.
    const dayWait = Math.max(codeDayLimiter.check(client), codeNetworkLimiter.check(networkOf(client)), changeEmailLimiter.check(account.id));
    if (dayWait > 0) return tooMany(context, dayWait);
    // The new address has no account (that is only said once the codes were right), so its code comes out of new
    // addresses' share of the day's emails, never out of what is kept for accounts' sign-ins, confirmations and deletes.
    if (usedUp("new", account.email ? 2 : 1)) return usedUpAnswer(context);
    // Both addresses or neither: the limits are checked before either code is made. The new address isn't the
    // account's yet, so its codes count as a stranger's; the current one's are the owner's own.
    const at = now();
    const waitFor = Math.max(store.codeWait(email, at, stranger(context)), account.email ? store.codeWait(account.email, at, OWNER) : 0);
    if (waitFor > 0) return tooMany(context, waitFor);
    if (account.email) {
      // The current address's code holds only for this new address.
      const current = store.requestCode(account.email, "confirm-email-change", account.id, at, OWNER, email);
      if (!current.ok) return tooMany(context, current.retryAfter);
      const failed = await send(context, confirmEmailChangeMail(account.email, email, current.code, language));
      if (failed) return failed;
    }
    const request = store.requestCode(email, "change-email", account.id, at, stranger(context));
    if (!request.ok) return tooMany(context, request.retryAfter);
    return (await send(context, codeMail("change-email", email, request.code, language))) ?? context.json({ status: "sent", current: account.email ? "email" : "discord" }, 202);
  });

  signedIn.post("/email", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const email = normalizeEmail(input.email);
    const account = context.get("account");
    const language = mailLanguage(input.language);
    if (!email || typeof input.code !== "string" || !CODE.test(input.code)) {
      return context.json({ error: "Send { email, code, currentCode | discord, language }.", reason: "bad-request" }, 400);
    }
    const discordProof = typeof input.discord === "object" && input.discord !== null && !Array.isArray(input.discord) ? (input.discord as Record<string, unknown>) : null;
    // The proof of the current address: its code, or a fresh Discord sign-in when there is none.
    if (account.email ? input.currentCode === undefined : discordProof === null) return updateToChange(context, language);
    if (account.email && (typeof input.currentCode !== "string" || !CODE.test(input.currentCode))) {
      return context.json({ error: "Send { email, code, currentCode, language }.", reason: "bad-request" }, 400);
    }
    // Every code is checked before any is spent (a wrong one counts as a try), and spent only once all proof holds.
    if (!store.checkCode(email, "change-email", account.id, input.code, now(), false)) return wrongCode(context);
    if (account.email) {
      if (!store.checkCode(account.email, "confirm-email-change", account.id, input.currentCode as string, now(), false, email)) return wrongCurrentCode(context);
    } else {
      const who = await identify(context, discordProof!);
      if (who instanceof Response) return who;
      if (!account.discord || account.discord.id !== who.id) return context.json({ error: "That is not the Discord login of this account.", reason: "discord-mismatch" }, 400);
    }
    if (!store.checkCode(email, "change-email", account.id, input.code, now(), true)) return wrongCode(context);
    if (account.email && !store.checkCode(account.email, "confirm-email-change", account.id, input.currentCode as string, now(), true, email)) return wrongCurrentCode(context);
    if (store.changeEmail(account.id, email, context.get("session").id) === "taken") {
      return context.json({ error: "That address already has a Tavora account.", reason: "email-taken" }, 409);
    }
    // The old address hears about it as well.
    if (account.email) await send(context, emailChangedMail(account.email, email, language));
    // The new address just proved itself from this network.
    store.rememberNetwork(email, networkOf(clientKey(context.req.raw)), now());
    return context.json({ account: accountAnswer({ ...account, email }) });
  });

  // Remove the email address: only while a Discord login remains, so the account can still be reached,
  // and only with a fresh code to that address, so a stolen sign-in cannot cut the owner out.
  signedIn.post("/email/remove/code", async (context) => {
    const wait = codeLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const account = context.get("account");
    if (!account.email) return context.json({ error: "This account has no email address.", reason: "no-email" }, 409);
    if (!account.discord) return lastMethod(context);
    const shareWait = ownerShare(context, account.id);
    if (shareWait > 0) return tooMany(context, shareWait);
    if (ownerMailFull(context, account, "other")) return usedUpAnswer(context);
    const request = store.requestCode(account.email, "remove-email", account.id, now(), OWNER);
    if (!request.ok) return tooMany(context, request.retryAfter);
    return (await send(context, codeMail("remove-email", account.email, request.code, mailLanguage(input.language)))) ?? context.json({ status: "sent" }, 202);
  });

  signedIn.post("/email/remove", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const account = context.get("account");
    if (typeof input.code !== "string" || !CODE.test(input.code)) return context.json({ error: "Send { code }.", reason: "bad-request" }, 400);
    if (!account.email) return context.json({ error: "This account has no email address.", reason: "no-email" }, 409);
    if (!store.checkCode(account.email, "remove-email", account.id, input.code, now(), true)) return wrongCode(context);
    if (store.removeEmail(account.id) === "last-method") return lastMethod(context);
    return context.json({ account: accountAnswer({ ...account, email: null }) });
  });

  // Delete the account: a fresh code to its address, then everything on the server goes at once.
  signedIn.post("/delete/code", async (context) => {
    const wait = codeLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const account = context.get("account");
    // A Discord-only account confirms with a fresh Discord sign-in instead (/delete/discord).
    if (!account.email) return context.json({ error: "This account has no email address; confirm with Discord.", reason: "no-email" }, 409);
    const shareWait = ownerShare(context, account.id);
    if (shareWait > 0) return tooMany(context, shareWait);
    if (ownerMailFull(context, account, "delete")) return usedUpAnswer(context);
    const request = store.requestCode(account.email, "delete", account.id, now(), OWNER);
    if (!request.ok) return tooMany(context, request.retryAfter);
    return (await send(context, codeMail("delete", account.email, request.code, mailLanguage(input.language)))) ?? context.json({ status: "sent" }, 202);
  });

  signedIn.post("/delete", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const account = context.get("account");
    if (typeof input.code !== "string" || !CODE.test(input.code)) return context.json({ error: "Send { code }.", reason: "bad-request" }, 400);
    if (!account.email || !store.checkCode(account.email, "delete", account.id, input.code, now(), true)) return wrongCode(context);
    deleteAccount(account.id);
    return context.body(null, 204);
  });

  // ── Discord login ─────────────────────────────────────────────────────
  // The app sends the code Discord handed back and the PKCE verifier only it
  // knew; the service asks Discord who this is and keeps the user id and
  // username, never the token. Nothing is ever linked by email address.

  /** Who the user is on Discord, or an answer to send instead. */
  const identify = async (context: Context, input: Record<string, unknown>): Promise<DiscordIdentity | Response> => {
    if (!options.discord) return discordUnavailable(context);
    if (!isDiscordCode(input.code) || !isPkceVerifier(input.verifier)) return context.json({ error: "Send { code, verifier }.", reason: "bad-request" }, 400);
    try {
      return await options.discord.identify(input.code, input.verifier);
    } catch (error) {
      if (error instanceof DiscordError) return context.json({ error: error.message, reason: error.reason }, error.reason === "discord-refused" ? 400 : 502);
      throw error;
    }
  };

  // Signed out: a known Discord login signs in (its username is refreshed); an
  // unknown one is held for 10 minutes while the app asks "Create a Tavora account?".
  app.post("/discord/sign-in", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const who = await identify(context, input);
    if (who instanceof Response) return who;
    const at = now();
    const existing = store.accountByDiscord(who.id);
    if (!existing) return context.json({ status: "no-account", ticket: store.holdDiscord(who, at), discord: { name: who.name } });
    if (store.isSuspended(existing.id)) return suspended(context);
    store.setDiscord(existing.id, who);
    const { token, session } = store.createSession(existing.id, deviceOs(input.os), at, deviceName(input.name));
    return context.json({ status: "signed-in", token, device: session.id, account: accountAnswer({ ...existing, discord: who }) });
  });

  app.post("/discord/create", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    if (typeof input.ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.ticket)) return context.json({ error: "Send { ticket, os }.", reason: "bad-request" }, 400);
    // The day's total first, then the ticket, and this network's share only for a ticket that holds and a login that
    // has no account yet; the ticket is spent only once all of that passed, so the user can try again with it.
    const full = accountsFull(context);
    if (full) return full;
    const at = now();
    const held = store.peekDiscord(input.ticket, at);
    if (!held) return context.json({ error: "That Discord sign-in has expired. Sign in with Discord again.", reason: "discord-expired" }, 400);
    // Made a moment ago by another sign-in with the same Discord login: sign in to that one.
    const existing = store.accountByDiscord(held.id);
    if (!existing) {
      const share = networkAccountsFull(context);
      if (share) return share;
    }
    const who = store.takeDiscord(input.ticket, at) ?? held;
    const account = existing ?? store.createAccount({ discord: who }, at);
    if (store.isSuspended(account.id)) return suspended(context);
    const { token, session } = store.createSession(account.id, deviceOs(input.os), at, deviceName(input.name));
    return context.json({ status: "created", token, device: session.id, account: accountAnswer(account) });
  });

  // Signed in: connect Discord. Only an account with an email has none (a Discord-only account already has
  // one), and connecting needs a code sent to that address as well as a fresh Discord sign-in, so a stolen
  // sign-in cannot add a way in that it controls. Never takes a login from another account or replaces the
  // account's own.
  signedIn.post("/discord/code", async (context) => {
    const wait = codeLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const account = context.get("account");
    if (account.discord) return discordConnected(context);
    if (!account.email) return noEmail(context);
    const shareWait = ownerShare(context, account.id);
    if (shareWait > 0) return tooMany(context, shareWait);
    if (ownerMailFull(context, account, "other")) return usedUpAnswer(context);
    const request = store.requestCode(account.email, "connect-discord", account.id, now(), OWNER);
    if (!request.ok) return tooMany(context, request.retryAfter);
    return (await send(context, codeMail("connect-discord", account.email, request.code, mailLanguage(input.language)))) ?? context.json({ status: "sent" }, 202);
  });

  signedIn.post("/discord", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const account = context.get("account");
    if (account.discord) return discordConnected(context);
    if (!account.email) return noEmail(context);
    if (typeof input.emailCode !== "string" || !CODE.test(input.emailCode)) {
      return context.json({ error: "Send { code, verifier, emailCode }.", reason: "bad-request" }, 400);
    }
    // The email code is checked first (a wrong one counts as a try) and spent only once Discord said who this is.
    if (!store.checkCode(account.email, "connect-discord", account.id, input.emailCode, now(), false)) return wrongCode(context);
    const who = await identify(context, input);
    if (who instanceof Response) return who;
    if (!store.checkCode(account.email, "connect-discord", account.id, input.emailCode, now(), true)) return wrongCode(context);
    if (store.setDiscord(account.id, who) === "taken") {
      return context.json({ error: "That Discord login belongs to another Tavora account.", reason: "discord-taken" }, 409);
    }
    return context.json({ account: accountAnswer({ ...account, discord: who }) });
  });

  // Disconnect Discord: only while an email address remains, and only with a code sent to it. The owner can
  // always remove a Discord login this way, also one they lost or one someone else connected; a stolen
  // sign-in cannot, without the mailbox.
  signedIn.post("/discord/remove/code", async (context) => {
    const wait = codeLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const account = context.get("account");
    if (!account.discord) return noDiscord(context);
    if (!account.email) return lastMethod(context);
    const shareWait = ownerShare(context, account.id);
    if (shareWait > 0) return tooMany(context, shareWait);
    if (ownerMailFull(context, account, "other")) return usedUpAnswer(context);
    const request = store.requestCode(account.email, "remove-discord", account.id, now(), OWNER);
    if (!request.ok) return tooMany(context, request.retryAfter);
    return (await send(context, codeMail("remove-discord", account.email, request.code, mailLanguage(input.language)))) ?? context.json({ status: "sent" }, 202);
  });

  signedIn.post("/discord/remove", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const account = context.get("account");
    if (typeof input.code !== "string" || !CODE.test(input.code)) return context.json({ error: "Send { code }.", reason: "bad-request" }, 400);
    if (!account.discord) return noDiscord(context);
    if (!account.email) return lastMethod(context);
    if (!store.checkCode(account.email, "remove-discord", account.id, input.code, now(), true)) return wrongCode(context);
    if (store.removeDiscord(account.id) === "last-method") return lastMethod(context);
    return context.json({ account: accountAnswer({ ...account, discord: null }) });
  });

  // Delete the account by a fresh Discord sign-in with the login it has.
  signedIn.post("/delete/discord", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const who = await identify(context, await body(context));
    if (who instanceof Response) return who;
    const account = context.get("account");
    if (!account.discord || account.discord.id !== who.id) {
      return context.json({ error: "That is not the Discord login of this account.", reason: "discord-mismatch" }, 400);
    }
    deleteAccount(account.id);
    return context.body(null, 204);
  });

  // The same for a Discord-only (or Discord) login: a fresh Discord sign-in proves it, and only a suspended account is deleted this way.
  app.post("/delete/suspended/discord", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const who = await identify(context, await body(context));
    if (who instanceof Response) return who;
    const account = store.accountByDiscord(who.id);
    if (!account || !store.isSuspended(account.id)) return context.json({ error: "That is not the Discord login of a suspended account.", reason: "discord-mismatch" }, 400);
    deleteAccount(account.id);
    return context.body(null, 204);
  });

  app.route("/", signedIn);
  return app;
}
