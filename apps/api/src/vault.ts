import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AccountStore } from "./account-store.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { requireSignIn, tooMany, type SignedInEnv } from "./sign-in.ts";

/**
 * The key vault (decided 2026-10-20, "one recovery key"): one small sealed blob per account, which only the
 * user's recovery key opens. The PC seals it before it leaves; the service keeps the bytes and a version
 * number, and gives them out only to a signed-in PC of the account. It holds what the recovery key keeps
 * safe besides the cloud copy (publisher keys, later), and its being there tells a new PC that the account
 * already has a recovery key. Unlike the copies it lives with the accounts, so the daily backup keeps it.
 */

/** The most a sealed vault may hold. */
export const MAX_VAULT_BYTES = 64 * 1024;

export interface VaultOptions {
  accounts: AccountStore;
  clientKey: (request: Request) => string;
  /** Vault requests per client: 60 a minute by default. */
  rateLimiter?: RateLimiter;
  now?: () => number;
}

type Env = SignedInEnv;

/** The routes under /v1/account/vault. Bodies are application/octet-stream, which a web page cannot send without a preflight this service refuses. */
export function vaultRoutes({ accounts, clientKey, rateLimiter, now = Date.now }: VaultOptions) {
  const limiter = rateLimiter ?? createRateLimiter({ limit: 60, windowMs: 60_000 });
  const app = new Hono<Env>();

  app.use("*", async (context, next) => {
    const wait = limiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    if (context.req.method === "PUT" && (context.req.header("content-type") ?? "").toLowerCase() !== "application/octet-stream") {
      return context.json({ error: "Send application/octet-stream.", reason: "bad-request" }, 415);
    }
    await next();
  });
  app.use("*", requireSignIn(accounts, now));
  app.use("*", bodyLimit({ maxSize: MAX_VAULT_BYTES + 4, onError: (context) => context.json({ error: "Too big.", reason: "too-big" }, 413) }));

  app.get("/", (context: Context<Env>) => {
    const vault = accounts.vault(context.get("account").id);
    if (!vault) return context.json({ error: "There is no key vault.", reason: "no-vault" }, 404);
    context.header("X-Vault-Version", String(vault.version));
    context.header("Content-Type", "application/octet-stream");
    return context.body(new Uint8Array(vault.data));
  });

  // The version it started from (4 bytes, big-endian), then the sealed vault.
  app.put("/", async (context: Context<Env>) => {
    const body = new Uint8Array(await context.req.arrayBuffer());
    if (body.length <= 4 || body.length > MAX_VAULT_BYTES + 4) return context.json({ error: `Send the version it started from and a sealed vault of at most ${MAX_VAULT_BYTES} bytes.`, reason: "bad-request" }, 400);
    const base = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
    const result = accounts.putVault(context.get("account").id, base, body.subarray(4), now());
    if (!result.ok) return context.json({ error: "The key vault changed on another PC.", reason: "vault-changed", version: result.version }, 409);
    return context.json({ version: result.version });
  });

  app.delete("/", (context: Context<Env>) => {
    accounts.removeVault(context.get("account").id);
    return context.body(null, 204);
  });

  return app;
}
