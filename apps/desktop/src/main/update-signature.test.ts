import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PINNED_UPDATE_KEYS } from "./update-keys";
import {
  checkDownloadedUpdate,
  checkUpdate,
  makeUpdateKey,
  rawUpdatePublicKey,
  readPinnedUpdateKeys,
  signedUpdateBytes,
  signUpdate,
  UPDATE_SIGNATURE_FIELD,
  verifyUpdateSignature,
  type PinnedUpdateKeys,
  type SignedUpdate,
} from "./update-signature";

const release = makeUpdateKey();
const backup = makeUpdateKey();
const stranger = makeUpdateKey();
const pinned = { release: release.publicKey, backup: backup.publicKey };

function keys(): PinnedUpdateKeys {
  const read = readPinnedUpdateKeys(pinned);
  if (!read.ok) throw new Error(read.problem);
  return read.keys;
}

const sha512 = (text: string) => createHash("sha512").update(text).digest("base64");
const UPDATE: SignedUpdate = { version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512: sha512("installer") };

describe("signedUpdateBytes", () => {
  it("is the format line, the version, the file name and the SHA-512, one per line", () => {
    expect(signedUpdateBytes(UPDATE).toString("utf8")).toBe(`tavora-update-v1\n1.0.1\nTavora-Setup-1.0.1.exe\n${UPDATE.sha512}`);
  });

  it("refuses fields that could make the signed text read two ways", () => {
    expect(() => signedUpdateBytes({ ...UPDATE, version: "1.0.1\nTavora-Setup-1.0.1.exe" })).toThrow(/version/);
    expect(() => signedUpdateBytes({ ...UPDATE, file: "a\nb.exe" })).toThrow(/file name/);
    expect(() => signedUpdateBytes({ ...UPDATE, sha512: `${UPDATE.sha512}\n` })).toThrow(/SHA-512/);
  });

  // Ed25519 signatures are deterministic: if this changes, every installed app would refuse every new release.
  it("signs exactly as before (a fixed test vector)", () => {
    const seed = Buffer.alloc(32, 7);
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
    const update = { version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512: sha512("Tavora test installer") };
    expect(update.sha512).toBe("A4/+xL5PVWb5a7dvZF8RLrFcoQ4ZREeyzv/XpcxRoWBqs32SVfAItRtuAfq0o9r75A3inWX+kNlTIWAcC1LMsA==");
    expect(rawUpdatePublicKey(key)).toBe("6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=");
    expect(signUpdate(update, key)).toBe("8hv+Gnvuvu6cn/C7bOdDZuodruVWpkYdJGHXfeintraypPHHSyXXjiXJtlMLYad3YemowvJq71fIv/VP0PfADQ==");
  });
});

describe("signUpdate", () => {
  it("needs an Ed25519 private key", () => {
    expect(() => signUpdate(UPDATE, release.privateKey)).not.toThrow();
    expect(() => signUpdate(UPDATE, keys().release)).toThrow(/private key/);
    expect(() => signUpdate(UPDATE, generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey)).toThrow(/Ed25519/);
  });
});

describe("verifyUpdateSignature", () => {
  const signature = signUpdate(UPDATE, release.privateKey);

  it("takes a signature by the release key, and one by the backup key", () => {
    expect(verifyUpdateSignature(UPDATE, signature, keys())).toEqual({ ok: true, key: "release" });
    expect(verifyUpdateSignature(UPDATE, signUpdate(UPDATE, backup.privateKey), keys())).toEqual({ ok: true, key: "backup" });
  });

  it("refuses a signature by any other key", () => {
    expect(verifyUpdateSignature(UPDATE, signUpdate(UPDATE, stranger.privateKey), keys())).toMatchObject({ ok: false, reason: expect.stringMatching(/does not match/) });
  });

  it("refuses when the version, the file name or the SHA-512 differ from what was signed", () => {
    expect(verifyUpdateSignature({ ...UPDATE, version: "1.0.2" }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, version: "2.0.1" }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, file: "Tavora-Setup-1.0.2.exe" }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, file: "tavora-setup-1.0.1.exe" }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, sha512: sha512("another installer") }, signature, keys()).ok).toBe(false);
  });

  it("refuses an Ed25519 signature over the same fields without the format line (another kind of Tavora signature)", () => {
    const bare = sign(null, Buffer.from([UPDATE.version, UPDATE.file, UPDATE.sha512].join("\n")), release.privateKey).toString("base64");
    expect(verifyUpdateSignature(UPDATE, bare, keys()).ok).toBe(false);
    const json = sign(null, Buffer.from(JSON.stringify(UPDATE)), release.privateKey).toString("base64");
    expect(verifyUpdateSignature(UPDATE, json, keys()).ok).toBe(false);
  });

  it("says so when latest.yml has no signature", () => {
    for (const missing of [undefined, null, ""]) {
      expect(verifyUpdateSignature(UPDATE, missing, keys())).toEqual({ ok: false, reason: "latest.yml has no Tavora signature" });
    }
  });

  it("refuses a signature that is not exactly 64 bytes of canonical base64", () => {
    const bad = [
      123,
      true,
      [signature],
      { signature },
      "not base64 at all!",
      signature.slice(0, -2), // padding cut off
      `${signature} `,
      ` ${signature}`,
      `${signature}\n`,
      `${signature}AAAA`, // extra bytes after the signature
      Buffer.alloc(63).toString("base64"),
      Buffer.alloc(65).toString("base64"),
      signature.replace(/=+$/, "").replace(/.$/, "B") + "==", // non-canonical last character
    ];
    for (const value of bad) {
      const result = verifyUpdateSignature(UPDATE, value, keys());
      expect(result.ok, JSON.stringify(value)).toBe(false);
    }
    expect(verifyUpdateSignature(UPDATE, "not base64 at all!", keys())).toEqual({ ok: false, reason: "the Tavora signature is not 64 bytes of base64" });
  });

  it("refuses fields that are missing or not plain", () => {
    expect(verifyUpdateSignature({ ...UPDATE, version: undefined }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, version: "1.0.1-beta" }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, version: "01.0.1" }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, version: 1 }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, file: undefined }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, file: "../Tavora-Setup-1.0.1.exe" }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, file: "dir/Tavora-Setup-1.0.1.exe" }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, file: "dir\\Tavora-Setup-1.0.1.exe" }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, sha512: undefined }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, sha512: createHash("sha256").update("x").digest("base64") }, signature, keys()).ok).toBe(false);
    expect(verifyUpdateSignature({ ...UPDATE, sha512: createHash("sha512").update("installer").digest("hex") }, signature, keys()).ok).toBe(false);
  });
});

describe("readPinnedUpdateKeys", () => {
  it("takes two different real keys", () => {
    expect(readPinnedUpdateKeys(pinned).ok).toBe(true);
  });

  it("refuses empty placeholders, so a build that pins none can't ship", () => {
    expect(readPinnedUpdateKeys({ release: "", backup: "" })).toEqual({ ok: false, problem: expect.stringMatching(/release update key is still empty/) });
    expect(readPinnedUpdateKeys({ release: release.publicKey, backup: "" })).toEqual({ ok: false, problem: expect.stringMatching(/backup update key is still empty/) });
  });

  it("refuses the same key twice, keys that aren't Ed25519 public keys, and other shapes", () => {
    expect(readPinnedUpdateKeys({ release: release.publicKey, backup: release.publicKey }).ok).toBe(false);
    expect(readPinnedUpdateKeys({ release: "abc", backup: backup.publicKey }).ok).toBe(false);
    expect(readPinnedUpdateKeys({ release: Buffer.alloc(31).toString("base64"), backup: backup.publicKey }).ok).toBe(false);
    expect(readPinnedUpdateKeys({ release: ` ${release.publicKey}`, backup: backup.publicKey }).ok).toBe(false);
    expect(readPinnedUpdateKeys({ release: release.publicKey }).ok).toBe(false);
    expect(readPinnedUpdateKeys({ ...pinned, spare: stranger.publicKey }).ok).toBe(false);
    expect(readPinnedUpdateKeys(null).ok).toBe(false);
    expect(readPinnedUpdateKeys([release.publicKey, backup.publicKey]).ok).toBe(false);
    expect(readPinnedUpdateKeys("keys").ok).toBe(false);
  });

  it("reads the keys this checkout pins (empty until the maintainer pastes them, which only a release refuses)", () => {
    const read = readPinnedUpdateKeys(PINNED_UPDATE_KEYS);
    if (PINNED_UPDATE_KEYS.release === "" || PINNED_UPDATE_KEYS.backup === "") expect(read.ok).toBe(false);
    else expect(read).toMatchObject({ ok: true });
  });
});

describe("checkUpdate", () => {
  const signed = { version: "1.0.1", downloadedFile: "C:\\Users\\me\\AppData\\Local\\tavora-updater\\pending\\Tavora-Setup-1.0.1.exe", [UPDATE_SIGNATURE_FIELD]: signUpdate(UPDATE, release.privateKey) };

  it("takes a version signed for the file the updater saved and the bytes in it, newer than this one", () => {
    expect(checkUpdate(signed, UPDATE.sha512, pinned, "1.0.0")).toEqual({ ok: true, key: "release" });
    expect(checkUpdate({ ...signed, downloadedFile: "/home/me/.cache/tavora-updater/pending/Tavora-Setup-1.0.1.exe" }, UPDATE.sha512, pinned, "1.0.0")).toEqual({ ok: true, key: "release" });
  });

  it("refuses when the bytes downloaded are not the ones signed, whatever latest.yml says", () => {
    expect(checkUpdate(signed, sha512("tampered"), pinned, "1.0.0").ok).toBe(false);
  });

  it("refuses an installer saved under another name, or no file at all", () => {
    expect(checkUpdate({ ...signed, downloadedFile: "C:\\pending\\Tavora-Setup-1.0.2.exe" }, UPDATE.sha512, pinned, "1.0.0").ok).toBe(false);
    expect(checkUpdate({ ...signed, downloadedFile: undefined }, UPDATE.sha512, pinned, "1.0.0")).toEqual({ ok: false, reason: "the updater named no downloaded file" });
    expect(checkUpdate({ ...signed, downloadedFile: "" }, UPDATE.sha512, pinned, "1.0.0").ok).toBe(false);
  });

  it("refuses when the updater installs another version than the one signed", () => {
    expect(checkUpdate({ ...signed, version: "1.0.2" }, UPDATE.sha512, pinned, "1.0.0").ok).toBe(false);
  });

  it("refuses a signed version that is not newer than this one (an old release served again)", () => {
    expect(checkUpdate(signed, UPDATE.sha512, pinned, "1.0.1")).toEqual({ ok: false, reason: "1.0.1 is not newer than this version (1.0.1)" });
    expect(checkUpdate(signed, UPDATE.sha512, pinned, "1.0.10").ok).toBe(false);
    expect(checkUpdate(signed, UPDATE.sha512, pinned, "2.0.0").ok).toBe(false);
    expect(checkUpdate(signed, UPDATE.sha512, pinned, "0.99.99")).toEqual({ ok: true, key: "release" });
  });

  it("refuses when this version is malformed: never newer, never equal", () => {
    for (const current of ["", "1.0", "1.0.x", "01.0.0", "1.0.0-beta.1", "1.0.0\n", "NaN.NaN.NaN"]) {
      expect(checkUpdate(signed, UPDATE.sha512, pinned, current)).toEqual({ ok: false, reason: `1.0.1 is not newer than this version (${current})` });
    }
  });

  it("refuses a malformed feed version even when it is signed, whether or not this version is plain", () => {
    for (const version of ["1.0", "1.0.x", "01.0.1", "1.0.1-beta.1", ""]) {
      const odd = { version, file: UPDATE.file, sha512: UPDATE.sha512 };
      expect(() => signUpdate(odd, release.privateKey)).toThrow(/can't sign/);
      expect(checkUpdate({ ...signed, version }, UPDATE.sha512, pinned, "1.0.0").ok).toBe(false);
      expect(checkUpdate({ ...signed, version }, UPDATE.sha512, pinned, version).ok).toBe(false);
    }
  });

  it("refuses without a signature, and with unusable pinned keys", () => {
    const { [UPDATE_SIGNATURE_FIELD]: _, ...unsigned } = signed;
    expect(checkUpdate(unsigned, UPDATE.sha512, pinned, "1.0.0")).toEqual({ ok: false, reason: "latest.yml has no Tavora signature" });
    expect(checkUpdate(signed, UPDATE.sha512, { release: "", backup: "" }, "1.0.0")).toMatchObject({ ok: false, reason: expect.stringMatching(/still empty/) });
  });

  it("refuses feed fields the signature doesn't cover that change how the installer runs", () => {
    expect(checkUpdate({ ...signed, files: [{ url: "Tavora-Setup-1.0.1.exe", isAdminRightsRequired: true }] }, UPDATE.sha512, pinned, "1.0.0")).toEqual({ ok: false, reason: "the feed asks to install with admin rights" });
    expect(checkUpdate({ ...signed, isAdminRightsRequired: true }, UPDATE.sha512, pinned, "1.0.0").ok).toBe(false);
    expect(checkUpdate({ ...signed, packages: { x64: { path: "x.7z" } } }, UPDATE.sha512, pinned, "1.0.0")).toEqual({ ok: false, reason: "the feed names an extra package to download" });
    // What electron-builder writes for Tavora passes.
    expect(checkUpdate({ ...signed, files: [{ url: "Tavora-Setup-1.0.1.exe", sha512: UPDATE.sha512, size: 1 }] }, UPDATE.sha512, pinned, "1.0.0").ok).toBe(true);
  });

  it("takes the backup key, and only the two pinned keys", () => {
    expect(checkUpdate({ ...signed, [UPDATE_SIGNATURE_FIELD]: signUpdate(UPDATE, backup.privateKey) }, UPDATE.sha512, pinned, "1.0.0")).toEqual({ ok: true, key: "backup" });
    expect(checkUpdate({ ...signed, [UPDATE_SIGNATURE_FIELD]: signUpdate(UPDATE, stranger.privateKey) }, UPDATE.sha512, pinned, "1.0.0").ok).toBe(false);
    expect(checkUpdate(signed, UPDATE.sha512, { release: stranger.publicKey, backup: backup.publicKey }, "1.0.0").ok).toBe(false);
  });
});

describe("checkDownloadedUpdate", () => {
  async function installer(content: string) {
    const dir = await mkdtemp(path.join(tmpdir(), "tavora-update-"));
    const file = path.join(dir, "Tavora-Setup-1.0.1.exe");
    await writeFile(file, content);
    return file;
  }

  it("hashes the file the updater saved and checks the signature against it", async () => {
    const file = await installer("the real installer");
    const signature = signUpdate({ version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512: sha512("the real installer") }, release.privateKey);
    expect(await checkDownloadedUpdate({ version: "1.0.1", downloadedFile: file, [UPDATE_SIGNATURE_FIELD]: signature }, pinned, "1.0.0")).toEqual({ ok: true, key: "release" });
  });

  it("refuses a file whose bytes were changed after signing", async () => {
    const file = await installer("the real installer, changed");
    const signature = signUpdate({ version: "1.0.1", file: "Tavora-Setup-1.0.1.exe", sha512: sha512("the real installer") }, release.privateKey);
    expect((await checkDownloadedUpdate({ version: "1.0.1", downloadedFile: file, [UPDATE_SIGNATURE_FIELD]: signature }, pinned, "1.0.0")).ok).toBe(false);
  });

  it("refuses a file that can't be read", async () => {
    const file = path.join(path.dirname(await installer("x")), "gone", "Tavora-Setup-1.0.1.exe");
    expect(await checkDownloadedUpdate({ version: "1.0.1", downloadedFile: file, [UPDATE_SIGNATURE_FIELD]: "x" }, pinned, "1.0.0")).toMatchObject({ ok: false, reason: expect.stringMatching(/can't be read/) });
  });
});
