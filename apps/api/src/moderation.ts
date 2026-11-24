import { folderKey, validateChangelog } from "@tavora/module-schema";
import type { ZipFile } from "@tavora/pack";
import { type CatalogStore, type CheckedZip, copyHashes, type ReviewReason } from "./catalog.ts";
import { checkModuleText } from "./review-filter.ts";
import { FREE_AFTER_BYTES, freeMemory } from "./upload-memory.ts";
import type { Scanner } from "./virus-scan.ts";
import { sha256Hex } from "./hash.ts";

/**
 * The automatic checks every new version runs before it lists (decided 2026-10-26, "Tavora Admin panel" in the
 * vault's decisions): all pass, it lists at once; any fails, it waits for a person, with a short reason for each. Nothing here
 * ever lists a version by itself, and a check that cannot run counts as failed: the version waits.
 */

/** Names of the checks; the developer's email has a sentence for each (mail.ts). */
export const CHECKS = ["words", "permissions", "copy", "compare", "code", "virus", "first-module", "pictures"] as const;
export type CheckName = (typeof CHECKS)[number];

/** Who a version is checked as: its account and that account's keys, which "another publisher" is measured against. */
export interface Subject {
  accountId: string | null;
  fingerprints: readonly string[];
}

export interface ModerationOptions {
  catalog: CatalogStore;
  /** The virus scanner. Without one, or when it fails, every version waits. */
  scanner?: Scanner | undefined;
  /** The longest a whole virus scan may take (SCAN_LIMIT_MS by default). */
  scanLimitMs?: number | undefined;
  /** Told about a scan that ran out of time and was told to stop: `stopped` settles once it has, and until then it still holds its memory. */
  holdWhileScanning?: ((stopped: Promise<void>) => void) | undefined;
}

const reason = (check: CheckName, text: string, detail?: string): ReviewReason => ({ check, text, ...(detail ? { detail } : {}) });

// ── 1. Words ──────────────────────────────────────────────────────────────

/** Every text a user can read about a module, with where it came from. */
function moduleTexts(checked: CheckedZip): { where: string; text: string }[] {
  const { manifest } = checked;
  const texts: { where: string; text: string }[] = [{ where: "name", text: manifest.name }];
  if (manifest.description) texts.push({ where: "description", text: manifest.description });
  for (const [code, translation] of Object.entries(manifest.translations ?? {})) {
    if (translation.name) texts.push({ where: `name (${code})`, text: translation.name });
    if (translation.description) texts.push({ where: `description (${code})`, text: translation.description });
    for (const name of Object.values(translation.panels ?? {})) texts.push({ where: `panel name (${code})`, text: name });
    for (const name of Object.values(translation.actions ?? {})) texts.push({ where: `action name (${code})`, text: name });
  }
  for (const panel of manifest.panels ?? []) if (panel.name) texts.push({ where: "panel name", text: panel.name });
  for (const action of manifest.actions ?? []) if (action.name) texts.push({ where: "action name", text: action.name });
  // The whole changelog, not only this version's notes: an old entry can be edited too.
  const changelog = manifest.changelog === undefined ? undefined : checked.files.find((file) => file.name === manifest.changelog);
  if (changelog) {
    try {
      const parsed = validateChangelog(JSON.parse(changelog.data.toString("utf8")));
      if (parsed.ok) for (const entry of parsed.entries) for (const note of entry.notes) texts.push({ where: `changelog ${entry.version}`, text: note });
    } catch {
      // checkCatalogZip already refused an unreadable changelog.
    }
  } else {
    for (const note of checked.notes) texts.push({ where: "changelog", text: note });
  }
  if (checked.readme) texts.push({ where: "readme", text: checked.readme });
  return texts;
}

function checkWords(checked: CheckedZip): ReviewReason | null {
  const hits = new Map<string, Set<string>>();
  for (const { where, text } of moduleTexts(checked)) {
    const result = checkModuleText(text);
    if (result !== "ok") (hits.get(result) ?? hits.set(result, new Set()).get(result)!).add(where);
  }
  if (hits.size === 0) return null;
  const detail = [...hits].map(([kind, wheres]) => `${kind === "adult" ? "Adult terms" : "Slurs"} in ${[...wheres].join(", ")}`).join("; ");
  return reason("words", hits.has("adult") ? "Its texts mention adult content, which isn't allowed." : "Its texts have words that aren't allowed.", detail);
}

// ── 2. Permissions ────────────────────────────────────────────────────────

function checkPermissions(checked: CheckedZip, catalog: CatalogStore, exceptSha?: string): ReviewReason | null {
  const { network, connectors = [] } = checked.manifest.permissions;
  const folders = (checked.manifest.permissions.folders ?? []).map(folderKey);
  const previous = catalog.previousListed(checked.manifest.id, exceptSha);
  if (!previous) {
    if (network.length === 0 && connectors.length === 0 && folders.length === 0) return null;
    return reason(
      "permissions",
      "Its first version asks for network access, connectors or folders.",
      `Network: ${network.join(", ") || "none"}; connectors: ${connectors.join(", ") || "none"}; folders: ${folders.join(", ") || "none"}`,
    );
  }
  const before = previous.manifest.permissions;
  const beforeFolders = (before.folders ?? []).map(folderKey);
  const moreNetwork = network.filter((host) => !before.network.includes(host));
  const moreConnectors = connectors.filter((name) => !(before.connectors ?? []).includes(name));
  const moreFolders = folders.filter((key) => !beforeFolders.includes(key));
  if (moreNetwork.length === 0 && moreConnectors.length === 0 && moreFolders.length === 0) return null;
  return reason(
    "permissions",
    "This update asks for more permissions than the last version.",
    `New since ${previous.version}: network ${moreNetwork.join(", ") || "none"}; connectors ${moreConnectors.join(", ") || "none"}; folders ${moreFolders.join(", ") || "none"}`,
  );
}

// ── 3. Copies ─────────────────────────────────────────────────────────────

/** A name as one run of lowercase letters and digits, so "Timer-Pro", "timer pro" and "TimerPro" are the same. */
const nameKey = (name: string) =>
  name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

function withinOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Share of a zip's counted bytes that another publisher's zip holds before it is called a copy. */
export const COPY_SHARE = 0.8;
/** A zip with less than this in counted bytes is too small to tell copies by its files. */
export const COPY_MIN_BYTES = 1024;

function checkCopies(checked: CheckedZip, catalog: CatalogStore, subject: Subject): ReviewReason | null {
  const self = { moduleId: checked.manifest.id, accountId: subject.accountId, fingerprints: subject.fingerprints };
  const mine = [checked.manifest.name, ...Object.values(checked.manifest.translations ?? {}).flatMap((translation) => translation.name ?? [])].map(nameKey).filter((key) => key.length >= 3);
  const found: string[] = [];
  for (const other of catalog.othersNames(self)) {
    const theirs = other.names.map(nameKey).filter((key) => key.length >= 3);
    if (mine.some((a) => theirs.some((b) => a === b || (a.length >= 6 && withinOne(a, b))))) found.push(`name like ${other.id} ("${other.names[0]}")`);
  }
  const hashes = copyHashes(checked.files);
  let uncompared: { id: string; version: string }[] = [];
  if (hashes.reduce((sum, [, size]) => sum + size, 0) >= COPY_MIN_BYTES) {
    const similar = catalog.mostSimilar(self, hashes);
    if (similar && similar.share >= COPY_SHARE) found.push(`${Math.round(similar.share * 100)}% of its files are the same as ${similar.id} ${similar.version}`);
    uncompared = catalog.uncomparedVersions(self);
  }
  if (found.length > 0) return reason("copy", "It looks like another developer's module.", found.slice(0, 5).join("; "));
  // A check that can't run counts as failed: it could be a copy of a version whose files aren't known.
  if (uncompared.length === 0) return null;
  const names = uncompared.slice(0, 5).map(({ id, version }) => `${id} ${version}`).join(", ");
  return reason("compare", "It couldn't be compared with every module, so a person looks at it.", `No stored file hashes for ${names}${uncompared.length > 5 ? ` (+${uncompared.length - 5} more)` : ""}`);
}

// ── 4. Code warning signs ─────────────────────────────────────────────────

const CODE_FILE = /\.(?:m?js|cjs|jsx|ts|tsx|html?|svg|xhtml)$/i;
/** A file bigger than this is not read for warning signs, which is itself a warning sign. */
const MAX_CODE_BYTES = 8 * 1024 * 1024;

type Sign = "eval" | "obfuscated" | "wasm" | "remote-code";
const SIGN_LABEL: Record<Sign, string> = { eval: "eval or new Function", obfuscated: "packed or obfuscated code", wasm: "WebAssembly", "remote-code": "code loaded from the internet" };

const around = (text: string, index: number) => text.slice(Math.max(0, index - 30), index + 70).replace(/\s+/g, " ").trim();

/**
 * Long base64 data that libraries ship and decode with atob, by the sha256 of the text between the quotes. Only this exact
 * text passes; anything else that long still counts as packed code.
 */
const KNOWN_DATA = new Set([
  // brotli 2.1.0, dec/dictionary.bin.js: the Brotli dictionary (RFC 7932)
  "28898156df2fa67a6ed6cb5901658b9ed1bc8d71adb6d45190a91a5366275a4b",
]);

// Pieces of the regex sources below: a quoted string's quote, a name, and a dotted name such as `e.document`.
const Q = "[\"'`]";
const ID = "[\\w$]+";
const PATH = "[\\w$]+(?:\\.[\\w$]+)*";
/** One statement in the empty script's handler below: run the queue, then unhook and drop the element. Nothing else. */
const CLEANUP = `(?:(?!(?:eval|Function|setTimeout|setInterval|setImmediate|importScripts)\\b)${ID}\\((?:${ID})?\\)|\\1\\.onreadystatechange\\s*=\\s*null|(?:${PATH}|\\1\\.parentNode)\\.removeChild\\(\\1\\)|\\1\\s*=\\s*null)`;

/**
 * Exact pieces of popular libraries that look like warning signs but run no code of anyone's choosing. They're blanked out
 * before the check, so the same words anywhere else, or written even slightly differently, are still held. Add one only
 * after reading where it comes from, with a test, and after trying to hide something inside or next to it.
 *
 * The setImmediate and script element ones are safe only next to the module page's policy, `script-src 'self'` without
 * 'unsafe-eval' or 'unsafe-inline' (apps/desktop/src/main/assets.ts): there `Function(text)` throws, and a script element
 * added at run time can only run the module's own, checked files. Someone could copy their shape; it gets them nothing.
 */
const KNOWN_SNIPPETS: { why: string; pattern: RegExp }[] = [
  {
    // lodash, core-js, regenerator, setimmediate, …: finds the global object. Only this fixed text runs, and its answer
    // isn't used right there (`Function('return this')().eval(x)` still holds).
    why: "Function('return this')()",
    pattern: new RegExp(`(?<![\\w$.])(?:new\\s+)?Function\\(\\s*(${Q})return this\\1\\s*\\)\\(\\)(?!\\s*[.[(])`, "g"),
  },
  {
    // regenerator-runtime: sets a global when strict mode forbids it. Only this fixed text runs.
    why: "Function('r', 'regeneratorRuntime = r')(r)",
    pattern: new RegExp(`(?<![\\w$.])Function\\(\\s*(${Q})r\\1\\s*,\\s*(${Q})regeneratorRuntime = r\\2\\s*\\)\\(r\\)`, "g"),
  },
  {
    // setimmediate, minified: setImmediate("code") would run the text, like setTimeout("code"). Only at the start of
    // setImmediate itself, so it can't turn other strings into code; a string given to setImmediate is held (below).
    why: "setImmediate turning a string callback into a function",
    pattern: new RegExp(
      `(?:\\.setImmediate\\s*=\\s*function|function\\s+setImmediate)\\s*\\(\\s*(${ID})\\s*\\)\\s*\\{\\s*` +
        `typeof\\s+\\1\\s*!==?\\s*(${Q})function\\2\\s*&&\\s*\\(\\s*\\1\\s*=\\s*(?:new\\s+)?Function\\(\\s*(${Q})\\3\\s*\\+\\s*\\1\\s*\\)\\s*\\)`,
      "g",
    ),
  },
  {
    // immediate (JSZip), setimmediate: checks whether old Internet Explorer fires onreadystatechange on a script element.
    why: "'onreadystatechange' in document.createElement('script')",
    pattern: new RegExp(`(${Q})onreadystatechange\\1\\s*in\\s*${PATH}\\.createElement\\(\\s*(${Q})script\\2\\s*\\)`, "g"),
  },
  {
    // immediate (JSZip), setimmediate: an empty script element as a timer, as the whole body of a function so nothing
    // else there can reach it. Its handler only runs the queue and drops it; it never gets a src or any text.
    // Never two \s* with only something optional between them (`\s*;?\s*`): on a long run of spaces they try every way
    // to split it, and a crafted file of spaces would hold the server for minutes. `\s*(?:;\s*)?` matches the same.
    why: "an empty script element used as a timer",
    pattern: new RegExp(
      `function\\s*\\(\\s*(?:${ID}\\s*)?\\)\\s*\\{\\s*` +
        `(?:var|let|const)\\s+(${ID})\\s*=\\s*${PATH}\\.createElement\\(\\s*(${Q})script\\2\\s*\\)\\s*;\\s*` +
        `\\1\\.onreadystatechange\\s*=\\s*function\\s*\\(\\)\\s*\\{\\s*${CLEANUP}(?:\\s*[,;]\\s*${CLEANUP})*\\s*(?:;\\s*)?\\}\\s*(?:[,;]\\s*)?` +
        `${PATH}\\.appendChild\\(\\1\\)\\s*(?:;\\s*)?\\}`,
      "g",
    ),
  },
];

/** The text with every known snippet replaced by spaces, so positions stay where they were. */
const withoutKnownSnippets = (text: string) => KNOWN_SNIPPETS.reduce((rest, { pattern }) => rest.replace(pattern, (match) => " ".repeat(match.length)), text);

/** The first match the filter keeps; `pattern` needs the g flag. */
function firstWhere(pattern: RegExp, text: string, keep: (match: RegExpExecArray) => boolean): RegExpExecArray | null {
  for (const match of text.matchAll(pattern)) if (keep(match)) return match;
  return null;
}

/**
 * Whether a match sits on a line that is only a // comment, which never runs. Asked in order through the text, it reads
 * each line once: looking back to the line's start for every match would read a long line again for each match on it.
 */
function commentLines(text: string): (index: number) => boolean {
  const leading = /\s*/y;
  let start = 0;
  let end = -1;
  let comment = 0;
  return (index) => {
    if (index < start || index >= end) {
      start = text.lastIndexOf("\n", index) + 1;
      end = text.indexOf("\n", index);
      if (end === -1) end = text.length;
      leading.lastIndex = start;
      leading.exec(text);
      comment = text.startsWith("//", leading.lastIndex) ? leading.lastIndex + 2 : 0;
    }
    return comment > 0 && comment <= index;
  };
}

/** In an HTML or SVG file, a `<script …>` tag longer than this is a warning sign itself: real ones are a few attributes. */
const MAX_SCRIPT_TAG = 16 * 1024;

/**
 * Where a tag whose attributes start at `from` ends: in an HTML or SVG file (`markup`) at its `>`, past any in a quoted
 * value, and with a quote left open at the end of the text. In code, where `<script` is in a string, at the first `>`.
 */
function tagEnd(text: string, from: number, markup: boolean): number {
  if (!markup) {
    const end = text.indexOf(">", from);
    return end === -1 ? text.length : end;
  }
  const stop = /[>"']/g;
  stop.lastIndex = from;
  for (let found = stop.exec(text); found; found = stop.exec(text)) {
    if (found[0] === ">") return found.index;
    const close = text.indexOf(found[0], found.index + 1);
    if (close === -1) return text.length;
    stop.lastIndex = close + 1;
  }
  return text.length;
}

const NAMED_ENTITY: Record<string, string> = { sol: "/", bsol: "\\", colon: ":", tab: "\t", newline: "\n", period: ".", num: "#" };
const ENTITY = /&(?:#(\d{1,7});?|#x([0-9a-f]{1,6});?|([a-z]{2,8});)/iy;

/**
 * The first few characters of the address in the attribute value at `at` (before `end`), as a browser reads it: entities
 * decoded, tabs and line breaks dropped, spaces before it trimmed, `\` as `/`. Only a few are read, so values that
 * overlap (`src=src=src=…`) aren't each read to their end.
 */
function addressStart(text: string, at: number, end: number): string {
  const quote = text[at] === '"' || text[at] === "'" ? text[at] : null;
  let i = quote ? at + 1 : at;
  let start = "";
  while (i < end && start.length < 8) {
    let char = text[i]!;
    if (quote ? char === quote : /[\s>]/.test(char)) break;
    i++;
    if (char === "&") {
      ENTITY.lastIndex = i - 1;
      const entity = ENTITY.exec(text);
      if (entity) {
        const code = entity[1] ? Number(entity[1]) : entity[2] ? parseInt(entity[2], 16) : -1;
        char = code >= 0 ? (code <= 0x10ffff ? String.fromCodePoint(code) : "�") : (NAMED_ENTITY[entity[3]!.toLowerCase()] ?? entity[0]);
        i = ENTITY.lastIndex;
      }
    }
    if (char === "\t" || char === "\n" || char === "\r") continue;
    if (start === "" && char <= " ") continue;
    start += char;
  }
  return start.toLowerCase().replaceAll("\\", "/");
}

/**
 * The first `<script …>` tag whose `attribute` loads an address from the internet (`//host`, `http:` or `https:` in any
 * form), or in an HTML or SVG file (`markup`) that is longer than any real one. Each tag is read once, up to its `>`
 * (tagEnd), and each attribute's value only for its first characters, so a crafted file can't make this slow. A `<script`
 * inside an earlier tag is part of that one.
 */
function remoteScriptTag(text: string, attribute: "src" | "href", markup: boolean): RegExpExecArray | null {
  const open = /<script\b/gi;
  const named = new RegExp(`\\b${attribute}\\s*=\\s*`, "gi");
  // The next `attribute=` at or after where it was last looked for, so the text is searched for it once in all.
  let next: RegExpExecArray | null = null;
  let searchedFrom = -1;
  const nextFrom = (from: number): RegExpExecArray | null => {
    if (next && next.index >= from) return next;
    if (searchedFrom >= 0 && !next) return null;
    named.lastIndex = Math.max(from, named.lastIndex);
    searchedFrom = from;
    next = named.exec(text);
    return next;
  };
  for (let tag = open.exec(text); tag; tag = open.exec(text)) {
    const from = tag.index + tag[0].length;
    const end = tagEnd(text, from, markup);
    if (markup && end - from > MAX_SCRIPT_TAG) return tag;
    for (let found = nextFrom(from); found && found.index < end; found = nextFrom(found.index + 1)) {
      if (/^(?:https?:|\/\/)/.test(addressStart(text, found.index + found[0].length, end))) return tag;
    }
    if (end >= text.length) return null;
    open.lastIndex = end;
  }
  return null;
}

/** The warning signs in one code file's text. Exported for tests. */
export function signsIn(name: string, source: string): { sign: Sign; detail: string }[] {
  const text = withoutKnownSnippets(source);
  const found: { sign: Sign; detail: string }[] = [];
  const add = (sign: Sign, match: RegExpExecArray | null | undefined) => {
    if (match) found.push({ sign, detail: `${name}: ${around(text, match.index)}` });
  };
  const count = (pattern: RegExp) => text.match(pattern)?.length ?? 0;
  const onCommentLine = commentLines(text);

  add("eval", /(?<![\w$.])eval\s*\(|(?:window|globalThis|self)\s*\.\s*eval\s*\(/.exec(text));
  add("eval", /(?<![\w$])(?:new\s+)?Function\s*\(/.exec(text));
  add("eval", /\bset(?:Timeout|Interval|Immediate)\s*\(\s*["'`]/.exec(text));

  add("wasm", /\bWebAssembly\b/.exec(text));
  add("wasm", /\bwasm-unsafe-eval\b/.exec(text));

  add("remote-code", /\bimport\s*\(\s*["'`](?:https?:|data:|blob:|\/\/)/.exec(text));
  // import(x) with x not a string. Not `obj.import(x)`, a method called import, nor `import(a, b) {` on one line, which
  // only defines one (a call there would be a syntax error; with a line break between, it is a call).
  add(
    "remote-code",
    firstWhere(/(?<![\w$.])import\s*\(\s*(?!["'`])[^)\s](?![^()]*\)[ \t]*(?::[^;{}()\n]*)?\{)/g, text, (match) => !onCommentLine(match.index)),
  );
  add("remote-code", /\b(?:from|import)\s*["'`](?:https?:)?\/\/[^"'`]+["'`]/.exec(text));
  add("remote-code", /\bimportScripts\s*\(/.exec(text));
  add("remote-code", /createElement(?:NS)?\s*\(\s*(?:["'`]http:\/\/www\.w3\.org\/2000\/svg["'`]\s*,\s*)?["'`]script["'`]/.exec(text));
  const markup = /\.(?:svg|x?html?)$/i.test(name);
  add("remote-code", remoteScriptTag(text, "src", markup));
  add("remote-code", /new\s+(?:Shared)?Worker\s*\(\s*["'`](?:https?:|data:|blob:)/.exec(text));
  if (markup) add("remote-code", remoteScriptTag(text, "href", markup));

  if (count(/_0x[0-9a-f]{3,8}\b/g) >= 8) add("obfuscated", /_0x[0-9a-f]{3,8}\b/.exec(text));
  add("obfuscated", /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/.exec(text));
  const escapes = count(/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/gi);
  if (escapes >= 100 && (escapes * 5) / text.length >= 0.08) found.push({ sign: "obfuscated", detail: `${name}: ${escapes} escaped characters` });
  if (text.length >= 500 && count(/[[\]()!+]/g) / text.length >= 0.8) found.push({ sign: "obfuscated", detail: `${name}: reads like JSFuck` });
  if (count(/String\.fromCharCode/g) >= 40) add("obfuscated", /String\.fromCharCode/.exec(text));
  if (/\batob\s*\(/.test(text)) {
    const known = (match: RegExpExecArray) => KNOWN_DATA.has(sha256Hex(match[0].slice(1, -1)));
    add("obfuscated", firstWhere(/(?<!base64,)["'`][A-Za-z0-9+/]{4000,}={0,2}["'`]/g, text, (match) => !known(match)));
  }
  return found;
}

function checkCode(files: readonly ZipFile[]): ReviewReason | null {
  const signs = new Map<Sign, string[]>();
  const note = (sign: Sign, detail: string) => (signs.get(sign) ?? signs.set(sign, []).get(sign)!).push(detail);
  // Each file is read as text once; those copies are handed back as it goes, or a big module holds all of them next to its files.
  let unfreed = 0;
  for (const file of files) {
    if (/\.wasm$/i.test(file.name) || (file.data.length >= 4 && file.data.readUInt32BE(0) === 0x0061736d)) note("wasm", `${file.name}: a WebAssembly file`);
    if (!CODE_FILE.test(file.name)) continue;
    if (file.data.length > MAX_CODE_BYTES) {
      note("obfuscated", `${file.name}: over ${MAX_CODE_BYTES / 1024 / 1024} MB, not read`);
      continue;
    }
    for (const { sign, detail } of signsIn(file.name, file.data.toString("utf8"))) note(sign, detail);
    unfreed += file.data.length;
    if (unfreed >= FREE_AFTER_BYTES) {
      freeMemory();
      unfreed = 0;
    }
  }
  if (signs.size === 0) return null;
  const detail = [...signs].map(([sign, where]) => `${SIGN_LABEL[sign]}: ${where.slice(0, 3).join(" | ")}${where.length > 3 ? ` (+${where.length - 3} more)` : ""}`).join("; ");
  return reason("code", `Its code has warning signs: ${[...signs.keys()].map((sign) => SIGN_LABEL[sign]).join(", ")}.`, detail);
}

// ── 5. Virus scan ─────────────────────────────────────────────────────────

/** The longest a whole virus scan may take before the version waits instead. */
export const SCAN_LIMIT_MS = 180_000;

async function checkVirus(bytes: Buffer, files: readonly ZipFile[], { scanner, scanLimitMs = SCAN_LIMIT_MS, holdWhileScanning }: ModerationOptions): Promise<ReviewReason | null> {
  if (!scanner) return reason("virus", "The virus scan couldn't run, so a person looks at it.", "No virus scanner is set up on the server");
  try {
    // However a scanner behaves, a scan that takes this long did not run in time: it is told to stop, and the version waits
    // right away. Its memory stays counted until it really has stopped.
    const stop = new AbortController();
    const scan = Promise.resolve().then(() => scanner.scan(bytes, files, stop.signal));
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("the scan took too long");
        stop.abort(error);
        holdWhileScanning?.(scan.then(() => undefined, () => undefined));
        reject(error);
      }, scanLimitMs);
    });
    const result = await Promise.race([scan, late]).finally(() => clearTimeout(timer));
    if (result.clean) return null;
    return reason("virus", "The virus scan found something.", `Found: ${result.threats.slice(0, 5).join(", ")}`);
  } catch (error) {
    return reason("virus", "The virus scan couldn't run, so a person looks at it.", `Scanner error: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
  }
}

// ── Running them ──────────────────────────────────────────────────────────

/** Runs a check; one that throws counts as failed (its version waits), never as passed. */
async function guarded(check: CheckName, run: () => ReviewReason | null | Promise<ReviewReason | null>): Promise<ReviewReason | null> {
  try {
    return await run();
  } catch (error) {
    return reason(check, "A check couldn't run, so a person looks at it.", `${check} check error: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
  }
}

/**
 * The five checks of a zip: words, permissions, copies, code and virus. `exceptSha` is the zip's own hash when it is
 * already in the catalog (the one-time run over live modules), so it is not compared to itself.
 */
export async function runChecks(options: ModerationOptions, checked: CheckedZip, bytes: Buffer, subject: Subject, exceptSha?: string): Promise<ReviewReason[]> {
  const { catalog } = options;
  const results = await Promise.all([
    guarded("words", () => checkWords(checked)),
    guarded("permissions", () => checkPermissions(checked, catalog, exceptSha)),
    guarded("copy", () => checkCopies(checked, catalog, subject)),
    guarded("code", () => checkCode(checked.files)),
    guarded("virus", () => checkVirus(bytes, checked.files, options)),
  ]);
  return results.filter((result): result is ReviewReason => result !== null);
}

/** The pictures a version names (icon and screenshots) as hashes. */
const pictureHashes = (icon: { sha256: string } | null, screenshots: readonly { sha256: string }[]) => new Set([...(icon ? [icon.sha256] : []), ...screenshots.map((shot) => shot.sha256)]);

/**
 * What a new upload checks: the five checks, and the two that make it wait whatever the checks say: the first module of an
 * account that has never had a version approved, and an icon or screenshots that are new or changed since the last listed version.
 */
export async function reviewUpload(options: ModerationOptions, checked: CheckedZip, bytes: Buffer, subject: Subject): Promise<ReviewReason[]> {
  const { catalog } = options;
  const reasons = await runChecks(options, checked, bytes, subject);
  const first = await guarded("first-module", () =>
    subject.accountId === null || !catalog.accountApproved(subject.accountId, subject.fingerprints)
      ? reason("first-module", "It's your first module, so a person looks at it.", subject.accountId === null ? "No account" : "This account has had no version approved yet")
      : null,
  );
  if (first) reasons.push(first);
  const pictures = await guarded("pictures", () => {
    const now = pictureHashes(checked.icon, checked.screenshots);
    if (now.size === 0) return null;
    const before = catalog.previousListed(checked.manifest.id);
    const known = before ? pictureHashes(before.icon, before.screenshots) : new Set<string>();
    const added = [...now].filter((hash) => !known.has(hash));
    return added.length === 0 ? null : reason("pictures", "It has a new or changed icon or screenshots, so a person looks at them.", `${added.length} new or changed of ${now.size} pictures`);
  });
  if (pictures) reasons.push(pictures);
  return reasons;
}
