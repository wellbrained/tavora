import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogPublicKey, readCatalogList, signCatalogList, type BlockList, type RevocationList, type SuccessionList } from "../packages/pack/src/catalog-lists.ts";
import { reviewCatalogList, undecidedRevocations } from "./catalog-sign-review.ts";

const hash = (c: string) => c.repeat(64);
const key = (c: string) => c.repeat(32);
const blocks = (sequence: number, blocked: BlockList["blocked"]): BlockList => ({ kind: "blocks", sequence, issued: "2026-10-18T12:00:00Z", blocked });
const A = { sha256: hash("a"), reason: "Dummy A." };
const B = { sha256: hash("b"), reason: "Dummy B." };

describe("undecidedRevocations", () => {
  const entry = { fingerprint: key("a"), revoked: "2026-10-18T12:00:00Z", allow: [] };

  it("names each version a revocation still needs a decision on", () => {
    const decide = [{ sha256: hash("b"), id: "dev.timer", version: "1.0.1", listedAt: "2026-10-17T12:00:00.000Z" }];
    expect(undecidedRevocations([entry, { ...entry, fingerprint: key("c"), decide }])).toEqual([`key ${key("c")}: dev.timer 1.0.1, listed 2026-10-17T12:00:00.000Z, zip ${hash("b")}`]);
  });

  it("doesn't let an emptied or broken field through as decided", () => {
    expect(undecidedRevocations([{ ...entry, decide: [] }])).toHaveLength(1);
    expect(undecidedRevocations([{ ...entry, decide: "none" }])).toHaveLength(1);
  });

  it("has nothing to ask of a file without the field", () => {
    expect(undecidedRevocations([entry])).toEqual([]);
    expect(undecidedRevocations("not a list")).toEqual([]);
  });
});

describe("reviewCatalogList", () => {
  it("refuses a list that drops a block in force, until the maintainer names it", () => {
    const review = reviewCatalogList("blocks", blocks(1, [A, B]), blocks(2, [B]), []);
    expect(review.lines).toEqual(["Changes against blocks list 1:", `- ${JSON.stringify(A)}`]);
    expect(review.refused).toEqual([hash("a")]);
    expect(reviewCatalogList("blocks", blocks(1, [A, B]), blocks(2, [B]), [hash("a")]).refused).toEqual([]);
  });

  it("shows new blocks and lets them through", () => {
    const review = reviewCatalogList("blocks", blocks(1, [B]), blocks(2, [B, A]), []);
    expect(review.lines).toEqual(["Changes against blocks list 1:", `+ ${JSON.stringify(A)}`]);
    expect(review.refused).toEqual([]);
  });

  it("refuses a loosened revocation: an added allowed zip or a later date", () => {
    const revocations = (sequence: number, revoked: RevocationList["revoked"]): RevocationList => ({ kind: "revocations", sequence, issued: "2026-10-18T12:00:00Z", revoked });
    const before = revocations(1, [{ fingerprint: key("1"), revoked: "2026-10-18T12:00:00Z", allow: [hash("a")] }]);
    const allowMore = revocations(2, [{ fingerprint: key("1"), revoked: "2026-10-18T12:00:00Z", allow: [hash("a"), hash("c")] }]);
    const later = revocations(2, [{ fingerprint: key("1"), revoked: "2026-10-19T12:00:00Z", allow: [hash("a")] }]);
    for (const next of [allowMore, later]) {
      const review = reviewCatalogList("revocations", before, next, []);
      expect(review.refused).toEqual([key("1")]);
      expect(review.lines[1]).toMatch(/^~ /);
      expect(review.lines[2]).toMatch(/^ {2}-> /);
    }
    // The same allowed zips in another order change nothing.
    const reordered = revocations(1, [{ fingerprint: key("1"), revoked: "2026-10-18T12:00:00Z", allow: [hash("c"), hash("a")] }]);
    expect(reviewCatalogList("revocations", reordered, allowMore, []).lines).toEqual(["Changes against revocations list 1:", "  none, the entries are the same."]);
  });

  it("names every new or changed succession, not only the pinned key's", () => {
    const successions = (sequence: number, list: SuccessionList["successions"]): SuccessionList => ({ kind: "successions", sequence, issued: "2026-10-18T12:00:00Z", successions: list });
    const kept = { old: key("1"), new: key("2"), account: "acc1" };
    const added = { old: key("3"), new: key("4"), account: "acc2" };
    const moved = { old: key("1"), new: key("5"), account: "acc1" };
    const review = reviewCatalogList("successions", successions(1, [kept]), successions(2, [moved, added]), []);
    expect(review.successions).toEqual([moved, added]);
    expect(review.refused).toEqual([key("1")]);
  });

  it("says when there is no list yet, and which named ids match nothing", () => {
    const review = reviewCatalogList("blocks", null, blocks(1, [A]), [hash("f")]);
    expect(review.lines).toEqual(["No signed blocks list yet: every entry is new.", `+ ${JSON.stringify(A)}`]);
    expect(review.refused).toEqual([]);
    expect(review.unused).toEqual([hash("f")]);
  });
});

describe("tavora-catalog-sign", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const sign = (dir: string, ...extra: string[]) =>
    spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--conditions=source", path.join(root, "scripts/catalog-sign.ts"), "blocks", path.join(dir, "entries.json"), "--key", path.join(dir, "key.pem"), "--out", path.join(dir, "blocks.json"), ...extra],
      { encoding: "utf8", cwd: root },
    );

  it("signs nothing when the entries drop a block in force, unless it is named", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tavora-catalog-sign-"));
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(path.join(dir, "key.pem"), privateKey.export({ format: "pem", type: "pkcs8" }));
    const served = signCatalogList(blocks(1, [A, B]), privateKey);
    writeFileSync(path.join(dir, "blocks.json"), served);
    writeFileSync(path.join(dir, "entries.json"), JSON.stringify([B]));

    const refused = sign(dir);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain(`- ${JSON.stringify(A)}`);
    expect(refused.stderr).toContain(`--allow-change ${hash("a")}`);
    expect(readFileSync(path.join(dir, "blocks.json"), "utf8")).toBe(served);

    const named = sign(dir, "--allow-change", hash("a"));
    expect(named.status).toBe(0);
    expect(readCatalogList("blocks", readFileSync(path.join(dir, "blocks.json"), "utf8"), catalogPublicKey(privateKey))).toMatchObject({ sequence: 2, blocked: [B] });
  });

  it("signs no revocation with a version still to decide on, and signs it once that is decided", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tavora-catalog-sign-"));
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(path.join(dir, "key.pem"), privateKey.export({ format: "pem", type: "pkcs8" }));
    const out = path.join(dir, "revocations.json");
    const revoke = () =>
      spawnSync(
        process.execPath,
        ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--conditions=source", path.join(root, "scripts/catalog-sign.ts"), "revocations", path.join(dir, "entries.json"), "--key", path.join(dir, "key.pem"), "--out", out],
        { encoding: "utf8", cwd: root },
      );
    const entry = { fingerprint: key("a"), revoked: "2026-10-18T12:00:00Z", allow: [] as string[] };
    writeFileSync(path.join(dir, "entries.json"), JSON.stringify([{ ...entry, decide: [{ sha256: hash("b"), id: "dev.timer", version: "1.0.1", listedAt: "2026-10-17T12:00:00.000Z" }] }]));

    const refused = revoke();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("dev.timer 1.0.1");
    expect(refused.stderr).toContain(hash("b"));
    expect(existsSync(out)).toBe(false);

    writeFileSync(path.join(dir, "entries.json"), JSON.stringify([{ ...entry, allow: [hash("b")] }]));
    expect(revoke().status).toBe(0);
    expect(readCatalogList("revocations", readFileSync(out, "utf8"), catalogPublicKey(privateKey))).toMatchObject({ revoked: [{ fingerprint: key("a"), allow: [hash("b")] }] });
  });
});
