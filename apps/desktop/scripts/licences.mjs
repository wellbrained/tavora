// The third-party notices Tavora ships: every package that ends up in the app, with its licence and the full licence
// text (CoreHub #540). Built at build time from what is installed, so a new dependency shows up here, and fails the
// build if its licence is missing or not on the allowlist.
//
//   node scripts/licences.mjs            writes out/licences/ (THIRD_PARTY_NOTICES.txt and licences.json)
//   node scripts/licences.mjs --update-crates   rewrites packages/media-helper/licences.json from Cargo (needs Rust)
//   node scripts/licences.mjs --modules   writes THIRD_PARTY_NOTICES.txt into each built-in module's dist/ (after the modules are built)
//
// What counts as shipped:
// - the desktop app: its dependencies, and the devDependencies that are bundled into it (everything except
//   TOOLING below: a new dependency is shipped until it is named there);
// - every module in modules/ (built-in modules ship in the app): its dependencies, through the shared kit too;
// - the fonts and the Rust crates of the media helper (packages/media-helper/licences.json, kept in step with its
//   Cargo.lock by a test, because Cargo is not needed to build the app).
// Each package is found by walking `dependencies` and `optionalDependencies` from those roots through node_modules.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");
const desktopRoot = path.resolve(here, "..");

/** Licences Tavora may ship (SPDX ids). Permissive; MPL-2.0 is file-level copyleft and fine to bundle unchanged. */
export const ALLOWED_LICENCES = [
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "OFL-1.1",
  "Python-2.0",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "Unlicense",
  "Zlib",
];

/** Licences that ask for source or the same licence on the whole work: reported, never shipped silently. */
const COPYLEFT = /^(?:A|L)?GPL|^CDDL|^EPL|^EUPL|^OSL|^SSPL|^CC-BY-(?:NC|SA)|^CPL/i;

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
 * Facts the package itself lacks or states in a way no tool reads. Keyed by name; each needs a reason.
 * { license, text? (a file next to this one in apps/desktop/licences/), reason }
 */
export const OVERRIDES = {};

// -- SPDX expressions ---------------------------------------------------------------------------------------------

/** "(MIT OR Apache-2.0) AND Unicode-3.0" as a tree: { id } | { op: "OR" | "AND", terms }. Null when it isn't an expression. */
export function parseExpression(text) {
  const tokens = text.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/).filter(Boolean);
  let i = 0;
  function atom() {
    const token = tokens[i++];
    if (token === "(") {
      const inner = or();
      if (tokens[i++] !== ")") throw new Error("unbalanced");
      return inner;
    }
    if (!token || token === ")" || /^(?:AND|OR)$/i.test(token)) throw new Error("unexpected");
    // `GPL-2.0+` and `Apache-2.0 WITH LLVM-exception`: the base id is what is judged.
    if (tokens[i]?.toUpperCase() === "WITH") i += 2;
    return { id: token.replace(/\+$/, "") };
  }
  function and() {
    const terms = [atom()];
    while (tokens[i]?.toUpperCase() === "AND") (i++, terms.push(atom()));
    return terms.length === 1 ? terms[0] : { op: "AND", terms };
  }
  function or() {
    const terms = [and()];
    while (tokens[i]?.toUpperCase() === "OR") (i++, terms.push(and()));
    return terms.length === 1 ? terms[0] : { op: "OR", terms };
  }
  try {
    const tree = or();
    return i === tokens.length ? tree : null;
  } catch {
    return null;
  }
}

/**
 * Judges a licence expression against the allowlist: "allowed" (with the ids that make it so), "copyleft" or "unknown".
 * For OR the user may pick, so one allowed side is enough; for AND every side has to be allowed.
 */
export function judgeLicence(expression, allowed = ALLOWED_LICENCES) {
  const tree = typeof expression === "string" ? parseExpression(expression) : null;
  if (!tree) return { status: "unknown", ids: [] };
  const allowedSet = new Set(allowed.map((id) => id.toLowerCase()));
  function judge(node) {
    if (node.id) {
      if (allowedSet.has(node.id.toLowerCase())) return { status: "allowed", ids: [node.id] };
      return { status: COPYLEFT.test(node.id) ? "copyleft" : "unknown", ids: [node.id] };
    }
    const parts = node.terms.map(judge);
    if (node.op === "OR") {
      const ok = parts.find((p) => p.status === "allowed");
      if (ok) return ok;
      return parts.find((p) => p.status === "copyleft") ?? parts[0];
    }
    const bad = parts.find((p) => p.status !== "allowed");
    return bad ?? { status: "allowed", ids: parts.flatMap((p) => p.ids) };
  }
  return judge(tree);
}

/** The licence a package.json declares as one SPDX-like string, or null. Reads `license` and the old `licenses`. */
export function declaredLicence(pkg) {
  const one = (value) => (typeof value === "string" ? value : typeof value?.type === "string" ? value.type : null);
  const single = one(pkg.license);
  if (single) return single.trim();
  if (Array.isArray(pkg.licenses)) {
    const ids = pkg.licenses.map(one).filter(Boolean);
    if (ids.length) return ids.join(" OR ");
  }
  return null;
}

// -- Finding the packages -----------------------------------------------------------------------------------------

const LICENCE_FILE = /^(?:licen[cs]e|copying|unlicense|notice)(?:[-_. ].*)?$/i;
const IGNORED_FILE = /\.(?:js|mjs|cjs|ts|json|map|d\.ts|css|html)$/i;

/** The licence and notice files in a package folder, by name. Text only: a LICENSE.js or LICENSE.json is code. */
export function licenceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name) && !IGNORED_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

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
    for (const [group, optional] of [["dependencies", false], ["optionalDependencies", true]]) {
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
  return { packages: [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)), missing };
}

// -- The notices --------------------------------------------------------------------------------------------------

const normaliseText = (text) => text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();

/** Fonts are listed apart: they are the bulk of what a user sees in the app. */
const isFont = (name, licence) => name.startsWith("@fontsource") || name.startsWith("@fontsource-variable/") || name === "allo-font" || licence === "OFL-1.1";

/**
 * The notices for a set of packages: { entries, texts, problems }. entries: [{ name, version, license, group, texts: [index] }]
 * with texts de-duplicated (identical texts are stored once). problems: what must fail the build.
 * `readNpm(pkg)` and friends are replaceable so tests need no node_modules.
 */
export function buildNotices({ packages, extra = [], overrides = OVERRIDES, allowed = ALLOWED_LICENCES, readFile = (file) => readFileSync(file, "utf8") }) {
  const texts = [];
  const textIndex = new Map();
  const problems = [];
  const intern = (raw) => {
    const text = normaliseText(raw);
    if (!text) return null;
    const hash = createHash("sha256").update(text).digest("hex");
    if (!textIndex.has(hash)) (textIndex.set(hash, texts.length), texts.push(text));
    return textIndex.get(hash);
  };
  const entries = [];
  for (const pkg of packages) {
    const id = `${pkg.name}@${pkg.version}`;
    const override = overrides[pkg.name];
    const license = override?.license ?? declaredLicence(pkg.pkg);
    const verdict = license ? judgeLicence(license, allowed) : null;
    if (!license) problems.push({ package: id, kind: "no-licence", message: "declares no licence" });
    else if (verdict.status === "copyleft") problems.push({ package: id, kind: "copyleft", message: `copyleft licence ${license}` });
    else if (verdict.status === "unknown") problems.push({ package: id, kind: "unknown-licence", message: `licence "${license}" is not on the allowlist` });
    const indexes = [];
    for (const file of licenceFiles(pkg.dir)) {
      const index = intern(readFile(path.join(pkg.dir, file)));
      if (index !== null && !indexes.includes(index)) indexes.push(index);
    }
    if (override?.text) {
      const index = intern(readFile(path.join(desktopRoot, "licences", override.text)));
      if (index !== null && !indexes.includes(index)) indexes.push(index);
    }
    let inferred = false;
    if (!indexes.length && verdict?.status === "allowed") {
      // Some packages declare MIT or ISC but ship no LICENSE file: the standard text, with the holder the package names.
      const template = standardText(verdict.ids, holderOf(pkg.pkg));
      const index = template ? intern(template) : null;
      if (index !== null) (indexes.push(index), (inferred = true));
    }
    if (!indexes.length) problems.push({ package: id, kind: "no-text", message: "has no licence text" });
    entries.push({ name: pkg.name, version: pkg.version, license: license ?? "UNKNOWN", group: isFont(pkg.name, license) ? "fonts" : "libraries", source: "npm", texts: indexes, ...(inferred ? { inferred: true } : {}) });
  }
  for (const item of extra) {
    const id = `${item.name}@${item.version}`;
    const verdict = judgeLicence(item.license, allowed);
    if (verdict.status === "copyleft") problems.push({ package: id, kind: "copyleft", message: `copyleft licence ${item.license}` });
    else if (verdict.status === "unknown") problems.push({ package: id, kind: "unknown-licence", message: `licence "${item.license}" is not on the allowlist` });
    const indexes = [];
    for (const raw of item.texts) {
      const index = intern(raw);
      if (index !== null && !indexes.includes(index)) indexes.push(index);
    }
    if (!indexes.length) problems.push({ package: id, kind: "no-text", message: "has no licence text" });
    entries.push({ name: item.name, version: item.version, license: item.license, group: item.group ?? "helper", source: item.source ?? "cargo", texts: indexes });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { entries, texts, problems };
}

const MIT_TEXT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ISC_TEXT = (holder) => `ISC License

Copyright (c) ${holder}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

/** Who a package names as its author (or, failing that, its repository), for a standard licence text; null when it names nobody. */
export function holderOf(pkg) {
  const name = (value) => (typeof value === "string" ? value.replace(/\s*[<(].*$/, "").trim() : typeof value?.name === "string" ? value.name.trim() : "");
  const author = name(pkg.author) || name(pkg.contributors?.[0]) || name(pkg.maintainers?.[0]);
  if (author) return author;
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return repo ? `the authors of ${repo.replace(/^git\+/, "").replace(/\.git$/, "")}` : null;
}

/** The standard text of a licence a package declares but doesn't ship: MIT and ISC only (others carry their own conditions); null otherwise. */
export function standardText(ids, holder) {
  if (!holder || ids.length !== 1) return null;
  if (ids[0].toLowerCase() === "mit") return MIT_TEXT(holder);
  if (ids[0].toLowerCase() === "isc") return ISC_TEXT(holder);
  return null;
}

const GROUP_TITLES = { fonts: "Fonts", libraries: "Libraries", helper: "Media helper (Rust)" };

/** THIRD_PARTY_NOTICES.txt: a list of what ships with its licence, then each distinct licence text once with who it covers. */
export function renderNotices({ entries, texts }, { version, name = "Tavora" } = {}) {
  const lines = [
    `${name}${version ? ` ${version}` : ""} - third-party notices`,
    "",
    `${name} is built with the open-source software and fonts listed below. Each is used under its own licence,`,
    "the full text of which follows the list.",
    ...(name === "Tavora" ? ["Electron's own licence is in LICENSE.electron.txt and the licences of Chromium's parts are in", "LICENSES.chromium.html, both next to Tavora.exe."] : []),
    "",
  ];
  for (const group of Object.keys(GROUP_TITLES)) {
    const members = entries.filter((entry) => entry.group === group);
    if (!members.length) continue;
    lines.push("", `== ${GROUP_TITLES[group]} (${members.length}) ==`, "");
    for (const entry of members) lines.push(`${entry.name} ${entry.version} - ${entry.license}`);
  }
  const inferred = entries.filter((entry) => entry.inferred);
  if (inferred.length) {
    lines.push("", "", "== Standard licence text ==", "", "These packages state their licence but ship no licence file, so the standard text is given with the holder named in their package.json:", "");
    for (const entry of inferred) lines.push(`${entry.name} ${entry.version}`);
  }
  lines.push("", "", "== Licence texts ==");
  texts.forEach((text, index) => {
    const users = entries.filter((entry) => entry.texts.includes(index));
    lines.push("", "-".repeat(78), `Used by: ${users.map((entry) => `${entry.name} ${entry.version}`).join(", ")}`, "-".repeat(78), "", text);
  });
  return `${lines.join("\n")}\n`;
}

// -- The media helper's crates -------------------------------------------------------------------------------------

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
  crates.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  writeFileSync(cratesFile, `${JSON.stringify({ note: "Generated by `node apps/desktop/scripts/licences.mjs --update-crates` from Cargo.lock; a test keeps it in step.", crates, texts }, null, 1)}\n`);
  return crates.length;
}

// -- Output --------------------------------------------------------------------------------------------------------

/** Builds the notices for the repo as installed. Returns { notices, text, missing }; throws nothing, the caller decides on problems. */
export function generate({ root = repoRoot } = {}) {
  const { packages, missing } = collectPackages(root);
  const notices = buildNotices({ packages, extra: readCrates() });
  const version = readJson(path.join(root, "apps/desktop/package.json")).version;
  return { notices, text: renderNotices(notices, { version }), missing };
}

/**
 * Writes THIRD_PARTY_NOTICES.txt into each built-in module's dist/ (what its dependencies bring in, through the kit too),
 * so the module's catalog copy carries its own notices in its zip. Run after the modules are built (`pnpm build`
 * does); a module without a dist is skipped. Throws, like writeLicences, for a package without an allowed licence.
 */
export function writeModuleNotices({ root = repoRoot } = {}) {
  const written = [];
  for (const entry of readdirSync(path.join(root, "modules"), { withFileTypes: true })) {
    const dir = path.join(root, "modules", entry.name);
    if (!entry.isDirectory() || !existsSync(path.join(dir, "tavora.module.json")) || !existsSync(path.join(dir, "dist"))) continue;
    const manifest = readJson(path.join(dir, "tavora.module.json"));
    const roots = shippedRoots(root).filter((r) => r.label === `modules/${entry.name}`);
    const { packages, missing } = collectPackages(root, roots);
    const notices = buildNotices({ packages });
    if (notices.problems.length || missing.length) throw new Error(`Third-party licences of ${manifest.name}: fix these before shipping:
${formatProblems({ problems: notices.problems, missing })}`);
    writeFileSync(path.join(dir, "dist", "THIRD_PARTY_NOTICES.txt"), renderNotices(notices, { name: manifest.name, version: manifest.version }));
    written.push(entry.name);
  }
  return written;
}

/** The shape the app reads (src/shared/host-api.ts, LicenceList): no timestamp, so the same install gives the same file. */
export function toAppJson({ entries, texts }) {
  return { entries, texts };
}

export function formatProblems({ problems, missing = [] }) {
  return [
    ...problems.map((p) => `  ${p.package}: ${p.message}`),
    ...missing.map((m) => `  ${m}: not installed`),
  ].join("\n");
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
  return { count: notices.entries.length, outDir };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes("--modules")) console.log(`[licences] notices written into the dist of: ${writeModuleNotices().join(", ")}`);
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
