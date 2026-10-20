import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { PUBLISH_STATEMENT, ZIP_LIMITS } from "@tavora/pack";
import type { AccountStore } from "./account-store.ts";
import { MAIL_RESERVED } from "./accounts.ts";
import { CatalogError, checkCatalogZip, type CatalogStore, type CheckedZip } from "./catalog.ts";
import { catalogTrust } from "./catalog-trust.ts";
import type { Mail, Mailer } from "./mail.ts";
import { signedStatement } from "./publishers.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";

/**
 * Publishing to the catalog (Milestone E, step 3): `tavora-pack publish` sends a zip it packed, with
 * the publisher key's signature over PUBLISH_STATEMENT and the zip's SHA-256. No sign-in is needed: the
 * key must be linked to an account (which takes a sign-in), and the account holds the module id's
 * prefix (C5). Signing the hash, not only the files, means a zip shared by hand cannot be published
 * by whoever received it; only the key's holder decides what lists. A revoked key publishes nothing
 * new (C6), and a successor key publishes the modules of the key it replaces (C7), both by the lists
 * signed with the catalogue key.
 */
export interface PublishLimits {
  /** Uploads per account in 24 hours (C9). */
  uploadsPerDay: number;
  /** Bytes of zips one account may have stored. */
  accountBytes: number;
  /** Bytes of zips in the whole catalog; past it uploads answer 507. */
  catalogBytes: number;
}

export const PUBLISH_LIMITS: Readonly<PublishLimits> = {
  uploadsPerDay: 10,
  accountBytes: 200 * 1024 * 1024,
  catalogBytes: 20 * 1024 * 1024 * 1024,
};

export interface PublishOptions {
  catalog: CatalogStore | undefined;
  store: AccountStore | undefined;
  clientKey: (request: Request) => string;
  /** Uploads per client: 30 an hour by default. */
  rateLimiter?: RateLimiter;
  limits?: Partial<PublishLimits>;
  now?: () => number;
  /** The catalogue public key the signed lists are checked against (CATALOGUE_PUBLIC_KEY outside tests). */
  catalogueKey?: string;
  /** Who is told when the catalog is full (MAINTAINER_EMAIL), and how. Absent: only the review page shows it. */
  maintainer?: { email: string; mailer: Mailer; mailDailyLimit?: number };
}

export function catalogFullMail(to: string, usedBytes: number, catalogBytes: number): Mail {
  const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
  return {
    to,
    subject: "Tavora's module catalog is full",
    text:
      `The module catalog holds ${mb(usedBytes)} MB of its ${mb(catalogBytes)} MB, so new uploads are refused with 507.\n\n` +
      "Make room by removing old zips, or raise the catalog's limit, and uploads work again. The review page shows this until an upload fits.\n\n" +
      "You get this email at most once a day.\n\nTavora\n",
  };
}

/** The middleware and handler for POST /v1/catalog/publish. */
export function publishHandlers({ catalog, store, clientKey, rateLimiter, limits = {}, now = Date.now, catalogueKey, maintainer }: PublishOptions) {
  const limiter = rateLimiter ?? createRateLimiter({ limit: 30, windowMs: 3_600_000 });
  const { uploadsPerDay, accountBytes, catalogBytes } = { ...PUBLISH_LIMITS, ...limits };
  const refuse = (context: Context, status: 400 | 403 | 409 | 413 | 415 | 429 | 503 | 507, reason: string, error: string) => context.json({ error, reason }, status);

  const limit = bodyLimit({
    maxSize: ZIP_LIMITS.maxArchiveBytes,
    onError: (context) => refuse(context, 413, "too-big", `A module zip may be at most ${ZIP_LIMITS.maxArchiveBytes / 1024 / 1024} MB.`),
  });

  // Tells the maintainer by email, at most once a day; the review page shows it either way (C9).
  const tellFull = async (catalog: CatalogStore, store: AccountStore, at: number, usedBytes: number) => {
    if (!catalog.markFull(new Date(at)) || !maintainer) return;
    const day = new Date(at).toISOString().slice(0, 10);
    // Sign-in codes come first: this notice never uses the emails kept for them.
    if (maintainer.mailDailyLimit !== undefined && store.mailsSent(day) >= Math.max(0, maintainer.mailDailyLimit - MAIL_RESERVED)) return;
    try {
      await maintainer.mailer.send(catalogFullMail(maintainer.email, usedBytes, catalogBytes));
      store.countMail(day);
    } catch {
      // The review page still shows it; the email is best effort.
    }
  };

  const handler = async (context: Context) => {
    const wait = limiter.check(clientKey(context.req.raw));
    if (wait > 0) {
      context.header("Retry-After", String(wait));
      return refuse(context, 429, "too-many", "Too many uploads. Wait a while and try again.");
    }
    if (!catalog || !store) return refuse(context, 503, "unavailable", "Publishing is not available right now.");
    if ((context.req.header("content-type") ?? "").toLowerCase() !== "application/zip") return refuse(context, 415, "bad-request", "Send the zip as application/zip.");
    const signature = context.req.header("x-tavora-signature");
    const bytes = Buffer.from(await context.req.arrayBuffer());

    let checked: CheckedZip;
    try {
      checked = checkCatalogZip(bytes);
    } catch (error) {
      if (error instanceof CatalogError) return refuse(context, 400, "invalid", error.message);
      throw error;
    }
    const key = store.publisherKey(checked.owner);
    if (!key) return refuse(context, 403, "key-not-linked", "This publisher key is not linked to a Tavora account.");
    if (!signedStatement(Buffer.from(key.publicKey, "base64"), `${PUBLISH_STATEMENT}\n${checked.sha256}`, signature)) {
      return refuse(context, 403, "bad-signature", "The upload is not signed by the key that signed the zip.");
    }
    const trust = catalogTrust(catalog, catalogueKey);
    if (trust.revoked(checked.owner, checked.sha256)) return refuse(context, 403, "key-revoked", "This publisher key was revoked and publishes nothing new. Link a new key to your account.");
    // Reported as leaked in the app: nothing new from it while the revocation waits to be signed.
    const reported = store.keyRequest(checked.owner);
    if (reported?.leaked && reported.declinedAt === null) return refuse(context, 403, "key-leaked", "You reported this publisher key as leaked, so it publishes nothing new. Publish with your new key.");
    // A successor key counts for its account's first key only when the succession names this account.
    const firstKey = (fingerprint: string) => {
      const first = trust.firstKey(fingerprint);
      return first.account === key.accountId ? first.key : fingerprint;
    };

    const prefix = checked.manifest.id.split(".")[0]!;
    const held = store.prefixCheck(key.accountId, prefix);
    if (held === "taken") return refuse(context, 403, "prefix-taken", `The id prefix "${prefix}" belongs to another developer.`);
    if (held === "reserved") return refuse(context, 403, "prefix-reserved", `The id prefix "${prefix}" is reserved.`);
    if (held === "too-many") return refuse(context, 403, "too-many-prefixes", "Your account holds as many id prefixes as it can. Publish under one of them.");

    const at = now();
    if (catalog.uploadsSince(key.accountId, new Date(at - 86_400_000)) >= uploadsPerDay) {
      return refuse(context, 429, "daily-limit", `An account can publish ${uploadsPerDay} versions a day. Try again tomorrow.`);
    }
    if (catalog.storedBytes(key.accountId) + checked.size > accountBytes) {
      return refuse(context, 413, "account-full", `Your modules may take at most ${accountBytes / 1024 / 1024} MB in the catalog.`);
    }
    const usedBytes = catalog.storedBytes();
    if (usedBytes + checked.size > catalogBytes) {
      console.warn("[tavora-api] The module catalog is full: uploads are refused until there is room.");
      await tellFull(catalog, store, at, usedBytes);
      return refuse(context, 507, "catalog-full", "The catalog has no room right now. Tavora has been told.");
    }

    try {
      catalog.add(bytes, new Date(at), key.accountId, checked, firstKey);
    } catch (error) {
      if (error instanceof CatalogError) return refuse(context, 409, "conflict", error.message);
      throw error;
    }
    catalog.clearFull();
    if (held === "free") store.reservePrefix(key.accountId, prefix, at);
    return context.json({ status: "published", id: checked.manifest.id, version: checked.manifest.version, sha256: checked.sha256 }, 201);
  };

  return { limit, handler };
}
