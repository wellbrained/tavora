import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { catalogPublicKey, nextCatalogList, readZip, signCatalogList, signedHash, signFiles, writeZip, type Block, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { createAdminApp } from "./admin-app.ts";
import { CatalogStore } from "./catalog.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { createSubmissions } from "./submissions.ts";

const TOKEN = "admin-token";

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "tavora-blocks-"));
  const catalog = new CatalogStore(dir);
  const publisher = generateKeyPairSync("ed25519").privateKey;
  const signed = (version: string): ZipFile[] => {
    const manifest = { id: "wellbrained.timer", name: "Timer", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
    const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from(`<p>${version}</p>`) }];
    return [...files, signFiles(files, publisher)];
  };
  const firstFiles = signed("1.0.0");
  const first = catalog.add(writeZip(firstFiles)).sha256;
  const second = catalog.add(writeZip(signed("1.1.0"))).sha256;
  // The hash of what each zip's signature covers, which the catalog keeps beside the zip's (S7).
  const firstSigned = signedHash(firstFiles)!;
  const secondSigned = catalog.versionBySha(second)!.signedSha256!;
  const catalogue = generateKeyPairSync("ed25519").privateKey;
  const state = new IconState(":memory:");
  const store = createHostedStore({ list: () => [], file: () => null }, state);
  const admin = createAdminApp({ token: TOKEN, submissions: createSubmissions({ state, store, gameName: () => null, gamesNamed: () => [] }), state, store, catalog, catalogueKey: catalogPublicKey(catalogue) });
  const get = (route: string) => admin.request(`http://admin.test${route}`, { headers: { "X-Admin-Token": TOKEN } });
  const post = (route: string, body: unknown) => admin.request(`http://admin.test${route}`, { method: "POST", headers: { "X-Admin-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let sequence = 0;
  /** Serves a signed list with these entries, as `catalog set-list blocks` does. */
  const serve = (entries: Block[]) => {
    const list = nextCatalogList("blocks", entries, null, new Date());
    catalog.setList("blocks", Buffer.from(signCatalogList({ ...list, sequence: ++sequence }, catalogue)));
  };
  /** What the maintainer does on their PC: sign the downloaded entries and upload the list. */
  const signAndUpload = async () => serve((await (await get("/api/blocks/blocks.json")).json()) as Block[]);
  const blocksWaiting = async () => ((await (await get("/api/summary")).json()) as any).waiting.find((kind: { id: string }) => kind.id === "blocks");
  return { dir, catalog, first, second, firstFiles, firstSigned, secondSigned, get, post, serve, signAndUpload, blocksWaiting };
}

describe("blocking a zip from the panel", () => {
  it("stages a block, offers it to sign, and shows it in force once the served list holds it", async () => {
    const { first, firstSigned, get, post, signAndUpload } = setup();
    expect((await post("/api/blocks", { sha256: first, reason: "It sends your files to a stranger." })).status).toBe(200);

    const staged = (await (await get("/api/blocks")).json()) as any;
    expect(staged.blocks).toEqual([
      { sha256: first, signedSha256: firstSigned, reason: "It sends your files to a stranger.", id: "wellbrained.timer", name: "Timer", version: "1.0.0", state: "to-sign", toSign: [first, firstSigned] },
    ]);
    expect(staged.signed).toBeNull();
    // Both hashes of the zip, each a plain entry: the list's format is what older apps read.
    const both = [
      { sha256: first, reason: "It sends your files to a stranger." },
      { sha256: firstSigned, reason: "It sends your files to a stranger." },
    ];
    expect(await (await get("/api/blocks/blocks.json")).json()).toEqual(both);

    await signAndUpload();
    const signed = (await (await get("/api/blocks")).json()) as any;
    expect(signed.blocks).toEqual([expect.objectContaining({ sha256: first, state: "in-force", toSign: [] })]);
    expect(signed.signed).toMatchObject({ sequence: 1 });
    // In force: it stays in the next file, and can't be staged or taken out here, by either hash.
    expect(await (await get("/api/blocks/blocks.json")).json()).toEqual(both);
    for (const sha256 of [first, firstSigned]) {
      expect((await post("/api/blocks", { sha256, reason: "Again." })).status).toBe(409);
      expect((await post("/api/blocks/remove", { sha256 })).status).toBe(409);
    }
  });

  it("puts new blocks after the ones in force, and lets a staged one be taken back", async () => {
    const { first, second, firstSigned, secondSigned, get, post, signAndUpload } = setup();
    await post("/api/blocks", { sha256: first, reason: "Harmful." });
    await signAndUpload();
    await post("/api/blocks", { sha256: second, reason: "Still harmful." });
    expect(((await (await get("/api/blocks/blocks.json")).json()) as { sha256: string }[]).map((entry) => entry.sha256)).toEqual([first, firstSigned, second, secondSigned]);
    expect((await post("/api/blocks/remove", { sha256: second })).status).toBe(200);
    expect(((await (await get("/api/blocks")).json()) as any).blocks).toHaveLength(1);
  });

  it("counts blocks to sign in the summary, one per zip", async () => {
    const { first, post, blocksWaiting } = setup();
    await post("/api/blocks", { sha256: first, reason: "Harmful." });
    expect(await blocksWaiting()).toMatchObject({ count: 1, section: "modules" });
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

describe("blocking by what a zip's signature covers (S7)", () => {
  it("names the hash a repack of the same signed files keeps", async () => {
    const { first, firstFiles, get, post } = setup();
    await post("/api/blocks", { sha256: first, reason: "Harmful." });
    const repacked = writeZip([...firstFiles].reverse());
    const hashes = ((await (await get("/api/blocks/blocks.json")).json()) as Block[]).map((entry) => entry.sha256);
    expect(hashes).toContain(signedHash(readZip(repacked)));
  });

  it("stages by the signed hash too, keeping one block under the zip's hash", async () => {
    const { first, firstSigned, get, post } = setup();
    expect((await post("/api/blocks", { sha256: firstSigned, reason: "Harmful." })).status).toBe(200);
    // Staging the same zip by its other hash replaces the block instead of adding a second one.
    expect((await post("/api/blocks", { sha256: first, reason: "Harmful, really." })).status).toBe(200);
    const listed = (await (await get("/api/blocks")).json()) as any;
    expect(listed.blocks).toEqual([expect.objectContaining({ sha256: first, signedSha256: firstSigned, reason: "Harmful, really.", state: "to-sign" })]);
    expect(((await (await get("/api/blocks/blocks.json")).json()) as Block[]).map((entry) => entry.sha256)).toEqual([first, firstSigned]);
  });

  it("takes a staged block back by either hash", async () => {
    const { first, firstSigned, get, post } = setup();
    await post("/api/blocks", { sha256: first, reason: "Harmful." });
    expect((await post("/api/blocks/remove", { sha256: firstSigned })).status).toBe(200);
    expect(((await (await get("/api/blocks")).json()) as any).blocks).toEqual([]);
    expect((await post("/api/blocks/remove", { sha256: first })).status).toBe(404);
  });

  it("offers the missing signed hash of a block already in force, so the next list adds it", async () => {
    const { first, firstSigned, get, serve, signAndUpload, blocksWaiting } = setup();
    // A list signed before this change: the zip's hash only.
    serve([{ sha256: first, reason: "Harmful." }]);
    const before = (await (await get("/api/blocks")).json()) as any;
    expect(before.blocks).toEqual([expect.objectContaining({ sha256: first, state: "in-force", toSign: [firstSigned] })]);
    expect(await (await get("/api/blocks/blocks.json")).json()).toEqual([
      { sha256: first, reason: "Harmful." },
      { sha256: firstSigned, reason: "Harmful." },
    ]);
    expect(await blocksWaiting()).toMatchObject({ count: 1 });

    await signAndUpload();
    const after = (await (await get("/api/blocks")).json()) as any;
    expect(after.blocks).toEqual([expect.objectContaining({ sha256: first, state: "in-force", toSign: [] })]);
    expect(after.signed).toMatchObject({ sequence: 2 });
    expect(await blocksWaiting()).toMatchObject({ count: 0 });
  });

  it("offers the zip's hash of a block in force by its signed hash only, for older apps", async () => {
    const { first, firstSigned, get, serve } = setup();
    serve([{ sha256: firstSigned, reason: "Harmful." }]);
    expect(((await (await get("/api/blocks")).json()) as any).blocks).toEqual([expect.objectContaining({ sha256: first, state: "in-force", toSign: [first] })]);
    expect(((await (await get("/api/blocks/blocks.json")).json()) as Block[]).map((entry) => entry.sha256)).toEqual([firstSigned, first]);
  });

  it("names the zip's hash alone when the catalog has no signed hash for it", async () => {
    const { dir, first, get, post } = setup();
    // As for a version whose zip was pruned before its signed hash could be filled in.
    const db = new DatabaseSync(path.join(dir, "catalog.sqlite"));
    db.prepare("update versions set signed_sha256 = null where sha256 = ?").run(first);
    db.close();
    await post("/api/blocks", { sha256: first, reason: "Harmful." });
    expect(((await (await get("/api/blocks")).json()) as any).blocks).toEqual([expect.objectContaining({ sha256: first, signedSha256: null, toSign: [first] })]);
    expect(await (await get("/api/blocks/blocks.json")).json()).toEqual([{ sha256: first, reason: "Harmful." }]);
  });

  it("keeps a staged block's signed hash when its version row goes, as a declined one does", async () => {
    const { dir, first, firstSigned, get, post } = setup();
    await post("/api/blocks", { sha256: first, reason: "Harmful." });
    const db = new DatabaseSync(path.join(dir, "catalog.sqlite"));
    db.prepare("delete from versions where sha256 = ?").run(first);
    db.close();
    expect(((await (await get("/api/blocks")).json()) as any).blocks).toEqual([expect.objectContaining({ sha256: first, signedSha256: firstSigned, id: null, toSign: [first, firstSigned] })]);
    expect(((await (await get("/api/blocks/blocks.json")).json()) as Block[]).map((entry) => entry.sha256)).toEqual([first, firstSigned]);
  });

  it("lifts a block once a list without both of its entries is served", async () => {
    const { first, second, get, post, serve, signAndUpload, blocksWaiting } = setup();
    await post("/api/blocks", { sha256: first, reason: "Harmful." });
    await post("/api/blocks", { sha256: second, reason: "Also harmful." });
    await signAndUpload();
    const kept = ((await (await get("/api/blocks/blocks.json")).json()) as Block[]).filter((entry) => entry.reason !== "Harmful.");
    expect(kept.map((entry) => entry.sha256)).not.toContain(first);
    serve(kept);
    // A staged block stays until it is taken back (as before), so the lifted zip shows as to sign again, with both hashes.
    expect(((await (await get("/api/blocks")).json()) as any).blocks).toEqual([
      expect.objectContaining({ sha256: second, state: "in-force", toSign: [] }),
      expect.objectContaining({ sha256: first, state: "to-sign", toSign: [first, expect.any(String)] }),
    ]);
    expect((await post("/api/blocks/remove", { sha256: first })).status).toBe(200);
    expect(((await (await get("/api/blocks")).json()) as any).blocks).toEqual([expect.objectContaining({ sha256: second, state: "in-force" })]);
    expect(await blocksWaiting()).toMatchObject({ count: 0 });
  });

  it("leaves a list entry the catalog never had as it is", async () => {
    const { get, serve, blocksWaiting } = setup();
    serve([{ sha256: "b".repeat(64), reason: "Added by hand." }]);
    expect(((await (await get("/api/blocks")).json()) as any).blocks).toEqual([expect.objectContaining({ sha256: "b".repeat(64), id: null, state: "in-force", toSign: [] })]);
    expect(await (await get("/api/blocks/blocks.json")).json()).toEqual([{ sha256: "b".repeat(64), reason: "Added by hand." }]);
    expect(await blocksWaiting()).toMatchObject({ count: 0 });
  });
});
