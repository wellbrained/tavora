import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module run at build time
import { ALLOWED_LICENCES, buildNotices, collectPackages, cratesFile, declaredLicence, generate, holderOf, judgeLicence, licenceFiles, lockedCrates, parseExpression, readCrates, renderNotices, repoRoot } from "./licences.mjs";

type Pkg = { name: string; version: string; dir: string; pkg: Record<string, unknown> };

/** A fake installed package: a folder with the files given. */
function fakePackage(name: string, version: string, json: Record<string, unknown>, files: Record<string, string> = {}): Pkg {
  const dir = mkdtempSync(path.join(tmpdir(), "licences-"));
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
  return { name, version, dir, pkg: { name, version, ...json } };
}

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
  const { notices, text, missing } = generate();
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
    const { packages } = collectPackages();
    const from = new Set(packages.flatMap((pkg: { from: Set<string> }) => [...pkg.from]));
    for (const module of ["modules/whiteboard", "modules/notes", "modules/pdf-viewer", "apps/desktop"]) expect(from.has(module), module).toBe(true);
  });
});

describe("the media helper's crates", () => {
  it("are the ones in Cargo.lock, so the list can't go stale when a crate changes", () => {
    const locked = lockedCrates(readFileSync(path.join(repoRoot, "packages/media-helper/Cargo.lock"), "utf8"));
    const listed = readCrates(cratesFile).map((crate: { name: string; version: string }) => `${crate.name}@${crate.version}`);
    // Cargo.lock also holds crates only other platforms build (filtered out of the list), never the other way round.
    expect(locked.length).toBeGreaterThanOrEqual(listed.length);
    expect(listed.filter((id: string) => !locked.includes(id))).toEqual([]);
    // What Windows builds is Cargo.lock minus a short list of other platforms' crates.
    const other = locked.filter((id: string) => !listed.includes(id));
    expect(other.filter((id: string) => !/^(?:windows[-_]|winapi|wasi|libc|redox|cfg-if|getrandom)/.test(id))).toEqual([]);
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
