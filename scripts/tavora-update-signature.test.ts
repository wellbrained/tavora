import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { makeUpdateKey, signUpdate } from "../apps/desktop/src/main/update-signature";
// @ts-expect-error - plain JavaScript module shared with apps/desktop/scripts/release.mjs
import { addSignatureToLatestYml, feedProblem, signLatestYml } from "../apps/desktop/scripts/update-feed.mjs";
// @ts-expect-error - plain JavaScript module shared with apps/desktop/scripts/release.mjs
import { feedNoteProblem } from "../apps/desktop/scripts/release-notes.mjs";

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

// latest.yml exactly as electron-builder writes it (app-builder-lib's updateInfoBuilder, builder-util's serializeToYaml).
const desktopRequire = createRequire(path.join(repo, "apps/desktop/package.json"));
const yaml = createRequire(createRequire(desktopRequire.resolve("electron-builder")).resolve("builder-util"))("js-yaml") as { dump: (value: unknown, options: object) => string };
function built(notes: string[] | null): string {
  const info = { version: "1.0.1", files: [{ url: installer, sha512, size: 123456 }], path: installer, sha512, ...(notes ? { releaseNotes: notes.map((note) => `- ${note}`).join("\n") + "\n" } : {}), releaseDate: "2026-11-14T10:00:00.000Z" };
  return yaml.dump(info, { lineWidth: 8000, skipInvalid: false, noRefs: true });
}
const signature = signUpdate({ version: "1.0.1", file: installer, sha512 }, release.privateKey);
const fields = { version: "1.0.1", file: installer, sha512 };

/** Notes electron-builder keeps as a plain block, and ones it quotes or folds; the early check must tell them apart. */
const NOTES: Record<string, string[] | null> = {
  none: null,
  plain: ["Faster start", "Ümlaut für dich 🎉, „Anführung“ und — Strich"],
  links: ["See https://docs.mytavora.app and url: here", "# not a comment", "key: value", "'quotes' and \"more\""],
  tab: ["a\tb"],
  nbsp: ["z.\u00a0B."],
  lineSeparator: ["a\u2028b"],
  nextLine: ["a\u0085b"],
  bom: ["\ufeffa"],
  long: ["word ".repeat(1700)],
};

describe("the update server's feed check, and the same check in pnpm release", () => {
  it("takes a feed exactly when electron-builder keeps the notes plain, and the early note check says so first", () => {
    for (const [name, notes] of Object.entries(NOTES)) {
      const feed = built(notes);
      const early = (notes ?? []).map(feedNoteProblem).filter(Boolean);
      const unsigned = feedProblem(feed, fields, { signed: false });
      expect({ name, early: early.length === 0 }).toEqual({ name, early: unsigned === null });
      expect({ name, signed: feedProblem(addSignatureToLatestYml(feed, signature), fields) }).toEqual({ name, signed: unsigned });
    }
  });

  it("refuses a built feed that is signed already, or isn't for this installer", () => {
    const feed = built(NOTES.plain!);
    expect(feedProblem(addSignatureToLatestYml(feed, signature), fields, { signed: false })).toContain("already has a tavoraSignature");
    expect(feedProblem(feed, { ...fields, sha512: otherSha512 }, { signed: false })).toContain("files list must hold exactly this installer");
    expect(feedProblem(feed, fields)).toContain("exactly one tavoraSignature");
  });
});

describe.skipIf(!capable)("the update server and pnpm release agree", () => {
  it("on every feed: the ones electron-builder writes, and ones made to slip past", () => {
    const made = [
      ...Object.values(NOTES).map(built),
      LATEST.replace("path:", `  - url: https://evil.example/Tavora-Setup-1.0.1-x64.exe\n    sha512: ${otherSha512}\n    size: 1\npath:`),
      LATEST.replace("path:", `  - url: Tavora-Setup-1.0.1-x64.exe\n    sha512: ${otherSha512}\n    size: 1\npath:`),
      LATEST.replace("releaseDate:", "packages:\n  x64:\n    path: x.7z\nreleaseDate:"),
      LATEST.replace("releaseDate:", "isAdminRightsRequired: true\nreleaseDate:"),
      LATEST.replace("releaseDate:", "releaseNotes: |\n  - fine\n  - url: https://evil.example/x.exe\nreleaseDate:"),
      LATEST.replace("releaseDate:", "releaseNotes: |\n  - fine\nurl: https://evil.example/x.exe\nreleaseDate:"),
      LATEST.replace("releaseDate:", "releaseNotes: |\n    deeper\nreleaseDate:"),
      LATEST.replace("releaseDate:", "releaseNotes: >\n  folded\nreleaseDate:"),
      LATEST.replace("releaseDate:", 'releaseNotes: "- a\\tb\\n"\nreleaseDate:'),
      `${LATEST}path: ${installer}\n`,
      LATEST.replace(/\n/g, "\r\n"),
    ];
    for (const unsigned of made) {
      const feed = addSignatureToLatestYml(unsigned, signature);
      const js = feedProblem(feed, fields);
      const server = verify(feed);
      expect({ feed, ok: server.ok }).toEqual({ feed, ok: js === null });
      if (js !== null) expect(server.err).toContain(js.trim());
    }
  }, 60_000);
});

describe.skipIf(!capable)("tavora-update-signature", { timeout: 30_000 }, () => {
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

  it("takes the feed as electron-builder writes it, release notes included", () => {
    const notes = signed().replace("releaseDate:", "releaseNotes: |\n  - Faster start\n\n  - Fewer clicks: the menu opens at once\nreleaseDate:");
    expect(verify(notes)).toMatchObject({ ok: true, out: "signed by the release update key" });
  });

  it("refuses a second installer in the files list, also one at an address", () => {
    const feed = signed();
    const second = feed.replace("path:", `  - url: Tavora-Setup-1.0.1-x64.exe\n    sha512: ${otherSha512}\n    size: 1\npath:`);
    expect(verify(second)).toMatchObject({ ok: false, err: expect.stringContaining("more than one url") });
    const away = feed.replace("path:", `  - url: https://evil.example/Tavora-Setup-1.0.1-x64.exe\n    sha512: ${otherSha512}\n    size: 1\npath:`);
    expect(verify(away)).toMatchObject({ ok: false, err: expect.stringContaining("names an address") });
    expect(verify(feed.replace(`  - url: ${installer}`, `  - url: https://evil.example/${installer}`)).err).toContain("names an address");
    expect(verify(feed.replace(`  - url: ${installer}`, "  - url: Other.exe")).err).toContain("files list must hold exactly this installer");
  });

  it("takes links in the release notes, which can never be keys there", () => {
    const notes = signed().replace("releaseDate:", "releaseNotes: |\n  - See https://docs.mytavora.app\n  - url: is just text here\nreleaseDate:");
    expect(verify(notes).ok).toBe(true);
  });

  it("refuses anything else the signature doesn't cover", () => {
    const feed = signed();
    expect(verify(feed.replace("releaseDate:", "isAdminRightsRequired: true\nreleaseDate:")).err).toContain("never has: isAdminRightsRequired");
    expect(verify(feed.replace("releaseDate:", "packages:\n  x64:\n    path: x.7z\nreleaseDate:")).err).toContain("never has: packages:");
    expect(verify(feed.replace("    size: 123456\n", "    size: 123456\n    isAdminRightsRequired: true\n")).err).toContain("never has");
    expect(verify(feed.replace(`path: ${installer}`, "path: Other.exe")).err).toContain("never has: path: Other.exe");
    expect(verify(`${feed}path: ${installer}\n`).err).toContain("exactly one path");
    expect(verify(feed.replace(`path: ${installer}\n`, "")).err).toContain("exactly one path");
    expect(verify(feed.replace("releaseDate:", "releaseNotes: |\n    indented more\nreleaseDate:")).err).toContain("never has");
    expect(verify(feed.replace("version: 1.0.1", "version: 1.0.1\nversion: 1.0.1")).err).toContain("exactly one version");
    expect(verify(feed.replace(/\n/g, "\r\n")).ok).toBe(false);
  });

  it("refuses base64 the app wouldn't take, even when it decodes to the same bytes", () => {
    const feed = signed();
    const line = feed.split("\n").find((l: string) => l.startsWith("tavoraSignature:"))!;
    const signature = line.slice("tavoraSignature: '".length, -1);
    const loose = (value: string) => value.slice(0, -3) + String.fromCharCode(value.charCodeAt(value.length - 3) + 1) + value.slice(-2);
    expect(Buffer.from(loose(signature), "base64")).toEqual(Buffer.from(signature, "base64"));
    expect(verify(feed.replace(signature, loose(signature))).err).toContain("not 64 bytes of base64");
    expect(verify(feed, { digest: loose(sha512) }).err).toContain("not 64 bytes of base64");
    const key = release.publicKey;
    const looseKey = key.slice(0, -2) + String.fromCharCode(key.charCodeAt(key.length - 2) + 1) + "=";
    expect(verify(feed, { keys: pinned({ release: looseKey, backup: backup.publicKey }) }).err).toContain("does not pin one release key");
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
