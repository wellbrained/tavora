import { Hono } from "hono";
import type { AccountRow, AccountStore } from "./account-store.ts";
import type { CatalogStore } from "./catalog.ts";
import type { CopyStore } from "./cloud-copy.ts";
import type { Mailer } from "./mail.ts";
import { mailLanguage } from "./mail.ts";
import { createNotifier, isSuspendReason, SUSPEND_REASONS, suspendedMail, type Notifier } from "./moderation-mail.ts";
import type { ReviewStore } from "./reviews.ts";

/**
 * The maintainer's account list and Suspend (decided 2026-10-26), as JSON under `/api/accounts/*` of the admin app (the token
 * check there covers it). The maintainer sees everything the service keeps about an account, unmasked, but never a secret: no
 * session or publish-token value or hash, no code hash, no vault bytes. Suspend is reversible: it signs the account out
 * everywhere, refuses sign-in, hides its reviews, stops its publishing and tells the person by email. Deleting an account stays
 * the owner's alone.
 */

export interface AccountsAdminOptions {
  accounts: AccountStore;
  catalog?: CatalogStore | undefined;
  reviews?: ReviewStore | undefined;
  copies?: CopyStore | undefined;
  /** How the person is told (suspended). Absent: nobody is. */
  mailer?: Mailer | undefined;
  mailDailyLimit?: number | undefined;
  now?: (() => number) | undefined;
}

const MAX_NOTE = 500;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FILTERS = ["all", "developers", "banned", "suspended"] as const;
type Filter = (typeof FILTERS)[number];
const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString());

export function accountsAdminRoutes({ accounts, catalog, reviews, copies, mailer, mailDailyLimit, now = Date.now }: AccountsAdminOptions) {
  const app = new Hono();
  const notifier: Notifier = mailer ? createNotifier({ store: accounts, mailer, mailDailyLimit, now }) : { send: async () => false };

  const json = async (request: Request): Promise<Record<string, unknown>> => {
    try {
      const body = JSON.parse(await request.text()) as unknown;
      return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  const stateOf = (row: Pick<AccountRow, "banned" | "suspended">) => (row.suspended ? "suspended" : row.banned ? "banned" : "active");

  const rowAnswer = (row: AccountRow) => ({
    id: row.id,
    email: row.email,
    discord: row.discordName,
    profileName: row.profileName,
    initials: row.initials,
    hasPicture: row.hasPicture,
    developer: row.developerName,
    createdAt: iso(row.createdAt),
    lastActiveAt: iso(row.lastActiveAt),
    devices: row.devices,
    banned: row.banned,
    suspended: row.suspended,
    state: stateOf(row),
  });

  // Every account, newest first. ?q= searches email, Discord name, profile name, developer name, account id, key fingerprint,
  // prefix and module id (part of any of them, case ignored); ?filter= is all, developers, banned or suspended.
  app.get("/list", (context) => {
    const filter = (context.req.query("filter") ?? "all") as Filter;
    if (!FILTERS.includes(filter)) return context.json({ error: `Send ?filter= one of ${FILTERS.join(", ")}.` }, 400);
    const q = (context.req.query("q") ?? "").trim().toLowerCase().slice(0, 100);
    let rows = accounts.accountRows();
    const total = rows.length;
    const counts = {
      developers: rows.filter((row) => row.developerName !== null).length,
      banned: rows.filter((row) => row.banned).length,
      suspended: rows.filter((row) => row.suspended).length,
    };
    if (filter === "developers") rows = rows.filter((row) => row.developerName !== null);
    else if (filter === "banned") rows = rows.filter((row) => row.banned);
    else if (filter === "suspended") rows = rows.filter((row) => row.suspended);
    if (q) {
      const held = accounts.keysAndPrefixes();
      rows = rows.filter((row) => {
        const own = held.get(row.id);
        const ids = own && catalog && (own.keys.length > 0 || own.prefixes.length > 0) ? catalog.modulesOfAccount(row.id, own.keys) : [];
        const fields = [row.email, row.discordName, row.profileName, row.developerName, row.id, ...(own?.keys ?? []), ...(own?.prefixes ?? []), ...ids];
        return fields.some((field) => field !== null && field.toLowerCase().includes(q));
      });
    }
    return context.json({ total, counts, accounts: rows.map(rowAnswer) });
  });

  // Everything the service keeps about one account.
  app.get("/:id", (context) => {
    const id = context.req.param("id");
    const account = ID.test(id) ? accounts.account(id) : null;
    if (!account) return context.json({ error: "No such account." }, 404);
    const at = now();
    const row = accounts.accountRows().find((candidate) => candidate.id === id)!;
    const profile = accounts.profile(id);
    const developer = accounts.developer(id);
    const keys = accounts.keys(id);
    const fingerprints = keys.map((key) => key.fingerprint);
    const listed = new Map((catalog?.adminModules() ?? []).map((module) => [module.id, module]));
    const moduleIds = catalog ? catalog.modulesOfAccount(id, fingerprints) : [];
    const copy = copies?.info(id) ?? null;
    const vault = accounts.vault(id);
    const ban = accounts.banOf(id);
    const suspension = accounts.suspension(id);
    return context.json({
      id,
      email: account.email,
      discord: account.discord ? { name: account.discord.name } : null,
      createdAt: account.createdAt,
      lastActiveAt: iso(row.lastActiveAt),
      state: stateOf(row),
      profile: profile ? { name: profile.name, initials: profile.initials, hasPicture: profile.picture !== null, updatedAt: iso(profile.updatedAt) } : null,
      devices: accounts.devices(id).map(({ os, name, createdAt, lastUsedAt }) => ({ os, name, createdAt, lastUsedAt })),
      developer: developer ? { name: developer.name, changedAt: iso(developer.changedAt) } : null,
      keys,
      prefixes: accounts.heldPrefixes(id).map(({ prefix, reservedAt }) => ({ prefix, reservedAt: iso(reservedAt) })),
      publishTokens: accounts.publishTokens(id, at).map((token) => ({ name: token.name, createdAt: iso(token.createdAt), expiresAt: iso(token.expiresAt), lastUsedAt: iso(token.lastUsedAt) })),
      modules: moduleIds.map((moduleId) => {
        const module = listed.get(moduleId);
        return { id: moduleId, name: module?.name ?? moduleId, listed: module?.listed ?? false, installs: module?.installs ?? 0, versions: module?.versions.length ?? 0 };
      }),
      reviews: reviews ? reviews.countByAccount(id) : { written: 0, hidden: 0 },
      cloudCopy: copy ? { size: copy.size, updatedAt: iso(copy.updatedAt) } : null,
      vault: vault ? { updatedAt: iso(vault.updatedAt) } : null,
      ban: ban ? { reason: ban.reason, note: ban.note, bannedAt: iso(ban.bannedAt), modules: ban.modules.length } : null,
      suspension: suspension ? { reason: suspension.reason, note: suspension.note, suspendedAt: iso(suspension.suspendedAt) } : null,
      reasons: SUSPEND_REASONS,
    });
  });

  // The profile picture, as the PNG the player chose. The panel fetches it with its token and shows it from a blob.
  app.get("/:id/picture.png", (context) => {
    const id = context.req.param("id");
    const picture = ID.test(id) ? accounts.profile(id)?.picture : null;
    if (!picture) return context.json({ error: "No picture." }, 404);
    return new Response(new Uint8Array(picture), { headers: { "Content-Type": "image/png" } });
  });

  app.post("/suspend", async (context) => {
    const { id, reason, note } = await json(context.req.raw);
    const text = note === undefined || note === null ? null : typeof note === "string" ? note.trim() || null : undefined;
    if (typeof id !== "string" || !isSuspendReason(reason) || text === undefined || (text !== null && text.length > MAX_NOTE)) {
      return context.json({ error: `Send { id, reason, note? } with reason one of ${SUSPEND_REASONS.join(", ")} and a note of at most ${MAX_NOTE} characters.` }, 400);
    }
    const account = ID.test(id) ? accounts.account(id) : null;
    if (!account) return context.json({ error: "No such account." }, 404);
    // Suspending again changes nothing but finishes what a failed first try left (the reviews), so a retry is safe: no new reason, no second email.
    if (accounts.isSuspended(id)) return context.json({ ok: true, already: true, signedOut: 0, hiddenReviews: reviews?.hideForSuspension(id) ?? 0, mailed: false });
    const language = mailLanguage(catalog?.languageOf(id));
    // No await from here to the end of the suspension: sign-ins end and reviews hide in one go.
    const signedOut = accounts.suspend(id, reason, text, now());
    const hiddenReviews = reviews?.hideForSuspension(id) ?? 0;
    const mailed = account.email ? await notifier.send(suspendedMail(account.email, reason, text, language)) : false;
    return context.json({ ok: true, signedOut, hiddenReviews, mailed });
  });

  app.post("/unsuspend", async (context) => {
    const { id } = await json(context.req.raw);
    if (typeof id !== "string") return context.json({ error: "Send { id }." }, 400);
    if (!ID.test(id)) return context.json({ error: "This account isn't suspended." }, 404);
    // Idempotent for a retry: the reviews the suspension hid are shown again even when the suspension is already gone.
    const was = accounts.unsuspend(id);
    const shownReviews = reviews?.showAfterSuspension(id) ?? 0;
    if (!was && shownReviews === 0) return context.json({ error: "This account isn't suspended." }, 404);
    return context.json({ ok: true, shownReviews });
  });

  return app;
}
