import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module run at build time
import { ALLOWED_LICENCES, buildNotices, checkBundled, collectPackages, cratesFile, declaredLicence, generate, holderOf, judgeLicence, licenceFiles, lockedCrates, packagesInPaths, parseExpression, readCrates, renderNotices, repoRoot } from "./licences.mjs";

type Pkg = { name: string; version: string; dir: string; pkg: Record<string, unknown> };

/** A fake installed package: a folder with the files given. */
function fakePackage(name: string, version: string, json: Record<string, unknown>, files: Record<string, string> = {}): Pkg {
  const dir = mkdtempSync(path.join(tmpdir(), "licences-"));
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
  return { name, version, dir, pkg: { name, version, ...json } };
}

// Walking every installed package takes a few seconds: once for the whole file.
const real = generate();
const realPackages = collectPackages();

const MIT = "MIT License\n\nCopyright (c) 2020 Someone\n\nPermission is hereby granted";

describe("licence expressions", () => {
  it("reads ids, OR, AND, brackets and WITH", () => {
    expect(parseExpression("MIT")).toEqual({ id: "MIT" });
    expect(parseExpression("(MIT OR Apache-2.0) AND Unicode-3.0")).toEqual({
      op: "AND",
      terms: [{ op: "OR", terms: [{ id: "MIT" }, { id: "Apache-2.0" }] }, { id: "Unicode-3.0" }],
    });
    expect(parseExpression("Apache-2.0 WITH LLVM-exception")).toEqual({ id: "Apache-2.0" });
    expect(parseExpression("MIT OR")).toBeNull();
    expect(parseExpression("(MIT")).toBeNull();
  });

  it("allows the permissive licences", () => {
    for (const id of ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1", "MPL-2.0", "Unicode-3.0", "CC0-1.0", "BlueOak-1.0.0", "Python-2.0", "Zlib"]) {
      expect(judgeLicence(id).status, id).toBe("allowed");
    }
    expect(ALLOWED_LICENCES).toContain("OFL-1.1");
  });

  it("lets the user pick one side of an OR, but needs every side of an AND", () => {
    expect(judgeLicence("MIT OR GPL-3.0-only").status).toBe("allowed");
    expect(judgeLicence("(MIT AND Zlib)").status).toBe("allowed");
    expect(judgeLicence("MIT AND GPL-3.0-only").status).toBe("copyleft");
  });

  it("flags copyleft apart from unknown", () => {
    for (const id of ["GPL-3.0-only", "GPL-2.0+", "LGPL-2.1-or-later", "AGPL-3.0-only"]) expect(judgeLicence(id).status, id).toBe("copyleft");
    expect(judgeLicence("SEE LICENSE IN LICENSE.md").status).toBe("unknown");
    expect(judgeLicence("Some-Custom-1.0").status).toBe("unknown");
    expect(judgeLicence(null).status).toBe("unknown");
  });

  it("reads the licence a package declares, also the old forms", () => {
    expect(declaredLicence({ license: "MIT" })).toBe("MIT");
    expect(declaredLicence({ license: { type: "ISC" } })).toBe("ISC");
    expect(declaredLicence({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe("MIT OR Apache-2.0");
    expect(declaredLicence({})).toBeNull();
  });
});

describe("licence files", () => {
  it("finds licence and notice files by name and skips code", () => {
    const { dir } = fakePackage("x", "1.0.0", {}, { LICENSE: MIT, "LICENSE-MIT": MIT, NOTICE: "n", "license.js": "x", "LICENSE.json": "{}", "README.md": "r", "index.js": "" });
    expect(licenceFiles(dir)).toEqual(["LICENSE", "LICENSE-MIT", "NOTICE"]);
  });
});

describe("the notices", () => {
  it("lists a package with its licence and text, and de-duplicates identical texts", () => {
    const a = fakePackage("alpha", "1.0.0", { license: "MIT" }, { LICENSE: MIT });
    const b = fakePackage("beta", "2.0.0", { license: "MIT" }, { LICENSE: `${MIT}\r\n` });
    const notices = buildNotices({ packages: [a, b] });
    expect(notices.problems).toEqual([]);
    expect(notices.texts).toHaveLength(1);
    expect(notices.entries.map((entry: { name: string; texts: number[] }) => [entry.name, entry.texts])).toEqual([["alpha", [0]], ["beta", [0]]]);
    const text = renderNotices(notices, { version: "1.2.3" });
    expect(text).toContain("Tavora 1.2.3 - third-party notices");
    expect(text).toContain("alpha 1.0.0 - MIT");
    expect(text).toContain("Copyright (c) 2020 Someone");
  });

  it("fails a package with an unknown licence", () => {
    const pkg = fakePackage("odd", "1.0.0", { license: "Some-Custom-1.0" }, { LICENSE: "custom" });
    expect(buildNotices({ packages: [pkg] }).problems).toEqual([{ package: "odd@1.0.0", kind: "unknown-licence", message: 'licence "Some-Custom-1.0" is not on the allowlist' }]);
  });

  it("fails a package without a licence", () => {
    const pkg = fakePackage("bare", "1.0.0", {}, { LICENSE: MIT });
    expect(buildNotices({ packages: [pkg] }).problems.map((p: { kind: string }) => p.kind)).toEqual(["no-licence"]);
  });

  it("reports a copyleft licence instead of shipping it", () => {
    const pkg = fakePackage("viral", "1.0.0", { license: "GPL-3.0-only" }, { LICENSE: "GPL text" });
    expect(buildNotices({ packages: [pkg] }).problems.map((p: { kind: string }) => p.kind)).toEqual(["copyleft"]);
  });

  it("fails a package that has a licence but no text, except MIT and ISC where the standard text stands in", () => {
    const apache = fakePackage("nofile", "1.0.0", { license: "Apache-2.0" });
    expect(buildNotices({ packages: [apache] }).problems.map((p: { kind: string }) => p.kind)).toEqual(["no-text"]);
    const mit = fakePackage("quiet", "1.0.0", { license: "MIT", author: "Ann <ann@example.com>" });
    const notices = buildNotices({ packages: [mit] });
    expect(notices.problems).toEqual([]);
    expect(notices.entries[0].inferred).toBe(true);
    expect(notices.texts[0]).toContain("Copyright (c) Ann");
    const nobody = fakePackage("nobody", "1.0.0", { license: "MIT" });
    expect(buildNotices({ packages: [nobody] }).problems.map((p: { kind: string }) => p.kind)).toEqual(["no-text"]);
  });

  it("names the holder from the author or the repository", () => {
    expect(holderOf({ author: { name: "Bo" } })).toBe("Bo");
    expect(holderOf({ repository: { url: "git+https://github.com/o/r.git" } })).toBe("the authors of https://github.com/o/r");
    expect(holderOf({})).toBeNull();
  });
});

describe("what ships, from the repo as installed", () => {
  const { notices, text, missing } = real;
  const byName = (name: string) => notices.entries.find((entry: { name: string }) => entry.name === name);

  it("has no problem: every package has an allowed licence and a text", () => {
    expect(missing).toEqual([]);
    expect(notices.problems).toEqual([]);
  });

  it("lists the app's own libraries", () => {
    for (const name of ["vue", "electron-updater", "koffi", "dockview-core", "@excalidraw/excalidraw", "@tiptap/core", "@ghostery/adblocker"]) expect(byName(name), name).toBeDefined();
    expect(text).toContain("electron-updater");
  });

  it("lists the fonts with their own copyright lines", () => {
    for (const name of ["@fontsource-variable/inter", "@fontsource-variable/jetbrains-mono", "allo-font", "@fontsource-variable/mona-sans", "@fontsource-variable/rubik", "@fontsource-variable/nunito", "@fontsource-variable/saira", "@fontsource-variable/atkinson-hyperlegible-next"]) {
      const entry = byName(name);
      expect(entry?.license, name).toBe("OFL-1.1");
      expect(entry?.group, name).toBe("fonts");
      expect(notices.texts[entry.texts[0]], name).toMatch(/Copyright/);
    }
  });

  it("lists the media helper's crates", () => {
    expect(byName("serde")?.source).toBe("cargo");
    expect(byName("windows")?.group).toBe("helper");
  });

  it("leaves out tools that don't ship", () => {
    for (const name of ["vite", "electron-builder", "esbuild", "@playwright/test", "mermaid"]) expect(byName(name), name).toBeUndefined();
  });

  it("doesn't list Tavora's own packages", () => {
    expect(notices.entries.filter((entry: { name: string }) => entry.name.startsWith("@tavora/"))).toEqual([]);
  });

  it("walks every built-in module's dependencies", () => {
    const { packages } = realPackages;
    const from = new Set(packages.flatMap((pkg: { from: Set<string> }) => [...pkg.from]));
    for (const module of ["modules/whiteboard", "modules/notes", "modules/pdf-viewer", "apps/desktop"]) expect(from.has(module), module).toBe(true);
  });
});

describe("the media helper's crates", () => {
  it("are the ones in Cargo.lock, so the list can't go stale when a crate changes", () => {
    const locked = lockedCrates(readFileSync(path.join(repoRoot, "packages/media-helper/Cargo.lock"), "utf8"));
    const listed = readCrates(cratesFile).map((crate: { name: string; version: string }) => `${crate.name}@${crate.version}`);
    // The crates Cargo.lock holds that the Windows build doesn't use are named in the file (otherPlatforms); nothing else may be missing.
    const other: string[] = JSON.parse(readFileSync(cratesFile, "utf8")).otherPlatforms;
    expect([...listed, ...other].sort()).toEqual(locked);
  });

  it("each has a licence text", () => {
    for (const crate of readCrates(cratesFile)) expect(crate.texts.length, crate.name).toBeGreaterThan(0);
  });
});

describe("collectPackages", () => {
  it("skips an optional dependency that isn't installed and reports a missing required one", () => {
    const root = mkdtempSync(path.join(tmpdir(), "licences-root-"));
    const write = (dir: string, json: object) => (mkdirSync(dir, { recursive: true }), writeFileSync(path.join(dir, "package.json"), JSON.stringify(json)));
    write(path.join(root, "apps/desktop"), { name: "d", dependencies: { a: "1", gone: "1" }, optionalDependencies: {} });
    write(path.join(root, "apps/desktop/node_modules/a"), { name: "a", version: "1.0.0", license: "MIT", optionalDependencies: { native: "1" } });
    mkdirSync(path.join(root, "modules"), { recursive: true });
    const { packages, missing } = collectPackages(root);
    expect(packages.map((p: { name: string }) => p.name)).toEqual(["a"]);
    expect(missing).toContain("gone (needed by apps/desktop)");
  });
});

describe("a NOTICE file alone", () => {
  it("is not the licence text", () => {
    const pkg = fakePackage("noticeonly", "1.0.0", { license: "Apache-2.0" }, { NOTICE: "Some notice" });
    expect(buildNotices({ packages: [pkg] }).problems.map((p: { kind: string }) => p.kind)).toEqual(["no-text"]);
  });
});

describe("peer dependencies", () => {
  it("are walked when they are installed, also those only named in peerDependenciesMeta (debug's supports-color)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "licences-peers-"));
    const write = (dir: string, json: object) => (mkdirSync(dir, { recursive: true }), writeFileSync(path.join(dir, "package.json"), JSON.stringify(json)));
    write(path.join(root, "apps/desktop"), { name: "d", dependencies: { debug: "1" } });
    write(path.join(root, "apps/desktop/node_modules/debug"), { name: "debug", version: "4.0.0", license: "MIT", peerDependenciesMeta: { "supports-color": { optional: true } }, peerDependencies: { other: "1" } });
    write(path.join(root, "apps/desktop/node_modules/supports-color"), { name: "supports-color", version: "9.0.0", license: "MIT" });
    write(path.join(root, "apps/desktop/node_modules/other"), { name: "other", version: "2.0.0", license: "MIT" });
    mkdirSync(path.join(root, "modules"), { recursive: true });
    expect(collectPackages(root).packages.map((p: { name: string }) => p.name)).toEqual(["debug", "other", "supports-color"]);
  });

  it("supports-color and has-flag, bundled into main through debug, are in the real notices", () => {
    const names = real.notices.entries.map((entry: { name: string }) => entry.name);
    expect(names).toContain("supports-color");
    expect(names).toContain("has-flag");
  });
});

describe("what the bundles really contain", () => {
  const vue = realPackages.packages.find((pkg: { name: string }) => pkg.name === "vue");
  const file = path.join(vue.dir, "dist/vue.cjs.js");

  it("finds packages in file paths and module ids, through pnpm's folders and queries", () => {
    const packages = packagesInPaths([file, `${file}?commonjs`, "\0virtual:thing", path.join(repoRoot, "apps/desktop/src/main/index.ts")]);
    expect(packages.map((p: { name: string }) => p.name)).toEqual(["vue"]);
  });

  it("names a bundled package that the notices lack", () => {
    expect(checkBundled([file], [])).toEqual([`vue@${vue.version}`]);
    expect(checkBundled([file], real.notices.entries)).toEqual([]);
  });
});

describe("fonts and data that ship without an npm package", () => {
  const { notices, text } = real;
  const byName = (name: string) => notices.entries.find((entry: { name: string }) => entry.name === name);

  it("lists the Whiteboard's Excalidraw fonts with their licence and copyright line", () => {
    for (const [name, license] of ([["Excalifont", "OFL-1.1"], ["Virgil", "OFL-1.1"], ["Cascadia Code", "OFL-1.1"], ["Lilita One", "OFL-1.1"], ["Nunito", "OFL-1.1"], ["Assistant", "OFL-1.1"], ["Liberation Sans", "OFL-1.1"], ["Comic Shanns", "MIT"]] as [string, string][])) {
      const entry = byName(name);
      expect(entry?.license, name).toBe(license);
      expect(entry?.group, name).toBe("fonts");
      expect(notices.texts[entry.texts[0]], name).toMatch(/Copyright/);
    }
    expect(text).toContain("Comic Shanns - MIT");
  });

  it("lists the filter lists as data, with their CC BY-SA 3.0 attribution", () => {
    for (const name of ["EasyList", "EasyPrivacy"]) {
      const entry = byName(name);
      expect(entry?.group, name).toBe("data");
      expect(entry?.license, name).toBe("CC-BY-SA-3.0");
      expect(notices.texts[entry.texts[0]], name).toContain("easylist.to");
    }
  });

  it("allows CC BY-SA for those data entries and never for code", () => {
    const text = "Some licence text";
    const list = [{ name: "EasyList", version: "", license: "CC-BY-SA-3.0", group: "data", texts: [text] }];
    expect(buildNotices({ packages: [], extra: list }).problems).toEqual([]);
    expect(buildNotices({ packages: [], extra: [{ ...list[0], name: "Other list" }] }).problems.map((p: { kind: string }) => p.kind)).toEqual(["copyleft"]);
    expect(buildNotices({ packages: [], extra: [{ ...list[0], group: "libraries" }] }).problems.map((p: { kind: string }) => p.kind)).toEqual(["copyleft"]);
    const pkg = fakePackage("codepkg", "1.0.0", { license: "CC-BY-SA-3.0" }, { LICENSE: text });
    expect(buildNotices({ packages: [pkg] }).problems.map((p: { kind: string }) => p.kind)).toEqual(["copyleft"]);
  });
});

describe("licence files in subfolders and overrides", () => {
  it("reads the licences a package keeps one folder down (pdf.js's wasm/ and standard_fonts/)", () => {
    const pkg = fakePackage("pdfish", "1.0.0", { license: "Apache-2.0" }, { LICENSE: "Apache" });
    mkdirSync(path.join(pkg.dir, "wasm"));
    writeFileSync(path.join(pkg.dir, "wasm", "LICENSE_OPENJPEG"), "OpenJPEG licence");
    mkdirSync(path.join(pkg.dir, "node_modules"));
    writeFileSync(path.join(pkg.dir, "node_modules", "LICENSE"), "not ours");
    expect(licenceFiles(pkg.dir)).toEqual(["LICENSE", "wasm/LICENSE_OPENJPEG"]);
    expect(buildNotices({ packages: [pkg] }).texts).toEqual(["Apache", "OpenJPEG licence"]);
  });

  it("uses the holder of an override, for a package or a whole scope, instead of a repository address", () => {
    const pkg = fakePackage("@scope/thing", "1.0.0", { license: "MIT", repository: "https://github.com/o/r" });
    const notices = buildNotices({ packages: [pkg], overrides: { "@scope/": { holder: "2022 Someone", reason: "test" } } });
    expect(notices.problems).toEqual([]);
    expect(notices.texts[0]).toContain("Copyright (c) 2022 Someone");
  });

  it("the real notices give Radix and Excalidraw their upstream holders", () => {
    const { notices } = real;
    const radix = notices.entries.find((entry: { name: string }) => entry.name === "@radix-ui/react-slot");
    expect(notices.texts[radix.texts[0]]).toContain("Copyright (c) 2022 WorkOS");
    const excalidraw = notices.entries.find((entry: { name: string }) => entry.name === "@excalidraw/excalidraw");
    expect(notices.texts[excalidraw.texts[0]]).toContain("Copyright (c) 2020 Excalidraw");
  });
});
