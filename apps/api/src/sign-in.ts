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
export type SignInStore = Pick<AccountStore, "sessionByToken" | "account">;

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

/** Only signed in: 401 otherwise. Answers are the account's own, so nothing caches them. */
export function requireSignIn(store: SignInStore, now: () => number = Date.now): MiddlewareHandler<SignedInEnv> {
  return async (context, next) => {
    const signedIn = signedInAs(store, context, now());
    if (!signedIn) return signedOut(context);
    context.set("session", signedIn.session);
    context.set("account", signedIn.account);
    context.header("Cache-Control", "no-store");
    await next();
  };
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
