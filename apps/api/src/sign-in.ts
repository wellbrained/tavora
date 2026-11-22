import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Account, AccountStore, Session } from "./account-store.ts";

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

/**
 * Reads the whole body, at most `max` bytes, and puts a request with those bytes in place of the one that streams in (as
 * Hono's bodyLimit does), so the route reads it as usual. False when it is bigger, or broke off.
 */
async function readBody(context: Context, max: number): Promise<boolean> {
  const raw = context.req.raw;
  if (raw.body === null) return true;
  const declared = Number(raw.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > max) return false;
  const reader = raw.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        return false;
      }
      chunks.push(value);
    }
  } catch {
    return false;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  context.req.raw = new Request(raw.url, { method: raw.method, headers: raw.headers, body: bytes });
  return true;
}

/**
 * Only signed in: 401 otherwise. Answers are the account's own, so nothing caches them.
 *
 * The sign-in is checked, then the body read, at most `maxBody` bytes (413 past it), then the sign-in checked again (audit
 * 2026-11-22): a body sent slowly can't hold a sign-in that was ended meanwhile (the email changed, the device was
 * removed) past that point, and a request without one is refused before anything is read. What a route writes after its own awaits checks again with stillSignedIn().
 */
export function requireSignIn(store: SignInStore, now: () => number = Date.now, maxBody = SIGNED_IN_BODY): MiddlewareHandler<SignedInEnv> {
  return async (context, next) => {
    // Checked before the body too, so a request without a working sign-in is answered at once, nothing read or held.
    if (!signedInAs(store, context, now())) return signedOut(context);
    if (!(await readBody(context, maxBody))) return fail(context, 413, "too-big", "Too big.");
    const signedIn = signedInAs(store, context, now());
    if (!signedIn) return signedOut(context);
    context.set("session", signedIn.session);
    context.set("account", signedIn.account);
    context.header("Cache-Control", "no-store");
    await next();
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
