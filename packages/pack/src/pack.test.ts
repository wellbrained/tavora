import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isOwnerId } from "@tavora/module-schema";
import { describe, expect, it } from "vitest";
import { fingerprint, loadExistingKey, packModule, PackError, PrivateKeyError, privateKeyFile, readZip, SIGNATURE_FILE, signFiles, verifyFiles, writeZip, ZIP_LIMITS, ZipError, type ZipFile } from "./index.ts";

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
    await expect(packModule(linked, key())).rejects.toThrow(/goes through a link/);
  });

  it("refuses a folder link that leads out of the module", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "tavora-outside-"));
    await writeFile(path.join(outside, "index.html"), "<p>not yours</p>");
    await writeFile(path.join(outside, "icon.png"), "png");

    // The entry's own folder is a link.
    const linkedDist = await moduleFolder();
    await rm(path.join(linkedDist, "dist"), { recursive: true });
    await symlink(outside, path.join(linkedDist, "dist"), "junction");
    await expect(packModule(linkedDist, key())).rejects.toThrow(/link/);

    // A folder on the way to the icon is a link.
    const linkedIcon = await moduleFolder();
    await writeFile(path.join(linkedIcon, "tavora.module.json"), JSON.stringify({ ...manifest, icon: "art/icon.png" }));
    await symlink(outside, path.join(linkedIcon, "art"), "junction");
    await expect(packModule(linkedIcon, key())).rejects.toThrow(/link/);

    // A link inside the entry's folder is refused too, not skipped silently.
    const linkedInside = await moduleFolder();
    await symlink(outside, path.join(linkedInside, "dist", "extra"), "junction");
    await expect(packModule(linkedInside, key())).rejects.toThrow(/link/);
  });
});

describe("packModule versions", () => {
  it("refuses a pre-release version, so only plain major.minor.patch reaches users", async () => {
    const dir = await moduleFolder({ "tavora.module.json": JSON.stringify({ ...manifest, version: "0.1.0-alpha.44" }) });
    await expect(packModule(dir, key())).rejects.toThrow("version 0.1.0-alpha.44 is a pre-release; module versions are plain major.minor.patch, e.g. 0.1.0");
  });
});

describe("packModule and private keys", () => {
  const rootEntry = { ...manifest, entry: "index.html" };
  const pem = (label: string) => `-----BEGIN ${label}-----\n${"MC4CAQAwBQYDK2VwBCIEIBn0cXXkq6oAQx3sF0kzM1v7Lw0aZ9vX4pOa2c3nRk1y".slice(0, 64)}\n-----END ${label}-----\n`;
  const rootModule = (extra: Record<string, string> = {}) => moduleFolder({ "tavora.module.json": JSON.stringify(rootEntry), "index.html": "<p>hi</p>", ...extra });

  it("stops when the module folder holds a key file, by its extension", async () => {
    for (const name of ["publisher-key.pem", "id.KEY", "cert.p12", "cert.pfx", "putty.ppk", "keys/old.pem"]) {
      const error = await packModule(await rootModule({ [name]: "anything" }), key()).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PrivateKeyError);
      expect((error as PrivateKeyError).file).toBe(name);
      expect((error as Error).message).toMatch(/private key/);
    }
  });

  it("stops on a file that holds a private key, whatever its name", async () => {
    for (const label of ["PRIVATE KEY", "RSA PRIVATE KEY", "OPENSSH PRIVATE KEY", "ENCRYPTED PRIVATE KEY", "PGP PRIVATE KEY BLOCK"]) {
      await expect(packModule(await rootModule({ "notes.txt": `my key:\n${pem(label)}` }), key())).rejects.toThrow(PrivateKeyError);
    }
    // In a built bundle, escaped as a string.
    await expect(packModule(await moduleFolder({ "dist/assets/app.js": `const k = ${JSON.stringify(pem("PRIVATE KEY"))};` }), key())).rejects.toThrow(/dist\/assets\/app\.js/);
    // A legacy encrypted key has headers before its body.
    const encrypted = `-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF\n\n${"A".repeat(64)}\n-----END RSA PRIVATE KEY-----`;
    await expect(packModule(await rootModule({ "data.bin": encrypted }), key())).rejects.toThrow(PrivateKeyError);
    await expect(packModule(await rootModule({ "k": "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\n" }), key())).rejects.toThrow(PrivateKeyError);
  });

  it("stops on the --key file itself, found by its path", async () => {
    const dir = await rootModule({ signing: "not a pem at all" });
    await expect(packModule(dir, key(), { keyFile: path.join(dir, "signing") })).rejects.toThrow(PrivateKeyError);
    // Outside the folder it is fine.
    await expect(packModule(dir, key(), { keyFile: path.join(tmpdir(), "elsewhere.pem") })).resolves.toBeDefined();
  });

  it("packs code that only names a key format, and public keys and certificates", async () => {
    const code = 'export const toPem = (b) => "-----BEGIN PRIVATE KEY-----\\n" + b + "\\n-----END PRIVATE KEY-----";';
    const publicPem = pem("PUBLIC KEY") + pem("CERTIFICATE");
    const { zip } = await packModule(await moduleFolder({ "dist/assets/pem.js": code, "dist/key.pub": publicPem, "dist/readme.txt": "Never ship your PRIVATE KEY." }), key());
    expect(readZip(zip).map((file) => file.name)).toContain("dist/assets/pem.js");
  });

  it("finds a key among zip files for the catalog", () => {
    const file = (name: string, body: string): ZipFile => ({ name, data: Buffer.from(body) });
    expect(privateKeyFile([file("a.js", "x"), file("b.txt", pem("EC PRIVATE KEY"))])).toBe("b.txt");
    expect(privateKeyFile([file("a.js", "x"), file("Key.PEM", "")])).toBe("Key.PEM");
    expect(privateKeyFile([file("a.js", "x"), file("key.pub", pem("PUBLIC KEY"))])).toBeNull();
  });
});

describe("packModule with a changelog", () => {
  const withChangelog = { ...manifest, changelog: "changelog.json" };

  it("packs the changelog the manifest names", async () => {
    const dir = await moduleFolder({ "tavora.module.json": JSON.stringify(withChangelog), "changelog.json": JSON.stringify([{ version: "1.0.0", notes: ["First release."] }]) });
    const names = readZip((await packModule(dir, key())).zip).map((file) => file.name);
    expect(names).toContain("changelog.json");
  });

  it("refuses a missing or invalid changelog, so users never get one Tavora cannot show", async () => {
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

describe("loadExistingKey", () => {
  it("reads a key file and never makes one", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "tavora-key-")), "key.pem");
    await expect(loadExistingKey(file)).rejects.toThrow(/no publisher key/);
    const { privateKey } = generateKeyPairSync("ed25519");
    await writeFile(file, privateKey.export({ format: "pem", type: "pkcs8" }));
    expect(fingerprint((await loadExistingKey(file)).key)).toBe(fingerprint(privateKey));
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

describe("createKeyFile", () => {
  it("writes a new Ed25519 key that loads again, readable by its owner only, and never overwrites a file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tavora-key-"));
    const file = path.join(dir, "tavora.key");
    const { createKeyFile, loadExistingKey } = await import("./index.ts");
    const { key } = await createKeyFile(file);
    expect(fingerprint(key)).toBe(fingerprint((await loadExistingKey(file)).key));
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o077).toBe(0);
    await expect(createKeyFile(file)).rejects.toThrow(/already exists/);
    expect(fingerprint((await loadExistingKey(file)).key)).toBe(fingerprint(key));
  });
});
