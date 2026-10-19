import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cleanDeveloperName, DEVICE_OS, NAME_HOLD_MS, normalizeEmail, type Account, type AccountStore, type DeviceOs, type Session, type StoredProfile } from "./account-store.ts";
import { DiscordError, isDiscordCode, isPkceVerifier, type DiscordClient, type DiscordIdentity } from "./discord.ts";
import { codeMail, emailChangedMail, MailLimitError, mailLanguage, type Mail, type Mailer } from "./mail.ts";
import { inspectPng } from "./png.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";

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
  /** Code checks per client: 20 in 15 minutes by default. */
  verifyRateLimiter?: RateLimiter;
  now?: () => number;
  /** The provider's emails a day (Brevo's free plan: 300). Unset: no limit (the test inbox). */
  mailDailyLimit?: number;
  /** Discord login. Absent: its routes answer 503 and email sign-in works as before. */
  discord?: DiscordClient;
}

/** Of the day's emails, the last ones are kept for changing the address and deleting the account. */
export const MAIL_RESERVED = 20;
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
const nextUtcDay = (at: number) => {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
};

type Env = { Variables: { session: Session; account: Account } };

const CODE = /^\d{6}$/;
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
const tooMany = (context: Context, wait: number) => {
  context.header("Retry-After", String(wait));
  return context.json({ error: "Too many requests.", reason: "too-many" }, 429);
};
/** What the owner sees of their account: never the Discord id, only its username as a label. */
const accountAnswer = (account: Account) => ({ email: account.email, discord: account.discord ? { name: account.discord.name } : null, createdAt: account.createdAt });
const lastMethod = (context: Context) => context.json({ error: "An account keeps at least one way to sign in.", reason: "last-method" }, 409);
const discordConnected = (context: Context) =>
  context.json({ error: "This account already has a Discord login; disconnect it first.", reason: "discord-connected" }, 409);
const noEmail = (context: Context) => context.json({ error: "This account has no email address.", reason: "no-email" }, 409);
const noDiscord = (context: Context) => context.json({ error: "This account has no Discord login.", reason: "no-discord" }, 409);
const wrongCode = (context: Context) => context.json({ error: "That code is wrong or has expired.", reason: "wrong-code" }, 400);

export function accountRoutes(options: AccountOptions, limiter: RateLimiter, clientKey: (request: Request) => string) {
  const { store, mailer } = options;
  const now = options.now ?? Date.now;
  const codeLimiter = options.codeRateLimiter ?? createRateLimiter({ limit: 10, windowMs: 3_600_000 });
  const verifyLimiter = options.verifyRateLimiter ?? createRateLimiter({ limit: 20, windowMs: 15 * 60_000 });
  const app = new Hono<Env>();

  /** The day's emails are used up (for sign-ins already when only the reserved ones are left). */
  const usedUp = (important: boolean) =>
    options.mailDailyLimit !== undefined && store.mailsSent(utcDay(now())) >= (important ? options.mailDailyLimit : Math.max(0, options.mailDailyLimit - MAIL_RESERVED));
  const usedUpAnswer = (context: Context) =>
    context.json({ error: "Today's emails are used up. Try again tomorrow.", reason: "daily-limit", retryAt: new Date(nextUtcDay(now())).toISOString() }, 503);

  const send = async (context: Context, mail: Mail) => {
    try {
      await mailer.send(mail);
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
    const wait = codeLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const email = normalizeEmail(input.email);
    if (!email) return context.json({ error: "Send { email, language }.", reason: "bad-email" }, 400);
    if (usedUp(false)) return usedUpAnswer(context);
    const request = store.requestCode(email, "sign-in", null, now());
    if (!request.ok) return tooMany(context, request.retryAfter);
    // The mail differs for a new address, but only its owner reads it; the answer is the same.
    const kind = store.accountByEmail(email) ? "sign-in" : "create";
    return (await send(context, codeMail(kind, email, request.code, mailLanguage(input.language)))) ?? context.json({ status: "sent" }, 202);
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
    // A new address keeps its code until the player said yes to an account.
    if (!store.checkCode(email, "sign-in", null, input.code, at, Boolean(existing) || create)) return wrongCode(context);
    if (!existing && !create) return context.json({ status: "no-account" });
    let account = existing;
    if (!account) {
      try {
        account = store.createAccount({ email }, at);
      } catch {
        // Created a moment ago by another sign-in with the same address.
        account = store.accountByEmail(email);
        if (!account) throw new Error("account could not be created");
      }
    }
    const { token, session } = store.createSession(account.id, deviceOs(input.os), at, deviceName(input.name));
    return context.json({ status: existing ? "signed-in" : "created", token, device: session.id, account: accountAnswer(account) });
  });

  // ── Signed in ─────────────────────────────────────────────────────────

  const signedIn = new Hono<Env>();
  signedIn.use("*", async (context, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(context.req.header("authorization") ?? "");
    const session = match ? store.sessionByToken(match[1]!, now()) : null;
    const account = session ? store.account(session.accountId) : null;
    if (!session || !account) return context.json({ error: "Sign in again.", reason: "signed-out" }, 401);
    context.set("session", session);
    context.set("account", account);
    await next();
  });

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
    };
  };

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

  signedIn.delete("/keys/:fingerprint", (context) => {
    if (!store.unlinkKey(context.get("account").id, context.req.param("fingerprint") ?? "")) return context.json({ error: "Not found.", reason: "not-found" }, 404);
    return context.json(developerAnswer(context.get("account").id));
  });

  // Change the address: a code to the new one. Whether it already has an account
  // is only said once its code was right.
  signedIn.post("/email/code", async (context) => {
    const wait = codeLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const email = normalizeEmail(input.email);
    const account = context.get("account");
    if (!email) return context.json({ error: "Send { email, language }.", reason: "bad-email" }, 400);
    if (email === account.email) return context.json({ error: "That is the address the account has.", reason: "same-email" }, 400);
    if (usedUp(true)) return usedUpAnswer(context);
    const request = store.requestCode(email, "change-email", account.id, now());
    if (!request.ok) return tooMany(context, request.retryAfter);
    return (await send(context, codeMail("change-email", email, request.code, mailLanguage(input.language)))) ?? context.json({ status: "sent" }, 202);
  });

  signedIn.post("/email", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    const email = normalizeEmail(input.email);
    const account = context.get("account");
    if (!email || typeof input.code !== "string" || !CODE.test(input.code)) {
      return context.json({ error: "Send { email, code, language }.", reason: "bad-request" }, 400);
    }
    if (!store.checkCode(email, "change-email", account.id, input.code, now(), true)) return wrongCode(context);
    if (store.changeEmail(account.id, email) === "taken") {
      return context.json({ error: "That address already has a Tavora account.", reason: "email-taken" }, 409);
    }
    // The old address hears about it, so a stolen sign-in cannot quietly take the account.
    if (account.email) await send(context, emailChangedMail(account.email, email, mailLanguage(input.language)));
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
    if (usedUp(true)) return usedUpAnswer(context);
    const request = store.requestCode(account.email, "remove-email", account.id, now());
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
    if (usedUp(true)) return usedUpAnswer(context);
    const request = store.requestCode(account.email, "delete", account.id, now());
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
    store.deleteAccount(account.id, now());
    return context.body(null, 204);
  });

  // ── Discord login ─────────────────────────────────────────────────────
  // The app sends the code Discord handed back and the PKCE verifier only it
  // knew; the service asks Discord who this is and keeps the user id and
  // username, never the token. Nothing is ever linked by email address.

  /** Who the player is on Discord, or an answer to send instead. */
  const identify = async (context: Context, input: Record<string, unknown>): Promise<DiscordIdentity | Response> => {
    if (!options.discord) return context.json({ error: "Discord sign-in is not available right now.", reason: "unavailable" }, 503);
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
    store.setDiscord(existing.id, who);
    const { token, session } = store.createSession(existing.id, deviceOs(input.os), at, deviceName(input.name));
    return context.json({ status: "signed-in", token, device: session.id, account: accountAnswer({ ...existing, discord: who }) });
  });

  app.post("/discord/create", async (context) => {
    const wait = verifyLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const input = await body(context);
    if (typeof input.ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.ticket)) return context.json({ error: "Send { ticket, os }.", reason: "bad-request" }, 400);
    const at = now();
    const who = store.takeDiscord(input.ticket, at);
    if (!who) return context.json({ error: "That Discord sign-in has expired. Sign in with Discord again.", reason: "discord-expired" }, 400);
    // Made a moment ago by another sign-in with the same Discord login: sign in to that one.
    const account = store.accountByDiscord(who.id) ?? store.createAccount({ discord: who }, at);
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
    if (usedUp(true)) return usedUpAnswer(context);
    const request = store.requestCode(account.email, "connect-discord", account.id, now());
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
    if (usedUp(true)) return usedUpAnswer(context);
    const request = store.requestCode(account.email, "remove-discord", account.id, now());
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
    store.deleteAccount(account.id, now());
    return context.body(null, 204);
  });

  app.route("/", signedIn);
  return app;
}
