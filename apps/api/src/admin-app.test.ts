import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { createAdminApp } from "./admin-app.ts";
import { CatalogStore } from "./catalog.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { AccountStore } from "./account-store.ts";
import type { Probes } from "./admin-probes.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { encodePng } from "./png.ts";
import { createSubmissions } from "./submissions.ts";

const TOKEN = "t0ken-".repeat(5);
const png = (seed: number) => encodePng(32, 32, Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * seed) % 256)));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

// A stand-in for the built panel (Tavora Admin's dist).
const panel = mkdtempSync(path.join(tmpdir(), "tavora-admin-panel-"));
mkdirSync(path.join(panel, "assets"));
writeFileSync(path.join(panel, "index.html"), "<!doctype html><title>Tavora Admin</title>");
writeFileSync(path.join(panel, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
for (const name of ["panel-abc123.js", "panel-abc123.css", "inter.woff2"]) writeFileSync(path.join(panel, "assets", name), "x");
writeFileSync(path.join(path.dirname(panel), "secret.txt"), "secret");

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
  submissions = createSubmissions({ state, store, gameName: (id) => names[id] ?? null, gamesNamed: () => [] });
  app = createAdminApp({ token: TOKEN, submissions, state, store, adminDir: panel });
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
const offer = (over: Record<string, unknown> = {}, sender = "account-1") => submissions.submit({ id: "diablo-iv", name: "Diablo 4", source: "installed", icon: b64(png(3)), ...over }, sender);

describe("the page", () => {
  it("serves the built panel without a token, with a strict content security policy", async () => {
    for (const path of ["/", "/assets/panel-abc123.js", "/assets/panel-abc123.css", "/assets/inter.woff2", "/favicon.svg"]) {
      const response = await call(path, { token: null });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store");
      const policy = response.headers.get("content-security-policy")!;
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("script-src 'self'");
      expect(policy).not.toContain("unsafe-inline");
      expect(policy).not.toContain("unsafe-eval");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("font-src 'self'");
    }
    expect((await call("/", { token: null })).headers.get("content-type")).toContain("text/html");
    expect((await call("/assets/panel-abc123.js", { token: null })).headers.get("content-type")).toContain("text/javascript");
  });

  it("says it is not built when there is no panel folder, and serves nothing outside the folder", async () => {
    const bare = createAdminApp({ token: TOKEN, submissions, state, store: createHostedStore({ list: () => [], file: () => null }, state), adminDir: path.join(panel, "missing") });
    expect((await bare.request("http://admin.test/")).status).toBe(503);
    expect((await call("/assets/..%2f..%2fsecret.txt", { token: null })).status).toBe(404);
    expect((await call("/assets/nothing.js", { token: null })).status).toBe(404);
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
    expect(body.pending).toEqual([expect.objectContaining({ id: "diablo-iv", gameName: "Diablo IV", name: "Diablo 4", source: "installed", count: 1, custom: false, hasIcon: false })]);
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

  it("lets the browser keep a hosted picture only under the hash of its bytes, and never an offered one", async () => {
    offer();
    const sha = state.listPending()[0]!.sha256;
    const seedSha = createHash("sha256").update(seedBytes).digest("hex");
    expect((await call(`/api/hosted/hades-2.png?v=${seedSha}`)).headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    for (const path of ["/api/hosted/hades-2.png", `/api/hosted/hades-2.png?v=${"a".repeat(64)}`, `/api/pending/${sha}.png`, `/api/pending/${sha}.png?v=${sha}`]) {
      expect((await call(path)).headers.get("cache-control")).toBe("no-store");
    }
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
    expect(body.hosted[0]).toMatchObject({ source: "installed", names: ["Diablo IV"] });
  });

  it("refuses to approve what is not there, and what would give a game two icons", async () => {
    expect((await post("/api/approve", { sha256: "0".repeat(64) })).status).toBe(409);
    expect((await post("/api/approve", {})).status).toBe(400);
    expect((await post("/api/approve", "not an object")).status).toBe(400);
    state.addPending({ sha256: "b".repeat(64), id: "hades-2", name: "Hades II", source: "other", bytes: png(5), sender: "account-1", now: new Date() });
    expect((await post("/api/approve", { sha256: "b".repeat(64) })).status).toBe(409);
  });

  it("denies an offer, and with block refuses the same file for ever", async () => {
    offer();
    const sha = state.listPending()[0]!.sha256;
    expect(await (await post("/api/deny", { sha256: sha, block: true })).json()).toEqual({ ok: true });
    expect(state.isBlocked(sha)).toBe(true);
    offer({}, "account-2");
    expect(state.pendingCount()).toBe(0);
    expect((await post("/api/deny", {})).status).toBe(400);
    // Blocking also stopped the sender; someone else can still offer.
    offer({ icon: b64(png(5)) });
    expect(state.pendingCount()).toBe(0);
    offer({ icon: b64(png(5)) }, "account-2");
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

describe("reports", () => {
  it("lists reported modules, delists and relists them, and dismisses reports, all with the token", async () => {
    const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-catalog-")));
    const key = generateKeyPairSync("ed25519").privateKey;
    const manifest = { id: "wellbrained.timer", name: "Timer", version: "1.0.0", apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
    const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
    const added = catalog.add(writeZip([...files, signFiles(files, key)]));
    app = createAdminApp({ token: TOKEN, submissions, state, store: createHostedStore({ list: () => [], file: () => null }, state), catalog });
    expect(catalog.report({ id: added.manifest.id, owner: added.owner, sha256: added.sha256 })).toBe(true);

    expect((await call("/api/reports", { token: null })).status).toBe(401);
    expect((await call("/api/reports", { method: "POST", token: null, body: {} })).status).toBe(401);
    const listed = (await (await call("/api/reports")).json()) as { reports: { sha256: string; id: string; count: number; listed: boolean }[]; catalogFullSince: string | null };
    expect(listed.catalogFullSince).toBeNull();
    expect(listed.reports).toEqual([expect.objectContaining({ sha256: added.sha256, id: "wellbrained.timer", count: 1, listed: true })]);

    expect((await post("/api/catalog/listed", { id: "wellbrained.timer", listed: false })).status).toBe(200);
    expect(catalog.index()).toEqual([]);
    expect(((await (await call("/api/reports")).json()) as { reports: { listed: boolean }[] }).reports[0]!.listed).toBe(false);
    expect((await post("/api/catalog/listed", { id: "wellbrained.timer", listed: true })).status).toBe(200);
    expect(catalog.index()).toHaveLength(1);
    expect((await post("/api/catalog/listed", { id: "nobody.here", listed: true })).status).toBe(404);
    expect((await post("/api/catalog/listed", { id: "wellbrained.timer" })).status).toBe(400);

    expect((await post("/api/reports/dismiss", { sha256: added.sha256 })).status).toBe(200);
    expect(((await (await call("/api/reports")).json()) as { reports: unknown[] }).reports).toEqual([]);
    expect((await post("/api/reports/dismiss", { sha256: added.sha256 })).status).toBe(404);

    // A full catalog (C9) shows with the reports until an upload fits again.
    catalog.markFull(new Date("2026-10-19T08:00:00Z"));
    expect(((await (await call("/api/reports")).json()) as { catalogFullSince: string | null }).catalogFullSince).toBe("2026-10-19T08:00:00.000Z");
    catalog.clearFull();
    expect(((await (await call("/api/reports")).json()) as { catalogFullSince: string | null }).catalogFullSince).toBeNull();
  });

  it("answers with no reports when there is no catalog", async () => {
    expect(await (await call("/api/reports")).json()).toEqual({ reports: [], catalogFullSince: null });
  });
});
