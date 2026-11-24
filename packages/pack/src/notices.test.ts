import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNotices, declaredLicence, holderOf, licenceFiles, packagesInPaths, readThirdParty } from "./notices.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "tavora-notices-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const MIT = "MIT License\n\nCopyright (c) 2020 Someone";

/** A package folder in root/node_modules with a package.json text (as given) and files. */
function install(name: string, manifest: string | null, files: Record<string, string | Buffer> = {}): string {
  const dir = path.join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  if (manifest !== null) writeFileSync(path.join(dir, "package.json"), manifest);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), body);
  }
  return dir;
}

describe("packagesInPaths", () => {
  it("reads a package.json with a byte order mark", () => {
    const dir = install("bom", `﻿${JSON.stringify({ name: "bom", version: "1.0.0", license: "MIT" })}`);
    expect(packagesInPaths([path.join(dir, "index.js")]).map((p) => `${p.name}@${p.version}`)).toEqual(["bom@1.0.0"]);
  });

  it("reports a package.json it cannot read as a problem instead of throwing", () => {
    const dir = install("broken", "{ not json", { LICENSE: MIT });
    const packages = packagesInPaths([path.join(dir, "index.js")]);
    expect(packages).toHaveLength(1);
    const { problems } = buildNotices({ packages });
    expect(problems.map((p) => [p.package, p.kind])).toEqual([["broken", "unreadable"]]);
  });

  it("keeps packages without a name or version apart", () => {
    const a = install("a", "{}", { LICENSE: MIT });
    const b = install("b", "{}", { LICENSE: MIT });
    const packages = packagesInPaths([path.join(a, "i.js"), path.join(b, "i.js")]);
    expect(packages.map((p) => p.name).sort()).toEqual(["a", "b"]);
  });
});

describe("readThirdParty", () => {
  it("reads a third-party.json with a byte order mark", () => {
    writeFileSync(path.join(root, "third-party.json"), `﻿${JSON.stringify([{ name: "Font", license: "OFL-1.1", files: ["f.txt"] }])}`);
    writeFileSync(path.join(root, "f.txt"), "text");
    expect(readThirdParty(root).map((item) => item.name)).toEqual(["Font"]);
  });

  it("takes an entry without files as one without a licence text", () => {
    writeFileSync(path.join(root, "third-party.json"), JSON.stringify([{ name: "Font", license: "OFL-1.1" }]));
    const extra = readThirdParty(root);
    expect(extra[0]!.texts).toEqual([]);
    expect(buildNotices({ packages: [], extra }).problems.map((p) => p.kind)).toEqual(["no-text"]);
  });
});

describe("licence files", () => {
  it("finds MIT-LICENSE, COPYRIGHT and the files of a REUSE LICENSES folder", () => {
    const dir = install("x", "{}", { "MIT-LICENSE": "m", "LICENSE-MIT.txt": "m", COPYRIGHT: "c", "LICENSES/MIT.txt": "m", "README.md": "r", "docs/README.md": "r" });
    expect(licenceFiles(dir)).toEqual(["COPYRIGHT", "LICENSE-MIT.txt", "LICENSES/MIT.txt", "MIT-LICENSE"]);
  });

  it("skips pictures, fonts and anything with a NUL byte", () => {
    const dir = install("y", "{}", { "license.png": "x", "LICENSE.woff2": "x", LICENSE: "text" });
    expect(licenceFiles(dir)).toEqual(["LICENSE"]);
    writeFileSync(path.join(dir, "COPYING"), Buffer.from([0x89, 0x50, 0, 0x47]));
    const { texts } = buildNotices({ packages: [{ name: "y", version: "1.0.0", dir, pkg: { license: "MIT" } }] });
    expect(texts).toEqual(["text"]);
  });
});

describe("holderOf", () => {
  it("never reads a string contributors or maintainers as a list", () => {
    expect(holderOf({ contributors: "John Smith" })).toBeNull();
    expect(holderOf({ maintainers: ["Ann <a@b.c>"] })).toBe("Ann");
  });

  it("strips an email or url only at the end of the name", () => {
    expect(holderOf({ author: "Ann <a@b.c> (https://a.b)" })).toBe("Ann");
    expect(holderOf({ author: "Acme (Europe) Ltd" })).toBe("Acme (Europe) Ltd");
  });
});

describe("declaredLicence", () => {
  it("reads the old array form of license as an OR", () => {
    expect(declaredLicence({ license: ["MIT", "Apache-2.0"] })).toBe("MIT OR Apache-2.0");
    expect(declaredLicence({ license: [{ type: "MIT" }] })).toBe("MIT");
    expect(declaredLicence({ license: [] })).toBeNull();
  });
});
