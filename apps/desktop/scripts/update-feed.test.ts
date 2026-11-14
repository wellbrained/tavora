import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkUpdate, makeUpdateKey, UPDATE_SIGNATURE_FIELD } from "../src/main/update-signature";
// @ts-expect-error - plain JavaScript module shared with scripts/release.mjs
import { addSignatureToLatestYml, loadUpdateSigningKey, readLatestYml, signLatestYml } from "./update-feed.mjs";

// The parser the app itself reads latest.yml with (electron-updater's generic provider).
const { parseUpdateInfo } = createRequire(import.meta.url)("electron-updater/out/providers/Provider.js") as { parseUpdateInfo: (text: string, file: string, url: string) => Record<string, unknown> };

const release = makeUpdateKey();
const backup = makeUpdateKey();
const pinned = { release: release.publicKey, backup: backup.publicKey };
const sha512 = createHash("sha512").update("installer").digest("base64");

/** latest.yml as electron-builder writes it. */
const LATEST = [
  "version: 1.0.1",
  "files:",
  "  - url: Tavora-Setup-1.0.1.exe",
  `    sha512: ${sha512}`,
  "    size: 123456",
  "path: Tavora-Setup-1.0.1.exe",
  `sha512: ${sha512}`,
  "releaseDate: '2026-11-14T10:00:00.000Z'",
  "releaseNotes: |",
  "  - Faster start",
  "  - version: not a field",
  "",
].join("\n");

async function keyFile(pem: string) {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "tavora-update-key-")), "update.pem");
  await writeFile(file, pem);
  return file;
}

describe("signLatestYml", () => {
  it("adds one signature field that electron-updater reads, and the app's check takes it", () => {
    const { text, key } = signLatestYml({ latestYml: LATEST, version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512, privateKey: release.privateKey, pinned });
    expect(key).toBe("release");
    // Every line the server checks is still there, unchanged; the signature is the one new line.
    expect(text.split("\n").filter((line: string) => !LATEST.split("\n").includes(line))).toHaveLength(1);
    const info = parseUpdateInfo(text, "latest.yml", "http://127.0.0.1/latest.yml");
    expect(info.version).toBe("1.0.1");
    expect(info.releaseNotes).toBe("- Faster start\n- version: not a field\n");
    expect(typeof info[UPDATE_SIGNATURE_FIELD]).toBe("string");
    expect(checkUpdate({ ...info, downloadedFile: "C:\\pending\\Tavora-Setup-1.0.1.exe" }, sha512, pinned, "1.0.0")).toEqual({ ok: true, key: "release" });
  });

  it("signs with the backup key too", () => {
    expect(signLatestYml({ latestYml: LATEST, version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512, privateKey: backup.privateKey, pinned }).key).toBe("backup");
  });

  it("refuses a key the app does not pin, a latest.yml of another version, and one that is already signed", () => {
    const stranger = makeUpdateKey();
    expect(() => signLatestYml({ latestYml: LATEST, version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512, privateKey: stranger.privateKey, pinned })).toThrow(/does not check out/);
    expect(() => signLatestYml({ latestYml: LATEST, version: "1.0.2", file: "Tavora-Setup-1.0.2.exe", sha512, privateKey: release.privateKey, pinned })).toThrow(/says version 1.0.1/);
    const { text } = signLatestYml({ latestYml: LATEST, version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512, privateKey: release.privateKey, pinned });
    expect(() => signLatestYml({ latestYml: text, version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512, privateKey: release.privateKey, pinned })).toThrow(/already has/);
  });

  it("refuses while the app pins placeholders", () => {
    expect(() => signLatestYml({ latestYml: LATEST, version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512, privateKey: release.privateKey, pinned: { release: "", backup: "" } })).toThrow(/still empty/);
  });
});

describe("addSignatureToLatestYml", () => {
  const signature = Buffer.alloc(64, 1).toString("base64");

  it("puts the field right after the version line, quoted, and keeps Windows line ends", () => {
    expect(addSignatureToLatestYml("version: 1.0.1\nfiles: []\n", signature)).toBe(`version: 1.0.1\n${UPDATE_SIGNATURE_FIELD}: '${signature}'\nfiles: []\n`);
    expect(addSignatureToLatestYml("version: 1.0.1\r\nfiles: []\r\n", signature)).toBe(`version: 1.0.1\r\n${UPDATE_SIGNATURE_FIELD}: '${signature}'\r\nfiles: []\r\n`);
  });

  it("refuses no version line, a signature that isn't one, and a second signature", () => {
    expect(() => addSignatureToLatestYml("files: []\n", signature)).toThrow(/no version/);
    expect(() => addSignatureToLatestYml("version: 1.0.1\n", "abc")).toThrow(/not an Ed25519 signature/);
    expect(() => addSignatureToLatestYml(`version: 1.0.1\n${UPDATE_SIGNATURE_FIELD}: 'x'\n`, signature)).toThrow(/already has/);
  });
});

describe("readLatestYml", () => {
  it("reads the version and the one signature", () => {
    const signature = Buffer.alloc(64, 2).toString("base64");
    expect(readLatestYml(addSignatureToLatestYml(LATEST, signature))).toEqual({ version: "1.0.1", signature, signatureLines: 1 });
    expect(readLatestYml(LATEST)).toEqual({ version: "1.0.1", signature: null, signatureLines: 0 });
    expect(readLatestYml(`version: 1.0.1\n${UPDATE_SIGNATURE_FIELD}: 'a'\n${UPDATE_SIGNATURE_FIELD}: 'b'\n`)).toMatchObject({ signature: null, signatureLines: 2 });
  });
});

describe("loadUpdateSigningKey", () => {
  it("takes a pinned key's private half and says which one it is", async () => {
    const file = await keyFile(release.privateKey.export({ format: "pem", type: "pkcs8" }) as string);
    expect(loadUpdateSigningKey(file, pinned)).toMatchObject({ which: "release" });
    const other = await keyFile(backup.privateKey.export({ format: "pem", type: "pkcs8" }) as string);
    expect(loadUpdateSigningKey(other, pinned)).toMatchObject({ which: "backup" });
  });

  it("says why it can't sign: no setting, no file, not a key, a key the app does not pin, placeholder pins", async () => {
    expect(loadUpdateSigningKey(undefined, pinned).problem).toMatch(/TAVORA_UPDATE_KEY/);
    expect(loadUpdateSigningKey(path.join(tmpdir(), "no-such-key.pem"), pinned).problem).toMatch(/Can't read/);
    expect(loadUpdateSigningKey(await keyFile("not a key"), pinned).problem).toMatch(/Can't read/);
    const stranger = makeUpdateKey();
    expect(loadUpdateSigningKey(await keyFile(stranger.privateKey.export({ format: "pem", type: "pkcs8" }) as string), pinned).problem).toMatch(/neither of the keys pinned/);
    const file = await keyFile(release.privateKey.export({ format: "pem", type: "pkcs8" }) as string);
    expect(loadUpdateSigningKey(file, { release: "", backup: "" }).problem).toMatch(/still empty/);
  });
});
