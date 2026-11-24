// Tavora's signature in latest.yml (src/main/update-signature.ts holds the format and the check the app runs).
// `pnpm release` signs on the maintainer's PC with the update key (TAVORA_UPDATE_KEY), after the files passed the
// hash and build-provenance checks; scripts/update-check.mjs signs its throwaway test feeds with the same code.
import { spawnSync } from "node:child_process";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  FEED_FRESH_DAYS,
  feedTime,
  rawUpdatePublicKey,
  readPinnedUpdateKeys,
  signUpdate,
  signUpdate2,
  UPDATE_SIGNATURE2_FIELD,
  UPDATE_SIGNATURE_FIELD,
  updateProblem,
  verifyUpdateSignature,
  verifyUpdateSignature2,
} from "../src/main/update-signature.ts";

const SIGNATURE_LINE = new RegExp(`^${UPDATE_SIGNATURE_FIELD}:`, "m");
const SIGNATURE2_LINE = new RegExp(`^${UPDATE_SIGNATURE2_FIELD}:`, "m");
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The version and the signatures latest.yml says, read line by line like the server does (deploy/server/tavora-receive).
 * `signature2` is the tavoraSignature2 value (channel, platform, times and signature), or null.
 */
export function readLatestYml(text) {
  const lines = String(text).split(/\r?\n/);
  const version = lines.find((line) => line.startsWith("version: "))?.slice("version: ".length) ?? null;
  const signatures = lines.filter((line) => SIGNATURE_LINE.test(line));
  const quoted = /^[^:]+: '([A-Za-z0-9+/=]*)'$/.exec(signatures[0] ?? "");
  const second = lines.filter((line) => SIGNATURE2_LINE.test(line));
  const quoted2 = /^[^:]+: '([A-Za-z0-9+/= :-]*)'$/.exec(second[0] ?? "");
  return {
    version,
    signature: signatures.length === 1 && quoted ? quoted[1] : null,
    signatureLines: signatures.length,
    signature2: second.length === 1 && quoted2 ? quoted2[1] : null,
    signature2Lines: second.length,
  };
}

/** The installer's name and SHA-512 latest.yml names (its `path:` and `sha512:` lines), or null. */
export function readFeedInstaller(text) {
  const lines = String(text).split(/\r?\n/);
  const file = lines.find((line) => line.startsWith("path: "))?.slice("path: ".length) ?? null;
  const sha512 = lines.find((line) => line.startsWith("sha512: "))?.slice("sha512: ".length) ?? null;
  return file && sha512 ? { file, sha512 } : null;
}

/**
 * The live latest.yml and the server's clock (its `Date` header), for the release's and the refresh's checks. Throws
 * when the feed doesn't answer; `text` is null when there is no feed yet (404).
 */
export async function fetchLiveFeed(base = "https://updates.mytavora.app") {
  const response = await fetch(`${base}/latest.yml`, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return { text: null, date: response.headers.get("date") };
  if (!response.ok) throw new Error(`${base}/latest.yml answered ${response.status}`);
  return { text: await response.text(), date: response.headers.get("date") };
}

/** A new v2 statement for the stable Windows feed: issued now (whole seconds), good for FEED_FRESH_DAYS. */
export function freshStatement(now = new Date(), { channel = "stable", platform = "win-x64" } = {}) {
  const issued = new Date(Math.floor(now.getTime() / 1000) * 1000);
  return { channel, platform, issuedAt: feedTime(issued), expiresAt: feedTime(new Date(issued.getTime() + FEED_FRESH_DAYS * DAY_MS)) };
}

/**
 * latest.yml with the second signature line right after the first (the server's layout check wants it exactly there).
 * `replace`: a refresh swaps the one that is there; a release must not find one (it signs a feed fresh from the build).
 */
export function addSignature2ToLatestYml(text, value, { replace = false } = {}) {
  const lines = String(text).split("\n");
  if (!/^(stable|preview) [a-z0-9-]+ \S+ \S+ [A-Za-z0-9+/]{86}==$/.test(value)) throw new Error("not a tavoraSignature2 value");
  const existing = lines.filter((line) => SIGNATURE2_LINE.test(line)).length;
  if (existing && !replace) throw new Error(`latest.yml already has a ${UPDATE_SIGNATURE2_FIELD} line; it must come unsigned from the Release build`);
  if (existing > 1) throw new Error(`latest.yml has more than one ${UPDATE_SIGNATURE2_FIELD} line`);
  const kept = lines.filter((line) => !SIGNATURE2_LINE.test(line));
  const at = kept.findIndex((line) => SIGNATURE_LINE.test(line));
  if (at === -1) throw new Error(`latest.yml has no ${UPDATE_SIGNATURE_FIELD} line to put the second signature after`);
  const eol = kept[at].endsWith("\r") ? "\r" : "";
  kept.splice(at + 1, 0, `${UPDATE_SIGNATURE2_FIELD}: '${value}'${eol}`);
  return kept.join("\n");
}

/**
 * latest.yml with the signature as one more top-level field, right after `version:`, in single quotes (YAML reads
 * base64 as a plain string then, whatever its first character). Throws when latest.yml already has one: the Release
 * build never signs, so a signature there was not made here.
 */
export function addSignatureToLatestYml(text, signature) {
  const lines = String(text).split("\n");
  if (lines.some((line) => SIGNATURE_LINE.test(line))) throw new Error(`latest.yml already has a ${UPDATE_SIGNATURE_FIELD} line; it must come unsigned from the Release build`);
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) throw new Error("not an Ed25519 signature in base64");
  const at = lines.findIndex((line) => /^version: \S+\r?$/.test(line));
  if (at === -1) throw new Error("latest.yml has no version line");
  const eol = lines[at].endsWith("\r") ? "\r" : "";
  lines.splice(at + 1, 0, `${UPDATE_SIGNATURE_FIELD}: '${signature}'${eol}`);
  return lines.join("\n");
}

/**
 * The update key in `file` (a PEM made by `pnpm tavora-update-key key`), and which pinned key it is; or why it can't
 * sign: no setting, a file that is not an Ed25519 private key, or a key the app does not pin.
 */
export function loadUpdateSigningKey(file, pinned) {
  const keys = readPinnedUpdateKeys(pinned);
  if (!keys.ok) return { problem: `${keys.problem}.` };
  if (!file) return { problem: "Set TAVORA_UPDATE_KEY to the path of the update key (deploy/README.md, \"The update key\")." };
  // The key itself pasted into the setting must never be printed back (nor any message that would quote it).
  if (/-----BEGIN|[\r\n]/.test(file) || file.length > 1000) return { problem: "TAVORA_UPDATE_KEY must be the path to the key file, not the key itself. Set it to the path and keep the key out of your environment." };
  let key;
  try {
    key = createPrivateKey(readFileSync(file, "utf8"));
  } catch (error) {
    // Only the error's code: a message about a file that is not a key could quote what is in it.
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "not a key";
    return { problem: `Can't read the update key at ${file} (${code}).` };
  }
  if (key.asymmetricKeyType !== "ed25519") return { problem: `${file} is not an Ed25519 key.` };
  const publicKey = rawUpdatePublicKey(key);
  const which = publicKey === pinned.release ? "release" : publicKey === pinned.backup ? "backup" : null;
  if (!which) return { problem: `The update key at ${file} (public key ${publicKey}) is neither of the keys pinned in apps/desktop/src/main/update-keys.ts.` };
  return { key, which };
}

/** The keys update-keys.ts pins, read from its text (as git has it at a release tag), or null when it pins no real ones. */
export function readPinsFromSource(text) {
  if (typeof text !== "string") return null;
  const release = /^\s*release:\s*"([^"]*)"/m.exec(text)?.[1];
  const backup = /^\s*backup:\s*"([^"]*)"/m.exec(text)?.[1];
  if (release === undefined || backup === undefined) return null;
  return readPinnedUpdateKeys({ release, backup }).ok ? { release, backup } : null;
}

/**
 * `file` as git has it at the release tag `v<version>` of the checkout at `repo`, or null only when the tag has no such
 * file. A missing tag, or a file git can't show, throws: neither may pass for "from before signed updates".
 */
export function sourceAtTag(repo, version, file) {
  const ref = `v${version}`;
  const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).status !== 0) throw new Error(`There is no tag ${ref} to read the update keys from.`);
  if (git("cat-file", "-e", `${ref}:${file}`).status !== 0) return null;
  const shown = git("show", `${ref}:${file}`);
  if (shown.status !== 0 || shown.error) throw new Error(`Can't read ${file} at ${ref}.`);
  return shown.stdout;
}

/**
 * The keys a release pins, as its apps have them: `readSource(path)` gives update-keys.ts as git has it at that
 * release, or null when the release has no such file (it is from before signed updates; then `pins` is null). A file
 * that is there but pins no two keys this can read throws: a release ships only with real pins, so that is never a
 * reason to skip the check.
 */
export function releasePins(version, readSource) {
  const source = readSource("apps/desktop/src/main/update-keys.ts");
  if (source === null) return { version, pins: null };
  const pins = readPinsFromSource(source);
  if (!pins) throw new Error(`Can't read the update keys ${version} pins.`);
  return { version, pins };
}

/**
 * Whether the apps of the last release will take this one. What counts is the keys their builds pin, not this
 * checkout's: the signing key must be one of those, and the pins may gain at most one new key per release, so an app
 * that updated once still trusts a key the maintainer holds. `previous` null: no release pinned keys yet (the first).
 * `changed`: the pins differ, which the release asks about before it goes on.
 */
export function checkPinChange(previous, current, signingPublicKey) {
  if (!previous) return { problems: [], changed: false, first: true };
  const old = new Set([previous.release, previous.backup]);
  const problems = [];
  if (signingPublicKey && !old.has(signingPublicKey)) {
    problems.push(`The update key signing this release is not one the last release pins, so every installed app would refuse it. Sign with one of those keys (release ${previous.release}, backup ${previous.backup}).`);
  }
  const added = [current.release, current.backup].filter((key) => !old.has(key));
  if (added.length > 1) problems.push("Both pinned update keys change in this release. Change one at a time, so installed apps keep trusting a key you hold.");
  return { problems, changed: added.length > 0 || previous.release !== current.release || previous.backup !== current.backup, first: false };
}

/**
 * Signs a release's latest.yml for this installer and checks the result the way the app will: both signatures read
 * back from the new text must hold for this version, file and SHA-512 under the pinned keys. Throws otherwise.
 * The v1 line is exactly what it was before v2 existed; v2 (`statement`: channel, platform, issuedAt, expiresAt; by
 * default the stable Windows feed, issued now) goes on the line after it. `statement: null` leaves v2 out (a dry run
 * whose clock wasn't checked: a dated statement is made only when the time on it is known to be right).
 */
export function signLatestYml({ latestYml, version, file, sha512, privateKey, pinned, statement = freshStatement() }) {
  const update = { version, file, sha512 };
  const problem = updateProblem(update);
  if (problem) throw new Error(`can't sign: ${problem}`);
  const said = readLatestYml(latestYml).version;
  if (said !== version) throw new Error(`latest.yml says version ${said}, not ${version}`);
  const v1 = addSignatureToLatestYml(latestYml, signUpdate(update, privateKey));
  const text = statement ? addSignature2ToLatestYml(v1, signUpdate2({ ...update, ...statement }, privateKey)) : v1;
  const keys = readPinnedUpdateKeys(pinned);
  if (!keys.ok) throw new Error(keys.problem);
  const layout = feedProblem(text, update);
  if (layout) throw new Error(`the update server would refuse it: ${layout}`);
  const back = readLatestYml(text);
  const check = verifyUpdateSignature(update, back.signature, keys.keys);
  if (!check.ok) throw new Error(`the signed latest.yml does not check out: ${check.reason}`);
  if (!statement) return { text, key: check.key, statement: null };
  const check2 = verifyUpdateSignature2(update, back.signature2, keys.keys);
  if (!check2.ok) throw new Error(`the signed latest.yml does not check out: ${check2.reason}`);
  return { text, key: check.key, statement: check2.statement };
}

/**
 * The live latest.yml with only its second signature made new (`pnpm release:refresh`): the update key vouches again
 * that this is still the newest version. Checks first that the live feed has the server's exact layout, that its v1
 * signature holds under `pinned` and that a v2 line already there holds too; then that the new statement is for the
 * same channel and platform and issued later. Every other line stays byte for byte. Throws otherwise.
 */
export function refreshLatestYml({ latestYml, privateKey, pinned, statement = freshStatement() }) {
  const keys = readPinnedUpdateKeys(pinned);
  if (!keys.ok) throw new Error(keys.problem);
  const read = readLatestYml(latestYml);
  const installer = readFeedInstaller(latestYml);
  if (!read.version || !installer) throw new Error("the live latest.yml names no version or installer");
  const update = { version: read.version, ...installer };
  const layout = feedProblem(latestYml, update);
  if (layout) throw new Error(`the live latest.yml is not the feed a release writes: ${layout}`);
  const v1 = verifyUpdateSignature(update, read.signature, keys.keys);
  if (!v1.ok) throw new Error(`the live latest.yml's signature does not check out: ${v1.reason}`);
  let previous = null;
  if (read.signature2Lines) {
    const old = verifyUpdateSignature2(update, read.signature2, keys.keys);
    if (!old.ok) throw new Error(`the live latest.yml's second signature does not check out: ${old.reason}`);
    previous = old.statement;
    if (statement.channel !== previous.channel || statement.platform !== previous.platform) {
      throw new Error(`the live feed is for ${previous.channel} ${previous.platform}, not ${statement.channel} ${statement.platform}`);
    }
    if (Date.parse(statement.issuedAt) <= Date.parse(previous.issuedAt)) throw new Error(`the new statement (${statement.issuedAt}) is not later than the live one (${previous.issuedAt})`);
  }
  const text = addSignature2ToLatestYml(latestYml, signUpdate2({ ...update, ...statement }, privateKey), { replace: true });
  const layoutAfter = feedProblem(text, update);
  if (layoutAfter) throw new Error(`the update server would refuse it: ${layoutAfter}`);
  const back = verifyUpdateSignature2(update, readLatestYml(text).signature2, keys.keys);
  if (!back.ok) throw new Error(`the refreshed latest.yml does not check out: ${back.reason}`);
  return { text, update, key: back.key, statement: back.statement, previous };
}

/**
 * Why latest.yml is not exactly electron-builder's feed for this one installer, or null: the update server's own check
 * (feed_problem in deploy/server/tavora-update-signature), line for line, so `pnpm release` finds out before it signs and
 * uploads. `signed`: whether the tavoraSignature line must be there (after signing) or must not (as built).
 */
export function feedProblem(text, { version, file, sha512 }, { signed = true } = {}) {
  // A YAML reader breaks lines at a lone CR too, so a notes line could start a key of its own: none of these anywhere.
  if (/[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029\ufeff]/.test(String(text))) {
    return "latest.yml has a control character or a line separator the feed never has (a lone CR, a tab, NUL, U+0085, U+2028)";
  }
  const lines = String(text).split("\n");
  if (lines.at(-1) === "") lines.pop();
  const seen = {};
  const count = (key) => (seen[key] = (seen[key] ?? 0) + 1);
  let state = "";
  let entry = 0;
  let urls = 0;
  // The second signature sits right after the first, nowhere else: a refresh swaps exactly that one line.
  let afterSignature = false;
  for (const line of lines) {
    const wasSignature = afterSignature;
    afterSignature = false;
    if (state === "notes") {
      if (line === "" || /^ {2}[^ ]/.test(line)) continue;
      state = "";
    }
    if (line.includes("://")) return "latest.yml names an address (://); the feed only ever names the installer next to it";
    if (line.includes("url:") && ++urls > 1) return "latest.yml names more than one url";
    if (state === "files") {
      entry++;
      if (entry === 1 && line === `  - url: ${file}`) continue;
      if (entry === 2 && line === `    sha512: ${sha512}`) continue;
      if (entry === 3 && /^ {4}size: [1-9][0-9]*$/.test(line)) {
        state = "";
        continue;
      }
      return "latest.yml's files list must hold exactly this installer: its url, sha512 and size";
    }
    if (line === `version: ${version}`) count("version");
    else if (/^tavoraSignature: '[A-Za-z0-9+/]{85}[AQgw]=='$/.test(line)) {
      count("tavoraSignature");
      afterSignature = true;
    } else if (/^tavoraSignature2: 'stable win-x64 \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ [A-Za-z0-9+/]{85}[AQgw]=='$/.test(line)) {
      // latest.yml is the stable Windows feed: a v2 line for anything else is refused like any unknown line.
      if (!wasSignature) return "latest.yml's tavoraSignature2 line must come right after its tavoraSignature line";
      count("tavoraSignature2");
    }
    else if (line === "files:") {
      count("files");
      state = "files";
      entry = 0;
    } else if (line === `path: ${file}`) count("path");
    else if (line === `sha512: ${sha512}`) count("sha512");
    else if (line === "releaseNotes: |") {
      count("releaseNotes");
      state = "notes";
    } else if (/^releaseDate: '[0-9TZ:.-]+'$/.test(line)) count("releaseDate");
    else return `latest.yml has a line electron-builder's feed for ${file} never has: ${line.slice(0, 80)}`;
  }
  if (state === "files") return "latest.yml's files list is cut off";
  if (urls !== 1) return "latest.yml must name the installer in exactly one url";
  for (const key of ["version", ...(signed ? ["tavoraSignature"] : []), "files", "path", "sha512", "releaseDate"]) {
    if (seen[key] !== 1) return `latest.yml must have exactly one ${key} line for this installer`;
  }
  if (!signed && seen.tavoraSignature) return "latest.yml already has a tavoraSignature line; it must come unsigned from the Release build";
  if ((seen.tavoraSignature2 ?? 0) > 1) return "latest.yml has more than one tavoraSignature2 line";
  if ((seen.releaseNotes ?? 0) > 1) return "latest.yml has more than one releaseNotes";
  return null;
}

/** What a release signs, as lines to show (the dry run's "would sign"). */
export function describeSigned({ version, file, sha512 }, statement = null) {
  const lines = [`version  ${version}`, `file     ${file}`, `sha512   ${sha512}`];
  if (statement) lines.push(`channel  ${statement.channel} ${statement.platform}`, `fresh    ${statement.issuedAt} to ${statement.expiresAt}`);
  return lines;
}
