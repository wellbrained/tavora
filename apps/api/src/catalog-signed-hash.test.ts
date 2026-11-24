import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readZip, signedHash, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it, vi } from "vitest";
import { CatalogStore, REMOVED_ZIP } from "./catalog.ts";

// S7: a version keeps the hash of what its zip's signature covers, so a block can name it as well as the zip's hash.

const publisher = generateKeyPairSync("ed25519").privateKey;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function signedFiles(version: string): ZipFile[] {
  const manifest = { id: "wellbrained.timer", name: "Timer", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [
    { name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) },
    { name: "index.html", data: Buffer.from(`<!doctype html><p>${version}</p>`) },
  ];
  return [...files, signFiles(files, publisher)];
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "tavora-signed-hash-"));
  return { dir, catalog: new CatalogStore(path.join(dir, "catalog")) };
}

/** Opens the catalog's database next to the store, the way an older service left it. */
const database = (dir: string) => new DatabaseSync(path.join(dir, "catalog", "catalog.sqlite"));

/** A catalog made before signed_sha256: the column is taken out again, as the older service never had it. */
function olderCatalog() {
  const { dir, catalog } = setup();
  const zips = ["1.0.0", "1.1.0", "1.2.0"].map((version) => writeZip(signedFiles(version)));
  for (const zip of zips) catalog.add(zip);
  catalog.close();
  const db = database(dir);
  db.exec("drop index versions_signed_sha256; alter table versions drop column signed_sha256");
  db.close();
  return { dir, zips };
}

describe("the signed hash of a version", () => {
  it("is kept at upload, and is the same for the same signed files packed again", () => {
    const { catalog } = setup();
    const files = signedFiles("1.0.0");
    const zip = writeZip(files);
    catalog.add(zip);
    const repacked = writeZip([...files].reverse());
    expect(sha(repacked)).not.toBe(sha(zip));
    expect(signedHash(readZip(repacked))).toBe(signedHash(files));
    expect(catalog.versionBySha(sha(zip))).toEqual({ id: "wellbrained.timer", name: "Timer", version: "1.0.0", sha256: sha(zip), signedSha256: signedHash(files) });
  });

  it("finds a version by either hash, and nothing for a hash the catalog never had", () => {
    const { catalog } = setup();
    const files = signedFiles("1.0.0");
    const zip = writeZip(files);
    catalog.add(zip);
    expect(catalog.versionBySha(signedHash(files)!)).toMatchObject({ version: "1.0.0", sha256: sha(zip) });
    expect(catalog.versionBySha("a".repeat(64))).toBeNull();
  });
});

describe("filling the signed hash of older versions", () => {
  it("adds the column to an older catalog and fills it from the kept zips, keeping every row", () => {
    const { dir, zips } = olderCatalog();
    const catalog = new CatalogStore(path.join(dir, "catalog"));
    expect(catalog.versionBySha(sha(zips[0]!))).toMatchObject({ signedSha256: null });

    expect(catalog.backfillSignedHashes()).toEqual({ filled: 3, skipped: [] });
    for (const zip of zips) expect(catalog.versionBySha(sha(zip))).toMatchObject({ sha256: sha(zip), signedSha256: signedHash(readZip(zip)) });
    expect(catalog.adminModules()[0]!.versions).toHaveLength(3);
  });

  it("is safe to run again: a filled hash is never read or changed", () => {
    const { dir, zips } = olderCatalog();
    const catalog = new CatalogStore(path.join(dir, "catalog"));
    catalog.backfillSignedHashes();
    // Even a filled row whose zip is now gone keeps its hash, and isn't reported.
    writeFileSync(path.join(dir, "catalog", "zips", `${sha(zips[0]!)}.zip`), "gone");
    expect(catalog.backfillSignedHashes()).toEqual({ filled: 0, skipped: [] });
    expect(catalog.versionBySha(sha(zips[0]!))).toMatchObject({ signedSha256: signedHash(readZip(zips[0]!)) });
    catalog.close();
    // And again from a fresh start, as the server does at every start.
    expect(new CatalogStore(path.join(dir, "catalog")).backfillSignedHashes()).toEqual({ filled: 0, skipped: [] });
  });

  it("skips and names a zip it can't use, and still fills the rest", () => {
    const { dir, zips } = olderCatalog();
    // 1.0.0: its zip was pruned. 1.1.0: its zip no longer matches its name.
    const db = database(dir);
    db.prepare("update versions set zip_removed = ? where sha256 = ?").run(new Date().toISOString(), sha(zips[0]!));
    db.close();
    writeFileSync(path.join(dir, "catalog", "zips", `${sha(zips[1]!)}.zip`), "not the zip");
    const catalog = new CatalogStore(path.join(dir, "catalog"));

    const result = catalog.backfillSignedHashes();
    expect(result.filled).toBe(1);
    expect(result.skipped).toEqual([
      { sha256: sha(zips[0]!), id: "wellbrained.timer", version: "1.0.0", reason: REMOVED_ZIP },
      { sha256: sha(zips[1]!), id: "wellbrained.timer", version: "1.1.0", reason: "its zip is missing or not what its name says" },
    ]);
    expect(catalog.versionBySha(sha(zips[2]!))).toMatchObject({ signedSha256: signedHash(readZip(zips[2]!)) });
    expect(catalog.versionBySha(sha(zips[1]!))).toMatchObject({ signedSha256: null });

    // Once the zip is back, the next run fills it; the pruned one stays without.
    writeFileSync(path.join(dir, "catalog", "zips", `${sha(zips[1]!)}.zip`), zips[1]!);
    expect(catalog.backfillSignedHashes()).toEqual({ filled: 1, skipped: [expect.objectContaining({ version: "1.0.0", reason: REMOVED_ZIP })] });
  });

  it("reads a zip again after one death: a restart says nothing about the zip", () => {
    const { dir, zips } = olderCatalog();
    const catalog = new CatalogStore(path.join(dir, "catalog"));
    catalog.setState("signed_backfill_reading", sha(zips[1]!));
    expect(catalog.backfillSignedHashes({ skipStalled: true })).toEqual({ filled: 3, skipped: [] });
    expect(catalog.getState("signed_backfill_reading")).toBe("");
    expect(JSON.parse(catalog.getState("signed_backfill_stalled")!)).toEqual({});
  });

  it("leaves a zip alone for a day after two deaths in a row, so the server can't loop on it, then tries it again", () => {
    const { dir, zips } = olderCatalog();
    const catalog = new CatalogStore(path.join(dir, "catalog"));
    const at = Date.parse("2026-11-22T12:00:00Z");
    const hash = sha(zips[1]!);
    catalog.setState("signed_backfill_stalled", JSON.stringify({ [hash]: { deaths: 1, at: at - 1000 } }));
    // As if a start was killed while it read 1.1.0 (the service's memory limit).
    catalog.setState("signed_backfill_reading", hash);

    for (const later of [0, 3_600_000]) {
      const result = catalog.backfillSignedHashes({ skipStalled: true, now: at + later });
      expect(result.skipped).toEqual([expect.objectContaining({ version: "1.1.0", reason: expect.stringContaining("stopped while reading") })]);
    }
    expect(catalog.versionBySha(sha(zips[0]!))).toMatchObject({ signedSha256: signedHash(readZip(zips[0]!)) });
    expect(catalog.getState("signed_backfill_reading")).toBe("");

    expect(catalog.backfillSignedHashes({ skipStalled: true, now: at + 86_400_001 })).toEqual({ filled: 1, skipped: [] });
    expect(catalog.versionBySha(sha(zips[1]!))).toMatchObject({ signedSha256: signedHash(readZip(zips[1]!)) });
    expect(JSON.parse(catalog.getState("signed_backfill_stalled")!)).toEqual({});
  });

  it("tries a zip again that an older service marked as stalled for good", () => {
    const { dir, zips } = olderCatalog();
    const catalog = new CatalogStore(path.join(dir, "catalog"));
    catalog.setState("signed_backfill_stalled", JSON.stringify([sha(zips[1]!)]));
    expect(catalog.backfillSignedHashes({ skipStalled: true })).toEqual({ filled: 3, skipped: [] });
  });

  it("starts over, with a warning, when the saved stalled zips can't be read", () => {
    const { dir } = olderCatalog();
    const catalog = new CatalogStore(path.join(dir, "catalog"));
    catalog.setState("signed_backfill_stalled", "{broken");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(catalog.backfillSignedHashes({ skipStalled: true })).toEqual({ filled: 3, skipped: [] });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("the command always tries a stalled zip", () => {
    const { dir, zips } = olderCatalog();
    const catalog = new CatalogStore(path.join(dir, "catalog"));
    catalog.setState("signed_backfill_stalled", JSON.stringify({ [sha(zips[1]!)]: { deaths: 2, at: Date.now() } }));
    expect(catalog.backfillSignedHashes()).toEqual({ filled: 3, skipped: [] });
  });

  it("reads a zip at start whose files together pass the limit but each fit next to it", () => {
    const { dir, catalog } = setup();
    const files: ZipFile[] = [
      { name: "tavora.module.json", data: Buffer.from(JSON.stringify({ id: "wellbrained.timer", name: "Timer", version: "1.0.0", apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } })) },
      { name: "index.html", data: Buffer.from("<p>timer</p>") },
      ...Array.from({ length: 4 }, (_, index) => ({ name: `part${index}.bin`, data: randomBytes(20_000) })),
    ];
    const zip = writeZip([...files, signFiles(files, publisher)]);
    catalog.add(zip);
    const db = database(dir);
    db.exec("update versions set file_hashes = null");
    const result = catalog.backfillSignedHashes({ skipStalled: true, memoryLimit: zip.length + 21_000 });
    expect(result).toEqual({ filled: 1, skipped: [] });
    expect((db.prepare("select file_hashes from versions").get() as { file_hashes: string | null }).file_hashes).not.toBeNull();
    db.close();
  });

  it("records no hashes to compare for a zip nothing can read, so it doesn't hold every upload back", () => {
    const { dir, catalog } = setup();
    const broken = Buffer.from("PK this is not a zip at all");
    writeFileSync(path.join(dir, "catalog", "zips", `${sha(broken)}.zip`), broken);
    const db = database(dir);
    db.prepare("insert into modules (id, owner, created_at) values ('wellbrained.broken', 'owner', ?)").run(new Date().toISOString());
    db.prepare("insert into versions (module_id, version, sha256, size, manifest, notes, published_at) values ('wellbrained.broken', '1.0.0', ?, ?, '{\"name\":\"Broken\"}', '[]', ?)").run(sha(broken), broken.length, new Date().toISOString());
    const self = { moduleId: "other.clock", accountId: "someone", fingerprints: [] };
    expect(catalog.uncomparedVersions(self)).toEqual([{ id: "wellbrained.broken", version: "1.0.0" }]);
    catalog.backfillSignedHashes();
    expect(catalog.uncomparedVersions(self)).toEqual([]);
    db.close();
  });

  it("names a stored zip that isn't a readable zip, or has no readable signature", () => {
    const { dir } = olderCatalog();
    const broken = Buffer.from("PK this is not a zip at all");
    const unsigned = writeZip([{ name: "tavora.module.json", data: Buffer.from("{}") }]);
    const badSignature = writeZip([{ name: "tavora.module.json", data: Buffer.from("{}") }, { name: "tavora.signature.json", data: Buffer.from("{ not json") }]);
    const db = database(dir);
    const insert = db.prepare("insert into versions (module_id, version, sha256, size, manifest, notes, published_at) values ('wellbrained.timer', ?, ?, ?, '{\"name\":\"Timer\"}', '[]', ?)");
    for (const [version, bytes] of [["2.0.0", broken], ["2.1.0", unsigned], ["2.2.0", badSignature]] as const) {
      writeFileSync(path.join(dir, "catalog", "zips", `${sha(bytes)}.zip`), bytes);
      insert.run(version, sha(bytes), bytes.length, new Date().toISOString());
    }
    db.close();
    const catalog = new CatalogStore(path.join(dir, "catalog"));

    const result = catalog.backfillSignedHashes();
    expect(result.filled).toBe(3);
    expect(result.skipped).toEqual([
      { sha256: sha(broken), id: "wellbrained.timer", version: "2.0.0", reason: expect.stringMatching(/^its zip can't be read: /) },
      { sha256: sha(unsigned), id: "wellbrained.timer", version: "2.1.0", reason: "its zip has no readable signature" },
      { sha256: sha(badSignature), id: "wellbrained.timer", version: "2.2.0", reason: "its zip has no readable signature" },
    ]);
  });
});
