import { createHash, createPublicKey, verify } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { LINK_CODE, type AccountStore } from "./account-store.ts";
import { OFFICIAL_PINS, type OfficialPins } from "./catalog-trust.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { tooMany } from "./sign-in.ts";

/**
 * Publishers under /v1/publishers: which developer name a publisher key shows to users, and
 * linking a key to an account. A developer gets a one-time code in the app (signed in) and runs
 * `tavora-pack link <code>`, which signs the code with the key. The service checks that signature
 * against the public half it was sent, so only whoever holds the key can link it, and keeps only
 * that public half. Nothing here ever sees a secret key.
 */

/** What the pack command signs: this line, then the code. Nothing else Tavora signs starts like it. */
export const LINK_STATEMENT = "tavora-key-link-1";
// DER prefix of an Ed25519 public key in SubjectPublicKeyInfo form; the raw key follows.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const FINGERPRINT = /^[0-9a-f]{32}$/;

/** The owner id of a key, as in module data: the first 16 bytes of the SHA-256 of the raw public key, in hex. */
export const keyFingerprint = (raw: Buffer) => createHash("sha256").update(raw).digest("hex").slice(0, 32);

/** The raw 32-byte Ed25519 key in strict base64, or null. */
function rawKey(value: unknown): Buffer | null {
  if (typeof value !== "string" || value.length !== 44) return null;
  const raw = Buffer.from(value, "base64");
  return raw.length === 32 && raw.toString("base64") === value ? raw : null;
}

/** Whether `signature` (base64) is the key's signature over `text`. */
export function signedStatement(raw: Buffer, text: string, signature: unknown): boolean {
  if (typeof signature !== "string" || signature.length !== 88) return false;
  const bytes = Buffer.from(signature, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== signature) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: "der", type: "spki" });
    return verify(null, Buffer.from(text, "utf8"), key, bytes);
  } catch {
    return false;
  }
}

/** Whether `signature` (base64) is the key's signature over the link statement for `code`. */
export const signedCode = (raw: Buffer, code: string, signature: unknown) => signedStatement(raw, `${LINK_STATEMENT}\n${code}`, signature);

export interface PublisherOptions {
  store: AccountStore;
  /** Link attempts per client: 20 in 15 minutes by default, so codes cannot be guessed. */
  linkRateLimiter?: RateLimiter;
  now?: () => number;
  /** Tavora's pinned publisher key and account (OFFICIAL_PINS by default): the key links to that account only. */
  officialPins?: OfficialPins;
}

export function publisherRoutes(options: PublisherOptions, limiter: RateLimiter, clientKey: (request: Request) => string) {
  const { store } = options;
  const now = options.now ?? Date.now;
  const pins = options.officialPins ?? OFFICIAL_PINS;
  const linkLimiter = options.linkRateLimiter ?? createRateLimiter({ limit: 20, windowMs: 15 * 60_000 });
  const app = new Hono();

  app.use("*", async (context, next) => {
    const wait = limiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    await next();
  });

  // Public: the name users see for a key. Nothing else about the account is ever said.
  app.get("/:fingerprint", (context) => {
    const fingerprint = context.req.param("fingerprint") ?? "";
    if (!FINGERPRINT.test(fingerprint)) return context.json({ error: "Not a key fingerprint.", reason: "bad-request" }, 400);
    const name = store.publisherName(fingerprint);
    if (!name) return context.json({ error: "No developer name for this key.", reason: "unknown" }, 404);
    context.header("Cache-Control", "public, max-age=3600");
    return context.json({ name });
  });

  app.post("/link", bodyLimit({ maxSize: 1000, onError: (context) => context.json({ error: "Too big.", reason: "bad-request" }, 413) }), async (context) => {
    const wait = linkLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    if (!(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) return context.json({ error: "Send JSON.", reason: "bad-request" }, 415);
    let input: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await context.req.text());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
    } catch {
      // Answered below like any other bad body.
    }
    const raw = rawKey(input.publicKey);
    const code = typeof input.code === "string" ? input.code : "";
    if (!raw || !LINK_CODE.test(code)) return context.json({ error: "Send { code, publicKey, signature }.", reason: "bad-request" }, 400);
    // The signature first: a code is only used up by whoever holds a key.
    if (!signedCode(raw, code, input.signature)) return context.json({ error: "The signature does not match the key.", reason: "bad-signature" }, 400);
    const accountId = store.takeLinkCode(code, now());
    if (!accountId) return context.json({ error: "That code is wrong or has expired. Get a new one in Tavora.", reason: "wrong-code" }, 400);
    const fingerprint = keyFingerprint(raw);
    // Tavora's publisher key belongs to Tavora's account alone; anyone else gets the answer for a key that is taken.
    if (pins.key !== "" && fingerprint === pins.key && accountId !== pins.account) return context.json({ error: "This key is linked to another Tavora account.", reason: "key-taken" }, 409);
    const result = store.linkKey(accountId, fingerprint, raw.toString("base64"), now());
    if (result === "taken") return context.json({ error: "This key is linked to another Tavora account.", reason: "key-taken" }, 409);
    if (result === "too-many") return context.json({ error: "This account has as many keys as it can link. Unlink one in Tavora first.", reason: "too-many-keys" }, 409);
    return context.json({ status: "linked", fingerprint, name: store.developer(accountId)?.name ?? null });
  });

  return app;
}
