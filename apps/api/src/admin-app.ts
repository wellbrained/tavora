import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { AccountStore } from "./account-store.ts";
import { ADMIN_CSS, ADMIN_HTML, ADMIN_JS } from "./admin-page.ts";
import type { CatalogStore } from "./catalog.ts";
import { catalogTrust } from "./catalog-trust.ts";
import { INTER_WOFF2 } from "./inter-font.ts";
import { keyRequestStatus, revocationEntries, successionEntries } from "./key-requests.ts";
import type { IconState } from "./icon-state.ts";
import { isIconId, type IconStore } from "./icons.ts";
import type { Submissions } from "./submissions.ts";

/**
 * The private review page: the icons players have offered, shown the way the
 * app will show them, with Approve, Deny and Deny and block; and the hosted
 * icons, with Take down for a publisher's request; and the modules players
 * reported from the catalog, with Delist and Dismiss; and the developers' requests to replace a lost
 * or leaked publisher key, exported as entries to sign offline. It is served on its own
 * port of 127.0.0.1 that the web server never forwards, and every call needs
 * the admin token, so reaching it takes the server and the token.
 */

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
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function createAdminApp({ token, submissions, state, store, catalog, accounts, catalogueKey }: AdminOptions) {
  const app = new Hono();
  const expected = digest(token);

  app.use("*", async (context, next) => {
    await next();
    if (!context.res.headers.has("Cache-Control")) context.header("Cache-Control", "no-store");
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

  app.post("/api/takedown", async (context) => {
    const { id, block } = await json(context.req.raw);
    if (typeof id !== "string") return context.json({ error: "Send { id, block }." }, 400);
    return submissions.takedown(id, block === true) ? context.json({ ok: true }) : context.json({ error: "No such hosted icon." }, 404);
  });

  // With the reports: since when the catalog has been full (C9), or null while there is room.
  app.get("/api/reports", (context) => context.json({ reports: catalog?.reports() ?? [], catalogFullSince: catalog?.fullSince() ?? null }));

  app.post("/api/reports/dismiss", async (context) => {
    const { sha256 } = await json(context.req.raw);
    if (typeof sha256 !== "string") return context.json({ error: "Send { sha256 }." }, 400);
    return catalog?.dismissReport(sha256) ? context.json({ ok: true }) : context.json({ error: "No such report." }, 404);
  });

  app.post("/api/catalog/listed", async (context) => {
    const { id, listed } = await json(context.req.raw);
    if (typeof id !== "string" || typeof listed !== "boolean") return context.json({ error: "Send { id, listed }." }, 400);
    return catalog?.setListed(id, listed) ? context.json({ ok: true }) : context.json({ error: "No such module." }, 404);
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

  app.notFound((context) => context.json({ error: "Not found." }, 404));
  app.onError((error, context) => {
    console.error(`[tavora-api admin] ${error instanceof Error ? error.message : "unknown error"}`);
    return context.json({ error: "Something went wrong." }, 500);
  });
  return app;
}
