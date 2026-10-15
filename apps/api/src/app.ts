import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { DEFAULT_LIMIT, MAX_LIMIT, MAX_QUERY_LENGTH, searchGames } from "./search.ts";

export interface AppOptions {
  db: DatabaseSync;
  /** Which client a request is from; the server derives it from the connection. */
  clientKey?: (request: Request) => string;
  rateLimiter?: RateLimiter;
}

export function createApp({ db, clientKey, rateLimiter }: AppOptions) {
  const limiter = rateLimiter ?? createRateLimiter({ limit: 60, windowMs: 60_000 });
  const app = new Hono();

  // The query is what a player typed: never cached, never logged here.
  app.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
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

  app.notFound((context) => context.json({ error: "Not found." }, 404));
  app.onError((error, context) => {
    // Never include the request: it holds what the player typed.
    console.error(`[tavora-api] ${error instanceof Error ? error.message : "unknown error"}`);
    return context.json({ error: "Something went wrong." }, 500);
  });
  return app;
}
