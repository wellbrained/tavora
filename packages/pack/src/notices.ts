// Third-party notices: which packages a build contains, their licences, and the text that goes with a build
// (THIRD_PARTY_NOTICES.txt). Used by the module Vite config (vite.ts) for every module's dist/, and by Tavora's own
// build (apps/desktop/scripts/licences.mjs), which adds the allowlist check for what ships in the app.
//
// Node-only, no dependencies.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Licences that may ship (SPDX ids). Permissive; MPL-2.0 is file-level copyleft and fine to bundle unchanged. */
export const ALLOWED_LICENCES: readonly string[] = [
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

/**
 * Licences allowed for one named piece of data only, never for code: the filter lists the Browser panel's ad blocker
 * is compiled from are CC BY-SA 3.0 and are attributed with it.
 */
export const ALLOWED_DATA_LICENCES: Readonly<Record<string, readonly string[]>> = {
  EasyList: ["CC-BY-SA-3.0"],
  EasyPrivacy: ["CC-BY-SA-3.0"],
};

/** Licences that ask for source or the same licence on the whole work: reported, never shipped silently. */
const COPYLEFT = /^(?:A|L)?GPL|^CDDL|^EPL|^EUPL|^OSL|^SSPL|^CC-BY-(?:NC|SA)|^CPL/i;

// -- SPDX expressions ---------------------------------------------------------------------------------------------

export type LicenceTree = { id: string } | { op: "OR" | "AND"; terms: LicenceTree[] };

/** "(MIT OR Apache-2.0) AND Unicode-3.0" as a tree. Null when it isn't an expression. */
export function parseExpression(text: string): LicenceTree | null {
  const tokens = text.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/).filter(Boolean);
  let i = 0;
  function atom(): LicenceTree {
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
  function and(): LicenceTree {
    const terms = [atom()];
    while (tokens[i]?.toUpperCase() === "AND") (i++, terms.push(atom()));
    return terms.length === 1 ? terms[0]! : { op: "AND", terms };
  }
  function or(): LicenceTree {
    const terms = [and()];
    while (tokens[i]?.toUpperCase() === "OR") (i++, terms.push(and()));
    return terms.length === 1 ? terms[0]! : { op: "OR", terms };
  }
  try {
    const tree = or();
    return i === tokens.length ? tree : null;
  } catch {
    return null;
  }
}

export interface Verdict {
  status: "allowed" | "copyleft" | "unknown";
  ids: string[];
}

/**
 * Judges a licence expression against the allowlist. For OR the user may pick, so one allowed side is enough; for AND
 * every side has to be allowed.
 */
export function judgeLicence(expression: string | null | undefined, allowed: readonly string[] = ALLOWED_LICENCES): Verdict {
  const tree = typeof expression === "string" ? parseExpression(expression) : null;
  if (!tree) return { status: "unknown", ids: [] };
  const allowedSet = new Set(allowed.map((id) => id.toLowerCase()));
  function judge(node: LicenceTree): Verdict {
    if ("id" in node) {
      if (allowedSet.has(node.id.toLowerCase())) return { status: "allowed", ids: [node.id] };
      return { status: COPYLEFT.test(node.id) ? "copyleft" : "unknown", ids: [node.id] };
    }
    const parts = node.terms.map(judge);
    if (node.op === "OR") {
      const ok = parts.find((p) => p.status === "allowed");
      if (ok) return ok;
      return parts.find((p) => p.status === "copyleft") ?? parts[0]!;
    }
    const bad = parts.find((p) => p.status !== "allowed");
    return bad ?? { status: "allowed", ids: parts.flatMap((p) => p.ids) };
  }
  return judge(tree);
}

/** The licence a package.json declares as one SPDX-like string, or null. Reads `license` and the old `licenses`. */
export function declaredLicence(pkg: Record<string, unknown>): string | null {
  const one = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    const type = (value as { type?: unknown } | null)?.type;
    return typeof type === "string" ? type : null;
  };
  const single = one(pkg.license);
  if (single) return single.trim();
  // The old forms: `license: ["MIT", "Apache-2.0"]` and `licenses: [{ type }]` both mean "one of these".
  for (const list of [pkg.license, pkg.licenses]) {
    if (!Array.isArray(list)) continue;
    const ids = list.map(one).filter((id): id is string => id !== null && id.trim() !== "");
    if (ids.length) return ids.map((id) => id.trim()).join(" OR ");
  }
  return null;
}

// -- Packages and their files -------------------------------------------------------------------------------------

// LICENSE, LICENSE-MIT, MIT-LICENSE.txt, COPYING, COPYRIGHT, NOTICE.
const LICENCE_FILE = /^(?:[a-z0-9.+]+[-_])?(?:licen[cs]es?|copying|copyright|unlicense|notice)(?:[-_. ].*)?$/i;
// Code, and files that are not text: a licence is never one of them.
const NOT_A_LICENCE_FILE = /\.(?:js|mjs|cjs|ts|json|map|d\.ts|css|html|png|jpe?g|gif|webp|avif|ico|bmp|svg|woff2?|ttf|otf|eot|wasm|zip|gz|tgz|br|pdf|node|exe|dll|so|dylib|bin)$/i;
// The folder REUSE keeps its licences in: LICENSES/MIT.txt.
const LICENCE_FOLDER = /^licen[cs]es$/i;

const isLicenceFile = (name: string) => LICENCE_FILE.test(name) && !NOT_A_LICENCE_FILE.test(name);

/** By name without regard to case, so the order of a package's licence files is the same wherever it was unpacked (then by exact name). */
const byNameNoCase = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/** The first licence file in a package folder (not a folder of that name), as a path from it; null when there is none. */
export function findLicenceFile(dir: string): string | null {
  const names = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && isLicenceFile(entry.name) && !/^notice/i.test(entry.name));
  return names.map((entry) => entry.name).sort(byNameNoCase)[0] ?? null;
}

/**
 * The licence and notice files of a package folder, as paths from it: those in the folder, and those one folder down
 * (pdf.js keeps its OpenJPEG, Foxit and Liberation licences in wasm/ and standard_fonts/). Text only: a LICENSE.js is code.
 */
export function licenceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && isLicenceFile(entry.name)) found.push(entry.name);
    else if (entry.isDirectory() && entry.name !== "node_modules") {
      for (const inner of readdirSync(path.join(dir, entry.name), { withFileTypes: true })) {
        const wanted = LICENCE_FOLDER.test(entry.name) ? !NOT_A_LICENCE_FILE.test(inner.name) : isLicenceFile(inner.name);
        if (inner.isFile() && wanted) found.push(`${entry.name}/${inner.name}`);
      }
    }
  }
  return found.sort(byNameNoCase);
}

export interface PackageInfo {
  name: string;
  version: string;
  dir: string;
  pkg: Record<string, unknown>;
  /** Where in the repo it is used from (labels, for reports). */
  from?: Set<string>;
  /** Why its package.json could not be read; then name and version are only what the folder says. */
  unreadable?: string;
}

/** JSON from a file, with a byte order mark (Windows editors add one) ignored. */
const readJson = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

/**
 * The npm packages a bundle contains, from the file or module ids its build lists: everything under a node_modules
 * folder. Ids that aren't files (a leading \0, a ?query) are cleaned or skipped.
 */
export function packagesInPaths(ids: Iterable<string>): PackageInfo[] {
  const found = new Map<string, PackageInfo>();
  for (const raw of ids) {
    if (raw.startsWith("\0")) continue;
    const file = raw.split("?")[0]!.replace(/\\/g, "/");
    const marker = "/node_modules/";
    const at = file.lastIndexOf(marker);
    if (at < 0) continue;
    const parts = file.slice(at + marker.length).split("/");
    const name = parts[0]!.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!;
    const dir = file.slice(0, at + marker.length) + name;
    const manifest = path.join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    let pkg: Record<string, unknown>;
    try {
      pkg = readJson(manifest);
      if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) throw new Error("it is not an object");
    } catch (error) {
      const key = path.normalize(dir);
      if (!found.has(key)) found.set(key, { name, version: "", dir: key, pkg: {}, unreadable: `its package.json cannot be read (${(error as Error).message})` });
      continue;
    }
    // One entry per name and version; a package that names neither is told apart by its folder.
    const named = typeof pkg.name === "string" && pkg.name !== "" && typeof pkg.version === "string" && pkg.version !== "";
    const key = named ? `${pkg.name}@${pkg.version}` : path.normalize(dir);
    if (!found.has(key)) found.set(key, { name: typeof pkg.name === "string" && pkg.name ? pkg.name : name, version: typeof pkg.version === "string" ? pkg.version : "", dir: path.normalize(dir), pkg });
  }
  return [...found.values()];
}

// -- Standard texts for packages that ship no licence file -----------------------------------------------------------

const MIT_TEXT = (holder: string) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ISC_TEXT = (holder: string) => `ISC License

Copyright (c) ${holder}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

/** Who a package names as its author (or, failing that, its repository), for a standard licence text; null when it names nobody. */
export function holderOf(pkg: Record<string, any>): string | null {
  // Only a list has a first person: a string would give its first letter.
  const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : undefined);
  const name = (value: unknown): string =>
    typeof value === "string" ? value.replace(/(?:\s*(?:<[^>]*>|\([^)]*\)))+\s*$/, "").trim() : typeof (value as { name?: unknown } | null)?.name === "string" ? (value as { name: string }).name.trim() : "";
  const author = name(pkg.author) || name(first(pkg.contributors)) || name(first(pkg.maintainers));
  if (author) return author;
  const repo: unknown = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return typeof repo === "string" && repo ? `the authors of ${repo.replace(/^git\+/, "").replace(/\.git$/, "")}` : null;
}

/** The standard text of a licence a package declares but doesn't ship: MIT and ISC only (others carry their own conditions); null otherwise. */
export function standardText(ids: string[], holder: string | null): string | null {
  if (!holder || ids.length !== 1) return null;
  if (ids[0]!.toLowerCase() === "mit") return MIT_TEXT(holder);
  if (ids[0]!.toLowerCase() === "isc") return ISC_TEXT(holder);
  return null;
}

// -- The notices --------------------------------------------------------------------------------------------------

export const normaliseText = (text: string): string => text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();

export type NoticeGroup = "libraries" | "fonts" | "data" | "helper";

export interface NoticeEntry {
  name: string;
  version: string;
  license: string;
  group: NoticeGroup;
  source: "npm" | "cargo" | "extra";
  /** Indexes into the texts. */
  texts: number[];
  /** Its licence file was missing: the text is the standard one with the holder its package info names. */
  inferred?: true;
}

export interface NoticeProblem {
  package: string;
  kind: "no-licence" | "unknown-licence" | "copyleft" | "no-text" | "unreadable";
  message: string;
}

/** A thing outside npm that ships: a font, data, a crate. `texts` are the licence texts themselves. */
export interface ExtraItem {
  name: string;
  version: string;
  license: string;
  group?: NoticeGroup;
  source?: "cargo" | "extra";
  texts: string[];
}

/** What a package's own facts get corrected by: { license, text (a file in `textDir`), holder (for the standard text) }, keyed by name, or by "@scope/" for a whole scope. */
export interface Override {
  license?: string;
  text?: string;
  holder?: string;
  reason: string;
}

export interface BuildOptions {
  packages: PackageInfo[];
  extra?: ExtraItem[];
  overrides?: Record<string, Override>;
  textDir?: string;
  allowed?: readonly string[];
  readFile?: (file: string) => string;
}

function overrideFor(overrides: Record<string, Override>, name: string): Override | undefined {
  if (Object.hasOwn(overrides, name)) return overrides[name];
  const scope = name.startsWith("@") ? `${name.split("/")[0]}/` : null;
  return scope && Object.hasOwn(overrides, scope) ? overrides[scope] : undefined;
}

const byName = (a: { name: string; version: string }, b: { name: string; version: string }) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en");

/**
 * The notices for a set of packages: { entries, texts, problems }, texts de-duplicated (identical texts are stored
 * once). problems is what must fail a build that has an allowlist to keep.
 */
export function buildNotices({ packages, extra = [], overrides = {}, textDir = "", allowed = ALLOWED_LICENCES, readFile = (file) => readFileSync(file, "utf8") }: BuildOptions) {
  const texts: string[] = [];
  const textIndex = new Map<string, number>();
  const problems: NoticeProblem[] = [];
  const intern = (raw: string): number | null => {
    const text = normaliseText(raw);
    if (!text) return null;
    const hash = createHash("sha256").update(text).digest("hex");
    if (!textIndex.has(hash)) (textIndex.set(hash, texts.length), texts.push(text));
    return textIndex.get(hash)!;
  };
  const addTo = (indexes: number[], raw: string) => {
    const index = intern(raw);
    if (index !== null && !indexes.includes(index)) indexes.push(index);
  };
  const judged = (id: string, license: string | null, list: readonly string[]): Verdict | null => {
    const verdict = license ? judgeLicence(license, list) : null;
    if (!license) problems.push({ package: id, kind: "no-licence", message: "declares no licence" });
    else if (verdict!.status === "copyleft") problems.push({ package: id, kind: "copyleft", message: `copyleft licence ${license}` });
    else if (verdict!.status === "unknown") problems.push({ package: id, kind: "unknown-licence", message: `licence "${license}" is not on the allowlist` });
    return verdict;
  };
  const entries: NoticeEntry[] = [];
  for (const pkg of packages) {
    const id = pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name;
    if (pkg.unreadable) {
      problems.push({ package: id, kind: "unreadable", message: pkg.unreadable });
      entries.push({ name: pkg.name, version: pkg.version, license: "UNKNOWN", group: "libraries", source: "npm", texts: [] });
      continue;
    }
    const override = overrideFor(overrides, pkg.name);
    const license = override?.license ?? declaredLicence(pkg.pkg);
    const verdict = judged(id, license, allowed);
    const indexes: number[] = [];
    let hasLicenceFile = false;
    for (const file of licenceFiles(pkg.dir)) {
      const text = readFile(path.join(pkg.dir, file));
      // A file with a NUL byte is not text (a picture named license): never part of the notices.
      if (text.includes("\0")) continue;
      addTo(indexes, text);
      // A NOTICE file alone isn't the licence.
      if (!/^notice/i.test(path.basename(file))) hasLicenceFile = true;
    }
    if (override?.text) {
      addTo(indexes, readFile(path.join(textDir, override.text)));
      hasLicenceFile = true;
    }
    let inferred = false;
    if (!hasLicenceFile && verdict?.status === "allowed") {
      // Some packages declare MIT or ISC but ship no LICENSE file: the standard text, with the holder named for them.
      const template = standardText(verdict.ids, override?.holder ?? holderOf(pkg.pkg));
      const index = template ? intern(template) : null;
      if (index !== null) (indexes.push(index), (inferred = true));
    }
    if (!hasLicenceFile && !inferred) problems.push({ package: id, kind: "no-text", message: "has no licence text" });
    entries.push({
      name: pkg.name,
      version: pkg.version,
      license: license ?? "UNKNOWN",
      group: isFont(pkg.name, license) ? "fonts" : "libraries",
      source: "npm",
      texts: indexes,
      ...(inferred ? { inferred: true as const } : {}),
    });
  }
  for (const item of extra) {
    const id = item.version ? `${item.name}@${item.version}` : item.name;
    // CC BY-SA is allowed for the named data entries and nothing else.
    const list = item.group === "data" && Object.hasOwn(ALLOWED_DATA_LICENCES, item.name) ? [...allowed, ...ALLOWED_DATA_LICENCES[item.name]!] : allowed;
    judged(id, item.license, list);
    const indexes: number[] = [];
    for (const raw of item.texts) addTo(indexes, raw);
    if (!indexes.length) problems.push({ package: id, kind: "no-text", message: "has no licence text" });
    entries.push({ name: item.name, version: item.version, license: item.license, group: item.group ?? "helper", source: item.source ?? "cargo", texts: indexes });
  }
  entries.sort(byName);
  return { entries, texts, problems };
}

/** Fonts are listed apart: they are the bulk of what a user sees. */
const isFont = (name: string, licence: string | null): boolean => name.startsWith("@fontsource") || name === "allo-font" || licence === "OFL-1.1";

const GROUP_TITLES: Record<NoticeGroup, string> = { fonts: "Fonts", libraries: "Libraries", data: "Data", helper: "Media controls (Rust)" };

/** THIRD_PARTY_NOTICES.txt: a list of what ships with its licence, then each distinct licence text once with who it covers. */
export function renderNotices({ entries, texts }: { entries: NoticeEntry[]; texts: string[] }, { name = "Tavora", version = "" }: { name?: string; version?: string } = {}): string {
  const label = (entry: { name: string; version: string }) => (entry.version ? `${entry.name} ${entry.version}` : entry.name);
  const lines = [
    `${name}${version ? ` ${version}` : ""} - third-party notices`,
    "",
    `${name} is built with the open-source software, fonts and data listed below. Each is used under its own licence,`,
    "the full text of which follows the list.",
    ...(name === "Tavora" ? ["Electron's own licence is in LICENSE.electron.txt and the licences of Chromium's parts are in", "LICENSES.chromium.html, both next to Tavora.exe."] : []),
    "",
  ];
  for (const group of Object.keys(GROUP_TITLES) as NoticeGroup[]) {
    const members = entries.filter((entry) => entry.group === group);
    if (!members.length) continue;
    lines.push("", `== ${GROUP_TITLES[group]} (${members.length}) ==`, "");
    for (const entry of members) lines.push(`${label(entry)} - ${entry.license}`);
  }
  const inferred = entries.filter((entry) => entry.inferred);
  if (inferred.length) {
    lines.push("", "", "== Standard licence text ==", "", "These packages state their licence but ship no licence file, so the standard text is given with the holder named in their package info:", "");
    for (const entry of inferred) lines.push(label(entry));
  }
  lines.push("", "", "== Licence texts ==");
  texts.forEach((text, index) => {
    const users = entries.filter((entry) => entry.texts.includes(index));
    lines.push("", "-".repeat(78), `Used by: ${users.map(label).join(", ")}`, "-".repeat(78), "", text);
  });
  return `${lines.join("\n")}\n`;
}

/**
 * The extras a folder keeps in its third-party.json: fonts and data that ship without an npm package of their own.
 * `[{ name, version, license, group, files: ["third-party/Foo-OFL.txt"] }]`, the files relative to the folder.
 */
export function readThirdParty(dir: string): ExtraItem[] {
  const file = path.join(dir, "third-party.json");
  if (!existsSync(file)) return [];
  const list: unknown = (() => {
    try {
      return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    } catch (error) {
      throw new Error(`third-party.json cannot be read (${(error as Error).message})`);
    }
  })();
  if (!Array.isArray(list)) throw new Error("third-party.json must be a list of { name, license, files } entries");
  const text = (value: unknown) => typeof value === "string" && value !== "";
  return list.map((entry: unknown, index) => {
    const item = (typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {}) as Record<string, unknown>;
    if (!text(item.name)) throw new Error(`third-party.json entry ${index + 1} has no name`);
    if (!text(item.license)) throw new Error(`third-party.json: ${String(item.name)} has no license`);
    if (item.version !== undefined && typeof item.version !== "string") throw new Error(`third-party.json: the version of ${String(item.name)} must be text`);
    if (item.files !== undefined && !(Array.isArray(item.files) && item.files.every(text))) throw new Error(`third-party.json: the files of ${String(item.name)} must be a list of file names`);
    return { name: item.name as string, version: (item.version as string | undefined) ?? "", license: item.license as string, group: ((item.group as NoticeGroup | undefined) ?? "libraries") as NoticeGroup, files: (item.files as string[] | undefined) ?? [] };
  }).map((item) => ({
    name: item.name,
    version: item.version,
    license: item.license,
    group: item.group,
    source: "extra" as const,
    // An entry without files has no text, which the notices report as a problem.
    texts: item.files.map((name) => readFileSync(path.join(dir, name), "utf8")),
  }));
}

/** What the packages of a build and its folder's third-party.json come to: the text for its THIRD_PARTY_NOTICES.txt, and what is wrong. */
export function noticesFor(root: string, moduleIds: Iterable<string>, options: { name: string; version: string }) {
  const notices = buildNotices({ packages: packagesInPaths(moduleIds), extra: readThirdParty(root) });
  return { notices, text: renderNotices(notices, options) };
}
