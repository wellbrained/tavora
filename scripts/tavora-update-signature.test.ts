import { spawnSync } from "node:child_process";
import { createHash, sign as cryptoSign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { feedTime, makeUpdateKey, signUpdate } from "../apps/desktop/src/main/update-signature";
// @ts-expect-error - plain JavaScript module shared with apps/desktop/scripts/release.mjs
import { addSignatureToLatestYml, feedProblem, freshStatement, refreshLatestYml, signLatestYml } from "../apps/desktop/scripts/update-feed.mjs";
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
type Statement = { channel: string; platform: string; issuedAt: string; expiresAt: string };
function signed(privateKey = release.privateKey, keys = { release: release.publicKey, backup: backup.publicKey }, statement: Statement = freshStatement()): string {
  return signLatestYml({ latestYml: LATEST, version: "1.0.1", file: installer, sha512, privateKey, pinned: keys, statement }).text;
}
const SIGNATURE2 = /^tavoraSignature2:.*\n/m;
/** The feed without its second signature line, as releases before v2 wrote it. */
const v1Only = (feed: string) => feed.replace(SIGNATURE2, "");
/** A statement `days` from now (negative: in the past), good for `span` days. */
const statementAt = (days: number, span = 30): Statement => {
  const issued = new Date(Math.floor(Date.now() / 1000) * 1000 + days * 86_400_000);
  return { channel: "stable", platform: "win-x64", issuedAt: feedTime(issued), expiresAt: feedTime(new Date(issued.getTime() + span * 86_400_000)) };
};
/** A second signature line signed over whatever these fields say, without the signer's own checks (to try the server's). */
function forged2(statement: Statement, key = release.privateKey, update = { version: "1.0.1", file: installer, sha512 }): string {
  const bytes = ["tavora-update-v2", update.version, update.file, update.sha512, statement.channel, statement.platform, statement.issuedAt, statement.expiresAt].join("\n");
  const sig = cryptoSign(null, Buffer.from(bytes), key).toString("base64");
  return `tavoraSignature2: '${[statement.channel, statement.platform, statement.issuedAt, statement.expiresAt, sig].join(" ")}'`;
}
/** A signed feed whose second line is `line`. */
const withLine2 = (line: string, feed = signed()) => feed.replace(/^tavoraSignature2:.*$/m, line);
function run(...args: string[]) {
  // The arguments travel in the environment: Windows mangles a newline inside a command-line argument, but not in a variable.
  const env: Record<string, string> = { ...(process.env as Record<string, string>), TAVORA_HELPER: helper, TAVORA_ARGC: String(args.length) };
  args.forEach((arg, i) => (env[`TAVORA_ARG${i}`] = arg));
  const script = 'list=(); for ((i = 0; i < TAVORA_ARGC; i++)); do name="TAVORA_ARG$i"; list+=("${!name}"); done; exec bash "$TAVORA_HELPER" "${list[@]}"';
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8", env });
  return { ok: result.status === 0, out: result.stdout.trim(), err: result.stderr.trim() };
}
const verify = (feed: string, { keys = pins, version = "1.0.1", file = installer, digest = sha512, live = null as string | null } = {}) =>
  run("verify", keys, write(feed), version, file, digest, ...(live === null ? [] : [write(live)]));
const refreshCheck = (feed: string, live: string, { keys = pins, version = "1.0.1", file = installer, digest = sha512 } = {}) => run("refresh", keys, write(feed), version, file, digest, write(live));

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

// What electron-updater reads latest.yml with (its own js-yaml), to see what an installed Tavora would make of a feed.
const reader = createRequire(desktopRequire.resolve("electron-updater"))("js-yaml") as { load: (text: string) => unknown };
const signedFeed = (unsigned: string) => addSignatureToLatestYml(unsigned, signature);
const withNotes = signedFeed(built(["Fixes", "More fixes"]));
const signatureLine = withNotes.split("\n").find((line: string) => line.startsWith("tavoraSignature:"))!;

// A lone CR is a line break to a YAML reader: inside a notes line it would start keys of their own.
const CR_ATTACK = withNotes.replace("  - Fixes\n", "  - Fixes\rpackages:\r  x64:\r    path: https://evil.example/p.7z\risAdminRightsRequired: true\rstagingPercentage: 0\n");
/** Control characters and separators, each put inside a notes line, between two keys, after the signature and first. */
const SEPARATORS = ["\r", "\u0085", "\u2028", "\u2029", "\v", "\f", "\0", "\t", "\x7f", "\ufeff", "\x1b"];
const FUZZED = SEPARATORS.flatMap((sep) => [
  withNotes.replace("  - Fixes", `  - Fi${sep}xes`),
  withNotes.replace("  - Fixes\n", `  - Fixes${sep}stagingPercentage: 0\n`),
  withNotes.replace("\npath:", `${sep}path:`),
  withNotes.replace("\npath:", `\n${sep}path:`),
  withNotes.replace(signatureLine, `${signatureLine}${sep}`),
  withNotes.replace(signatureLine, `${signatureLine}${sep}isAdminRightsRequired: true`),
  `${sep}${withNotes}`,
]);

/** A feed exactly as `pnpm release` signs it now (both lines), and its second signature line with the line feed. */
const WITH_V2 = signed();
const LINE2 = SIGNATURE2.exec(WITH_V2)![0];

/** Every feed both checks are tried on: electron-builder's own, ones made to slip past, and the fuzzed ones. */
const FEEDS: string[] = [
  ...Object.values(NOTES).map((notes) => signedFeed(built(notes))),
  withNotes,
  signedFeed(LATEST.replace("path:", `  - url: https://evil.example/Tavora-Setup-1.0.1-x64.exe\n    sha512: ${otherSha512}\n    size: 1\npath:`)),
  signedFeed(LATEST.replace("path:", `  - url: Tavora-Setup-1.0.1-x64.exe\n    sha512: ${otherSha512}\n    size: 1\npath:`)),
  signedFeed(LATEST.replace("releaseDate:", "packages:\n  x64:\n    path: x.7z\nreleaseDate:")),
  signedFeed(LATEST.replace("releaseDate:", "isAdminRightsRequired: true\nreleaseDate:")),
  signedFeed(LATEST.replace("releaseDate:", "releaseNotes: |\n  - fine\n  - url: https://evil.example/x.exe\nreleaseDate:")),
  signedFeed(LATEST.replace("releaseDate:", "releaseNotes: |\n  - fine\nurl: https://evil.example/x.exe\nreleaseDate:")),
  signedFeed(LATEST.replace("releaseDate:", "releaseNotes: |\n    deeper\nreleaseDate:")),
  signedFeed(LATEST.replace("releaseDate:", "releaseNotes: >\n  folded\nreleaseDate:")),
  signedFeed(LATEST.replace("releaseDate:", 'releaseNotes: "- a\\tb\\n"\nreleaseDate:')),
  signedFeed(`${LATEST}path: ${installer}\n`),
  signedFeed(LATEST).replace(/\n/g, "\r\n"),
  withNotes.replace(signatureLine, `${signatureLine} # trailing`),
  withNotes.replace(signatureLine, "tavoraSignature: AAAA"),
  CR_ATTACK,
  ...FUZZED,
  // The second signature: where pnpm release puts it, and everywhere else.
  WITH_V2,
  WITH_V2.replace(LINE2, "").replace("\npath:", `\n${LINE2.trimEnd()}\npath:`),
  WITH_V2.replace(LINE2, `${LINE2}${LINE2}`),
  `${LINE2}${WITH_V2.replace(LINE2, "")}`,
  `${WITH_V2.replace(LINE2, "")}${LINE2}`,
  WITH_V2.replace(LINE2, LINE2.replace("stable", "preview")),
  WITH_V2.replace(LINE2, LINE2.replace("win-x64", "win-arm64")),
  WITH_V2.replace(LINE2, LINE2.replace(/Z /, ".000Z ")),
  WITH_V2.replace(LINE2, LINE2.replace(/'\n$/, "' # note\n")),
  WITH_V2.replace(LINE2, LINE2.replace("'", "").replace(/'\n$/, "\n")),
  WITH_V2.replace(LINE2, LINE2.replace("tavoraSignature2:", "tavoraSignature2 :")),
  WITH_V2.replace(/\n/g, "\r\n"),
  ...SEPARATORS.flatMap((sep) => [WITH_V2.replace(LINE2, LINE2.replace(/\n$/, `${sep}\n`)), WITH_V2.replace(LINE2, LINE2.replace(/\n$/, `${sep}isAdminRightsRequired: true\n`))]),
];

describe("what an installed Tavora reads from a feed the checks take", () => {
  it("refuses a lone CR, and every other control character or separator, wherever it is", () => {
    expect(feedProblem(CR_ATTACK, fields)).toContain("control character");
    for (const feed of FUZZED) expect(feedProblem(feed, fields)).toContain("control character");
  });

  it("is only the version, the signature, this one installer, the date and the notes as text", () => {
    let taken = 0;
    for (const feed of FEEDS) {
      if (feedProblem(feed, fields) !== null) continue;
      taken++;
      const info = reader.load(feed) as Record<string, unknown>;
      const keys = Object.keys(info).sort();
      expect(keys.filter((key) => key !== "releaseNotes" && key !== "tavoraSignature2")).toEqual(["files", "path", "releaseDate", "sha512", "tavoraSignature", "version"]);
      expect(info).toMatchObject({ version: "1.0.1", path: installer, sha512, tavoraSignature: signature });
      expect(info.files).toEqual([{ url: installer, sha512, size: 123456 }]);
      if ("releaseNotes" in info) expect(typeof info.releaseNotes).toBe("string");
      // The second signature is always one plain string, never a Date or anything else YAML could make of it.
      if ("tavoraSignature2" in info) expect(info.tavoraSignature2).toMatch(/^stable win-x64 \S+Z \S+Z \S{88}$/);
    }
    expect(taken).toBeGreaterThanOrEqual(5);
  });
});

describe.skipIf(!capable)("the update server and pnpm release agree", () => {
  it("on every feed: the ones electron-builder writes, ones made to slip past, and fuzzed ones", () => {
    for (const feed of FEEDS) {
      const js = feedProblem(feed, fields);
      const server = verify(feed);
      expect({ feed, ok: server.ok }).toEqual({ feed, ok: js === null });
      if (js !== null) expect(server.err).toContain(js.trim());
    }
  }, 120_000);
});

describe.skipIf(!capable)("tavora-update-signature", { timeout: 30_000 }, () => {
  it("takes an update signed by the release or the backup key", () => {
    expect(verify(signed())).toMatchObject({ ok: true, out: expect.stringMatching(/^signed by the release update key\nfresh until \S+Z, signed by the release update key$/) });
    expect(verify(signed(backup.privateKey))).toMatchObject({ ok: true, out: expect.stringMatching(/^signed by the backup update key\nfresh until \S+Z, signed by the backup update key$/) });
    // Without the second line (it isn't required yet), as before.
    expect(verify(v1Only(signed()))).toMatchObject({ ok: true, out: "signed by the release update key" });
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
    expect(verify(feed.replace(line, "tavoraSignature: 'AAAA'")).err).toContain("never has: tavoraSignature: 'AAAA'");
  });

  it("takes the feed as electron-builder writes it, release notes included", () => {
    const notes = signed().replace("releaseDate:", "releaseNotes: |\n  - Faster start\n\n  - Fewer clicks: the menu opens at once\nreleaseDate:");
    expect(verify(notes)).toMatchObject({ ok: true, out: expect.stringMatching(/^signed by the release update key\n/) });
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
    expect(verify(feed.replace(signature, loose(signature))).err).toContain("never has: tavoraSignature:");
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

describe.skipIf(!capable)("tavora-update-signature and the second signature", { timeout: 60_000 }, () => {
  it("takes v1 and v2 by different pinned keys", () => {
    const feed = withLine2(forged2(statementAt(0), backup.privateKey));
    expect(verify(feed)).toMatchObject({ ok: true, out: expect.stringMatching(/^signed by the release update key\nfresh until \S+, signed by the backup update key$/) });
  });

  it("refuses a second signature by a key the app doesn't pin, or over other fields", () => {
    expect(verify(withLine2(forged2(statementAt(0), stranger.privateKey))).err).toContain("second Tavora signature does not match");
    expect(verify(withLine2(forged2(statementAt(0), release.privateKey, { version: "1.0.1", file: installer, sha512: otherSha512 }))).err).toContain("second Tavora signature does not match");
    expect(verify(withLine2(forged2(statementAt(0), release.privateKey, { version: "1.0.2", file: installer, sha512 }))).err).toContain("second Tavora signature does not match");
    const line = SIGNATURE2.exec(signed())![0].trimEnd();
    const swapped = line.replace(/ (\S+Z) (\S+Z) /, (_all, issued, expires) => ` ${issued} ${feedTime(new Date(Date.parse(expires) + 1000))} `);
    expect(verify(withLine2(swapped)).err).toContain("second Tavora signature does not match");
  });

  it("refuses a statement that has expired, is issued in the future or is good for too long", () => {
    expect(verify(withLine2(forged2(statementAt(-40)))).err).toContain("expired at");
    expect(verify(withLine2(forged2(statementAt(1)))).err).toContain("issued in the future");
    expect(verify(withLine2(forged2(statementAt(0, 91)))).err).toContain("more than 90 days");
    expect(verify(withLine2(forged2({ ...statementAt(0), expiresAt: statementAt(-1).issuedAt }))).err).toContain("expires before");
    expect(verify(withLine2(forged2({ ...statementAt(0), expiresAt: "2099-02-30T10:00:00Z" }))).err).toContain("not a real UTC time");
  });

  it("takes a little clock leeway for the issue time", () => {
    expect(verify(withLine2(forged2(statementAt(4 / (24 * 60))))).ok).toBe(true);
  });

  it("with the live feed, takes only a second signature issued after the live one's", () => {
    const live = signed(release.privateKey, undefined, statementAt(-2));
    expect(verify(signed(), { live }).ok).toBe(true);
    expect(verify(signed(), { live: v1Only(live) }).ok).toBe(true);
    expect(verify(signed(release.privateKey, undefined, statementAt(-3)), { live }).err).toContain("not later than the live one");
    expect(verify(live, { live }).err).toContain("not later than the live one");
    // A feed without the second line still goes on (it isn't required yet).
    expect(verify(v1Only(signed()), { live }).ok).toBe(true);
  });
});

describe.skipIf(!capable)("tavora-update-signature refresh", { timeout: 60_000 }, () => {
  const live = signed(release.privateKey, undefined, statementAt(-20));
  const fresh = () => refreshLatestYml({ latestYml: live, privateKey: release.privateKey, pinned: { release: release.publicKey, backup: backup.publicKey }, statement: statementAt(0) }).text as string;

  it("takes the live feed with only a newer second signature, also on a live feed from before v2", () => {
    expect(refreshCheck(fresh(), live)).toMatchObject({ ok: true, out: expect.stringMatching(/^signed by the release update key\nfresh until /) });
    expect(refreshCheck(fresh(), v1Only(live)).ok).toBe(true);
  });

  it("refuses one that changes anything else, or carries no second signature", () => {
    expect(refreshCheck(fresh().replace("releaseDate: '2026-11-14T10:00:00.000Z'", "releaseDate: '2026-11-15T10:00:00.000Z'"), live).err).toContain("changes more than the second signature");
    expect(refreshCheck(fresh().replace("releaseDate:", "releaseNotes: |\n  - new\nreleaseDate:"), live).err).toContain("changes more than the second signature");
    expect(refreshCheck(v1Only(fresh()), live).err).toContain("carries no second signature");
  });

  it("refuses an older or the same statement", () => {
    expect(refreshCheck(live, live).err).toContain("not later than the live one");
    const older = withLine2(forged2(statementAt(-25)), live);
    expect(refreshCheck(older, live).err).toContain("not later than the live one");
  });

  it("refuses a version that isn't the live one, and no live feed", () => {
    const otherLive = live.replace("version: 1.0.1", "version: 1.0.0");
    expect(refreshCheck(fresh(), otherLive).err).toContain("1.0.1 is not the live version");
    expect(run("refresh", pins, write(fresh()), "1.0.1", installer, sha512, path.join(dir, "missing.yml")).err).toContain("no live feed");
    expect(run("refresh", pins, write(fresh()), "1.0.1", installer, sha512).err).toContain("usage");
  });

  it("still checks the signatures and the layout", () => {
    const own = { release: stranger.publicKey, backup: backup.publicKey };
    expect(refreshCheck(fresh(), live, { keys: pinned(own) }).err).toContain("under either pinned update key");
    expect(refreshCheck(withLine2(forged2(statementAt(0), stranger.privateKey), live), live).err).toContain("second Tavora signature does not match");
  });
});
