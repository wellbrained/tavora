import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isOwnerId } from "@tavora/module-schema";
import { describe, expect, it } from "vitest";
import { fingerprint, loadOrCreateKey, packModule, PackError, readZip, SIGNATURE_FILE, signFiles, verifyFiles, writeZip, ZIP_LIMITS, ZipError, type ZipFile } from "./index.ts";

const manifest = {
  id: "wellbrained.tracker",
  name: "Tracker",
  version: "1.0.0",
  apiVersion: "1",
  entry: "dist/index.html",
  games: [],
  viewport: { minWidth: 100, minHeight: 100 },
  permissions: { network: [] },
};

async function moduleFolder(extra: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-pack-"));
  const files: Record<string, string> = {
    "tavora.module.json": JSON.stringify(manifest),
    "dist/index.html": "<!doctype html><p>hi</p>",
    "dist/assets/app.js": "console.log(1)",
    "src/main.ts": "secret source",
    "package.json": "{}",
    ...extra,
  };
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), body);
  }
  return dir;
}

const key = () => generateKeyPairSync("ed25519").privateKey;

describe("packModule", () => {
  it("packs the manifest and the entry's folder, signed, and the zip reads back", async () => {
    const privateKey = key();
    const { zip } = await packModule(await moduleFolder(), privateKey);
    const files = readZip(zip);
    expect(files.map((file) => file.name).sort()).toEqual(["dist/assets/app.js", "dist/index.html", "tavora.module.json", SIGNATURE_FILE]);
    const result = verifyFiles(files);
    expect(result).toEqual({ ok: true, owner: fingerprint(privateKey), signed: true });
    expect(isOwnerId(fingerprint(privateKey))).toBe(true);
    // The same files give the same zip.
    expect((await packModule(await moduleFolder(), privateKey)).zip.equals(zip)).toBe(true);
  });

  it("refuses an unbuilt module and a link", async () => {
    const dir = await moduleFolder();
    await writeFile(path.join(dir, "tavora.module.json"), JSON.stringify({ ...manifest, entry: "dist/missing.html" }));
    await expect(packModule(dir, key())).rejects.toThrow(PackError);

    const linked = await moduleFolder();
    await writeFile(path.join(linked, "tavora.module.json"), JSON.stringify({ ...manifest, icon: "icon.png" }));
    await symlink("/etc/hostname", path.join(linked, "icon.png"));
    await expect(packModule(linked, key())).rejects.toThrow(/not a plain file/);
  });
});

describe("packModule with a changelog", () => {
  const withChangelog = { ...manifest, changelog: "changelog.json" };

  it("packs the changelog the manifest names", async () => {
    const dir = await moduleFolder({ "tavora.module.json": JSON.stringify(withChangelog), "changelog.json": JSON.stringify([{ version: "1.0.0", notes: ["First release."] }]) });
    const names = readZip((await packModule(dir, key())).zip).map((file) => file.name);
    expect(names).toContain("changelog.json");
  });

  it("refuses a missing or invalid changelog, so players never get one Tavora cannot show", async () => {
    await expect(packModule(await moduleFolder({ "tavora.module.json": JSON.stringify(withChangelog) }), key())).rejects.toThrow("the changelog changelog.json is missing");
    await expect(packModule(await moduleFolder({ "tavora.module.json": JSON.stringify(withChangelog), "changelog.json": "{" }), key())).rejects.toThrow(/not valid JSON/);
    await expect(packModule(await moduleFolder({ "tavora.module.json": JSON.stringify(withChangelog), "changelog.json": JSON.stringify([{ version: "1", notes: ["x"] }]) }), key())).rejects.toThrow(/version must be semver/);
  });
});

describe("verifyFiles", () => {
  const files: ZipFile[] = [
    { name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) },
    { name: "dist/index.html", data: Buffer.from("<p>hi</p>") },
  ];

  it("treats an unsigned package as local", () => {
    expect(verifyFiles(files)).toEqual({ ok: true, owner: "local", signed: false });
  });

  it("refuses a changed, added or missing file", () => {
    const signature = signFiles(files, key());
    expect(verifyFiles([{ ...files[0]!, data: Buffer.from("{}") }, files[1]!, signature])).toMatchObject({ ok: false });
    expect(verifyFiles([...files, { name: "dist/extra.js", data: Buffer.from("x") }, signature])).toMatchObject({ ok: false });
    expect(verifyFiles([files[0]!, signature])).toMatchObject({ ok: false });
  });

  it("refuses a signature by another key over the same hashes, and a damaged signature file", () => {
    const signature = JSON.parse(signFiles(files, key()).data.toString());
    const other = JSON.parse(signFiles(files, key()).data.toString());
    const swapped = { ...signature, publicKey: other.publicKey };
    expect(verifyFiles([...files, { name: SIGNATURE_FILE, data: Buffer.from(JSON.stringify(swapped)) }])).toMatchObject({ ok: false });
    expect(verifyFiles([...files, { name: SIGNATURE_FILE, data: Buffer.from("{") }])).toMatchObject({ ok: false });
    expect(verifyFiles([...files, { name: SIGNATURE_FILE, data: Buffer.from(JSON.stringify({ ...signature, extra: 1 })) }])).toMatchObject({ ok: false });
  });

  it("gives another key another owner, so its data stays apart (S5)", () => {
    const a = verifyFiles([...files, signFiles(files, key())]);
    const b = verifyFiles([...files, signFiles(files, key())]);
    expect(a.ok && b.ok && a.owner !== b.owner).toBe(true);
  });
});

describe("readZip", () => {
  const plain = (name: string) => ({ name, data: Buffer.from(name) });

  it("refuses unsafe names", () => {
    for (const name of ["../x", "/abs", "a/../b", "C:/x", "a\\b", "con.txt", "dir/NUL", "a./b", "x "]) {
      expect(() => writeZip([plain(name)])).toThrow(ZipError);
      expect(() => readZip(renamed(writeZip([plain("a".repeat(name.length))]), name))).toThrow(ZipError);
    }
  });

  it("refuses names that differ only in case", () => {
    expect(() => readZip(writeZip([plain("dist/A.js"), plain("dist/a.js")]))).toThrow(/twice/);
  });

  it("refuses symlinks and encrypted entries", () => {
    const zip = writeZip([plain("link")]);
    const at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const link = Buffer.from(zip);
    link.writeUInt16LE((3 << 8) | 20, at + 4);
    link.writeUInt32LE((0o120777 << 16) >>> 0, at + 38);
    expect(() => readZip(link)).toThrow(/link/);
    const encrypted = Buffer.from(zip);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(at + 8) | 1, at + 8);
    expect(() => readZip(encrypted)).toThrow(/encrypted/);
  });

  it("caps size, file count and compression", () => {
    const bomb = writeZip([{ name: "zeros", data: Buffer.alloc(5 * 1024 * 1024) }]);
    expect(() => readZip(bomb)).toThrow(/far more/);
    expect(() => readZip(writeZip([plain("a"), plain("b"), plain("c")]), { ...ZIP_LIMITS, maxFiles: 2 })).toThrow(/too many/);
    expect(() => readZip(writeZip([plain("a")]), { ...ZIP_LIMITS, maxArchiveBytes: 10 })).toThrow(/too big/);
  });

  it("refuses a file that unpacks to more than it says", () => {
    const zip = writeZip([{ name: "a", data: Buffer.alloc(1000, 1) }]);
    const at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const lying = Buffer.from(zip);
    lying.writeUInt32LE(10, at + 24);
    expect(() => readZip(lying)).toThrow(ZipError);
    expect(() => readZip(Buffer.from("not a zip"))).toThrow(ZipError);
  });
});

describe("loadOrCreateKey", () => {
  it("makes a key once, private to the owner, and reuses it", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "tavora-key-")), "nested", "key.pem");
    const first = await loadOrCreateKey(file);
    const again = await loadOrCreateKey(file);
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.key.export({ format: "pem", type: "pkcs8" })).toBe(await readFile(file, "utf8"));
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o077).toBe(0);
  });
});

/** Rewrites the one file name in a zip made by writeZip (same length), past the writer's own checks. */
function renamed(zip: Buffer, name: string): Buffer {
  const out = Buffer.from(zip);
  const replacement = Buffer.from(name);
  for (const signature of [[0x50, 0x4b, 0x03, 0x04, 30], [0x50, 0x4b, 0x01, 0x02, 46]] as const) {
    const at = out.indexOf(Buffer.from(signature.slice(0, 4)));
    replacement.copy(out, at + signature[4]);
  }
  return out;
}
