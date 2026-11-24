// The key compatibility test of the second signature (vault Github/Tavora/docs/update-signature-binding.md): a feed
// that carries tavoraSignature2 must pass electron-updater's own parser and the update check of every Tavora already
// installed, unchanged. Those checks are saved as they shipped (test/fixtures/old-update-checkers).
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as v0_24_105 from "../../test/fixtures/old-update-checkers/0.24.105/main/update-signature";
import * as v0_25_3 from "../../test/fixtures/old-update-checkers/0.25.3/main/update-signature";
import { checkUpdate, makeUpdateKey, signUpdate2 } from "./update-signature";
// @ts-expect-error - plain JavaScript module shared with scripts/release.mjs
import { signLatestYml } from "../../scripts/update-feed.mjs";

// The parser an installed app reads latest.yml with (electron-updater's generic provider: js-yaml load, no schema).
const { parseUpdateInfo } = createRequire(import.meta.url)("electron-updater/out/providers/Provider.js") as {
  parseUpdateInfo: (text: string, file: string, url: string) => Record<string, unknown>;
};
const parse = (text: string) => parseUpdateInfo(text, "latest.yml", "https://updates.mytavora.app/latest.yml");

const release = makeUpdateKey();
const backup = makeUpdateKey();
const pinned = { release: release.publicKey, backup: backup.publicKey };
const sha512 = createHash("sha512").update("installer").digest("base64");
const FILE = "Tavora-Setup-1.0.1.exe";
const LATEST = [
  "version: 1.0.1",
  "files:",
  `  - url: ${FILE}`,
  `    sha512: ${sha512}`,
  "    size: 123456",
  `path: ${FILE}`,
  `sha512: ${sha512}`,
  "releaseNotes: |",
  "  - Faster start",
  "releaseDate: '2026-11-24T10:00:00.000Z'",
  "",
].join("\n");
const STATEMENT = { channel: "stable", platform: "win-x64", issuedAt: "2026-11-24T10:00:00Z", expiresAt: "2026-12-24T10:00:00Z" } as const;
const feed: string = signLatestYml({ latestYml: LATEST, version: "1.0.1", file: FILE, sha512, privateKey: release.privateKey, pinned, statement: STATEMENT }).text;
const v2Line = feed.split("\n").find((line) => line.startsWith("tavoraSignature2:"))!;
/** A feed with only the v2 line (what a preview channel would serve): never a v1 signature. */
const v2Only = LATEST.replace("version: 1.0.1\n", `version: 1.0.1\n${v2Line}\n`);
const downloaded = (info: Record<string, unknown>) => ({ ...info, downloadedFile: path.join("pending", FILE) });

const CHECKERS = { "0.24.105": v0_24_105.checkUpdate, "0.25.3": v0_25_3.checkUpdate, "this version": checkUpdate };

describe("a feed with the second signature, read by apps already installed", () => {
  it("parses with electron-updater: the new line is one plain string, everything else as before", () => {
    const info = parse(feed);
    expect(info).toMatchObject({ version: "1.0.1", path: FILE, sha512, releaseNotes: "- Faster start\n" });
    expect(info.tavoraSignature2).toBe(v2Line.slice("tavoraSignature2: '".length, -1));
    expect(typeof info.tavoraSignature).toBe("string");
  });

  for (const [version, check] of Object.entries(CHECKERS)) {
    it(`passes ${version}'s check for a newer version, and its refusals stay as they were`, () => {
      const info = downloaded(parse(feed));
      expect(check(info, sha512, pinned, "1.0.0")).toEqual({ ok: true, key: "release" });
      expect(check(info, sha512, pinned, "1.0.1")).toMatchObject({ ok: false });
      expect(check(info, createHash("sha512").update("other").digest("base64"), pinned, "1.0.0")).toMatchObject({ ok: false });
      // A broken or foreign second line changes nothing for them: they never read it.
      const foreign = signUpdate2({ version: "1.0.1", file: FILE, sha512, ...STATEMENT }, makeUpdateKey().privateKey);
      expect(check(downloaded(parse(feed.replace(v2Line, `tavoraSignature2: '${foreign}'`))), sha512, pinned, "1.0.0")).toEqual({ ok: true, key: "release" });
    });

    it(`is refused by ${version}'s check without a v1 line (a v2-only feed, as a preview channel would serve)`, () => {
      expect(check(downloaded(parse(v2Only)), sha512, pinned, "1.0.0")).toMatchObject({ ok: false, reason: expect.stringContaining("no Tavora signature") });
    });
  }
});
