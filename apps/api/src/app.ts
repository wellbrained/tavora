import type { DatabaseSync } from "node:sqlite";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { accountRoutes, type AccountOptions } from "./accounts.ts";
import { publishHandlers, type PublishLimits } from "./catalog-publish.ts";
import type { Scanner } from "./virus-scan.ts";
import { reportHandlers } from "./catalog-report.ts";
import { copyRoutes } from "./cloud-copy.ts";
import { pairingRoutes } from "./pairing.ts";
import { reviewRoutes, type ReviewStore } from "./reviews.ts";
import { conversationRoutes, createConversationNotifier, publicContact } from "./conversations.ts";
import { leaderboardRoutes } from "./leaderboards.ts";
import { createNotifier } from "./moderation-mail.ts";
import { vaultRoutes } from "./vault.ts";
import { catalogFilter, isOfficialId, isSignedList, type CatalogEntry, type CatalogStore } from "./catalog.ts";
import { isBot, parseVisit, referrerDomain, SITE_CLICKS, SITE_ORIGIN, UNKNOWN_COUNTRY } from "./site-visits.ts";
import { isAppVersion, type StatsStore } from "./stats.ts";
import { catalogTrust, OFFICIAL_PINS, type OfficialPins } from "./catalog-trust.ts";
import { publisherRoutes } from "./publishers.ts";
import { ICON_NOTICE, isIconId, NO_ICONS, type IconStore } from "./icons.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { fail, signedInAs, signedOut, tooMany } from "./sign-in.ts";
import { MAX_UPLOAD_BODY, type Submissions } from "./submissions.ts";
import { DEFAULT_LIMIT, MAX_LIMIT, MAX_QUERY_LENGTH, searchGames } from "./search.ts";
import { MAX_PROFILE_LENGTH, SteamError, type SteamClient } from "./steam.ts";

/** A Steam import body is `{ "profile": <at most MAX_PROFILE_LENGTH characters> }`; nothing bigger is read. */
const STEAM_BODY = 1000;
/** A site visit is `{ referrer }` or `{ click }`; nothing bigger is read. */
const SITE_BODY = 2000;

export interface AppOptions {
  db: DatabaseSync;
  /** Which client a request is from; the server derives it from the connection. */
  clientKey?: (request: Request) => string;
  rateLimiter?: RateLimiter;
  /** Absent when the service has no Steam key: the import answers 503. */
  steam?: SteamClient;
  steamRateLimiter?: RateLimiter;
  /** The hosted game icons. */
  icons?: IconStore;
  /**
   * Where a publisher sends a request to remove an icon. Icons are only served
   * while this is set, so no icon is ever offered without a way to object.
   */
  takedownContact?: string;
  /** Icons offered by users. Absent: the offer route answers 503. */
  submissions?: Submissions;
  submitRateLimiter?: RateLimiter;
  /** Accounts, only when the service can send email. Absent: the account routes answer 503. */
  accounts?: AccountOptions;
  /** The module catalog. Absent: the catalog routes answer 503. */
  catalog?: CatalogStore;
  /** Publishing: uploads per client, and the catalog's size limits. Publishing also needs accounts. */
  publishRateLimiter?: RateLimiter;
  publishLimits?: Partial<PublishLimits>;
  /** The virus scanner of the checks every new version runs. Without one, every new version waits for review. */
  scanner?: Scanner;
  /** The catalogue public key uploads check the signed lists against; CATALOGUE_PUBLIC_KEY by default. */
  catalogueKey?: string;
  /** The pinned publisher key and account for Tavora's own modules (`tavora.*`); OFFICIAL_PINS by default, empty means none are accepted. */
  officialPins?: OfficialPins;
  /** Reports per client. */
  reportRateLimiter?: RateLimiter;
  /** Who is told by email when the catalog is full (needs accounts' mailer). */
  maintainerEmail?: string;
  /** Ratings, replies and review reports written per client. */
  reviewRateLimiter?: RateLimiter;
  /** Conversation messages and settings written per client. */
  conversationRateLimiter?: RateLimiter;
  /** Leaderboard writes per account and module. */
  leaderboardRateLimiter?: RateLimiter;
  /** Plain daily totals (stats.ts). Absent: nothing is counted. */
  stats?: StatsStore;
  /** The country of a request, for site visits (site-visits.ts). Absent or null: counted as unknown. */
  countryOf?: (request: Request) => string | null;
  /** Site visits per client (site-visits.ts). */
  siteRateLimiter?: RateLimiter;
}

/** Why an icon offer was refused, by its status. */
const SUBMIT_REASONS = { 400: "bad-request", 409: "has-icon", 413: "too-big", 429: "too-many", 503: "unavailable" } as const;

/** A Steam import refusal: the English message and its reason code. */
const steamFail = (context: Context, status: ContentfulStatusCode, reason: string, error: string) => context.json({ error, reason }, status);

export function createApp({ db, clientKey, rateLimiter, steam, steamRateLimiter, icons = NO_ICONS, takedownContact, submissions, submitRateLimiter, accounts, catalog, publishRateLimiter, publishLimits, scanner, catalogueKey, officialPins = OFFICIAL_PINS, reportRateLimiter, maintainerEmail, reviewRateLimiter, conversationRateLimiter, leaderboardRateLimiter, stats, countryOf, siteRateLimiter }: AppOptions) {
  const limiter = rateLimiter ?? createRateLimiter({ limit: 60, windowMs: 60_000 });
  // Enough for a whole Steam library in one sitting; the review queue's own cap (MAX_PENDING) still stops a flood.
  const submitLimiter = submitRateLimiter ?? createRateLimiter({ limit: 100, windowMs: 3_600_000 });
  const steamLimiter = steamRateLimiter ?? createRateLimiter({ limit: 6, windowMs: 60_000 });
  const siteLimiter = siteRateLimiter ?? createRateLimiter({ limit: 30, windowMs: 60_000 });
  const app = new Hono();

  // Steam appid -> canonical id, loaded the first time an import asks.
  let idByAppid: Map<number, string> | undefined;
  const canonicalIds = () => {
    idByAppid ??= new Map(
      (db.prepare("select steam_appid as appid, id from games where steam_appid is not null").all() as unknown as {
        appid: number;
        id: string;
      }[]).map(({ appid, id }) => [appid, id]),
    );
    return idByAppid;
  };

  // The query is what a user typed: never cached, never logged here. Only the
  // hosted icons, which are the same for everyone, say otherwise themselves.
  app.use("*", async (context, next) => {
    await next();
    if (!context.res.headers.has("Cache-Control")) context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
  });

  app.get("/v1/health", (context) => {
    const meta = Object.fromEntries(
      (db.prepare("select key, value from meta").all() as unknown as { key: string; value: string }[]).map(
        ({ key, value }) => [key, value],
      ),
    );
    return context.json({ ok: true, games: Number(meta.games ?? 0), builtAt: meta.built_at ?? null });
  });

  app.get("/v1/games/search", (context) => {
    const wait = limiter.check(clientKey ? clientKey(context.req.raw) : "local");
    if (wait > 0) return tooMany(context, wait);
    const q = context.req.query("q") ?? "";
    if (q.length > MAX_QUERY_LENGTH) return fail(context, 400, "bad-request", "Query too long.");

    const rawLimit = context.req.query("limit");
    const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return fail(context, 400, "bad-request", `limit must be a whole number from 1 to ${MAX_LIMIT}.`);
    }
    return context.json({ results: searchGames(db, q, limit) });
  });

  // Hosted game icons: a list of what exists, then the files. The app downloads
  // only the ones it needs, so the service never learns a user's library.
  const iconsAvailable = Boolean(takedownContact?.trim());
  app.get("/v1/icons", (context) => {
    const wait = limiter.check(clientKey ? clientKey(context.req.raw) : "local");
    if (wait > 0) return tooMany(context, wait);
    if (!iconsAvailable) return fail(context, 503, "unavailable", "Icons are not available right now.");
    context.header("Cache-Control", "public, max-age=300");
    return context.json({ notice: ICON_NOTICE, takedown: takedownContact!.trim(), icons: icons.list() });
  });

  app.get("/v1/icons/:file", (context) => {
    const wait = limiter.check(clientKey ? clientKey(context.req.raw) : "local");
    if (wait > 0) return tooMany(context, wait);
    const match = /^([a-z0-9-]+)\.png$/.exec(context.req.param("file"));
    const bytes = iconsAvailable && match && isIconId(match[1]) ? icons.file(match[1]) : null;
    if (!bytes) return fail(context, 404, "not-found", "Not found.");
    return new Response(bytes, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
    });
  });

  // A signed-in user offers an icon their PC has and the service lacks. It is
  // checked, cleaned and queued; nothing is served until a person approves it.
  // JSON only, which a web page on another site cannot send without a preflight
  // this service refuses. The account is kept with the offer until it is reviewed.
  app.post(
    "/v1/icons/submit",
    bodyLimit({ maxSize: MAX_UPLOAD_BODY + 2000, onError: (context) => fail(context, 413, "too-big", "That icon is too big.") }),
    async (context) => {
      const wait = submitLimiter.check(clientKey ? clientKey(context.req.raw) : "local");
      if (wait > 0) return tooMany(context, wait);
      if (!iconsAvailable || !submissions || !accounts) return fail(context, 503, "unavailable", "Sharing icons is not available right now.");
      const signedIn = signedInAs(accounts.store, context, (accounts.now ?? Date.now)());
      if (!signedIn) return signedOut(context);
      const session = signedIn.session;
      if (!(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return fail(context, 415, "bad-request", "Send JSON.");
      }
      let body: unknown;
      try {
        body = JSON.parse(await context.req.text());
      } catch {
        return fail(context, 400, "bad-request", "Send { id, name, source, icon }.");
      }
      const result = submissions.submit(body, session.accountId);
      if (result.status === 202) return context.json({ status: "received" }, 202);
      return fail(context, result.status, SUBMIT_REASONS[result.status], result.error);
    },
  );

  // Steam import. POST, so the profile is in no URL; JSON only, which a web
  // page on another site cannot send without a preflight this service refuses.
  app.post("/v1/steam/library", bodyLimit({ maxSize: STEAM_BODY, onError: (context) => steamFail(context, 413, "bad-request", "Send { \"profile\": a Steam profile link or SteamID64 }.") }), async (context) => {
    const wait = steamLimiter.check(clientKey ? clientKey(context.req.raw) : "local");
    if (wait > 0) return tooMany(context, wait);
    if (!steam) return steamFail(context, 503, "unavailable", "Steam import is not available right now.");
    if (!(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return steamFail(context, 415, "bad-request", "Send JSON.");
    }
    const text = await context.req.text();
    let profile: unknown;
    try {
      profile = text.length <= STEAM_BODY ? (JSON.parse(text) as { profile?: unknown }).profile : undefined;
    } catch {
      profile = undefined;
    }
    if (typeof profile !== "string" || profile.length === 0 || profile.length > MAX_PROFILE_LENGTH) {
      return steamFail(context, 400, "bad-request", "Send { \"profile\": a Steam profile link or SteamID64 }.");
    }
    try {
      const ids = canonicalIds();
      const owned = await steam.ownedGames(profile);
      return context.json({ games: owned.map((game) => ({ appid: game.appid, name: game.name, id: ids.get(game.appid) ?? null })) });
    } catch (error) {
      if (error instanceof SteamError) return steamFail(context, error.status, error.code, error.message);
      throw error;
    }
  });

  // The module catalog, read-only and without sign-in. The app takes the whole index (for a game, or
  // all of it) and decides on the PC what to update, so it never sends what a user has installed (C11).
  // "by <name>" comes from the account the key is linked to, never from the listing (C13).
  // `installs` counts installs from Browse (POST /installed), never who installed.
  // Its rating is every version's ratings together; the app shows "New" below MIN_RATINGS_SHOWN.
  const ratings = accounts?.reviews;
  const listed = (entry: CatalogEntry, summaries?: ReturnType<ReviewStore["summaries"]>) => ({
    ...entry,
    publisher: accounts?.store.publisherName(entry.owner) ?? null,
    installs: catalog?.installCount(entry.id) ?? 0,
    rating: (summaries ? summaries.get(entry.id) : ratings?.summary(entry.id)) ?? null,
  });
  const catalogApp = new Hono();
  // Publishing has its own limits per client and per account, so it comes before the read limiter.
  const publish = publishHandlers({
    catalog,
    store: accounts?.store,
    clientKey: (request) => (clientKey ? clientKey(request) : "local"),
    ...(publishRateLimiter ? { rateLimiter: publishRateLimiter } : {}),
    ...(publishLimits ? { limits: publishLimits } : {}),
    ...(scanner ? { scanner } : {}),
    ...(catalogueKey ? { catalogueKey } : {}),
    officialPins,
    ...(accounts?.now ? { now: accounts.now } : {}),
    ...(accounts ? { mail: { mailer: accounts.mailer, ...(accounts.mailDailyLimit === undefined ? {} : { mailDailyLimit: accounts.mailDailyLimit }) } } : {}),
    ...(accounts && maintainerEmail?.trim()
      ? { maintainer: { email: maintainerEmail.trim(), mailer: accounts.mailer, ...(accounts.mailDailyLimit === undefined ? {} : { mailDailyLimit: accounts.mailDailyLimit }) } }
      : {}),
  });
  catalogApp.post("/publish", publish.limit, publish.handler);
  // The developer's own versions waiting for review, and taking one back.
  catalogApp.get("/waiting", publish.waiting);
  catalogApp.delete("/waiting/:sha256", publish.withdraw);
  const report = reportHandlers({
    catalog,
    accounts,
    clientKey: (request) => (clientKey ? clientKey(request) : "local"),
    ...(reportRateLimiter ? { rateLimiter: reportRateLimiter } : {}),
    ...(accounts?.now ? { now: accounts.now } : {}),
  });
  catalogApp.post("/report", report.limit, report.handler);
  catalogApp.use("*", async (context, next) => {
    const wait = limiter.check(clientKey ? clientKey(context.req.raw) : "local");
    if (wait > 0) return tooMany(context, wait);
    if (!catalog) return fail(context, 503, "unavailable", "The module catalog is not available right now.");
    await next();
  });
  // Tavora's own modules take no ratings, reviews, reports or messages.
  catalogApp.all("/modules/:id/:what", async (context, next) => {
    if (isOfficialId(context.req.param("id")) && ["review", "reviews", "contact"].includes(context.req.param("what"))) return fail(context, 404, "not-found", "Not found.");
    await next();
  });
  catalogApp.get("/", (context) => {
    const filter = catalogFilter(context.req.query("game"), context.req.query("personal"), context.req.query("workspace"));
    if (!filter) return fail(context, 400, "bad-request", "Ask for ?game=<game id>, ?personal=1 or neither.");
    context.header("Cache-Control", "public, max-age=300");
    const summaries = ratings?.summaries();
    // Tavora's own modules are for the app's own update check only: asked for with ?include=official, never in the public index.
    const official = context.req.query("include") === "official";
    return context.json({ modules: catalog!.index(filter, { official }).map((entry) => listed(entry, summaries ?? new Map())) });
  });
  catalogApp.get("/modules/:id", (context) => {
    const found = catalog!.module(context.req.param("id"));
    if (!found) return fail(context, 404, "not-found", "Not found.");
    context.header("Cache-Control", "public, max-age=300");
    // Tavora's own modules have no developer to write to.
    const contact = accounts?.conversations && !isOfficialId(found.module.id) ? publicContact(accounts.conversations, accounts.store, found.module.id, found.module.owner) : undefined;
    return context.json({ module: { ...listed(found.module), ...(contact ? { contact } : {}) }, versions: found.versions, readme: found.readme });
  });
  // Sent once by the app after a user installed a module from Browse: only the module id.
  catalogApp.post("/installed", async (context) => {
    const body = (await context.req.json().catch(() => null)) as { id?: unknown } | null;
    const id = typeof body?.id === "string" && body.id.length <= 200 ? body.id : null;
    if (!id || !catalog!.countInstall(id)) return fail(context, 404, "not-found", "Not found.");
    stats?.count("module-install", id);
    return context.body(null, 204);
  });
  // Sent once by the app after a module from the catalog was updated: only the module id.
  catalogApp.post("/updated", async (context) => {
    const body = (await context.req.json().catch(() => null)) as { id?: unknown } | null;
    const id = typeof body?.id === "string" && body.id.length <= 200 ? body.id : null;
    if (!id || !catalog!.isListed(id)) return fail(context, 404, "not-found", "Not found.");
    stats?.count("module-update", id);
    return context.body(null, 204);
  });
  catalogApp.get("/zips/:file", (context) => {
    const match = /^([0-9a-f]{64})\.zip$/.exec(context.req.param("file"));
    const bytes = match ? catalog!.zip(match[1]!) : null;
    if (!bytes) return fail(context, 404, "not-found", "Not found.");
    // Named by its hash, so it never changes.
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": "attachment", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  });
  catalogApp.get("/pictures/:file", (context) => {
    const match = /^([0-9a-f]{64})\.(png|webp)$/.exec(context.req.param("file"));
    const bytes = match ? catalog!.picture(match[1]!, match[2]!) : null;
    if (!bytes) return fail(context, 404, "not-found", "Not found.");
    // Checked to be a picture when it was uploaded (C10) and named by its hash, so it never changes.
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": `image/${match![2]}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });
  // The signed lists, byte for byte as tavora-catalog-sign wrote them. Short caching, so a revocation
  // or a blocked zip reaches users soon; the app refuses a list older than the one it has.
  catalogApp.get("/lists/:file", (context) => {
    const match = /^([a-z]+)\.json$/.exec(context.req.param("file"));
    const bytes = match && isSignedList(match[1]!) ? catalog!.list(match[1]) : null;
    if (!bytes) return fail(context, 404, "not-found", "Not found.");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
  });
  // Ratings and reviews (reviews.ts): reading is open, rating and replying need a sign-in.
  if (ratings && catalog && accounts) {
    catalogApp.route(
      "/",
      reviewRoutes({
        reviews: ratings,
        catalog,
        accounts: accounts.store,
        clientKey: (request) => (clientKey ? clientKey(request) : "local"),
        ...(reviewRateLimiter ? { writeRateLimiter: reviewRateLimiter } : {}),
        ...(accounts.now ? { now: accounts.now } : {}),
      }),
    );
  } else {
    const off = (context: Context) => context.json({ error: "Ratings are not available right now.", reason: "unavailable" }, 503);
    catalogApp.all("/modules/:id/review", off).all("/modules/:id/reviews", off).all("/reviews/*", off);
  }
  // Conversations (conversations.ts): the developer's contact settings under /v1/catalog, the user routes, and the editable texts.
  const talk = accounts?.conversations;
  if (talk && catalog && accounts) {
    const notifier = createConversationNotifier({
      conversations: talk,
      accounts: accounts.store,
      catalog,
      notifier: createNotifier({ store: accounts.store, mailer: accounts.mailer, ...(accounts.mailDailyLimit === undefined ? {} : { mailDailyLimit: accounts.mailDailyLimit }), ...(accounts.now ? { now: accounts.now } : {}) }),
    });
    const routes = conversationRoutes({
      conversations: talk,
      catalog,
      accounts: accounts.store,
      clientKey: (request) => (clientKey ? clientKey(request) : "local"),
      notifier,
      ...(conversationRateLimiter ? { writeRateLimiter: conversationRateLimiter } : {}),
      ...(accounts.now ? { now: accounts.now } : {}),
    });
    catalogApp.route("/", routes.contact);
    app.route("/v1/conversations", routes.user);
    app.route("/v1/texts", routes.texts);
  } else {
    const off = (context: Context) => context.json({ error: "Messages are not available right now.", reason: "unavailable" }, 503);
    app.all("/v1/conversations", off).all("/v1/conversations/*", off).all("/v1/texts", off);
    catalogApp.all("/modules/:id/contact", off);
  }
  app.route("/v1/catalog", catalogApp);

  // Leaderboards (leaderboards.ts): a catalog module's boards are the ones its newest listed version declares.
  if (accounts?.leaderboards) {
    app.route(
      "/v1/leaderboards",
      leaderboardRoutes({
        leaderboards: accounts.leaderboards,
        accounts: accounts.store,
        boards: (moduleId) => catalog?.previousListed(moduleId)?.manifest.leaderboards?.boards ?? null,
        clientKey: (request) => (clientKey ? clientKey(request) : "local"),
        ...(leaderboardRateLimiter ? { writeRateLimiter: leaderboardRateLimiter } : {}),
        ...(accounts.now ? { now: accounts.now } : {}),
      }),
    );
  } else app.all("/v1/leaderboards/*", (context) => context.json({ error: "Leaderboards are not available right now.", reason: "unavailable" }, 503));

  // Accounts: the only user data the service keeps, and only once it can send email.
  // The cloud copy first: its bodies are bigger than the account routes allow, and it has its own limits.
  if (accounts?.copies) app.route("/v1/account/copy", copyRoutes({ copies: accounts.copies, accounts: accounts.store, clientKey: (request) => (clientKey ? clientKey(request) : "local"), ...(accounts.now ? { now: accounts.now } : {}) }));
  else app.all("/v1/account/copy", (context) => context.json({ error: "The cloud copy is not available right now.", reason: "unavailable" }, 503)).all("/v1/account/copy/*", (context) => context.json({ error: "The cloud copy is not available right now.", reason: "unavailable" }, 503));
  if (accounts) app.route("/v1/account/vault", vaultRoutes({ accounts: accounts.store, clientKey: (request) => (clientKey ? clientKey(request) : "local"), ...(accounts.now ? { now: accounts.now } : {}) }));
  if (accounts) app.route("/v1/account/pairing", pairingRoutes({ accounts: accounts.store, clientKey: (request) => (clientKey ? clientKey(request) : "local"), ...(accounts.now ? { now: accounts.now } : {}) }));
  if (accounts) app.route("/v1/account", accountRoutes({ ...(catalog ? { trust: catalogTrust(catalog, catalogueKey), catalog } : {}), officialPins, ...accounts }, limiter, (request) => (clientKey ? clientKey(request) : "local")));
  else app.all("/v1/account/*", (context) => context.json({ error: "Accounts are not available right now.", reason: "unavailable" }, 503));
  // Publisher keys belong to accounts, so they come and go with them.
  if (accounts) app.route("/v1/publishers", publisherRoutes({ store: accounts.store, officialPins, ...(accounts.verifyRateLimiter ? { linkRateLimiter: accounts.verifyRateLimiter } : {}), ...(accounts.now ? { now: accounts.now } : {}) }, limiter, (request) => (clientKey ? clientKey(request) : "local")));
  else app.all("/v1/publishers/*", (context) => context.json({ error: "Publishers are not available right now.", reason: "unavailable" }, 503));

  // Sent once by the app when a new Tavora version finished downloading: only the version.
  app.post("/v1/app/updated", async (context) => {
    const wait = limiter.check(clientKey ? clientKey(context.req.raw) : "local");
    if (wait > 0) return tooMany(context, wait);
    const body = (await context.req.json().catch(() => null)) as { version?: unknown } | null;
    if (!isAppVersion(body?.version)) return fail(context, 400, "bad-request", "Send { version }.");
    stats?.count("app-update", body.version);
    return context.body(null, 204);
  });

  // Called by the update feed's web server for every installer download that starts (Caddy forward_auth,
  // apps/desktop/deploy/tavora-updates.caddy), never through the public address (api.mytavora.app answers
  // 404 for /internal/). It reads the version from the file name and answers 204 whatever happens, so the
  // download goes on; nothing about the request is kept.
  app.get("/internal/installer-download", (context) => {
    const version = /^\/Tavora-Setup-([0-9.]+)\.exe$/.exec(context.req.header("x-forwarded-uri") ?? "")?.[1];
    if (isAppVersion(version)) stats?.count("app-installer", version);
    return context.body(null, 204);
  });

  // Sent by mytavora.app when the page opens ({ referrer }) and when a tracked link is clicked ({ click }).
  // Always 204, so the page never waits or learns anything. Only calls from the site itself are counted, and not
  // from programs that say they are one. Nothing about the request is kept (site-visits.ts).
  app.post("/v1/site/visit", bodyLimit({ maxSize: SITE_BODY, onError: (context) => context.body(null, 413) }), async (context) => {
    context.header("Access-Control-Allow-Origin", SITE_ORIGIN);
    if (!stats || context.req.header("origin") !== SITE_ORIGIN || isBot(context.req.header("user-agent"))) return context.body(null, 204);
    if (siteLimiter.check(clientKey ? clientKey(context.req.raw) : "local") > 0) return context.body(null, 204);
    const body = parseVisit(await context.req.text());
    if (body?.click !== undefined) {
      if ((SITE_CLICKS as readonly unknown[]).includes(body.click)) stats.count("site-click", body.click as string);
    } else if (body) {
      const from = referrerDomain(body.referrer);
      if (from !== null) {
        stats.count("site-view", from);
        stats.count("site-country", countryOf?.(context.req.raw) ?? UNKNOWN_COUNTRY);
      }
    }
    return context.body(null, 204);
  });

  app.notFound((context) => fail(context, 404, "not-found", "Not found."));
  app.onError((error, context) => {
    // Never include the request: it holds what the user typed.
    console.error(`[tavora-api] ${error instanceof Error ? error.message : "unknown error"}`);
    return fail(context, 500, "internal", "Something went wrong.");
  });
  return app;
}
