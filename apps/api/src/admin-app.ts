import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { ADMIN_CSS, ADMIN_HTML, ADMIN_JS } from "./admin-page.ts";
import { INTER_WOFF2 } from "./inter-font.ts";
import type { IconState } from "./icon-state.ts";
import { isIconId, type IconStore } from "./icons.ts";
import type { Submissions } from "./submissions.ts";

/**
 * The private review page: the icons players have offered, shown the way the
 * app will show them, with Approve, Deny and Deny and block; and the hosted
 * icons, with Take down for a publisher's request. It is served on its own
 * port of 127.0.0.1 that the web server never forwards, and every call needs
 * the admin token, so reaching it takes the server and the token.
 */

export interface AdminOptions {
  token: string;
  submissions: Submissions;
  state: IconState;
  store: IconStore;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function createAdminApp({ token, submissions, state, store }: AdminOptions) {
  const app = new Hono();
  const expected = digest(token);

  app.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  // The page itself holds no data, so it needs no token.
  app.get("/", (context) => context.html(ADMIN_HTML));
  app.get("/admin.js", (context) => new Response(ADMIN_JS, { headers: { "Content-Type": "text/javascript; charset=utf-8" } }));
  app.get("/admin.css", (context) => new Response(ADMIN_CSS, { headers: { "Content-Type": "text/css; charset=utf-8" } }));
  app.get("/inter.woff2", () => new Response(INTER_WOFF2, { headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable" } }));

  app.use("/api/*", async (context, next) => {
    const sent = context.req.header("x-admin-token") ?? "";
    if (!timingSafeEqual(digest(sent), expected)) return context.json({ error: "Wrong token." }, 401);
    if (context.req.method === "POST" && !(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return context.json({ error: "Send JSON." }, 415);
    }
    await next();
  });

  app.get("/api/overview", (context) => {
    const approved = new Map(state.approvedList().map((icon) => [icon.id, icon]));
    return context.json({
      pending: submissions.listPending(),
      hosted: store.list().map((icon) => ({ ...icon, origin: approved.has(icon.id) ? "approved" : "release", source: approved.get(icon.id)?.source ?? null })),
    });
  });

  app.get("/api/pending/:file", (context) => {
    const sha = /^([0-9a-f]{64})\.png$/.exec(context.req.param("file"))?.[1];
    const bytes = sha ? state.pendingBytes(sha) : null;
    return bytes ? new Response(bytes, { headers: { "Content-Type": "image/png" } }) : context.json({ error: "Not found." }, 404);
  });

  app.get("/api/hosted/:file", (context) => {
    const id = /^([a-z0-9-]+)\.png$/.exec(context.req.param("file"))?.[1];
    const bytes = id && isIconId(id) ? store.file(id) : null;
    return bytes ? new Response(bytes, { headers: { "Content-Type": "image/png" } }) : context.json({ error: "Not found." }, 404);
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

  app.post("/api/takedown", async (context) => {
    const { id, block } = await json(context.req.raw);
    if (typeof id !== "string") return context.json({ error: "Send { id, block }." }, 400);
    return submissions.takedown(id, block === true) ? context.json({ ok: true }) : context.json({ error: "No such hosted icon." }, 404);
  });

  app.notFound((context) => context.json({ error: "Not found." }, 404));
  app.onError((error, context) => {
    console.error(`[tavora-api admin] ${error instanceof Error ? error.message : "unknown error"}`);
    return context.json({ error: "Something went wrong." }, 500);
  });
  return app;
}
