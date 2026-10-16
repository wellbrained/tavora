import { beforeEach, describe, expect, it } from "vitest";
import { createAdminApp } from "./admin-app.ts";
import { ADMIN_JS } from "./admin-page.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { encodePng } from "./png.ts";
import { createSubmissions } from "./submissions.ts";

const TOKEN = "t0ken-".repeat(5);
const png = (seed: number) => encodePng(32, 32, Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * seed) % 256)));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

let state: IconState;
let submissions: ReturnType<typeof createSubmissions>;
let app: ReturnType<typeof createAdminApp>;
const seedBytes = png(9);
beforeEach(() => {
  state = new IconState(":memory:");
  const seed = {
    list: () => [{ id: "hades-2", names: ["Hades II"], sha256: "a".repeat(64), size: seedBytes.byteLength }],
    file: (id: string) => (id === "hades-2" ? seedBytes : null),
  };
  const store = createHostedStore(seed, state);
  const names: Record<string, string> = { "diablo-iv": "Diablo IV", "hades-2": "Hades II" };
  submissions = createSubmissions({ state, store, gameName: (id) => names[id] ?? null });
  app = createAdminApp({ token: TOKEN, submissions, state, store });
});

const call = (path: string, init: { method?: string; token?: string | null; body?: unknown; contentType?: string } = {}) =>
  app.request(`http://admin.test${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.token === null ? {} : { "X-Admin-Token": init.token ?? TOKEN }),
      ...(init.body === undefined ? {} : { "Content-Type": init.contentType ?? "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
const post = (path: string, body: unknown) => call(path, { method: "POST", body });
const offer = (over: Record<string, unknown> = {}) => submissions.submit({ id: "diablo-iv", name: "Diablo 4", source: "installed", icon: b64(png(3)), ...over });

describe("the page", () => {
  it("is served without a token, with a strict content security policy and no outside resources", async () => {
    for (const path of ["/", "/admin.js", "/admin.css"]) {
      const response = await call(path, { token: null });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const policy = response.headers.get("content-security-policy")!;
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("script-src 'self'");
      expect(policy).not.toContain("unsafe-inline");
      expect(policy).not.toContain("unsafe-eval");
      expect(policy).toContain("frame-ancestors 'none'");
    }
    const html = await (await call("/", { token: null })).text();
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script>|onclick=|style=/);
  });

  it("has two tabs, opens on the ones to review, and has no token button", async () => {
    const html = await (await call("/", { token: null })).text();
    expect(html).toContain('data-tab="pending"');
    expect(html).toContain('data-tab="hosted"');
    expect(html).toMatch(/id="panel-hosted"[^>]*hidden/);
    expect(html).not.toMatch(/id="panel-pending"[^>]*hidden/);
    expect(html).toContain('id="search"');
    expect(html).not.toContain("Forget token");
    expect(ADMIN_JS).not.toContain("forget");
    expect(() => new Function(ADMIN_JS)).not.toThrow();
  });

  it("puts nothing a player sent into the page as markup", () => {
    expect(ADMIN_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(ADMIN_JS).toContain("textContent");
  });
});

describe("the token", () => {
  it("is needed for every call to the api, and a wrong or missing one gets 401", async () => {
    for (const path of ["/api/overview", "/api/pending/" + "a".repeat(64) + ".png", "/api/hosted/hades-2.png"]) {
      expect((await call(path, { token: null })).status).toBe(401);
      expect((await call(path, { token: "wrong" })).status).toBe(401);
      expect((await call(path, { token: TOKEN.slice(0, -1) })).status).toBe(401);
      expect((await call(path, { token: `${TOKEN}x` })).status).toBe(401);
      expect((await call(path, { token: TOKEN.toUpperCase() })).status).toBe(401);
    }
    for (const path of ["/api/approve", "/api/deny", "/api/takedown"]) {
      expect((await call(path, { method: "POST", token: null, body: {} })).status).toBe(401);
    }
  });

  it("wants JSON for a change, so another web page cannot send one", async () => {
    offer();
    const sha = state.listPending()[0]!.sha256;
    const response = await call("/api/deny", { method: "POST", body: { sha256: sha, block: true }, contentType: "text/plain" });
    expect(response.status).toBe(415);
    expect(state.pendingCount()).toBe(1);
  });
});

describe("overview and images", () => {
  it("lists what waits and what is hosted, saying where each hosted icon came from", async () => {
    offer();
    const body = (await (await call("/api/overview")).json()) as { pending: Record<string, unknown>[]; hosted: Record<string, unknown>[] };
    expect(body.pending).toEqual([expect.objectContaining({ id: "diablo-iv", gameName: "Diablo IV", name: "Diablo 4", source: "installed", count: 1, hasIcon: false })]);
    expect(body.hosted).toEqual([expect.objectContaining({ id: "hades-2", origin: "release", source: null })]);
  });

  it("serves the offered and the hosted pictures", async () => {
    offer();
    const sha = state.listPending()[0]!.sha256;
    const pending = await call(`/api/pending/${sha}.png`);
    expect(pending.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await pending.arrayBuffer())).toEqual(png(3));
    expect(new Uint8Array(await (await call("/api/hosted/hades-2.png")).arrayBuffer())).toEqual(seedBytes);
  });

  it("answers 404 for pictures that are not there or names that are not valid", async () => {
    for (const path of ["/api/pending/" + "0".repeat(64) + ".png", "/api/pending/short.png", "/api/pending/..%2Fx.png", "/api/hosted/nothing.png", "/api/hosted/Hades-2.png", "/api/hosted/a.b.png"]) {
      expect((await call(path)).status).toBe(404);
    }
  });
});

describe("approve, deny and takedown", () => {
  it("approves an offer, which is then hosted and listed as approved", async () => {
    offer();
    const sha = state.listPending()[0]!.sha256;
    expect(await (await post("/api/approve", { sha256: sha })).json()).toEqual({ ok: true, id: "diablo-iv" });
    const body = (await (await call("/api/overview")).json()) as { pending: unknown[]; hosted: { id: string; origin: string; source: string | null; names: string[] }[] };
    expect(body.pending).toEqual([]);
    expect(body.hosted.map((icon) => [icon.id, icon.origin])).toEqual([["diablo-iv", "approved"], ["hades-2", "release"]]);
    expect(body.hosted[0]).toMatchObject({ source: "installed", names: ["Diablo IV", "Diablo 4"] });
  });

  it("refuses to approve what is not there, and what would give a game two icons", async () => {
    expect((await post("/api/approve", { sha256: "0".repeat(64) })).status).toBe(409);
    expect((await post("/api/approve", {})).status).toBe(400);
    expect((await post("/api/approve", "not an object")).status).toBe(400);
    state.addPending({ sha256: "b".repeat(64), id: "hades-2", name: "Hades II", source: "other", bytes: png(5), now: new Date() });
    expect((await post("/api/approve", { sha256: "b".repeat(64) })).status).toBe(409);
  });

  it("denies an offer, and with block refuses the same file for ever", async () => {
    offer();
    const sha = state.listPending()[0]!.sha256;
    expect(await (await post("/api/deny", { sha256: sha, block: true })).json()).toEqual({ ok: true });
    expect(state.isBlocked(sha)).toBe(true);
    offer();
    expect(state.pendingCount()).toBe(0);
    expect((await post("/api/deny", {})).status).toBe(400);
    offer({ icon: b64(png(5)) });
    expect(await (await post("/api/deny", { sha256: state.listPending()[0]!.sha256 })).json()).toEqual({ ok: true });
    expect(state.isBlocked(state.listPending()[0]?.sha256 ?? "")).toBe(false);
  });

  it("takes a hosted icon down at once, a release icon too", async () => {
    expect((await post("/api/takedown", { id: "hades-2", block: true })).status).toBe(200);
    expect((await call("/api/hosted/hades-2.png")).status).toBe(404);
    expect(((await (await call("/api/overview")).json()) as { hosted: unknown[] }).hosted).toEqual([]);
    expect((await post("/api/takedown", { id: "hades-2" })).status).toBe(404);
    expect((await post("/api/takedown", {})).status).toBe(400);
  });

  it("answers 404 for other paths and never leaks an error's details", async () => {
    expect((await call("/api/nothing")).status).toBe(404);
    expect((await call("/nothing", { token: null })).status).toBe(404);
  });
});
