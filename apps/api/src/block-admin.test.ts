import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, nextCatalogList, signCatalogList, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { createAdminApp } from "./admin-app.ts";
import { CatalogStore } from "./catalog.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { createSubmissions } from "./submissions.ts";

const TOKEN = "admin-token";

function setup() {
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-blocks-")));
  const publisher = generateKeyPairSync("ed25519").privateKey;
  const zip = (version: string) => {
    const manifest = { id: "wellbrained.timer", name: "Timer", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
    const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from(`<p>${version}</p>`) }];
    return writeZip([...files, signFiles(files, publisher)]);
  };
  const first = catalog.add(zip("1.0.0")).sha256;
  const second = catalog.add(zip("1.1.0")).sha256;
  const catalogue = generateKeyPairSync("ed25519").privateKey;
  const state = new IconState(":memory:");
  const store = createHostedStore({ list: () => [], file: () => null }, state);
  const admin = createAdminApp({ token: TOKEN, submissions: createSubmissions({ state, store, gameName: () => null, gamesNamed: () => [] }), state, store, catalog, catalogueKey: catalogPublicKey(catalogue) });
  const get = (route: string) => admin.request(`http://admin.test${route}`, { headers: { "X-Admin-Token": TOKEN } });
  const post = (route: string, body: unknown) => admin.request(`http://admin.test${route}`, { method: "POST", headers: { "X-Admin-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  /** What the maintainer does on their PC: sign the downloaded entries and upload the list. */
  const signAndUpload = async () => {
    const entries = (await (await get("/api/blocks/blocks.json")).json()) as unknown;
    catalog.setList("blocks", Buffer.from(signCatalogList(nextCatalogList("blocks", entries, null, new Date()), catalogue)));
  };
  return { catalog, first, second, get, post, signAndUpload };
}

describe("blocking a zip from the panel", () => {
  it("stages a block, offers it to sign, and shows it in force once the served list holds it", async () => {
    const { first, get, post, signAndUpload } = setup();
    expect((await post("/api/blocks", { sha256: first, reason: "It sends your files to a stranger." })).status).toBe(200);

    const staged = (await (await get("/api/blocks")).json()) as any;
    expect(staged.blocks).toEqual([{ sha256: first, reason: "It sends your files to a stranger.", id: "wellbrained.timer", name: "Timer", version: "1.0.0", state: "to-sign" }]);
    expect(staged.signed).toBeNull();
    expect(await (await get("/api/blocks/blocks.json")).json()).toEqual([{ sha256: first, reason: "It sends your files to a stranger." }]);

    await signAndUpload();
    const signed = (await (await get("/api/blocks")).json()) as any;
    expect(signed.blocks).toEqual([expect.objectContaining({ sha256: first, state: "in-force" })]);
    expect(signed.signed).toMatchObject({ sequence: 1 });
    // In force: it stays in the next file, and can't be staged or taken out here.
    expect(await (await get("/api/blocks/blocks.json")).json()).toEqual([{ sha256: first, reason: "It sends your files to a stranger." }]);
    expect((await post("/api/blocks", { sha256: first, reason: "Again." })).status).toBe(409);
    expect((await post("/api/blocks/remove", { sha256: first })).status).toBe(409);
  });

  it("puts new blocks after the ones in force, and lets a staged one be taken back", async () => {
    const { first, second, get, post, signAndUpload } = setup();
    await post("/api/blocks", { sha256: first, reason: "Harmful." });
    await signAndUpload();
    await post("/api/blocks", { sha256: second, reason: "Still harmful." });
    expect(((await (await get("/api/blocks/blocks.json")).json()) as { sha256: string }[]).map((entry) => entry.sha256)).toEqual([first, second]);
    expect((await post("/api/blocks/remove", { sha256: second })).status).toBe(200);
    expect(((await (await get("/api/blocks")).json()) as any).blocks).toHaveLength(1);
  });

  it("counts blocks to sign in the summary", async () => {
    const { first, get, post } = setup();
    await post("/api/blocks", { sha256: first, reason: "Harmful." });
    const summary = (await (await get("/api/summary")).json()) as any;
    expect(summary.waiting.find((kind: { id: string }) => kind.id === "blocks")).toMatchObject({ count: 1, section: "modules" });
  });

  it("refuses a zip the catalog never had, and a reason the list can't hold", async () => {
    const { first, post } = setup();
    expect((await post("/api/blocks", { sha256: "a".repeat(64), reason: "Harmful." })).status).toBe(404);
    expect((await post("/api/blocks", { sha256: first, reason: "" })).status).toBe(400);
    expect((await post("/api/blocks", { sha256: first, reason: "x".repeat(301) })).status).toBe(400);
    expect((await post("/api/blocks", { sha256: first, reason: "Line\nbreak" })).status).toBe(400);
    expect((await post("/api/blocks", { sha256: "not a hash", reason: "Harmful." })).status).toBe(400);
  });
});
