import { readZip } from "@tavora/pack";
import { Hono } from "hono";
import { accountLifecycle, type AccountLifecycle } from "./account-lifecycle.ts";
import type { AccountStore } from "./account-store.ts";
import { CatalogError, checkCatalogZip, type CatalogStore, type ReviewReason, type WaitingVersion } from "./catalog.ts";
import { PUBLISH_LIMITS } from "./catalog-publish.ts";
import { mailLanguage, publishedMail, type Mailer } from "./mail.ts";
import { bannedMail, createNotifier, declinedMail, DECLINE_REASONS, isDeclineReason, type Notifier } from "./moderation-mail.ts";
import { runChecks } from "./moderation.ts";
import type { Scanner } from "./virus-scan.ts";

/**
 * The maintainer's side of the review before listing (decided 2026-10-26), as JSON under `/api/moderation/*` of the admin
 * app (the token check there covers it): the versions waiting with their reasons and what helps judge them, Approve, Decline with a
 * reason, Ban and Unban for a developer account, and the one-time run of the checks over what is already live. The Approval section
 * of the admin panel is built on these.
 */

export interface ModerationAdminOptions {
  catalog: CatalogStore;
  accounts: AccountStore;
  scanner?: Scanner | undefined;
  /** How developers are told (approved, declined, banned). Absent: nobody is (tests that don't look). */
  mailer?: Mailer | undefined;
  mailDailyLimit?: number | undefined;
  now?: () => number;
  /** Versions of a module that keep their zip once one is approved (the publishing limit by default). */
  keepVersions?: number;
  /** The owner's address (MAINTAINER_EMAIL): that account can't be banned. */
  ownerEmail?: string | undefined;
  /** What banning reaches (account-lifecycle.ts). Absent: built from the catalog and accounts. */
  lifecycle?: AccountLifecycle | undefined;
}

const MAX_NOTE = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_README = 20_000;
/** Where the one-time run keeps its results. */
const LIVE_CHECK = "live_check";

/** What the review page shows of one waiting version. */
function describe(waiting: WaitingVersion, catalog: CatalogStore, accounts: AccountStore) {
  const { manifest } = waiting;
  let files: { name: string; size: number }[] = [];
  const bytes = catalog.zipBytes(waiting.sha256);
  if (bytes) {
    try {
      files = readZip(bytes).map((file) => ({ name: file.name, size: file.data.length }));
    } catch {
      files = [];
    }
  }
  const id = waiting.accountId;
  const keys = id ? accounts.keys(id).map((key) => key.fingerprint) : [];
  return {
    sha256: waiting.sha256,
    id: waiting.id,
    name: manifest.name,
    version: waiting.version,
    size: waiting.size,
    queuedAt: waiting.queuedAt,
    previousVersion: catalog.previousListed(waiting.id)?.version ?? null,
    reasons: waiting.review.reasons,
    developer: {
      accountId: id,
      name: id ? (accounts.developer(id)?.name ?? null) : null,
      email: id ? (accounts.account(id)?.email ?? null) : null,
      banned: id ? accounts.isBanned(id) : false,
      approvedBefore: id ? catalog.accountApproved(id, keys) : false,
      keys,
      prefixes: id ? accounts.prefixes(id) : [],
      modules: id ? catalog.modulesOfAccount(id, keys) : [],
    },
    module: {
      description: manifest.description ?? null,
      translations: manifest.translations ?? {},
      homepage: manifest.homepage ?? null,
      support: manifest.support ?? null,
      games: manifest.games,
      permissions: { network: manifest.permissions.network, connectors: manifest.permissions.connectors ?? [] },
      notes: waiting.notes,
      readme: waiting.readme === null ? null : waiting.readme.slice(0, MAX_README),
      pictures: [
        ...(waiting.icon ? [{ ...waiting.icon, kind: "icon" as const }] : []),
        ...waiting.screenshots.map((shot) => ({ ...shot, kind: "screenshot" as const })),
      ],
      files,
    },
    language: waiting.review.language,
    token: waiting.review.token,
  };
}

export function moderationRoutes({ catalog, accounts, scanner, mailer, mailDailyLimit, ownerEmail, now = Date.now, keepVersions = PUBLISH_LIMITS.keepVersions, lifecycle: given }: ModerationAdminOptions) {
  const app = new Hono();
  const lifecycle = given ?? accountLifecycle({ accounts, catalog, copies: undefined, reviews: undefined, conversations: undefined, leaderboards: undefined, icons: undefined });
  const notifier: Notifier = mailer ? createNotifier({ store: accounts, mailer, mailDailyLimit, now }) : { send: async () => false };
  let running = false;

  const json = async (request: Request): Promise<Record<string, unknown>> => {
    try {
      const body = JSON.parse(await request.text()) as unknown;
      return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const noteOf = (value: unknown): string | null | undefined => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return undefined;
    const note = value.trim();
    return note.length > MAX_NOTE ? undefined : note || null;
  };
  const reasonList = DECLINE_REASONS.join(", ");

  app.get("/waiting", (context) => context.json({ waiting: catalog.waitingVersions().map((waiting) => describe(waiting, catalog, accounts)), reasons: DECLINE_REASONS }));

  // A text file of a waiting zip, to read its code.
  app.get("/waiting/:sha256/file", (context) => {
    const waiting = catalog.waitingVersion(context.req.param("sha256"));
    const name = context.req.query("name") ?? "";
    const bytes = waiting ? catalog.zipBytes(waiting.sha256) : null;
    if (!waiting || !bytes) return context.json({ error: "Not waiting." }, 404);
    let data: Buffer | undefined;
    try {
      data = readZip(bytes).find((file) => file.name === name)?.data;
    } catch {
      data = undefined;
    }
    if (!data) return context.json({ error: "No such file." }, 404);
    return new Response(new Uint8Array(data.subarray(0, MAX_FILE_BYTES)), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" } });
  });

  // An icon or screenshot of a waiting version, as the picture it is.
  app.get("/pictures/:file", (context) => {
    const match = /^([0-9a-f]{64})\.(png|webp)$/.exec(context.req.param("file"));
    const bytes = match ? catalog.waitingPicture(match[1]!, match[2]!) : null;
    return bytes ? new Response(new Uint8Array(bytes), { headers: { "Content-Type": `image/${match![2]}` } }) : context.json({ error: "Not found." }, 404);
  });

  app.post("/approve", async (context) => {
    const { sha256 } = await json(context.req.raw);
    if (typeof sha256 !== "string") return context.json({ error: "Send { sha256 }." }, 400);
    const waiting = catalog.waitingVersion(sha256);
    if (!waiting) return context.json({ error: "Nothing with this hash is waiting." }, 404);
    if (waiting.accountId && accounts.isBanned(waiting.accountId)) return context.json({ error: "This developer is banned. Unban them first, or decline the version." }, 409);
    if (waiting.accountId && accounts.isSuspended(waiting.accountId)) return context.json({ error: "This developer is suspended. Unsuspend them first, or decline the version." }, 409);
    const approved = catalog.approve(sha256, new Date(now()));
    if (!approved) return context.json({ error: "Its zip is gone, so it can't be listed. Decline it." }, 409);
    catalog.prune(waiting.id, keepVersions, new Date(now()));
    catalog.clearFull();
    const to = waiting.accountId ? accounts.account(waiting.accountId)?.email : undefined;
    const mailed = to
      ? await notifier.send(publishedMail(to, { id: waiting.id, name: waiting.manifest.name, version: waiting.version }, waiting.owner, waiting.review.token, mailLanguage(waiting.review.language)))
      : false;
    return context.json({ ok: true, id: waiting.id, version: waiting.version, mailed });
  });

  app.post("/decline", async (context) => {
    const { sha256, reason, note } = await json(context.req.raw);
    const text = noteOf(note);
    if (typeof sha256 !== "string" || !isDeclineReason(reason) || text === undefined) {
      return context.json({ error: `Send { sha256, reason, note? } with reason one of ${reasonList} and a note of at most ${MAX_NOTE} characters.` }, 400);
    }
    const waiting = catalog.waitingVersion(sha256);
    if (!waiting) return context.json({ error: "Nothing with this hash is waiting." }, 404);
    catalog.recordDeclined(waiting, reason, text, new Date(now()));
    catalog.removeWaiting(sha256);
    const to = waiting.accountId ? accounts.account(waiting.accountId)?.email : undefined;
    const mailed = to ? await notifier.send(declinedMail(to, { id: waiting.id, name: waiting.manifest.name, version: waiting.version }, reason, text, mailLanguage(waiting.review.language))) : false;
    return context.json({ ok: true, mailed });
  });

  app.post("/ban", async (context) => {
    const { accountId, sha256, reason, note } = await json(context.req.raw);
    const text = noteOf(note);
    if (!isDeclineReason(reason) || text === undefined || (typeof accountId !== "string" && typeof sha256 !== "string")) {
      return context.json({ error: `Send { accountId or sha256, reason, note? } with reason one of ${reasonList}.` }, 400);
    }
    const id = typeof accountId === "string" ? accountId : catalog.waitingVersion(sha256 as string)?.accountId;
    if (!id) return context.json({ error: "No such developer." }, 404);
    // A ban that stopped halfway (a module still listed or a version waiting) may be run again to finish it.
    if (accounts.isBanned(id) && !lifecycle.banUnfinished(id)) return context.json({ error: "This developer is banned already." }, 409);
    const email = accounts.account(id)?.email;
    if (email && ownerEmail?.trim() && email.toLowerCase() === ownerEmail.trim().toLowerCase()) return context.json({ error: "This is the owner's account. It can't be banned." }, 403);
    if (!email && !accounts.developer(id) && accounts.keys(id).length === 0 && catalog.modulesOfAccount(id, []).length === 0) return context.json({ error: "No such developer." }, 404);
    const language = mailLanguage(catalog.languageOf(id));
    // No await from here to the end of the ban: what still waits is declined with the same reason (the one mail below covers it),
    // the modules go, their conversations close, and the account is banned in one go.
    const { unlisted, declined, closedConversations } = lifecycle.ban(id, reason, text, now());
    const mailed = email ? await notifier.send(bannedMail(email, reason, text, language)) : false;
    return context.json({ ok: true, unlisted, declined, closedConversations, mailed });
  });

  app.post("/unban", async (context) => {
    const { accountId } = await json(context.req.raw);
    if (typeof accountId !== "string") return context.json({ error: "Send { accountId }." }, 400);
    // Only the modules the ban unlisted come back; one the maintainer delisted for another reason was not on that list.
    const unbanned = lifecycle.unban(accountId);
    if (unbanned === null) return context.json({ error: "This developer isn't banned." }, 404);
    return context.json({ ok: true, relisted: unbanned.relisted });
  });

  app.get("/bans", (context) =>
    context.json({
      bans: accounts.bans().map((ban) => ({ ...ban, bannedAt: new Date(ban.bannedAt).toISOString() })),
    }),
  );

  // The one-time run of the checks over every module already live: results only, nothing is delisted or changed.
  app.get("/live-check", (context) => {
    const saved = catalog.getState(LIVE_CHECK);
    return context.json({ result: saved === null ? null : (JSON.parse(saved) as unknown), running });
  });

  app.post("/live-check", async (context) => {
    const { again } = await json(context.req.raw);
    if (running) return context.json({ error: "It is running already." }, 409);
    const saved = catalog.getState(LIVE_CHECK);
    if (saved !== null && again !== true) return context.json({ error: "It ran once already. Send { again: true } to run it again.", result: JSON.parse(saved) as unknown }, 409);
    running = true;
    try {
      const results: { id: string; version: string; name: string; owner: string; developer: string | null; reasons: ReviewReason[]; error?: string }[] = [];
      let skipped = 0;
      for (const live of catalog.liveVersions()) {
        const bytes = catalog.zipBytes(live.sha256);
        const developer = (live.accountId ?? accounts.publisherKey(live.owner)?.accountId ?? null);
        const base = { id: live.id, version: live.version, name: live.manifest.name, owner: live.owner, developer: developer ? (accounts.developer(developer)?.name ?? null) : null };
        if (!bytes) {
          skipped++;
          continue;
        }
        try {
          const checked = checkCatalogZip(bytes);
          const fingerprints = developer ? accounts.keys(developer).map((key) => key.fingerprint) : [live.owner];
          const reasons = await runChecks({ catalog, scanner }, checked, bytes, { accountId: developer, fingerprints }, live.sha256);
          results.push({ ...base, reasons });
        } catch (error) {
          // A zip that can't be checked is a result too, not a pass.
          results.push({ ...base, reasons: [], error: error instanceof CatalogError ? error.message : "The checks could not run." });
        }
      }
      const result = {
        ranAt: new Date(now()).toISOString(),
        checked: results.length,
        skipped,
        flagged: results.filter((item) => item.reasons.length > 0 || item.error !== undefined).length,
        results,
      };
      catalog.setState(LIVE_CHECK, JSON.stringify(result));
      return context.json({ result });
    } finally {
      running = false;
    }
  });

  return app;
}
