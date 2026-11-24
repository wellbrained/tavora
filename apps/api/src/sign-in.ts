import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Account, AccountStore, Session } from "./account-store.ts";
import { readUpload, type MemoryTicket, type ReadLimits, type UploadMemory } from "./upload-memory.ts";

/**
 * The one sign-in gate of the API, and the one shape of its refusals: `{ error, reason }`, where `reason`
 * is a short kebab code the apps map to their own texts (so it never changes) and `error` is English for
 * people. A suspended account is signed out here, as sessionByToken refuses it; a ban is not a sign-in
 * block, it stops publishing and acting as a publisher where those happen.
 */

const BEARER = /^Bearer ([A-Za-z0-9_-]{20,100})$/;

/** What the gate needs from the accounts. */
export type SignInStore = Pick<AccountStore, "sessionByToken" | "account" | "sessionAlive">;

export interface SignedIn {
  session: Session;
  account: Account;
}

/** Routes behind requireSignIn. */
export type SignedInEnv = { Variables: SignedIn };
/** Routes behind optionalSignIn: a guest has neither. */
export type MaybeSignedInEnv = { Variables: { session: Session | null; account: Account | null } };

/** An API refusal. */
export function fail(context: Context, status: ContentfulStatusCode, reason: string, error: string): Response {
  return context.json({ error, reason }, status);
}

/** Too many requests from this client; `wait` is in seconds. */
export function tooMany(context: Context, wait: number, error = "Too many requests. Try again later."): Response {
  context.header("Retry-After", String(wait));
  return fail(context, 429, "too-many", error);
}

/** A body past the route's limit. */
function tooBig(context: Context): Response {
  return fail(context, 413, "too-big", "Too big.");
}

/** No sign-in, or one that no longer works. */
export function signedOut(context: Context): Response {
  return fail(context, 401, "signed-out", "Sign in again.");
}

/** A banned developer tries to act as a module's publisher (reply to reviews, change the contact link). */
export function banned(context: Context): Response {
  return fail(context, 403, "banned", "This account can't act as a developer any more. Check your email for why.");
}

/** The token after `Bearer` in the Authorization header, or null. */
export function bearerToken(context: Context): string | null {
  return BEARER.exec(context.req.header("authorization") ?? "")?.[1] ?? null;
}

/** Who sent this request: null without a token, or with one that is unknown, expired or of a suspended account. */
export function signedInAs(store: SignInStore, context: Context, now: number): SignedIn | null {
  const token = bearerToken(context);
  const session = token ? store.sessionByToken(token, now) : null;
  const account = session ? store.account(session.accountId) : null;
  return session && account ? { session, account } : null;
}

/** The most requireSignIn reads of a body by default: every signed-in route but the big ones sends less. */
export const SIGNED_IN_BODY = 64 * 1024;

/** The body's declared length (Content-Length), or null when it names none. */
function declaredLength(context: Context): number | null {
  const declared = Number(context.req.raw.headers.get("content-length") ?? "NaN");
  return Number.isSafeInteger(declared) && declared >= 0 ? declared : null;
}

/**
 * Reads the whole body, at most `max` bytes, and puts a request with those bytes in place of the one that streams in (as
 * Hono's bodyLimit does), so the route reads it as usual. Like an upload (readUpload, CoreHub #596) it gives up on a body
 * that stops coming for a while or falls far behind, so a trickle can't hold a request, or the memory booked for it, for long.
 */
async function readBody(context: Context, max: number, limits: ReadLimits): Promise<"ok" | "too-big" | "too-slow"> {
  const raw = context.req.raw;
  if (raw.body === null) return "ok";
  const declared = declaredLength(context);
  if (declared !== null && declared > max) return "too-big";
  // As much room as it said it needs, never more than allowed.
  const read = await readUpload(raw, declared ?? max, limits);
  if ("refused" in read) return read.refused;
  context.req.raw = new Request(raw.url, { method: raw.method, headers: raw.headers, body: new Uint8Array(read.bytes) });
  return "ok";
}

/**
 * Where routes with big bodies hold them (audit run 7): every body is counted in `memory` (the one the uploads share, so all
 * of them together stay under the service's limit) from before its first byte until the answer is out, at twice its size,
 * as it is held once while read and once more as the route reads it. And one account sends at most `perAccount` at once.
 */
export interface BodyHold {
  memory: UploadMemory;
  perAccount: number;
}

/** How long a client that found no room waits, in seconds. */
const BUSY_WAIT = 30;

/** No room for the body right now: the apps keep their data and try again later, as for any 503. */
function busy(context: Context): Response {
  context.header("Retry-After", String(BUSY_WAIT));
  return fail(context, 503, "unavailable", "Tavora is busy right now. Try again in a minute.");
}

/**
 * Only signed in: 401 otherwise. Answers are the account's own, so nothing caches them.
 *
 * The sign-in is checked, then the body read, at most `maxBody` bytes (413 past it), then the sign-in checked again (audit
 * 2026-11-22): a body sent slowly can't hold a sign-in that was ended meanwhile (the email changed, the device was
 * removed) past that point, and a request without one is refused before anything is read. What a route writes after its own awaits checks again with stillSignedIn().
 * With `hold`, the body waits for room first (see BodyHold), and a 503 says when there is none. A length past the limit
 * is refused before any room is booked. `readLimits`: how patient the read is (readUpload's, the catalog's by default).
 */
export function requireSignIn(store: SignInStore, now: () => number = Date.now, maxBody = SIGNED_IN_BODY, hold?: BodyHold, readLimits: ReadLimits = {}): MiddlewareHandler<SignedInEnv> {
  const sending = new Map<string, number>();
  return async (context, next) => {
    // Checked before the body too, so a request without a working sign-in is answered at once, nothing read or held.
    const before = signedInAs(store, context, now());
    if (!before) return signedOut(context);
    let ticket: MemoryTicket | null = null;
    let limit = maxBody;
    const accountId = before.account.id;
    const declared = context.req.raw.body === null ? null : declaredLength(context);
    // Too big by its own word: refused before anything is booked or read.
    if (declared !== null && declared > maxBody) return tooBig(context);
    if (hold && context.req.raw.body !== null) {
      // Without a length it may be as big as allowed.
      const size = declared ?? maxBody;
      if ((sending.get(accountId) ?? 0) >= hold.perAccount) return busy(context);
      ticket = hold.memory.take(2 * size);
      if (!ticket) return busy(context);
      // Never more than it holds room for.
      limit = size;
      sending.set(accountId, (sending.get(accountId) ?? 0) + 1);
    }
    try {
      const read = await readBody(context, limit, readLimits);
      if (read === "too-big") return tooBig(context);
      if (read === "too-slow") return fail(context, 408, "invalid", "That took too long. Check your connection and try again.");
      const signedIn = signedInAs(store, context, now());
      if (!signedIn) return signedOut(context);
      context.set("session", signedIn.session);
      context.set("account", signedIn.account);
      context.header("Cache-Control", "no-store");
      await next();
    } finally {
      if (ticket) {
        ticket.release();
        const left = (sending.get(accountId) ?? 1) - 1;
        if (left > 0) sending.set(accountId, left);
        else sending.delete(accountId);
      }
    }
  };
}

/**
 * Whether the request's sign-in still exists, checked right before a write, in the same synchronous step: after an await
 * (a body, a mail, another service) it may have ended meanwhile.
 */
export function stillSignedIn(store: Pick<AccountStore, "sessionAlive">, context: Context<SignedInEnv>): boolean {
  return store.sessionAlive(context.get("session").id);
}

/** Signed in or a guest: no Authorization header is a guest, a token that doesn't work is still a 401. */
export function optionalSignIn(store: SignInStore, now: () => number = Date.now): MiddlewareHandler<MaybeSignedInEnv> {
  return async (context, next) => {
    if (context.req.header("authorization") === undefined) {
      context.set("session", null);
      context.set("account", null);
    } else {
      const signedIn = signedInAs(store, context, now());
      if (!signedIn) return signedOut(context);
      context.set("session", signedIn.session);
      context.set("account", signedIn.account);
    }
    context.header("Cache-Control", "no-store");
    await next();
  };
}
