// The second signature (tavoraSignature2): what it covers, how its value is read, and that the v1 bytes never move.
import { createHash, createPrivateKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FEED_MAX_DAYS,
  feedTime,
  makeUpdateKey,
  rawUpdatePublicKey,
  readPinnedUpdateKeys,
  readSignature2,
  signedUpdate2Bytes,
  signedUpdateBytes,
  signUpdate,
  signUpdate2,
  statementProblem,
  verifyUpdateSignature2,
  type FeedStatement,
  type PinnedUpdateKeys,
} from "./update-signature";

/** A fixed key (seed: 32 bytes of 7), so the signatures below are fixed too: Ed25519 is deterministic. */
const FIXED = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 7)]), format: "der", type: "pkcs8" });
const FIXED_PUBLIC = "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=";
const sha512 = createHash("sha512").update("installer").digest("base64");
const UPDATE = { version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512 };
const STATEMENT: FeedStatement = { channel: "stable", platform: "win-x64", issuedAt: "2026-11-24T10:00:00Z", expiresAt: "2026-12-24T10:00:00Z" };
const V1_SIGNATURE = "TxlAL3JBmtlOYyxQ0bGLvazqC3e5MIcB5Hj8pg76fZRm9zw30D6aaeDI6qdqPIxLDcMy1qGHpcGB36SRwHlFDQ==";
const V2_VALUE = "stable win-x64 2026-11-24T10:00:00Z 2026-12-24T10:00:00Z vnkRzgGc2RbECqPW8ymIHMmCCdHXKNpXMrsoXOGwqTe3Yuv63TZ/OoUOLpLVxyCWCeO6GrS0dY5xQuhZvRl/DQ==";

const release = makeUpdateKey();
const backup = makeUpdateKey();
function keys(pins = { release: release.publicKey, backup: backup.publicKey }): PinnedUpdateKeys {
  const read = readPinnedUpdateKeys(pins);
  if (!read.ok) throw new Error(read.problem);
  return read.keys;
}

describe("the fixed test vectors", () => {
  it("v1: the bytes and the signature are what every app since 0.24.105 rebuilds and checks", () => {
    expect(rawUpdatePublicKey(FIXED)).toBe(FIXED_PUBLIC);
    expect(signedUpdateBytes(UPDATE).toString("utf8")).toBe(`tavora-update-v1\n1.0.1\nTavora-Setup-1.0.1.exe\n${sha512}`);
    expect(signUpdate(UPDATE, FIXED)).toBe(V1_SIGNATURE);
  });

  it("v2: the format, v1's three fields, channel, platform and both times, one per line", () => {
    expect(signedUpdate2Bytes({ ...UPDATE, ...STATEMENT }).toString("utf8")).toBe(
      `tavora-update-v2\n1.0.1\nTavora-Setup-1.0.1.exe\n${sha512}\nstable\nwin-x64\n2026-11-24T10:00:00Z\n2026-12-24T10:00:00Z`,
    );
    expect(signUpdate2({ ...UPDATE, ...STATEMENT }, FIXED)).toBe(V2_VALUE);
    const pins = keys({ release: FIXED_PUBLIC, backup: backup.publicKey });
    expect(verifyUpdateSignature2(UPDATE, V2_VALUE, pins)).toEqual({ ok: true, key: "release", statement: STATEMENT });
  });
});

describe("statementProblem", () => {
  it("takes the stable and preview channels, win-x64, and two real UTC times up to 90 days apart", () => {
    expect(statementProblem(STATEMENT)).toBeNull();
    expect(statementProblem({ ...STATEMENT, channel: "preview" })).toBeNull();
    expect(statementProblem({ ...STATEMENT, expiresAt: feedTime(new Date(Date.parse(STATEMENT.issuedAt) + FEED_MAX_DAYS * 86_400_000)) })).toBeNull();
  });

  it("refuses anything else", () => {
    expect(statementProblem({ ...STATEMENT, channel: "beta" })).toContain("channel");
    expect(statementProblem({ ...STATEMENT, platform: "win-arm64" })).toContain("platform");
    for (const time of ["2026-11-24T10:00:00.000Z", "2026-11-24 10:00:00Z", "2026-11-24T10:00:00+00:00", "2026-02-30T10:00:00Z", "2026-11-24T24:00:00Z", ""]) {
      expect(statementProblem({ ...STATEMENT, issuedAt: time })).toContain("issue time");
    }
    // An unquoted time in YAML becomes a Date: never a statement.
    expect(statementProblem({ ...STATEMENT, issuedAt: new Date(STATEMENT.issuedAt) })).toContain("issue time");
    expect(statementProblem({ ...STATEMENT, expiresAt: STATEMENT.issuedAt })).toContain("not after");
    expect(statementProblem({ ...STATEMENT, expiresAt: "2026-11-23T10:00:00Z" })).toContain("not after");
    expect(statementProblem({ ...STATEMENT, expiresAt: feedTime(new Date(Date.parse(STATEMENT.issuedAt) + FEED_MAX_DAYS * 86_400_000 + 1000)) })).toContain("more than 90 days");
  });
});

describe("readSignature2", () => {
  it("reads the one value form", () => {
    const read = readSignature2(V2_VALUE);
    expect(read).toMatchObject({ ok: true, statement: STATEMENT });
  });

  it("refuses what isn't exactly that form", () => {
    expect(readSignature2(undefined)).toMatchObject({ ok: false, reason: expect.stringContaining("no second") });
    expect(readSignature2(new Date())).toMatchObject({ ok: false, reason: expect.stringContaining("not text") });
    expect(readSignature2(` ${V2_VALUE}`).ok).toBe(false);
    expect(readSignature2(`${V2_VALUE} `).ok).toBe(false);
    expect(readSignature2(V2_VALUE.replace(" win-x64 ", "  win-x64 ")).ok).toBe(false);
    expect(readSignature2(V2_VALUE.replace("stable", "Stable")).ok).toBe(false);
    expect(readSignature2(V2_VALUE.slice(0, -4) + "==").ok).toBe(false);
    // The same bytes in a second spelling (stray bits before the padding) are not the signature.
    const loose = V2_VALUE.slice(0, -3) + String.fromCharCode(V2_VALUE.charCodeAt(V2_VALUE.length - 3) + 1) + "==";
    expect(readSignature2(loose).ok).toBe(false);
  });
});

describe("verifyUpdateSignature2", () => {
  const value = signUpdate2({ ...UPDATE, ...STATEMENT }, release.privateKey);

  it("says which pinned key signed it, the backup key too", () => {
    expect(verifyUpdateSignature2(UPDATE, value, keys())).toEqual({ ok: true, key: "release", statement: STATEMENT });
    expect(verifyUpdateSignature2(UPDATE, signUpdate2({ ...UPDATE, ...STATEMENT }, backup.privateKey), keys())).toMatchObject({ ok: true, key: "backup" });
  });

  it("refuses it for another version, file, SHA-512, channel, platform or time", () => {
    const other = createHash("sha512").update("other").digest("base64");
    expect(verifyUpdateSignature2({ ...UPDATE, version: "1.0.2" }, value, keys()).ok).toBe(false);
    expect(verifyUpdateSignature2({ ...UPDATE, file: "Tavora-Setup-1.0.2.exe" }, value, keys()).ok).toBe(false);
    expect(verifyUpdateSignature2({ ...UPDATE, sha512: other }, value, keys()).ok).toBe(false);
    expect(verifyUpdateSignature2(UPDATE, value.replace("stable", "preview"), keys()).ok).toBe(false);
    expect(verifyUpdateSignature2(UPDATE, value.replace("2026-12-24T10:00:00Z", "2027-01-24T10:00:00Z"), keys()).ok).toBe(false);
    expect(verifyUpdateSignature2(UPDATE, value.replace("2026-11-24T10:00:00Z", "2026-11-25T10:00:00Z"), keys()).ok).toBe(false);
  });

  it("refuses a key the app doesn't pin, and a v1 signature in its place", () => {
    const stranger = makeUpdateKey();
    expect(verifyUpdateSignature2(UPDATE, signUpdate2({ ...UPDATE, ...STATEMENT }, stranger.privateKey), keys()).ok).toBe(false);
    const v1 = signUpdate(UPDATE, release.privateKey);
    expect(verifyUpdateSignature2(UPDATE, `stable win-x64 ${STATEMENT.issuedAt} ${STATEMENT.expiresAt} ${v1}`, keys()).ok).toBe(false);
  });

  it("refuses to sign what it couldn't check", () => {
    expect(() => signUpdate2({ ...UPDATE, ...STATEMENT, channel: "beta" as "stable" }, release.privateKey)).toThrow(/channel/);
    expect(() => signUpdate2({ ...UPDATE, ...STATEMENT, version: "1.0" }, release.privateKey)).toThrow(/plain x.y.z/);
  });
});
