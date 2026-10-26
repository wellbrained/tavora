import { validateChangelog } from "@tavora/module-schema";
import type { ZipFile } from "@tavora/pack";
import { type CatalogStore, type CheckedZip, copyHashes, type ReviewReason } from "./catalog.ts";
import { checkModuleText } from "./review-filter.ts";
import type { Scanner } from "./virus-scan.ts";

/**
 * The automatic checks every new version runs before it lists (decided 2026-10-26, "Tavora Admin panel" in the
 * vault's decisions): all pass, it lists at once; any fails, it waits for a person, with a short reason for each. Nothing here
 * ever lists a version by itself, and a check that cannot run counts as failed: the version waits.
 */

/** Names of the checks; the developer's email has a sentence for each (mail.ts). */
export const CHECKS = ["words", "permissions", "copy", "code", "virus", "first-module", "pictures"] as const;
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
}

const reason = (check: CheckName, text: string, detail?: string): ReviewReason => ({ check, text, ...(detail ? { detail } : {}) });

// ── 1. Words ──────────────────────────────────────────────────────────────

/** Every text a player can read about a module, with where it came from. */
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
  const previous = catalog.previousListed(checked.manifest.id, exceptSha);
  if (!previous) {
    if (network.length === 0 && connectors.length === 0) return null;
    return reason("permissions", "Its first version asks for network access or connectors.", `Network: ${network.join(", ") || "none"}; connectors: ${connectors.join(", ") || "none"}`);
  }
  const before = previous.manifest.permissions;
  const moreNetwork = network.filter((host) => !before.network.includes(host));
  const moreConnectors = connectors.filter((name) => !(before.connectors ?? []).includes(name));
  if (moreNetwork.length === 0 && moreConnectors.length === 0) return null;
  return reason("permissions", "This update asks for more permissions than the last version.", `New since ${previous.version}: network ${moreNetwork.join(", ") || "none"}; connectors ${moreConnectors.join(", ") || "none"}`);
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
  if (hashes.reduce((sum, [, size]) => sum + size, 0) >= COPY_MIN_BYTES) {
    const similar = catalog.mostSimilar(self, hashes);
    if (similar && similar.share >= COPY_SHARE) found.push(`${Math.round(similar.share * 100)}% of its files are the same as ${similar.id} ${similar.version}`);
  }
  return found.length === 0 ? null : reason("copy", "It looks like another developer's module.", found.slice(0, 5).join("; "));
}

// ── 4. Code warning signs ─────────────────────────────────────────────────

const CODE_FILE = /\.(?:m?js|cjs|jsx|ts|tsx|html?|svg|xhtml)$/i;
/** A file bigger than this is not read for warning signs, which is itself a warning sign. */
const MAX_CODE_BYTES = 8 * 1024 * 1024;

type Sign = "eval" | "obfuscated" | "wasm" | "remote-code";
const SIGN_LABEL: Record<Sign, string> = { eval: "eval or new Function", obfuscated: "packed or obfuscated code", wasm: "WebAssembly", "remote-code": "code loaded from the internet" };

const around = (text: string, index: number) => text.slice(Math.max(0, index - 30), index + 70).replace(/\s+/g, " ").trim();

function signsIn(name: string, text: string): { sign: Sign; detail: string }[] {
  const found: { sign: Sign; detail: string }[] = [];
  const add = (sign: Sign, match: RegExpExecArray | null | undefined) => {
    if (match) found.push({ sign, detail: `${name}: ${around(text, match.index)}` });
  };
  const count = (pattern: RegExp) => text.match(pattern)?.length ?? 0;

  add("eval", /(?<![\w$.])eval\s*\(|(?:window|globalThis|self)\s*\.\s*eval\s*\(/.exec(text));
  add("eval", /(?<![\w$])(?:new\s+)?Function\s*\(/.exec(text));
  add("eval", /\bset(?:Timeout|Interval)\s*\(\s*["'`]/.exec(text));

  add("wasm", /\bWebAssembly\b/.exec(text));
  add("wasm", /\bwasm-unsafe-eval\b/.exec(text));

  add("remote-code", /\bimport\s*\(\s*["'`](?:https?:|data:|blob:|\/\/)/.exec(text));
  add("remote-code", /\bimport\s*\(\s*(?!["'`])[^)\s]/.exec(text));
  add("remote-code", /\b(?:from|import)\s*["'`](?:https?:)?\/\/[^"'`]+["'`]/.exec(text));
  add("remote-code", /\bimportScripts\s*\(/.exec(text));
  add("remote-code", /createElement(?:NS)?\s*\(\s*(?:["'`]http:\/\/www\.w3\.org\/2000\/svg["'`]\s*,\s*)?["'`]script["'`]/.exec(text));
  add("remote-code", /<script\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//i.exec(text));
  add("remote-code", /new\s+(?:Shared)?Worker\s*\(\s*["'`](?:https?:|data:|blob:)/.exec(text));
  if (/\.svg$/i.test(name) || /\.x?html?$/i.test(name)) add("remote-code", /<script\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\//i.exec(text));

  if (count(/_0x[0-9a-f]{3,8}\b/g) >= 8) add("obfuscated", /_0x[0-9a-f]{3,8}\b/.exec(text));
  add("obfuscated", /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/.exec(text));
  const escapes = count(/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/gi);
  if (escapes >= 100 && (escapes * 5) / text.length >= 0.08) found.push({ sign: "obfuscated", detail: `${name}: ${escapes} escaped characters` });
  if (text.length >= 500 && count(/[[\]()!+]/g) / text.length >= 0.8) found.push({ sign: "obfuscated", detail: `${name}: reads like JSFuck` });
  if (count(/String\.fromCharCode/g) >= 40) add("obfuscated", /String\.fromCharCode/.exec(text));
  if (/\batob\s*\(/.test(text)) add("obfuscated", /(?<!base64,)["'`][A-Za-z0-9+/]{4000,}={0,2}["'`]/.exec(text));
  return found;
}

function checkCode(files: readonly ZipFile[]): ReviewReason | null {
  const signs = new Map<Sign, string[]>();
  const note = (sign: Sign, detail: string) => (signs.get(sign) ?? signs.set(sign, []).get(sign)!).push(detail);
  for (const file of files) {
    if (/\.wasm$/i.test(file.name) || (file.data.length >= 4 && file.data.readUInt32BE(0) === 0x0061736d)) note("wasm", `${file.name}: a WebAssembly file`);
    if (!CODE_FILE.test(file.name)) continue;
    if (file.data.length > MAX_CODE_BYTES) {
      note("obfuscated", `${file.name}: over ${MAX_CODE_BYTES / 1024 / 1024} MB, not read`);
      continue;
    }
    for (const { sign, detail } of signsIn(file.name, file.data.toString("utf8"))) note(sign, detail);
  }
  if (signs.size === 0) return null;
  const detail = [...signs].map(([sign, where]) => `${SIGN_LABEL[sign]}: ${where.slice(0, 3).join(" | ")}${where.length > 3 ? ` (+${where.length - 3} more)` : ""}`).join("; ");
  return reason("code", `Its code has warning signs: ${[...signs.keys()].map((sign) => SIGN_LABEL[sign]).join(", ")}.`, detail);
}

// ── 5. Virus scan ─────────────────────────────────────────────────────────

/** The longest a whole virus scan may take before the version waits instead. */
const SCAN_LIMIT_MS = 180_000;

async function checkVirus(bytes: Buffer, files: readonly ZipFile[], scanner: Scanner | undefined): Promise<ReviewReason | null> {
  if (!scanner) return reason("virus", "The virus scan couldn't run, so a person looks at it.", "No virus scanner is set up on the server");
  try {
    // However a scanner behaves, a scan that takes this long did not run in time.
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("the scan took too long")), SCAN_LIMIT_MS)));
    const result = await Promise.race([Promise.resolve().then(() => scanner.scan(bytes, files)), late]).finally(() => clearTimeout(timer));
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
  const { catalog, scanner } = options;
  const results = await Promise.all([
    guarded("words", () => checkWords(checked)),
    guarded("permissions", () => checkPermissions(checked, catalog, exceptSha)),
    guarded("copy", () => checkCopies(checked, catalog, subject)),
    guarded("code", () => checkCode(checked.files)),
    guarded("virus", () => checkVirus(bytes, checked.files, scanner)),
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
