import { createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { addByHand } from "./catalog-add.ts";
import { CatalogStore } from "./catalog.ts";
import { keyFingerprint } from "./publishers.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);

function moduleZip(key: KeyObject, id: string, version = "1.0.0"): Buffer {
  const manifest = { id, name: "Timer", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
  return writeZip([...files, signFiles(files, key)]);
}

function setup() {
  const accounts = new AccountStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-catalog-add-")));
  const linked = (email: string) => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const account = accounts.createAccount({ email }, NOW);
    accounts.linkKey(account.id, keyFingerprint(rawKey(key)), rawKey(key).toString("base64"), NOW);
    return { key, accountId: account.id };
  };
  return { accounts, catalog, linked };
}

describe("catalog add (by hand)", () => {
  it("reserves the prefix for the account the zip's key is linked to", () => {
    const { accounts, catalog, linked } = setup();
    const { key, accountId } = linked("dev@example.com");
    expect(addByHand(catalog, accounts, moduleZip(key, "community.timer"), new Date(NOW))).toMatchObject({ reservedFor: accountId, unheld: false });
    expect(accounts.prefixHolder("community")).toBe(accountId);
    // A later version under the prefix it holds changes nothing.
    expect(addByHand(catalog, accounts, moduleZip(key, "community.timer", "1.0.1"), new Date(NOW))).toMatchObject({ reservedFor: null, unheld: false });
  });

  it("leaves the prefix unheld for a key no account has, which keeps it taken for everyone else", () => {
    const { accounts, catalog, linked } = setup();
    const stranger = generateKeyPairSync("ed25519").privateKey;
    expect(addByHand(catalog, accounts, moduleZip(stranger, "community.timer"), new Date(NOW))).toMatchObject({ reservedFor: null, unheld: true });
    expect(accounts.prefixHolder("community")).toBeNull();
    expect(accounts.prefixCheck(linked("other@example.com").accountId, "community", catalog)).toBe("taken");
  });

  it("refuses a zip under a prefix another account holds, and adds nothing", () => {
    const { accounts, catalog, linked } = setup();
    const holder = linked("holder@example.com");
    accounts.reservePrefix(holder.accountId, "community", NOW);
    const other = linked("other@example.com");
    expect(() => addByHand(catalog, accounts, moduleZip(other.key, "community.timer"), new Date(NOW))).toThrow(/belongs to another account/);
    const stranger = generateKeyPairSync("ed25519").privateKey;
    expect(() => addByHand(catalog, accounts, moduleZip(stranger, "community.notes"), new Date(NOW))).toThrow(/belongs to another account/);
    expect(catalog.modules()).toEqual([]);
  });
});
