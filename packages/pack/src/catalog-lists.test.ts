import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { catalogPublicKey, isNewerCatalogList, nextCatalogList, readCatalogList, signCatalogList, type BlockList } from "./index.ts";

const catalogue = generateKeyPairSync("ed25519").privateKey;
const publicKey = catalogPublicKey(catalogue);
const hash = (c: string) => c.repeat(64);
const blocks = (sequence: number, issued = "2026-10-18T12:00:00Z"): BlockList => ({ kind: "blocks", sequence, issued, blocked: [{ sha256: hash("a"), reason: "Sends your files away." }] });

describe("catalog lists", () => {
  it("reads back a list it signed, only as its own kind", () => {
    const text = signCatalogList(blocks(1), catalogue);
    expect(readCatalogList("blocks", text, publicKey)).toEqual(blocks(1));
    expect(readCatalogList("revocations", text, publicKey)).toBeNull();
  });

  it("ignores a list signed by another key, or changed after signing (C2)", () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    expect(readCatalogList("blocks", signCatalogList(blocks(1), other), publicKey)).toBeNull();
    const file = JSON.parse(signCatalogList(blocks(1), catalogue)) as { payload: string };
    file.payload = file.payload.replace(hash("a"), hash("b"));
    expect(readCatalogList("blocks", JSON.stringify(file), publicKey)).toBeNull();
    expect(readCatalogList("blocks", "not json", publicKey)).toBeNull();
    expect(readCatalogList("blocks", signCatalogList(blocks(1), catalogue), "")).toBeNull();
  });

  it("refuses to sign entries that are not in the format", () => {
    expect(() => nextCatalogList("blocks", [{ sha256: "abc", reason: "x" }], null, new Date())).toThrow(/not a valid blocks list/);
    expect(() => nextCatalogList("blocks", [{ sha256: hash("a"), reason: "line\nbreak" }], null, new Date())).toThrow();
    expect(() => nextCatalogList("successions", [{ old: "0".repeat(32), new: "0".repeat(32), account: "a" }], null, new Date())).toThrow();
    expect(() => nextCatalogList("revocations", [{ fingerprint: "0".repeat(32), revoked: "yesterday", allow: [] }], null, new Date())).toThrow();
  });

  it("numbers each list after the one before it and never goes back in time", () => {
    const first = nextCatalogList("blocks", [], null, new Date("2026-10-18T12:00:00.123Z"));
    expect(first).toEqual({ kind: "blocks", sequence: 1, issued: "2026-10-18T12:00:00Z", blocked: [] });
    const second = nextCatalogList("blocks", [], first, new Date("2026-10-19T00:00:00Z"));
    expect(second.sequence).toBe(2);
    expect(() => nextCatalogList("blocks", [], second, new Date("2026-10-18T00:00:00Z"))).toThrow(/clock/);
  });

  it("takes only a list with a higher sequence that was not issued earlier", () => {
    expect(isNewerCatalogList(blocks(2), blocks(1))).toBe(true);
    expect(isNewerCatalogList(blocks(1), blocks(2))).toBe(false);
    expect(isNewerCatalogList(blocks(2), blocks(2))).toBe(false);
    expect(isNewerCatalogList(blocks(3, "2026-01-01T00:00:00Z"), blocks(2))).toBe(false);
    expect(isNewerCatalogList(blocks(1), null)).toBe(true);
  });
});
