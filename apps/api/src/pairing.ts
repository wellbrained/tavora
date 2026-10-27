import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Account, AccountStore, Session } from "./account-store.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";

/**
 * Approving a new PC from an old one (decided 2026-10-20, "one recovery key", step 4). The new PC asks; a
 * PC of the account that has the recovery key answers, both show a code made from both PCs' one-time keys,
 * and on the user's click the old PC sends the key sealed to the new PC's one-time key. The service only
 * passes the messages on: it never sees anything that opens the key, and a code that matches on both
 * screens shows that nobody, the service included, swapped a one-time key on the way.
 *
 * The steps, each by one side only:
 * 1. The new PC asks, with a commitment (a hash) to its one-time key, so it can't pick that key after it
 *    sees the old PC's: neither side, nor the service, can try keys until the codes match.
 * 2. One old PC answers with its one-time key. The first answer wins.
 * 3. The new PC shows its key, which must match the commitment.
 * 4. The old PC's user clicks Add: the sealed key goes up, and to the new PC once.
 * Either side can end it. Requests live in memory only, ten minutes, one per account.
 */

export const PAIRING_TTL_MS = 10 * 60_000;
/** A one-time X25519 key or a commitment, base64url. */
const KEY_TEXT = /^[A-Za-z0-9_-]{43}$/;
/** The sealed recovery key: nonce, 33 bytes, tag; base64url, with room to spare. */
const SEALED_TEXT = /^[A-Za-z0-9_-]{40,200}$/;
const MAX_ACCOUNTS = 10_000;

export interface PairingOptions {
  accounts: AccountStore;
  clientKey: (request: Request) => string;
  /** Pairing requests per client: 120 a minute by default (a waiting PC asks every few seconds). */
  rateLimiter?: RateLimiter;
  now?: () => number;
}

interface Pairing {
  id: string;
  /** The new PC's sign-in, and its name as the account knows it. */
  from: string;
  name: string | null;
  commit: string;
  expiresAt: number;
  answer?: { by: string; name: string | null; publicKey: string };
  reveal?: string;
  sealed?: string;
  /** An old PC's user said no: the new PC is told once. */
  declined?: boolean;
}

type Env = { Variables: { account: Account; session: Session } };

/** The routes under /v1/account/pairing. */
export function pairingRoutes({ accounts, clientKey, rateLimiter, now = Date.now }: PairingOptions) {
  const limiter = rateLimiter ?? createRateLimiter({ limit: 120, windowMs: 60_000 });
  const pairings = new Map<string, Pairing>();
  const app = new Hono<Env>();

  const current = (accountId: string): Pairing | null => {
    const pairing = pairings.get(accountId);
    if (pairing && pairing.expiresAt > now()) return pairing;
    pairings.delete(accountId);
    return null;
  };
  const nameOf = (session: Session) => accounts.devices(session.accountId).find((device) => device.id === session.id)?.name ?? null;

  app.use("*", async (context, next) => {
    const wait = limiter.check(clientKey(context.req.raw));
    if (wait > 0) {
      context.header("Retry-After", String(wait));
      return context.json({ error: "Too many requests.", reason: "too-many" }, 429);
    }
    const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(context.req.header("authorization") ?? "");
    const session = match ? accounts.sessionByToken(match[1]!, now()) : null;
    const account = session ? accounts.account(session.accountId) : null;
    if (!session || !account) return context.json({ error: "Sign in again.", reason: "signed-out" }, 401);
    context.set("account", account);
    context.set("session", session);
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.use("*", bodyLimit({ maxSize: 1024, onError: (context) => context.json({ error: "Too big.", reason: "too-big" }, 413) }));

  const body = async (context: Context<Env>): Promise<Record<string, unknown> | null> => {
    if (!(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) return null;
    const value = (await context.req.json().catch(() => null)) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  };
  const gone = (context: Context<Env>) => context.json({ error: "That request is gone.", reason: "gone" }, 404);
  const turn = (context: Context<Env>) => context.json({ error: "Not your turn.", reason: "not-now" }, 409);
  const bad = (context: Context<Env>) => context.json({ error: "Send what this step needs.", reason: "bad-request" }, 400);
  /** The account's request with this id, when there is one. */
  const find = (context: Context<Env>) => {
    const pairing = current(context.get("account").id);
    return pairing && pairing.id === context.req.param("id") ? pairing : null;
  };

  // 1. The new PC asks. A newer request replaces an older one of the account.
  app.post("/", async (context) => {
    const sent = await body(context);
    if (!sent || typeof sent.commit !== "string" || !KEY_TEXT.test(sent.commit)) return bad(context);
    const session = context.get("session");
    if (!pairings.has(session.accountId) && pairings.size >= MAX_ACCOUNTS) {
      for (const [id, pairing] of pairings) if (pairing.expiresAt <= now()) pairings.delete(id);
      if (pairings.size >= MAX_ACCOUNTS) return context.json({ error: "Try again in a minute.", reason: "too-many" }, 429);
    }
    const pairing: Pairing = { id: randomBytes(12).toString("base64url"), from: session.id, name: nameOf(session), commit: sent.commit, expiresAt: now() + PAIRING_TTL_MS };
    pairings.delete(session.accountId);
    pairings.set(session.accountId, pairing);
    return context.json({ id: pairing.id, expiresAt: new Date(pairing.expiresAt).toISOString() });
  });

  // What each side needs to see. The sealed key goes to the new PC once, and the request ends with it.
  app.get("/", (context) => {
    const session = context.get("session");
    const pairing = current(session.accountId);
    if (!pairing) return context.body(null, 204);
    const own = pairing.from === session.id;
    if (pairing.declined) {
      if (!own) return context.body(null, 204);
      pairings.delete(session.accountId);
      return context.json({ id: pairing.id, own, declined: true });
    }
    const answered = pairing.answer?.by === session.id;
    // An old PC that didn't answer sees only that a request is there, until another PC answers it.
    if (!own && pairing.answer && !answered) return context.body(null, 204);
    const view: Record<string, unknown> = { id: pairing.id, own, name: pairing.name, commit: pairing.commit, expiresAt: new Date(pairing.expiresAt).toISOString() };
    if (pairing.answer) view.answer = { name: pairing.answer.name, publicKey: pairing.answer.publicKey };
    if (pairing.reveal) view.reveal = pairing.reveal;
    if (own && pairing.sealed) {
      view.sealed = pairing.sealed;
      pairings.delete(session.accountId);
    }
    return context.json(view);
  });

  // 2. An old PC answers with its one-time key.
  app.post("/:id/answer", async (context) => {
    const pairing = find(context);
    if (!pairing || pairing.declined) return gone(context);
    const session = context.get("session");
    if (pairing.from === session.id || pairing.answer) return turn(context);
    const sent = await body(context);
    if (!sent || typeof sent.publicKey !== "string" || !KEY_TEXT.test(sent.publicKey)) return bad(context);
    pairing.answer = { by: session.id, name: nameOf(session), publicKey: sent.publicKey };
    return context.body(null, 204);
  });

  // 3. The new PC shows its one-time key.
  app.post("/:id/reveal", async (context) => {
    const pairing = find(context);
    if (!pairing || pairing.declined) return gone(context);
    if (pairing.from !== context.get("session").id || !pairing.answer || pairing.reveal) return turn(context);
    const sent = await body(context);
    if (!sent || typeof sent.publicKey !== "string" || !KEY_TEXT.test(sent.publicKey)) return bad(context);
    pairing.reveal = sent.publicKey;
    return context.body(null, 204);
  });

  // 4. The old PC's user said yes: the sealed key, for the new PC to take once.
  app.post("/:id/key", async (context) => {
    const pairing = find(context);
    if (!pairing || pairing.declined) return gone(context);
    if (pairing.answer?.by !== context.get("session").id || !pairing.reveal || pairing.sealed) return turn(context);
    const sent = await body(context);
    if (!sent || typeof sent.sealed !== "string" || !SEALED_TEXT.test(sent.sealed)) return bad(context);
    pairing.sealed = sent.sealed;
    return context.body(null, 204);
  });

  // Either side ends it: the new PC cancels, or the old PC's user said no.
  app.delete("/:id", (context) => {
    const pairing = find(context);
    if (!pairing) return context.body(null, 204);
    const session = context.get("session");
    if (pairing.from === session.id) pairings.delete(session.accountId);
    // Any other PC of the account may turn it down before one answered it; after that, only the one that did.
    else if (!pairing.answer || pairing.answer.by === session.id) pairing.declined = true;
    return context.body(null, 204);
  });

  return app;
}
