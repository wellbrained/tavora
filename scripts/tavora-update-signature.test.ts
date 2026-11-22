import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeUpdateKey } from "../apps/desktop/src/main/update-signature";
// @ts-expect-error - plain JavaScript module shared with apps/desktop/scripts/release.mjs
import { signLatestYml } from "../apps/desktop/scripts/update-feed.mjs";

// The server's check (deploy/server/tavora-update-signature) against what `pnpm release` really signs. It needs
// OpenSSL 3, as the server does: CI (Ubuntu) has it and must run this; a PC without it skips.
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const helper = path.join(repo, "deploy/server/tavora-update-signature");
const pinsFile = path.join(repo, "apps/desktop/src/main/update-keys.ts");
const openssl = spawnSync("openssl", ["version"], { encoding: "utf8" });
const capable = openssl.status === 0 && openssl.stdout.startsWith("OpenSSL 3.");
if (!capable && process.env.CI) throw new Error(`CI must check the server's update signature check, but openssl is ${openssl.stdout || "missing"}`);

const release = makeUpdateKey();
const backup = makeUpdateKey();
const stranger = makeUpdateKey();
const installer = "Tavora-Setup-1.0.1.exe";
const sha512 = createHash("sha512").update("installer").digest("base64");
const otherSha512 = createHash("sha512").update("another installer").digest("base64");
const LATEST = ["version: 1.0.1", "files:", `  - url: ${installer}`, `    sha512: ${sha512}`, "    size: 123456", `path: ${installer}`, `sha512: ${sha512}`, "releaseDate: '2026-11-14T10:00:00.000Z'", ""].join("\n");

const dir = mkdtempSync(path.join(tmpdir(), "tavora-update-signature-"));
let files = 0;
function write(text: string): string {
  const file = path.join(dir, `f${++files}`);
  writeFileSync(file, text);
  return file;
}
/** update-keys.ts as the repo has it, with these keys pinned. */
function pinned(keys: { release: string; backup: string }): string {
  return write(readFileSync(pinsFile, "utf8").replace(/^ {2}release: ".*",$/m, `  release: "${keys.release}",`).replace(/^ {2}backup: ".*",$/m, `  backup: "${keys.backup}",`));
}
const pins = pinned({ release: release.publicKey, backup: backup.publicKey });
function signed(privateKey = release.privateKey, keys = { release: release.publicKey, backup: backup.publicKey }): string {
  return signLatestYml({ latestYml: LATEST, version: "1.0.1", file: installer, sha512, privateKey, pinned: keys }).text;
}
function run(...args: string[]) {
  const result = spawnSync("bash", [helper, ...args], { encoding: "utf8" });
  return { ok: result.status === 0, out: result.stdout.trim(), err: result.stderr.trim() };
}
const verify = (feed: string, { keys = pins, version = "1.0.1", file = installer, digest = sha512 } = {}) => run("verify", keys, write(feed), version, file, digest);

describe.skipIf(!capable)("tavora-update-signature", () => {
  it("takes an update signed by the release or the backup key", () => {
    expect(verify(signed())).toMatchObject({ ok: true, out: "signed by the release update key" });
    expect(verify(signed(backup.privateKey))).toMatchObject({ ok: true, out: "signed by the backup update key" });
  });

  it("refuses an unsigned update", () => {
    expect(verify(LATEST)).toMatchObject({ ok: false, err: expect.stringContaining("no Tavora signature") });
  });

  it("refuses a signature by a key the app doesn't pin", () => {
    const own = { release: stranger.publicKey, backup: backup.publicKey };
    expect(verify(signed(stranger.privateKey, own))).toMatchObject({ ok: false, err: expect.stringContaining("under either pinned update key") });
  });

  it("refuses the genuine signature on another installer, version or file name", () => {
    const feed = signed();
    expect(verify(feed, { digest: otherSha512 }).ok).toBe(false);
    expect(verify(feed.replace("version: 1.0.1", "version: 1.0.2"), { version: "1.0.2" }).ok).toBe(false);
    expect(verify(feed, { file: "Tavora-Setup-1.0.2.exe" }).ok).toBe(false);
  });

  it("refuses a feed with two signatures, or one that isn't 64 bytes", () => {
    const feed = signed();
    const line = feed.split("\n").find((l: string) => l.startsWith("tavoraSignature:"))!;
    expect(verify(`${feed}${line}\n`).err).toContain("more than one");
    expect(verify(feed.replace(line, "tavoraSignature: 'AAAA'")).err).toContain("not 64 bytes");
  });

  it("refuses fields the app would refuse", () => {
    const feed = signed();
    expect(verify(feed, { version: "1.0.1\nx" }).err).toContain("not a plain x.y.z version");
    expect(verify(feed, { file: "../Tavora.exe" }).err).toContain("not a plain file name");
    expect(verify(feed, { digest: "abc" }).err).toContain("not 64 bytes of base64");
  });

  it("refuses everything without pinned keys", () => {
    expect(verify(signed(), { keys: path.join(dir, "missing.ts") }).err).toContain("no pinned update keys");
    expect(verify(signed(), { keys: pinned({ release: "", backup: backup.publicKey }) }).err).toContain("does not pin one release key");
  });

  it("checks the pins the setup installs", () => {
    expect(run("keys", pinsFile)).toMatchObject({ ok: true, out: "two pinned update keys" });
    expect(run("keys", pins).ok).toBe(true);
    expect(run("keys", pinned({ release: release.publicKey, backup: release.publicKey })).err).toContain("the same key");
    expect(run("keys", pinned({ release: "", backup: backup.publicKey })).ok).toBe(false);
  });
});
