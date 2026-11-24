import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkUpdate, makeUpdateKey, signUpdate, signUpdate2, UPDATE_SIGNATURE2_FIELD, UPDATE_SIGNATURE_FIELD } from "../src/main/update-signature";
import {
  addSignature2ToLatestYml,
  addSignatureToLatestYml,
  checkPinChange,
  feedProblem,
  freshStatement,
  loadUpdateSigningKey,
  readLatestYml,
  readPinsFromSource,
  refreshLatestYml,
  signLatestYml,
  // @ts-expect-error - plain JavaScript module shared with scripts/release.mjs
} from "./update-feed.mjs";

const STATEMENT = { channel: "stable", platform: "win-x64", issuedAt: "2026-11-24T10:00:00Z", expiresAt: "2026-12-24T10:00:00Z" } as const;

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
  it("adds the two signature fields that electron-updater reads, and the app's check takes it", () => {
    const { text, key, statement } = signLatestYml({ latestYml: LATEST, version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512, privateKey: release.privateKey, pinned, statement: STATEMENT });
    expect(key).toBe("release");
    expect(statement).toEqual(STATEMENT);
    // Every line the server checks is still there, unchanged; the two signatures are the new lines, v2 right after v1.
    const added = text.split("\n").filter((line: string) => !LATEST.split("\n").includes(line));
    expect(added).toHaveLength(2);
    expect(added[0]).toMatch(new RegExp(`^${UPDATE_SIGNATURE_FIELD}: '`));
    expect(added[1]).toMatch(new RegExp(`^${UPDATE_SIGNATURE2_FIELD}: 'stable win-x64 2026-11-24T10:00:00Z 2026-12-24T10:00:00Z `));
    const info = parseUpdateInfo(text, "latest.yml", "http://127.0.0.1/latest.yml");
    expect(info.version).toBe("1.0.1");
    expect(info.releaseNotes).toBe("- Faster start\n- version: not a field\n");
    expect(typeof info[UPDATE_SIGNATURE_FIELD]).toBe("string");
    expect(typeof info[UPDATE_SIGNATURE2_FIELD]).toBe("string");
    expect(checkUpdate({ ...info, downloadedFile: "C:\\pending\\Tavora-Setup-1.0.1.exe" }, sha512, pinned, "1.0.0")).toEqual({ ok: true, key: "release" });
  });

  it("leaves the v1 line byte for byte as it was before v2: the feed without the v2 line is the v1-only feed", () => {
    const { text } = signLatestYml({ latestYml: LATEST, version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512, privateKey: release.privateKey, pinned, statement: STATEMENT });
    const v1Only = addSignatureToLatestYml(LATEST, signUpdate({ version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512 }, release.privateKey));
    expect(text.split("\n").filter((line: string) => !line.startsWith(`${UPDATE_SIGNATURE2_FIELD}:`)).join("\n")).toBe(v1Only);
  });

  it("dates the statement now, for 30 days, by default", () => {
    const before = Date.now() - 1000;
    const { statement } = signLatestYml({ latestYml: LATEST, version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512, privateKey: release.privateKey, pinned });
    expect(Date.parse(statement.issuedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(statement.expiresAt) - Date.parse(statement.issuedAt)).toBe(30 * 86_400_000);
    expect(freshStatement(new Date("2026-11-24T10:00:00.789Z"))).toEqual(STATEMENT);
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
    expect(readLatestYml(addSignatureToLatestYml(LATEST, signature))).toEqual({ version: "1.0.1", signature, signatureLines: 1, signature2: null, signature2Lines: 0 });
    expect(readLatestYml(LATEST)).toEqual({ version: "1.0.1", signature: null, signatureLines: 0, signature2: null, signature2Lines: 0 });
    expect(readLatestYml(`version: 1.0.1\n${UPDATE_SIGNATURE_FIELD}: 'a'\n${UPDATE_SIGNATURE_FIELD}: 'b'\n`)).toMatchObject({ signature: null, signatureLines: 2 });
  });
});

describe("readPinsFromSource", () => {
  it("reads the two keys from update-keys.ts as git has it, or null when it pins none", () => {
    const source = `export const PINNED_UPDATE_KEYS = {\n  release: "${release.publicKey}",\n  backup: "${backup.publicKey}",\n};\n`;
    expect(readPinsFromSource(source)).toEqual(pinned);
    expect(readPinsFromSource(source.replaceAll("\n", "\r\n"))).toEqual(pinned);
    expect(readPinsFromSource('export const PINNED_UPDATE_KEYS = {\n  release: "",\n  backup: "",\n};\n')).toBeNull();
    expect(readPinsFromSource(null)).toBeNull();
    expect(readPinsFromSource("nothing here")).toBeNull();
  });
});

describe("checkPinChange", () => {
  const next = makeUpdateKey();

  it("passes the first release with pins, and one signed with a key the last release pins", () => {
    expect(checkPinChange(null, pinned, release.publicKey)).toMatchObject({ problems: [], first: true });
    expect(checkPinChange(pinned, pinned, release.publicKey)).toMatchObject({ problems: [], changed: false });
    expect(checkPinChange(pinned, pinned, backup.publicKey)).toMatchObject({ problems: [], changed: false });
  });

  it("refuses a signing key installed apps don't pin, though this checkout does (they would refuse the release)", () => {
    const moved = { release: next.publicKey, backup: backup.publicKey };
    expect(checkPinChange(pinned, moved, next.publicKey).problems).toEqual([expect.stringMatching(/not one the last release pins/)]);
  });

  it("takes one new key per release (rotation after a lost key), and says the pins changed", () => {
    expect(checkPinChange(pinned, { release: backup.publicKey, backup: next.publicKey }, backup.publicKey)).toMatchObject({ problems: [], changed: true });
    expect(checkPinChange(pinned, { release: release.publicKey, backup: next.publicKey }, release.publicKey)).toMatchObject({ problems: [], changed: true });
    expect(checkPinChange(pinned, { release: backup.publicKey, backup: release.publicKey }, release.publicKey)).toMatchObject({ problems: [], changed: true });
  });

  it("refuses both keys changing at once", () => {
    const other = makeUpdateKey();
    expect(checkPinChange(pinned, { release: next.publicKey, backup: other.publicKey }, release.publicKey).problems).toEqual([expect.stringMatching(/Both pinned update keys change/)]);
  });
});

describe("loadUpdateSigningKey", () => {
  it("never repeats a key pasted into the setting instead of a path", () => {
    const pem = release.privateKey.export({ format: "pem", type: "pkcs8" }) as string;
    const result = loadUpdateSigningKey(pem, pinned);
    expect(result.problem).toMatch(/path to the key file, not the key itself/);
    expect(result.problem).not.toContain(pem.split("\n")[1]);
  });

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

describe("addSignature2ToLatestYml", () => {
  const value = `stable win-x64 2026-11-24T10:00:00Z 2026-12-24T10:00:00Z ${Buffer.alloc(64, 3).toString("base64")}`;
  const v1 = addSignatureToLatestYml("version: 1.0.1\nfiles: []\n", Buffer.alloc(64, 1).toString("base64"));

  it("puts the line right after the v1 line, quoted, and keeps Windows line ends", () => {
    expect(addSignature2ToLatestYml(v1, value).split("\n")[2]).toBe(`${UPDATE_SIGNATURE2_FIELD}: '${value}'`);
    expect(addSignature2ToLatestYml(v1.replaceAll("\n", "\r\n"), value).split("\n")[2]).toBe(`${UPDATE_SIGNATURE2_FIELD}: '${value}'\r`);
  });

  it("replaces the one that is there only when asked (a refresh), never a second", () => {
    const once = addSignature2ToLatestYml(v1, value);
    expect(() => addSignature2ToLatestYml(once, value)).toThrow(/already has/);
    const newer = value.replace("2026-11-24", "2026-11-25");
    expect(addSignature2ToLatestYml(once, newer, { replace: true })).toBe(once.replace(value, newer));
  });

  it("refuses a feed without v1 and a value that isn't one", () => {
    expect(() => addSignature2ToLatestYml("version: 1.0.1\n", value)).toThrow(/no tavoraSignature line/);
    expect(() => addSignature2ToLatestYml(v1, "stable win-x64 x")).toThrow(/not a tavoraSignature2 value/);
  });
});

describe("feedProblem and the second signature", () => {
  const fields = { version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512 };
  const { text } = signLatestYml({ latestYml: LATEST, ...fields, privateKey: release.privateKey, pinned, statement: STATEMENT });
  const line = text.split("\n").find((l: string) => l.startsWith(`${UPDATE_SIGNATURE2_FIELD}:`))!;
  const withoutLine = text.replace(`${line}\n`, "");

  it("takes it right after v1, and a feed without it (it isn't required yet)", () => {
    expect(feedProblem(text, fields)).toBeNull();
    expect(feedProblem(withoutLine, fields)).toBeNull();
  });

  it("refuses it anywhere else, twice, for another channel or platform, or in another form", () => {
    expect(feedProblem(withoutLine.replace("\npath:", `\n${line}\npath:`), fields)).toContain("right after its tavoraSignature line");
    expect(feedProblem(`${line}\n${withoutLine}`, fields)).toContain("right after its tavoraSignature line");
    expect(feedProblem(text.replace(line, `${line}\n${line}`), fields)).toContain("right after its tavoraSignature line");
    expect(feedProblem(text.replace(line, line.replace("stable", "preview")), fields)).toContain("never has");
    expect(feedProblem(text.replace(line, line.replace("win-x64", "win-arm64")), fields)).toContain("never has");
    expect(feedProblem(text.replace(line, line.replace("10:00:00Z ", "10:00:00.000Z ")), fields)).toContain("never has");
    expect(feedProblem(text.replace(line, line.replace(/'$/, "' # note")), fields)).toContain("never has");
    expect(feedProblem(text.replace(line, line.replace("'stable", "stable").replace(/'$/, "")), fields)).toContain("never has");
  });
});

describe("refreshLatestYml", () => {
  const fields = { version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512 };
  const live = signLatestYml({ latestYml: LATEST, ...fields, privateKey: release.privateKey, pinned, statement: STATEMENT }).text;
  const later = { ...STATEMENT, issuedAt: "2026-12-01T10:00:00Z", expiresAt: "2026-12-31T10:00:00Z" };

  it("signs only v2 again, later; every other line stays byte for byte", () => {
    const { text, statement, previous, key } = refreshLatestYml({ latestYml: live, privateKey: backup.privateKey, pinned, statement: later });
    expect({ statement, previous, key }).toEqual({ statement: later, previous: STATEMENT, key: "backup" });
    const others = (feed: string) => feed.split("\n").filter((l) => !l.startsWith(`${UPDATE_SIGNATURE2_FIELD}:`));
    expect(others(text)).toEqual(others(live));
    expect(text).not.toBe(live);
    expect(feedProblem(text, fields)).toBeNull();
  });

  it("adds v2 to a live feed from before it", () => {
    const v1Only = live.split("\n").filter((l: string) => !l.startsWith(`${UPDATE_SIGNATURE2_FIELD}:`)).join("\n");
    expect(refreshLatestYml({ latestYml: v1Only, privateKey: release.privateKey, pinned, statement: later })).toMatchObject({ previous: null, statement: later });
  });

  it("refuses a statement no later than the live one, or for another channel", () => {
    expect(() => refreshLatestYml({ latestYml: live, privateKey: release.privateKey, pinned, statement: STATEMENT })).toThrow(/not later/);
    expect(() => refreshLatestYml({ latestYml: live, privateKey: release.privateKey, pinned, statement: { ...later, issuedAt: "2026-11-01T10:00:00Z" } })).toThrow(/not later/);
    expect(() => refreshLatestYml({ latestYml: live, privateKey: release.privateKey, pinned, statement: { ...later, channel: "preview" } })).toThrow(/is for stable win-x64/);
  });

  it("refuses a live feed whose signatures don't hold under the pins, or that isn't a release's feed", () => {
    const stranger = makeUpdateKey();
    const others = { release: stranger.publicKey, backup: backup.publicKey };
    expect(() => refreshLatestYml({ latestYml: live, privateKey: backup.privateKey, pinned: others, statement: later })).toThrow(/signature does not check out/);
    const forged = addSignature2ToLatestYml(live, signUpdate2({ ...fields, ...STATEMENT, expiresAt: "2026-12-25T10:00:00Z" }, stranger.privateKey), { replace: true });
    expect(() => refreshLatestYml({ latestYml: forged, privateKey: release.privateKey, pinned, statement: later })).toThrow(/second signature does not check out/);
    expect(() => refreshLatestYml({ latestYml: live.replace("releaseDate:", "isAdminRightsRequired: true\nreleaseDate:"), privateKey: release.privateKey, pinned, statement: later })).toThrow(/not the feed a release writes/);
    expect(() => refreshLatestYml({ latestYml: LATEST, privateKey: release.privateKey, pinned, statement: later })).toThrow(/exactly one tavoraSignature/);
  });

  it("refuses to sign with a key the pins don't name", () => {
    const stranger = makeUpdateKey();
    expect(() => refreshLatestYml({ latestYml: live, privateKey: stranger.privateKey, pinned, statement: later })).toThrow(/does not check out/);
  });
});
