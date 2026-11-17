// The third-party notices Tavora ships: every package that ends up in the app, with its licence and the full licence
// text (CoreHub #540). Built at build time from what is installed, so a new dependency shows up here, and fails the
// build if its licence is missing or not on the allowlist. The generic parts (allowlist, SPDX judging, texts) live in
// packages/pack/src/notices.ts, which every module's build uses too.
//
//   node scripts/licences.mjs                 writes out/licences/ (THIRD_PARTY_NOTICES.txt and licences.json)
//   node scripts/licences.mjs --update-crates rewrites packages/media-helper/licences.json from Cargo (needs Rust)
//   node scripts/licences.mjs --check-modules after the modules are built: each has its notices file, and every package
//                                             they bundle is listed in out/licences/licences.json
//
// What counts as shipped:
// - the desktop app: its dependencies, and the devDependencies that are bundled into it (everything except
//   TOOLING below: a new dependency is shipped until it is named there);
// - every module in modules/ (built-in modules ship in the app): its dependencies, through the shared kit too;
// - the fonts and data in third-party.json files (apps/desktop's filter lists, the Whiteboard's fonts), and the Rust
//   crates of the media helper (packages/media-helper/licences.json, kept in step with its Cargo.lock by a test,
//   because Cargo is not needed to build the app).
// Each package is found by walking `dependencies`, `optionalDependencies` and peers (also those only named in `peerDependenciesMeta`, like debug's supports-color) from those roots
// through node_modules. As a safety net the build also lists what its bundles really contain (esbuild's metafile,
// Rollup's chunk modules) and fails when a package in them is missing from the notices (assertBundled).
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNotices, licenceFiles, normaliseText, packagesInPaths, readThirdParty, renderNotices } from "../../../packages/pack/src/notices.ts";

export { ALLOWED_LICENCES, buildNotices, declaredLicence, holderOf, judgeLicence, licenceFiles, packagesInPaths, parseExpression, renderNotices, standardText } from "../../../packages/pack/src/notices.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");
const desktopRoot = path.resolve(here, "..");

/** Packages in the desktop app's devDependencies that only build, test or package it, so none of their code ships. */
export const TOOLING = new Set([
  "@electron/asar",
  "@electron/fuses",
  "@playwright/test",
  "@tailwindcss/vite",
  "@tavora/pack",
  "@types/node",
  "@vitejs/plugin-vue",
  "electron", // its LICENSE.electron.txt and LICENSES.chromium.html are shipped by electron-builder
  "electron-builder",
  "esbuild",
  "vite",
  "vue-tsc",
]);

/**
 * Packages that are listed as dependencies but whose code is not in what ships, so they and what only they need are
 * left out: name -> why.
 */
export const NOT_SHIPPED = {
  "@excalidraw/mermaid-to-excalidraw": "the Whiteboard replaces it with a stub (modules/whiteboard/stubs/mermaid.ts), so Mermaid is not bundled",
  "@napi-rs/canvas": "pdfjs-dist uses it only in Node; the PDF viewer is a browser bundle",
};

/** Packages outside the dependency lists that still end up in the app: Allo is subset into src/fonts (scripts/subset-allo.mjs). */
export const EXTRA_SHIPPED = ["allo-font"];

/**
 * Facts a package itself lacks. Keyed by name, or "@scope/" for a whole scope; each needs a reason.
 * { license?, text? (a file in apps/desktop/licences/), holder? (for the standard text), reason }
 */
export const OVERRIDES = {
  "@radix-ui/": { holder: "2022 WorkOS", reason: "the packages ship no LICENSE file; the repository's (radix-ui/primitives) is MIT, Copyright (c) 2022 WorkOS" },
  "@excalidraw/excalidraw": { holder: "2020 Excalidraw", reason: "the package ships no LICENSE file; the repository's (excalidraw/excalidraw) is MIT, Copyright (c) 2020 Excalidraw" },
};

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Where `name` resolves to from a package folder, through node_modules like Node does (pnpm's links included); null when it isn't installed. */
export function resolvePackage(name, from) {
  let dir = from;
  for (;;) {
    for (const candidate of [path.join(dir, "node_modules", name), path.basename(dir) === "node_modules" ? path.join(dir, name) : null]) {
      if (candidate && existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The shipped roots of the repo: { dir, deps: names }, where dir is the folder their names are resolved from. */
export function shippedRoots(root = repoRoot) {
  const roots = [];
  const desktop = readJson(path.join(root, "apps/desktop/package.json"));
  const bundled = Object.keys({ ...desktop.dependencies, ...desktop.devDependencies }).filter((name) => !TOOLING.has(name));
  roots.push({ label: "apps/desktop", dir: path.join(root, "apps/desktop"), names: bundled });
  roots.push({ label: "fonts", dir: root, names: EXTRA_SHIPPED });
  for (const entry of readdirSync(path.join(root, "modules"), { withFileTypes: true })) {
    const file = path.join(root, "modules", entry.name, "package.json");
    if (!entry.isDirectory() || !existsSync(file)) continue;
    roots.push({ label: `modules/${entry.name}`, dir: path.join(root, "modules", entry.name), names: Object.keys(readJson(file).dependencies ?? {}) });
  }
  return roots;
}

/**
 * Every npm package that ships: Map "name@version" -> { name, version, dir, from: [root labels] }.
 * Workspace packages (@tavora/*) are Tavora's own code: they are walked through, not listed. A dependency that is
 * not installed is skipped when it is optional (another platform's native part) and an error otherwise.
 */
export function collectPackages(root = repoRoot, roots = shippedRoots(root)) {
  const found = new Map();
  const missing = [];
  const seenDirs = new Set();
  const isThirdParty = (dir) => dir.includes(`${path.sep}node_modules${path.sep}`);
  function visit(dir, label) {
    if (seenDirs.has(dir + label)) return;
    seenDirs.add(dir + label);
    const pkg = readJson(path.join(dir, "package.json"));
    if (isThirdParty(dir)) {
      const key = `${pkg.name}@${pkg.version}`;
      const entry = found.get(key) ?? { name: pkg.name, version: pkg.version, dir, pkg, from: new Set() };
      entry.from.add(label);
      found.set(key, entry);
    }
    for (const [group, optional] of [["dependencies", false], ["optionalDependencies", true], ["peerDependencies", true], ["peerDependenciesMeta", true]]) {
      for (const name of Object.keys(pkg[group] ?? {})) {
        if (Object.hasOwn(NOT_SHIPPED, name)) continue;
        const next = resolvePackage(name, dir);
        if (next) visit(next, label);
        else if (!optional) missing.push(`${name} (needed by ${pkg.name})`);
      }
    }
  }
  for (const rootEntry of roots) {
    for (const name of rootEntry.names) {
      const dir = resolvePackage(name, rootEntry.dir);
      if (dir) visit(dir, rootEntry.label);
      else missing.push(`${name} (needed by ${rootEntry.label})`);
    }
  }
  return { packages: [...found.values()].sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en")), missing };
}


export const cratesFile = path.join(repoRoot, "packages/media-helper/licences.json");

/** The crates the media helper ships, from the committed list: [{ name, version, license, texts }]. */
export function readCrates(file = cratesFile) {
  const data = readJson(file);
  return data.crates.map((crate) => ({
    name: crate.name,
    version: crate.version,
    license: crate.license,
    group: "helper",
    source: "cargo",
    texts: crate.texts.map((index) => data.texts[index]),
  }));
}

/** name@version of every package in a Cargo.lock except the crate itself. */
export function lockedCrates(lockText, own = "tavora-media") {
  return [...lockText.matchAll(/\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g)]
    .map((match) => `${match[1]}@${match[2]}`)
    .filter((id) => !id.startsWith(`${own}@`))
    .sort();
}

/** Rewrites packages/media-helper/licences.json from `cargo metadata` (the crates built for Windows) and their licence files in the Cargo registry. */
export async function updateCrates() {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("cargo", ["metadata", "--format-version", "1", "--locked", "--filter-platform", "x86_64-pc-windows-msvc"], {
    cwd: path.join(repoRoot, "packages/media-helper"),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`cargo metadata failed: ${result.error?.message ?? result.stderr}`);
  const metadata = JSON.parse(result.stdout);
  const used = new Set(metadata.resolve.nodes.map((node) => node.id));
  const texts = [];
  const crates = [];
  for (const pkg of metadata.packages) {
    if (!used.has(pkg.id) || !pkg.source) continue; // no source: the helper itself
    const dir = path.dirname(pkg.manifest_path);
    const indexes = [];
    for (const file of licenceFiles(dir)) {
      const text = normaliseText(readFileSync(path.join(dir, file), "utf8"));
      if (!text) continue;
      if (!texts.includes(text)) texts.push(text);
      indexes.push(texts.indexOf(text));
    }
    crates.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? "UNKNOWN", texts: indexes });
  }
  crates.sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));
  // What Cargo.lock holds for other platforms only: the test accepts these as missing from the list, and nothing else.
  const listed = new Set(crates.map((crate) => `${crate.name}@${crate.version}`));
  const otherPlatforms = lockedCrates(readFileSync(path.join(repoRoot, "packages/media-helper/Cargo.lock"), "utf8")).filter((id) => !listed.has(id));
  writeFileSync(cratesFile, `${JSON.stringify({ note: "Generated by `node apps/desktop/scripts/licences.mjs --update-crates` from Cargo.lock; a test keeps it in step.", crates, otherPlatforms, texts }, null, 1)}
`);
  return crates.length;
}

// -- Output --------------------------------------------------------------------------------------------------------


// -- Output --------------------------------------------------------------------------------------------------------

/** The fonts and data kept in third-party.json files: the app's own, and each built-in module's. */
export function readExtras(root = repoRoot) {
  const extras = [...readThirdParty(path.join(root, "apps/desktop"))];
  for (const entry of readdirSync(path.join(root, "modules"), { withFileTypes: true })) {
    if (entry.isDirectory()) extras.push(...readThirdParty(path.join(root, "modules", entry.name)));
  }
  const seen = new Set();
  return extras.filter((item) => !seen.has(`${item.name}@${item.version}`) && seen.add(`${item.name}@${item.version}`));
}

/** Builds the notices for the repo as installed. Returns { notices, text, missing }; throws nothing, the caller decides on problems. */
export function generate({ root = repoRoot } = {}) {
  const { packages, missing } = collectPackages(root);
  const notices = buildNotices({ packages, extra: [...readCrates(), ...readExtras(root)], overrides: OVERRIDES, textDir: path.join(desktopRoot, "licences") });
  const version = readJson(path.join(root, "apps/desktop/package.json")).version;
  return { notices, text: renderNotices(notices, { version }), missing };
}

/** The shape the app reads (src/shared/host-api.ts, LicenceList): no timestamp, so the same install gives the same file. */
export function toAppJson({ entries, texts }) {
  return { entries, texts };
}

export function formatProblems({ problems, missing = [] }) {
  return [...problems.map((p) => `  ${p.package}: ${p.message}`), ...missing.map((m) => `  ${m}: not installed`)].join("\n");
}

/**
 * The packages found in a bundle (file paths or module ids) that the notices don't list: name@version each. A package
 * that is bundled but not walked to would otherwise ship without its licence.
 */
export function checkBundled(ids, entries) {
  const listed = new Set(entries.map((entry) => `${entry.name}@${entry.version}`));
  return packagesInPaths(ids)
    .map((pkg) => `${pkg.name}@${pkg.version}`)
    .filter((id) => !listed.has(id))
    .sort();
}

/** Throws when what the build bundled has a package the notices lack. `bundles`: { label: [path or module id] }. */
export function assertBundled(bundles, entries) {
  const lines = Object.entries(bundles).flatMap(([label, ids]) => checkBundled(ids, entries).map((id) => `  ${id}: bundled into ${label} but not in the third-party notices`));
  if (lines.length) throw new Error(`Third-party licences: the bundles contain packages the notices don't list (scripts/licences.mjs walks dependencies from package.json; add the missing root):\n${lines.join("\n")}`);
}

/** Writes out/licences/ and throws with every problem when something shipped has no or an unknown licence. */
export function writeLicences({ root = repoRoot, outDir = path.join(desktopRoot, "out/licences") } = {}) {
  const { notices, text, missing } = generate({ root });
  if (notices.problems.length || missing.length) {
    throw new Error(`Third-party licences: fix these before shipping (an allowlisted licence, or a reasoned entry in OVERRIDES in apps/desktop/scripts/licences.mjs):\n${formatProblems({ problems: notices.problems, missing })}`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "THIRD_PARTY_NOTICES.txt"), text);
  writeFileSync(path.join(outDir, "licences.json"), JSON.stringify(toAppJson(notices)));
  return { count: notices.entries.length, outDir, entries: notices.entries };
}

/**
 * After the modules are built: each built-in module's dist/ has the THIRD_PARTY_NOTICES.txt its Vite build wrote
 * (packages/pack/src/vite.ts), and every package listed in it is in the app's notices (out/licences/licences.json).
 */
export function checkModuleNotices({ root = repoRoot, licencesFile = path.join(desktopRoot, "out/licences/licences.json") } = {}) {
  const app = readJson(licencesFile).entries;
  const listed = new Set(app.map((item) => (item.version ? `${item.name} ${item.version}` : item.name)));
  const problems = [];
  let checked = 0;
  for (const entry of readdirSync(path.join(root, "modules"), { withFileTypes: true })) {
    const dir = path.join(root, "modules", entry.name);
    if (!entry.isDirectory() || !existsSync(path.join(dir, "tavora.module.json")) || !existsSync(path.join(dir, "dist"))) continue;
    const file = path.join(dir, "dist", "THIRD_PARTY_NOTICES.txt");
    if (!existsSync(file)) {
      problems.push(`  ${entry.name}: dist/THIRD_PARTY_NOTICES.txt is missing`);
      continue;
    }
    checked++;
    for (const line of readFileSync(file, "utf8").split("== Licence texts ==")[0].split("\n")) {
      const match = /^(\S.*?) - (.+)$/.exec(line);
      if (match && !line.startsWith("==") && match[2] !== "third-party notices" && !listed.has(match[1])) problems.push(`  ${entry.name}: ${match[1]} is in its notices but not in the app's`);
    }
  }
  if (problems.length) throw new Error(`Third-party licences of the built-in modules:\n${problems.join("\n")}`);
  return checked;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes("--check-modules")) console.log(`[licences] notices of ${checkModuleNotices()} modules match the app's`);
    else if (process.argv.includes("--update-crates")) console.log(`[licences] ${await updateCrates()} crates written to packages/media-helper/licences.json`);
    else {
      const { count, outDir } = writeLicences();
      console.log(`[licences] ${count} packages -> ${path.relative(repoRoot, outDir)}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
