import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { accountRoutes, type AccountOptions } from "./accounts.ts";
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
}

export function createApp({ db, clientKey, rateLimiter, steam, steamRateLimiter, icons = NO_ICONS, takedownContact, submissions, submitRateLimiter, accounts }: AppOptions) {
  const limiter = rateLimiter ?? createRateLimiter({ limit: 60, windowMs: 60_000 });
  const submitLimiter = submitRateLimiter ?? createRateLimiter({ limit: 10, windowMs: 3_600_000 });
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

  // A player offers an icon their PC has and the service lacks. It is checked,
  // cleaned and queued; nothing is served until a person approves it. JSON
  // only, which a web page on another site cannot send without a preflight
  // this service refuses. Who sent it is never recorded.
  app.post(
    "/v1/icons/submit",
    bodyLimit({ maxSize: MAX_UPLOAD_BODY + 2000, onError: (context) => context.json({ error: "That icon is too big." }, 413) }),
    async (context) => {
      const wait = submitLimiter.check(clientKey ? clientKey(context.req.raw) : "local");
      if (wait > 0) {
        context.header("Retry-After", String(wait));
        return context.json({ error: "Too many requests." }, 429);
      }
      if (!iconsAvailable || !submissions) return context.json({ error: "Sharing icons is not available right now." }, 503);
      if (!(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return context.json({ error: "Send JSON." }, 415);
      }
      let body: unknown;
      try {
        body = JSON.parse(await context.req.text());
      } catch {
        return context.json({ error: "Send { id, name, source, icon }." }, 400);
      }
      const result = submissions.submit(body);
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

  // Accounts: the only player data the service keeps, and only once it can send email.
  if (accounts) app.route("/v1/account", accountRoutes(accounts, limiter, (request) => (clientKey ? clientKey(request) : "local")));
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
