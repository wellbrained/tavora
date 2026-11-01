import { createHash, timingSafeEqual } from "node:crypto";
import { accountLifecycle, type AccountLifecycle } from "./account-lifecycle.ts";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { AccountStore } from "./account-store.ts";
import { registerPanelRoutes } from "./admin-panel.ts";
import { createProbes, type Probes } from "./admin-probes.ts";
import { blockRoutes, blocksToSign } from "./block-admin.ts";
import type { CatalogStore } from "./catalog.ts";
import { catalogTrust } from "./catalog-trust.ts";
import { keyRequestStatus, revocationEntries, successionEntries } from "./key-requests.ts";
import type { IconState } from "./icon-state.ts";
import { isIconId, type IconStore } from "./icons.ts";
import { accountsAdminRoutes } from "./accounts-admin.ts";
import { ActivityLog, type ActivityTarget } from "./activity-log.ts";
import type { CopyStore } from "./cloud-copy.ts";
import { mailLanguage } from "./mail.ts";
import { moderationRoutes, type ModerationAdminOptions } from "./moderation-admin.ts";
import { createNotifier, isUnpublishReason, unpublishedMail, UNPUBLISH_REASONS } from "./moderation-mail.ts";
import type { ReviewStore } from "./reviews.ts";
import { accountName, createConversationNotifier, type ConversationStore } from "./conversations.ts";
import { conversationsAdminRoutes, textsAdminRoutes } from "./conversations-admin.ts";
import { leaderboardsAdminRoutes, type LeaderboardStore } from "./leaderboards.ts";
import type { ModuleRequestStore } from "./module-requests.ts";
import { statsRange, type StatsStore } from "./stats.ts";
import type { Submissions } from "./submissions.ts";

/**
 * Tavora Admin, the private panel: Overview, Updates, Modules, Review, Accounts and Status. The page is the
 * built Tavora Admin (its own repo, wellbrained/tavora-admin: Vue and the shared kit), served from `adminDir`; its JSON is here and in admin-panel.ts.
 * Review is the old review page: the icons users have offered, shown the way the
 * app will show them, with Approve, Deny and Deny and block; and the hosted
 * icons, with Take down for a publisher's request; and the modules users
 * reported from the catalog, with Delist and Dismiss; and the reviews users reported, with Hide and Dismiss; and the developers' requests to replace a lost
 * or leaked publisher key, exported as entries to sign offline. It is served on its own
 * port of 127.0.0.1 that the web server never forwards, and every call needs
 * the admin token, so reaching it takes the server and the token.
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

export interface AdminOptions {
  token: string;
  submissions: Submissions;
  state: IconState;
  store: IconStore;
  catalog?: CatalogStore;
  /** Accounts, for the key replacement requests. Absent: the list is empty. */
  accounts?: AccountStore;
  /** The catalogue public key the served lists are checked against; CATALOGUE_PUBLIC_KEY by default. */
  catalogueKey?: string;
  /** The cloud copies, for the account details (size and date only). Absent: no account has one. */
  copies?: CopyStore;
  /** Ratings and reviews, for the reported reviews. Absent: the list is empty. */
  reviews?: ReviewStore;
  /** Conversations, for Messages and Texts. Absent: those routes answer 404. */
  conversations?: ConversationStore;
  /** Leaderboards, for allowing modules and hiding names. Absent: those routes answer 404. */
  leaderboards?: LeaderboardStore;
  /** The built panel (Tavora Admin's dist; on the server /srv/tavora-admin/current). Absent or missing: the page says it is not built. */
  adminDir?: string;
  /** What the panel asks the outside world; the real ones by default. */
  probes?: Probes;
  /** The game dataset's size and build date, as /v1/health says. */
  dataset?: () => { games: number; builtAt: string | null };
  /** Emails a day the mail provider allows. */
  mailDailyLimit?: number;
  /** The state directory, where the daily backup leaves its time. */
  stateDir?: string;
  /** The plain daily totals for GET /api/stats. Absent: the route answers 503. */
  stats?: StatsStore;
  /** The votes for modules for games, for GET /api/module-requests. Absent: the route answers 503. */
  moduleRequests?: ModuleRequestStore;
  /** The review before listing (`/api/moderation/*`; needs `catalog` and `accounts`): the scanner, and how developers are emailed. */
  /** The owner's address (MAINTAINER_EMAIL): that account is marked as the owner and can't be suspended or banned. */
  ownerEmail?: string;
  /** What the maintainer did, for the Activity page. Absent: nothing is kept and the page is empty. */
  activity?: ActivityLog;
  moderation?: Pick<ModerationAdminOptions, "scanner" | "mailer" | "mailDailyLimit" | "now" | "keepVersions">;
  /** What suspend and ban reach (account-lifecycle.ts); the server passes the one built over every store. Absent: built from the stores above. */
  lifecycle?: AccountLifecycle;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function createAdminApp({ token, submissions, state, store, catalog, accounts, catalogueKey, reviews, conversations, leaderboards, copies, adminDir, probes, dataset, mailDailyLimit, stateDir, stats, moduleRequests, moderation, ownerEmail, activity, lifecycle: given }: AdminOptions) {
  const lifecycle = given ?? (accounts ? accountLifecycle({ accounts, catalog, copies, reviews, conversations, leaderboards, icons: state }) : undefined);
  const app = new Hono();
  const expected = digest(token);

  // A file of the built panel. Only plain names under the panel's own folder; hashed assets never change.
  const page = (name: string): Response => {
    const root = adminDir ? path.resolve(adminDir) : null;
    const file = root ? path.resolve(root, name) : null;
    if (!root || !file || !file.startsWith(root + path.sep) || !/^[\w./-]+$/.test(name)) return new Response("Not found.", { status: 404 });
    try {
      if (!statSync(file).isFile()) throw new Error("not a file");
      const kept = name.startsWith("assets/") ? { "Cache-Control": "public, max-age=31536000, immutable" } : {};
      return new Response(readFileSync(file), { headers: { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", ...kept } });
    } catch {
      return name === "index.html"
        ? new Response("The admin panel is not built. Build or deploy Tavora Admin (wellbrained/tavora-admin).", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
        : new Response("Not found.", { status: 404 });
    }
  };

  app.use("*", async (context, next) => {
    await next();
    if (!context.res.headers.has("Cache-Control")) context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  // The page itself holds no data, so it needs no token.
  app.get("/", () => page("index.html"));
  app.get("/assets/:file", (context) => page(`assets/${context.req.param("file")}`));
  app.get("/favicon.svg", () => page("favicon.svg"));

  app.use("/api/*", async (context, next) => {
    const sent = context.req.header("x-admin-token") ?? "";
    if (!timingSafeEqual(digest(sent), expected)) return context.json({ error: "Wrong token." }, 401);
    if (context.req.method === "POST" && !(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return context.json({ error: "Send JSON." }, 415);
    }
    await next();
  });

  // Every change the maintainer makes is written down: the route, what it touched, the reason and note typed for it.
  if (activity) {
    const log = activity;
    const FIELDS = ["id", "accountId", "sha256", "version", "listed", "hidden", "replaceable", "block"] as const;
    app.use("/api/*", async (context, next) => {
      if (context.req.method !== "POST") return next();
      let body: Record<string, unknown> = {};
      try {
        const text = await context.req.raw.clone().text();
        if (text.length <= 20_000) body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = {};
      }
      const kind = new URL(context.req.url).pathname.replace(/^\/api\//, "");
      const target = activityTarget(kind, body);
      await next();
      if (context.res.status < 200 || context.res.status >= 300) return;
      const answer = (await context.res.clone().json().catch(() => null)) as Record<string, unknown> | null;
      const detail: Record<string, string | number | boolean> = {};
      for (const field of FIELDS) {
        const value = body[field];
        if (field !== "id" && field !== "accountId" && field !== "sha256" && (typeof value === "boolean" || typeof value === "string")) detail[field] = value;
      }
      for (const [field, value] of Object.entries(answer ?? {})) if (field !== "ok" && (typeof value === "boolean" || typeof value === "number")) detail[field] = value;
      const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null);
      log.record({ at: Date.now(), kind, target, reason: text(body.reason), note: text(body.note), detail });
    });
  }

  /** What an action touched, named the way a person knows it, worked out before the action changes it. */
  function activityTarget(kind: string, body: Record<string, unknown>): ActivityTarget | null {
    const text = (value: unknown) => (typeof value === "string" ? value : null);
    const person = (id: string) => ({ type: "account", id, label: accounts?.profile(id)?.name ?? accounts?.account(id)?.email ?? null });
    if (kind.startsWith("accounts/")) {
      const id = text(body.id);
      return id ? person(id) : null;
    }
    if (kind === "moderation/ban" || kind === "moderation/unban") {
      const sha = text(body.sha256);
      const id = text(body.accountId) ?? (sha ? (catalog?.waitingVersion(sha)?.accountId ?? null) : null);
      return id ? person(id) : null;
    }
    if (kind.startsWith("moderation/")) {
      const sha = text(body.sha256);
      const waiting = sha ? catalog?.waitingVersion(sha) : undefined;
      if (waiting) return { type: "version", id: `${waiting.id}@${waiting.version}`, label: `${waiting.manifest.name} ${waiting.version}` };
      return sha ? { type: "version", id: sha.slice(0, 12), label: null } : null;
    }
    if (kind === "catalog/listed") {
      const id = text(body.id);
      return id ? { type: "module", id, label: catalog?.module(id)?.module.name ?? null } : null;
    }
    if (kind === "messages/start") {
      const id = text(body.accountId);
      return id ? person(id) : null;
    }
    if (kind.startsWith("messages/")) {
      const id = text(body.id);
      return id ? { type: "conversation", id, label: null } : null;
    }
    if (kind === "texts") {
      const key = text(body.key);
      return key ? { type: "text", id: key, label: null } : null;
    }
    if (kind.startsWith("reviews/")) {
      const id = text(body.id);
      return id ? { type: "review", id, label: null } : null;
    }
    if (kind.startsWith("reports/")) {
      const sha = text(body.sha256);
      return sha ? { type: "module", id: sha.slice(0, 12), label: null } : null;
    }
    const id = text(body.id) ?? text(body.sha256);
    return id ? { type: kind.split("/")[0] ?? "other", id: id.length > 64 ? id.slice(0, 12) : id, label: null } : null;
  }

  app.get("/api/activity", (context) => {
    const query = context.req.query();
    const before = Number(query.before);
    const limit = Number(query.limit);
    return context.json(activity?.list({ ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}), ...(Number.isInteger(before) && before > 0 ? { before } : {}), ...(query.kind ? { kind: query.kind } : {}), ...(query.q ? { q: query.q } : {}) }) ?? { entries: [], hasMore: false });
  });

  app.get("/api/overview", (context) => {
    const approved = new Map(state.approvedList().map((icon) => [icon.id, icon]));
    return context.json({
      pending: submissions.listPending(),
      hosted: store.list().map((icon) => ({
        ...icon,
        origin: approved.has(icon.id) ? "approved" : "release",
        source: approved.get(icon.id)?.source ?? null,
        replaceable: icon.open === true,
      })),
    });
  });

  app.get("/api/pending/:file", (context) => {
    const sha = /^([0-9a-f]{64})\.png$/.exec(context.req.param("file"))?.[1];
    const bytes = sha ? state.pendingBytes(sha) : null;
    return bytes ? new Response(bytes, { headers: { "Content-Type": "image/png" } }) : context.json({ error: "Not found." }, 404);
  });

  // Hosted icons are public anyway, so the browser may keep one, but only under
  // an address that names the hash of exactly these bytes.
  app.get("/api/hosted/:file", (context) => {
    const id = /^([a-z0-9-]+)\.png$/.exec(context.req.param("file"))?.[1];
    const bytes = id && isIconId(id) ? store.file(id) : null;
    if (!bytes) return context.json({ error: "Not found." }, 404);
    const kept = context.req.query("v") === createHash("sha256").update(bytes).digest("hex");
    return new Response(bytes, { headers: { "Content-Type": "image/png", ...(kept ? { "Cache-Control": "private, max-age=31536000, immutable" } : {}) } });
  });

  const json = async (request: Request): Promise<Record<string, unknown>> => {
    try {
      const body = JSON.parse(await request.text()) as unknown;
      return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  app.post("/api/approve", async (context) => {
    const { sha256 } = await json(context.req.raw);
    if (typeof sha256 !== "string") return context.json({ error: "Send { sha256 }." }, 400);
    const result = submissions.approve(sha256);
    return result.ok ? context.json({ ok: true, id: result.id }) : context.json({ error: result.error }, 409);
  });

  app.post("/api/deny", async (context) => {
    const { sha256, block } = await json(context.req.raw);
    if (typeof sha256 !== "string") return context.json({ error: "Send { sha256, block }." }, 400);
    return context.json({ ok: submissions.deny(sha256, block === true) });
  });

  // Opens a hosted icon for replacements (users may offer another for its game) or closes it again.
  app.post("/api/replaceable", async (context) => {
    const { id, replaceable } = await json(context.req.raw);
    if (typeof id !== "string" || typeof replaceable !== "boolean") return context.json({ error: "Send { id, replaceable }." }, 400);
    return submissions.setReplaceable(id, replaceable) ? context.json({ ok: true }) : context.json({ error: "No such hosted icon." }, 404);
  });

  app.post("/api/takedown", async (context) => {
    const { id, block } = await json(context.req.raw);
    if (typeof id !== "string") return context.json({ error: "Send { id, block }." }, 400);
    return submissions.takedown(id, block === true) ? context.json({ ok: true }) : context.json({ error: "No such hosted icon." }, 404);
  });

  // With the reports: since when the catalog has been full (C9), or null while there is room.
  // Each report says who reported it while it is open (decided 2026-10-27): the account, its name and the reason and note given.
  const reporter = (accountId: string, reason: string | null, note: string | null, at: number) => ({ accountId, name: accountName(accounts!, accountId), reason, note, at: new Date(at).toISOString() });
  app.get("/api/reports", (context) =>
    context.json({
      reports: (catalog?.reports() ?? []).map((report) => ({ ...report, reporters: accounts ? (catalog?.reporters(report.sha256) ?? []).map((row) => reporter(row.accountId, row.reason, row.note, row.at)) : [] })),
      catalogFullSince: catalog?.fullSince() ?? null,
    }),
  );

  app.post("/api/reports/dismiss", async (context) => {
    const { sha256 } = await json(context.req.raw);
    if (typeof sha256 !== "string") return context.json({ error: "Send { sha256 }." }, 400);
    return catalog?.dismissReport(sha256) ? context.json({ ok: true }) : context.json({ error: "No such report." }, 404);
  });

  // Unpublish takes a reason and a note, and tells the developer by email; Publish takes neither.
  const notifier = accounts && moderation?.mailer ? createNotifier({ store: accounts, mailer: moderation.mailer, ...(moderation.mailDailyLimit === undefined ? {} : { mailDailyLimit: moderation.mailDailyLimit }), ...(moderation.now ? { now: moderation.now } : {}) }) : null;
  app.post("/api/catalog/listed", async (context) => {
    const { id, listed, reason, note } = await json(context.req.raw);
    const text = note === undefined || note === null ? null : typeof note === "string" ? note.trim() || null : undefined;
    if (typeof id !== "string" || typeof listed !== "boolean" || (reason !== undefined && !isUnpublishReason(reason)) || text === undefined || (text !== null && text.length > 500)) {
      return context.json({ error: `Send { id, listed, reason?, note? } with reason one of ${UNPUBLISH_REASONS.join(", ")} and a note of at most 500 characters.` }, 400);
    }
    const found = catalog?.adminModules().find((module) => module.id === id) ?? null;
    if (!catalog?.setListed(id, listed)) return context.json({ error: "No such module." }, 404);
    let mailed = false;
    if (!listed && reason !== undefined && notifier) {
      const owner = catalog.accountOfModule(id) ?? (found ? (accounts?.accountOfKey(found.owner) ?? null) : null);
      const to = owner ? accounts?.account(owner)?.email : undefined;
      if (to && owner) mailed = await notifier.send(unpublishedMail(to, { id, name: found?.name ?? id }, reason, text, mailLanguage(catalog.languageOf(owner))));
    }
    return context.json({ ok: true, ...(!listed && reason !== undefined ? { mailed } : {}) });
  });

  // Reported reviews, with what helps judge them: the module, the stars, the text and its reply.
  app.get("/api/reviews", (context) =>
    context.json({
      reports: (reviews?.reports() ?? []).map(({ review, count, firstAt, lastAt }) => ({
        count,
        reporters: accounts ? (reviews?.reporters(review.id) ?? []).map((row) => reporter(row.accountId, null, null, row.at)) : [],
        firstAt: new Date(firstAt).toISOString(),
        lastAt: new Date(lastAt).toISOString(),
        review: {
          id: review.id,
          moduleId: review.moduleId,
          moduleName: catalog?.module(review.moduleId)?.module.name ?? review.moduleId,
          stars: review.stars,
          text: review.text,
          version: review.version,
          hidden: review.hidden,
          author: accounts?.profile(review.accountId)?.name ?? null,
          reply: review.reply?.text ?? null,
        },
      })),
    }),
  );

  // Reviews that wait for you: held by the word filter, or live and not looked at yet. Approve lets a held one through,
  // Seen clears the new ones, Hide takes the text off (the stars stay) and Remove takes the whole rating away.
  app.get("/api/reviews/queue", (context) =>
    context.json({
      queue: (reviews?.queue() ?? []).map((review) => ({
        id: review.id,
        held: review.held,
        capped: review.capped,
        moduleId: review.moduleId,
        moduleName: catalog?.module(review.moduleId)?.module.name ?? review.moduleId,
        stars: review.stars,
        text: review.text,
        version: review.version,
        hidden: review.hidden,
        author: accounts?.profile(review.accountId)?.name ?? null,
        authorId: review.accountId,
        at: new Date(review.updatedAt).toISOString(),
        reply: review.reply?.text ?? null,
      })),
    }),
  );

  // Every rating and review of one module for its detail view (#345): held and hidden ones too, with the author, the state,
  // how often it was reported, and the module's public summary (held ratings don't count there). The dates let the panel
  // draw the average over time. 404 for a module the catalog doesn't know and nobody rated.
  app.get("/api/modules/:id/reviews", (context) => {
    const id = context.req.param("id");
    const all = reviews?.byModule(id) ?? [];
    const name = catalog?.module(id)?.module.name ?? catalog?.adminModules().find((module) => module.id === id)?.name ?? null;
    if (!name && !all.length) return context.json({ error: "No such module." }, 404);
    const reported = new Map((reviews?.reports() ?? []).map((report) => [report.review.id, report.count]));
    return context.json({
      module: { id, name: name ?? id },
      summary: reviews?.summary(id) ?? null,
      reviews: all.map((review) => ({
        id: review.id,
        stars: review.stars,
        text: review.text,
        version: review.version,
        hidden: review.hidden,
        held: review.held,
        capped: review.capped,
        seen: review.seen,
        reports: reported.get(review.id) ?? 0,
        author: accounts?.profile(review.accountId)?.name ?? null,
        authorId: review.accountId,
        createdAt: new Date(review.createdAt).toISOString(),
        updatedAt: new Date(review.updatedAt).toISOString(),
        reply: review.reply ? { text: review.reply.text, at: new Date(review.reply.updatedAt).toISOString() } : null,
      })),
    });
  });

  app.post("/api/reviews/approve", async (context) => {
    const { id } = await json(context.req.raw);
    if (typeof id !== "string") return context.json({ error: "Send { id }." }, 400);
    return reviews?.approve(id) ? context.json({ ok: true }) : context.json({ error: "That review isn't held." }, 404);
  });

  app.post("/api/reviews/seen", async (context) => {
    const { ids } = await json(context.req.raw);
    if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== "string")) return context.json({ error: "Send { ids: up to 200 review ids }." }, 400);
    return context.json({ ok: true, marked: reviews?.markSeen(ids as string[]) ?? 0 });
  });

  app.post("/api/reviews/remove", async (context) => {
    const { id } = await json(context.req.raw);
    if (typeof id !== "string") return context.json({ error: "Send { id }." }, 400);
    return reviews?.remove(id) ? context.json({ ok: true }) : context.json({ error: "No such review." }, 404);
  });

  app.post("/api/reviews/hidden", async (context) => {
    const { id, hidden } = await json(context.req.raw);
    if (typeof id !== "string" || typeof hidden !== "boolean") return context.json({ error: "Send { id, hidden }." }, 400);
    return reviews?.setHidden(id, hidden) ? context.json({ ok: true }) : context.json({ error: "No such review." }, 404);
  });

  app.post("/api/reviews/dismiss", async (context) => {
    const { id } = await json(context.req.raw);
    if (typeof id !== "string") return context.json({ error: "Send { id }." }, 400);
    return reviews?.dismissReport(id) ? context.json({ ok: true }) : context.json({ error: "No such report." }, 404);
  });

  // Key replacements: each request with what helps judge it, and the entries to sign next.
  const trust = () => (catalog ? catalogTrust(catalog, catalogueKey) : null);
  app.get("/api/keys", (context) => {
    const lists = trust();
    const requests = (accounts?.allKeyRequests() ?? []).map((request) => {
      const linkedAt = accounts?.keyLinkedAt(request.new) ?? null;
      return {
        old: request.old,
        new: request.new,
        account: request.accountId,
        email: accounts?.account(request.accountId)?.email ?? null,
        developer: accounts?.developer(request.accountId)?.name ?? null,
        leaked: request.leaked,
        requestedAt: new Date(request.requestedAt).toISOString(),
        newLinkedAt: linkedAt === null ? null : new Date(linkedAt).toISOString(),
        status: keyRequestStatus(request, lists),
      };
    });
    return context.json({ requests });
  });

  // As files for `pnpm tavora-catalog-sign successions|revocations <file> --key … --out …`: every entry in force, plus the waiting ones.
  for (const kind of ["successions", "revocations"] as const) {
    app.get(`/api/keys/${kind}.json`, (context) => {
      const entries = !accounts ? [] : kind === "successions" ? successionEntries(accounts, trust()) : revocationEntries(accounts, trust(), catalog);
      return new Response(`${JSON.stringify(entries, null, 2)}\n`, { headers: { "Content-Type": "application/json; charset=utf-8" } });
    });
  }

  app.post("/api/keys/decline", async (context) => {
    const { old } = await json(context.req.raw);
    if (typeof old !== "string") return context.json({ error: "Send { old }." }, 400);
    return accounts?.declineKeyRequest(old, Date.now()) ? context.json({ ok: true }) : context.json({ error: "No open request for this key." }, 404);
  });

  // Block from the panel: blocks to sign, and the file to sign them (block-admin.ts).
  if (catalog) app.route("/api/blocks", blockRoutes({ catalog, trust }));

  registerPanelRoutes(app, {
    submissions,
    store,
    catalog,
    accounts,
    reviews,
    conversations,
    probes: probes ?? createProbes(),
    leaderboardsWaiting: () => {
      const allowed = new Set(leaderboards?.allowedModules().map((entry) => entry.moduleId));
      return (catalog?.adminModules() ?? []).filter((module) => module.leaderboards !== null && !allowed.has(module.id)).length;
    },
    blocksToSign: () => (catalog ? blocksToSign(catalog, trust()).length : 0),
    keysWaiting: () => (accounts?.allKeyRequests() ?? []).filter((request) => keyRequestStatus(request, trust()) === "waiting").length,
    dataset: dataset ?? (() => ({ games: 0, builtAt: null })),
    mailDailyLimit,
    stateDir,
  });

  // Daily totals for charts: ?days=<1-730> ending today (default 30), or ?from=YYYY-MM-DD&to=YYYY-MM-DD (UTC days).
  app.get("/api/stats", (context) => {
    if (!stats) return context.json({ error: "Counting is off." }, 503);
    const range = statsRange(context.req.query(), Date.now());
    if (!range) return context.json({ error: "Ask for ?days=1-730 or ?from=&to= as YYYY-MM-DD." }, 400);
    return context.json({ ...range, ...stats.series(range.from, range.to) });
  });
  // The games users asked a module for, most votes first (module-requests.ts).
  app.get("/api/module-requests", (context) => {
    if (!moduleRequests) return context.json({ error: "Module requests are off." }, 503);
    return context.json({ requests: moduleRequests.ranked() });
  });
  // Approval: versions waiting for review, Approve, Decline, Ban, and the one-time check of what is live (moderation-admin.ts).
  if (catalog && accounts) app.route("/api/moderation", moderationRoutes({ catalog, accounts, ...moderation, ownerEmail, lifecycle }));

  // Messages (conversations-admin.ts): Tavora's own conversations and the reported ones, and the editable texts.
  if (conversations && accounts) {
    const conversationNotifier = notifier && catalog ? createConversationNotifier({ conversations, accounts, catalog, notifier }) : undefined;
    app.route("/api/messages", conversationsAdminRoutes({ conversations, accounts, catalog, notifier: conversationNotifier, now: moderation?.now }));
    app.route("/api/texts", textsAdminRoutes({ conversations }));
  }

  // Leaderboards (leaderboards.ts): which catalog modules may use them, and the names hidden on every board.
  if (leaderboards && accounts) app.route("/api/leaderboards", leaderboardsAdminRoutes({ leaderboards, accounts, now: moderation?.now }));

  // The account list and Suspend (accounts-admin.ts). The counts at GET /api/accounts stay in admin-panel.ts.
  if (accounts) app.route("/api/accounts", accountsAdminRoutes({ accounts, catalog, reviews, copies, mailer: moderation?.mailer, mailDailyLimit: moderation?.mailDailyLimit, ownerEmail, now: moderation?.now, lifecycle }));

  app.notFound((context) => context.json({ error: "Not found." }, 404));
  app.onError((error, context) => {
    console.error(`[tavora-api admin] ${error instanceof Error ? error.message : "unknown error"}`);
    return context.json({ error: "Something went wrong." }, 500);
  });
  return app;
}
