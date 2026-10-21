import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { accountRoutes, type AccountOptions } from "./accounts.ts";
import { publishHandlers, type PublishLimits } from "./catalog-publish.ts";
import { reportHandlers } from "./catalog-report.ts";
import { copyRoutes } from "./cloud-copy.ts";
import { pairingRoutes } from "./pairing.ts";
import { vaultRoutes } from "./vault.ts";
import { catalogFilter, isSignedList, type CatalogEntry, type CatalogStore } from "./catalog.ts";
import { catalogTrust } from "./catalog-trust.ts";
import { publisherRoutes } from "./publishers.ts";
import { ICON_NOTICE, isIconId, NO_ICONS, type IconStore } from "./icons.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { MAX_UPLOAD_BODY, type Submissions } from "./submissions.ts";
import { DEFAULT_LIMIT, MAX_LIMIT, MAX_QUERY_LENGTH, searchGames } from "./search.ts";
import { MAX_PROFILE_LENGTH, SteamError, type SteamClient } from "./steam.ts";

/** A Steam import body is `{ "profile": <at most MAX_PROFILE_LENGTH characters> }`; nothing bigger is read. */
const STEAM_BODY = 1000;

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
  /** Icons offered by players. Absent: the offer route answers 503. */
  submissions?: Submissions;
  submitRateLimiter?: RateLimiter;
  /** Accounts, only when the service can send email. Absent: the account routes answer 503. */
  accounts?: AccountOptions;
  /** The module catalog. Absent: the catalog routes answer 503. */
  catalog?: CatalogStore;
  /** Publishing: uploads per client, and the catalog's size limits. Publishing also needs accounts. */
  publishRateLimiter?: RateLimiter;
  publishLimits?: Partial<PublishLimits>;
  /** The catalogue public key uploads check the signed lists against; CATALOGUE_PUBLIC_KEY by default. */
  catalogueKey?: string;
  /** Reports per client. */
  reportRateLimiter?: RateLimiter;
  /** Who is told by email when the catalog is full (needs accounts' mailer). */
  maintainerEmail?: string;
}

export function createApp({ db, clientKey, rateLimiter, steam, steamRateLimiter, icons = NO_ICONS, takedownContact, submissions, submitRateLimiter, accounts, catalog, publishRateLimiter, publishLimits, catalogueKey, reportRateLimiter, maintainerEmail }: AppOptions) {
  const limiter = rateLimiter ?? createRateLimiter({ limit: 60, windowMs: 60_000 });
  // Enough for a whole Steam library in one sitting; the review queue's own cap (MAX_PENDING) still stops a flood.
  const submitLimiter = submitRateLimiter ?? createRateLimiter({ limit: 100, windowMs: 3_600_000 });
  const steamLimiter = steamRateLimiter ?? createRateLimiter({ limit: 6, windowMs: 60_000 });
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

  // The query is what a player typed: never cached, never logged here. Only the
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
    if (wait > 0) {
      context.header("Retry-After", String(wait));
      return context.json({ error: "Too many requests." }, 429);
    }
    const q = context.req.query("q") ?? "";
    if (q.length > MAX_QUERY_LENGTH) return context.json({ error: "Query too long." }, 400);

    const rawLimit = context.req.query("limit");
    const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return context.json({ error: `limit must be a whole number from 1 to ${MAX_LIMIT}.` }, 400);
    }
    return context.json({ results: searchGames(db, q, limit) });
  });

  // Hosted game icons: a list of what exists, then the files. The app downloads
  // only the ones it needs, so the service never learns a player's library.
  const iconsAvailable = Boolean(takedownContact?.trim());
  app.get("/v1/icons", (context) => {
    const wait = limiter.check(clientKey ? clientKey(context.req.raw) : "local");
    if (wait > 0) {
      context.header("Retry-After", String(wait));
      return context.json({ error: "Too many requests." }, 429);
    }
    if (!iconsAvailable) return context.json({ error: "Icons are not available right now." }, 503);
    context.header("Cache-Control", "public, max-age=300");
    return context.json({ notice: ICON_NOTICE, takedown: takedownContact!.trim(), icons: icons.list() });
  });

  app.get("/v1/icons/:file", (context) => {
    const wait = limiter.check(clientKey ? clientKey(context.req.raw) : "local");
    if (wait > 0) {
      context.header("Retry-After", String(wait));
      return context.json({ error: "Too many requests." }, 429);
    }
    const match = /^([a-z0-9-]+)\.png$/.exec(context.req.param("file"));
    const bytes = iconsAvailable && match && isIconId(match[1]) ? icons.file(match[1]) : null;
    if (!bytes) return context.json({ error: "Not found." }, 404);
    return new Response(bytes, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
    });
  });

  // A signed-in player offers an icon their PC has and the service lacks. It is
  // checked, cleaned and queued; nothing is served until a person approves it.
  // JSON only, which a web page on another site cannot send without a preflight
  // this service refuses. The account is kept with the offer until it is reviewed.
  app.post(
    "/v1/icons/submit",
    bodyLimit({ maxSize: MAX_UPLOAD_BODY + 2000, onError: (context) => context.json({ error: "That icon is too big." }, 413) }),
    async (context) => {
      const wait = submitLimiter.check(clientKey ? clientKey(context.req.raw) : "local");
      if (wait > 0) {
        context.header("Retry-After", String(wait));
        return context.json({ error: "Too many requests." }, 429);
      }
      if (!iconsAvailable || !submissions || !accounts) return context.json({ error: "Sharing icons is not available right now." }, 503);
      const token = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(context.req.header("authorization") ?? "")?.[1];
      const session = token ? accounts.store.sessionByToken(token, (accounts.now ?? Date.now)()) : null;
      if (!session || !accounts.store.account(session.accountId)) return context.json({ error: "Sign in to share icons.", reason: "signed-out" }, 401);
      if (!(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return context.json({ error: "Send JSON." }, 415);
      }
      let body: unknown;
      try {
        body = JSON.parse(await context.req.text());
      } catch {
        return context.json({ error: "Send { id, name, source, icon }." }, 400);
      }
      const result = submissions.submit(body, session.accountId);
      if (result.status === 202) return context.json({ status: "received" }, 202);
      return context.json({ error: result.error }, result.status);
    },
  );

  // Steam import. POST, so the profile is in no URL; JSON only, which a web
  // page on another site cannot send without a preflight this service refuses.
  app.post("/v1/steam/library", bodyLimit({ maxSize: STEAM_BODY, onError: (context) => context.json({ error: "Send { \"profile\": a Steam profile link or SteamID64 }." }, 413) }), async (context) => {
    const wait = steamLimiter.check(clientKey ? clientKey(context.req.raw) : "local");
    if (wait > 0) {
      context.header("Retry-After", String(wait));
      return context.json({ error: "Too many requests." }, 429);
    }
    if (!steam) return context.json({ error: "Steam import is not available right now." }, 503);
    if (!(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return context.json({ error: "Send JSON." }, 415);
    }
    const text = await context.req.text();
    let profile: unknown;
    try {
      profile = text.length <= STEAM_BODY ? (JSON.parse(text) as { profile?: unknown }).profile : undefined;
    } catch {
      profile = undefined;
    }
    if (typeof profile !== "string" || profile.length === 0 || profile.length > MAX_PROFILE_LENGTH) {
      return context.json({ error: "Send { \"profile\": a Steam profile link or SteamID64 }." }, 400);
    }
    try {
      const ids = canonicalIds();
      const owned = await steam.ownedGames(profile);
      return context.json({ games: owned.map((game) => ({ appid: game.appid, name: game.name, id: ids.get(game.appid) ?? null })) });
    } catch (error) {
      if (error instanceof SteamError) return context.json({ error: error.message }, error.status);
      throw error;
    }
  });

  // The module catalog, read-only and without sign-in. The app takes the whole index (for a game, or
  // all of it) and decides on the PC what to update, so it never sends what a player has installed (C11).
  // "by <name>" comes from the account the key is linked to, never from the listing (C13).
  // `installs` counts installs from Browse (POST /installed), never who installed.
  const listed = (entry: CatalogEntry) => ({ ...entry, publisher: accounts?.store.publisherName(entry.owner) ?? null, installs: catalog?.installCount(entry.id) ?? 0 });
  const catalogApp = new Hono();
  // Publishing has its own limits per client and per account, so it comes before the read limiter.
  const publish = publishHandlers({
    catalog,
    store: accounts?.store,
    clientKey: (request) => (clientKey ? clientKey(request) : "local"),
    ...(publishRateLimiter ? { rateLimiter: publishRateLimiter } : {}),
    ...(publishLimits ? { limits: publishLimits } : {}),
    ...(catalogueKey ? { catalogueKey } : {}),
    ...(accounts?.now ? { now: accounts.now } : {}),
    ...(accounts ? { mail: { mailer: accounts.mailer, ...(accounts.mailDailyLimit === undefined ? {} : { mailDailyLimit: accounts.mailDailyLimit }) } } : {}),
    ...(accounts && maintainerEmail?.trim()
      ? { maintainer: { email: maintainerEmail.trim(), mailer: accounts.mailer, ...(accounts.mailDailyLimit === undefined ? {} : { mailDailyLimit: accounts.mailDailyLimit }) } }
      : {}),
  });
  catalogApp.post("/publish", publish.limit, publish.handler);
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
    if (wait > 0) {
      context.header("Retry-After", String(wait));
      return context.json({ error: "Too many requests." }, 429);
    }
    if (!catalog) return context.json({ error: "The module catalog is not available right now." }, 503);
    await next();
  });
  catalogApp.get("/", (context) => {
    const filter = catalogFilter(context.req.query("game"), context.req.query("workspace"));
    if (!filter) return context.json({ error: "Ask for ?game=<game id>, ?workspace=1 or neither." }, 400);
    context.header("Cache-Control", "public, max-age=300");
    return context.json({ modules: catalog!.index(filter).map(listed) });
  });
  catalogApp.get("/modules/:id", (context) => {
    const found = catalog!.module(context.req.param("id"));
    if (!found) return context.json({ error: "Not found." }, 404);
    context.header("Cache-Control", "public, max-age=300");
    return context.json({ module: listed(found.module), versions: found.versions, readme: found.readme });
  });
  // Sent once by the app after a player installed a module from Browse: only the module id.
  catalogApp.post("/installed", async (context) => {
    const body = (await context.req.json().catch(() => null)) as { id?: unknown } | null;
    const id = typeof body?.id === "string" && body.id.length <= 200 ? body.id : null;
    if (!id || !catalog!.countInstall(id)) return context.json({ error: "Not found." }, 404);
    return context.body(null, 204);
  });
  catalogApp.get("/zips/:file", (context) => {
    const match = /^([0-9a-f]{64})\.zip$/.exec(context.req.param("file"));
    const bytes = match ? catalog!.zip(match[1]!) : null;
    if (!bytes) return context.json({ error: "Not found." }, 404);
    // Named by its hash, so it never changes.
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": "attachment", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  });
  catalogApp.get("/pictures/:file", (context) => {
    const match = /^([0-9a-f]{64})\.(png|webp)$/.exec(context.req.param("file"));
    const bytes = match ? catalog!.picture(match[1]!, match[2]!) : null;
    if (!bytes) return context.json({ error: "Not found." }, 404);
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
  // or a blocked zip reaches players soon; the app refuses a list older than the one it has.
  catalogApp.get("/lists/:file", (context) => {
    const match = /^([a-z]+)\.json$/.exec(context.req.param("file"));
    const bytes = match && isSignedList(match[1]!) ? catalog!.list(match[1]) : null;
    if (!bytes) return context.json({ error: "Not found." }, 404);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
  });
  app.route("/v1/catalog", catalogApp);

  // Accounts: the only player data the service keeps, and only once it can send email.
  // The cloud copy first: its bodies are bigger than the account routes allow, and it has its own limits.
  if (accounts?.copies) app.route("/v1/account/copy", copyRoutes({ copies: accounts.copies, accounts: accounts.store, clientKey: (request) => (clientKey ? clientKey(request) : "local"), ...(accounts.now ? { now: accounts.now } : {}) }));
  else app.all("/v1/account/copy", (context) => context.json({ error: "The cloud copy is not available right now.", reason: "unavailable" }, 503)).all("/v1/account/copy/*", (context) => context.json({ error: "The cloud copy is not available right now.", reason: "unavailable" }, 503));
  if (accounts) app.route("/v1/account/vault", vaultRoutes({ accounts: accounts.store, clientKey: (request) => (clientKey ? clientKey(request) : "local"), ...(accounts.now ? { now: accounts.now } : {}) }));
  if (accounts) app.route("/v1/account/pairing", pairingRoutes({ accounts: accounts.store, clientKey: (request) => (clientKey ? clientKey(request) : "local"), ...(accounts.now ? { now: accounts.now } : {}) }));
  if (accounts) app.route("/v1/account", accountRoutes({ ...(catalog ? { trust: catalogTrust(catalog, catalogueKey) } : {}), ...accounts }, limiter, (request) => (clientKey ? clientKey(request) : "local")));
  else app.all("/v1/account/*", (context) => context.json({ error: "Accounts are not available right now.", reason: "unavailable" }, 503));
  // Publisher keys belong to accounts, so they come and go with them.
  if (accounts) app.route("/v1/publishers", publisherRoutes({ store: accounts.store, ...(accounts.verifyRateLimiter ? { linkRateLimiter: accounts.verifyRateLimiter } : {}), ...(accounts.now ? { now: accounts.now } : {}) }, limiter, (request) => (clientKey ? clientKey(request) : "local")));
  else app.all("/v1/publishers/*", (context) => context.json({ error: "Publishers are not available right now.", reason: "unavailable" }, 503));

  app.notFound((context) => context.json({ error: "Not found." }, 404));
  app.onError((error, context) => {
    // Never include the request: it holds what the player typed.
    console.error(`[tavora-api] ${error instanceof Error ? error.message : "unknown error"}`);
    return context.json({ error: "Something went wrong." }, 500);
  });
  return app;
}
