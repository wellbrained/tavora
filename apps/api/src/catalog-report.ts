import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAIL_RESERVED, type AccountOptions } from "./accounts.ts";
import { cleanMessage } from "./conversations.ts";
import type { CatalogStore } from "./catalog.ts";
import type { Mail } from "./mail.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";

/**
 * The Report button (Milestone E, step 7; C12). The app sends the module id, the key fingerprint and the
 * zip hash, a reason and an optional note, and only after the user pressed Report. Reporting needs a
 * sign-in (decided 2026-10-27): Tavora keeps who reported only while the report is open, and deletes it
 * when the report is dismissed or acted on or the account is deleted. The publisher is never told who. A report hides nothing by itself: it waits on the admin page, where a person can
 * delist the module, or block the zip or revoke the key in the signed lists. The publisher is told
 * by email at most once a day, when their account has an address.
 */

const MODULE_ID = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*){1,4}$/;
const OWNER = /^[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
export const MODULE_REPORT_REASONS = ["unsafe", "hateful", "adult", "spam", "broken", "other"] as const;
export const MAX_REPORT_NOTE = 500;

export interface ReportOptions {
  catalog: CatalogStore | undefined;
  accounts: AccountOptions | undefined;
  clientKey: (request: Request) => string;
  /** Reports per client: 10 an hour by default. */
  rateLimiter?: RateLimiter;
  now?: () => number;
}

export function reportMail(to: string, module: { id: string; name: string }): Mail {
  return {
    to,
    subject: `A user reported ${module.name} in Tavora's module catalog`,
    text:
      `A user pressed Report on your module ${module.name} (${module.id}) in Tavora's module catalog.\n\n` +
      "It stays listed while Tavora looks at it. " +
      "If Tavora takes the module down, you hear from us.\n\n" +
      "You get this email at most once a day.\n\nTavora\n",
  };
}

export function reportHandlers({ catalog, accounts, clientKey, rateLimiter, now = Date.now }: ReportOptions) {
  const limiter = rateLimiter ?? createRateLimiter({ limit: 10, windowMs: 3_600_000 });
  const limit = bodyLimit({ maxSize: 3000, onError: (context) => context.json({ error: "Send { id, owner, sha256, reason?, note? }." }, 413) });

  const tellOwner = async (owner: string, id: string) => {
    const store = accounts?.store;
    if (!store || !catalog) return;
    const key = store.publisherKey(owner);
    const email = key ? store.account(key.accountId)?.email : null;
    if (!email) return;
    const day = new Date(now()).toISOString().slice(0, 10);
    // Sign-in codes come first: a report notice never uses the emails kept for them.
    if (accounts.mailDailyLimit !== undefined && store.mailsSent(day) >= Math.max(0, accounts.mailDailyLimit - MAIL_RESERVED)) return;
    if (!catalog.takeReportNotice(owner, new Date(now()))) return;
    const name = catalog.module(id)?.module.name ?? id;
    try {
      await accounts.mailer.send(reportMail(email, { id, name }));
      store.countMail(day);
    } catch {
      // The report is recorded either way; the notice is best effort.
    }
  };

  const handler = async (context: Context) => {
    const wait = limiter.check(clientKey(context.req.raw));
    if (wait > 0) {
      context.header("Retry-After", String(wait));
      return context.json({ error: "Too many reports. Try again later." }, 429);
    }
    if (!catalog) return context.json({ error: "The module catalog is not available right now." }, 503);
    const token = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(context.req.header("authorization") ?? "")?.[1];
    const session = token && accounts ? accounts.store.sessionByToken(token, now()) : null;
    const sender = session ? accounts!.store.account(session.accountId) : null;
    if (!sender) return context.json({ error: "Sign in to report.", reason: "signed-out" }, 401);
    if (!(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) return context.json({ error: "Send JSON." }, 415);
    let body: unknown;
    try {
      body = JSON.parse(await context.req.text());
    } catch {
      body = null;
    }
    // Only these fields, so nothing else about the user can ride along. The reason and note are optional, so an older signed-in app still works.
    const input = body as Record<string, unknown> | null;
    const note = input && typeof input === "object" && !Array.isArray(input) ? (input.note === undefined ? null : cleanMessage(input.note, MAX_REPORT_NOTE)) : null;
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !["id", "owner", "sha256"].every((key) => key in input) ||
      Object.keys(input).some((key) => !["id", "owner", "sha256", "reason", "note"].includes(key)) ||
      (input.reason !== undefined && input.reason !== null && !(MODULE_REPORT_REASONS as readonly unknown[]).includes(input.reason)) ||
      note === undefined ||
            typeof input.id !== "string" ||
      !MODULE_ID.test(input.id) ||
      typeof input.owner !== "string" ||
      !OWNER.test(input.owner) ||
      typeof input.sha256 !== "string" ||
      !SHA256.test(input.sha256)
    ) {
      return context.json({ error: "Send { id, owner, sha256, reason?, note? }." }, 400);
    }
    const report = { id: input.id, owner: input.owner, sha256: input.sha256 };
    const reason = typeof input.reason === "string" ? input.reason : null;
    if (!catalog.report(report, new Date(now()), { accountId: sender.id, reason, note })) return context.json({ error: "The catalog lists no such module." }, 404);
    await tellOwner(report.owner, report.id);
    return context.json({ status: "received" }, 202);
  };

  return { limit, handler };
}
