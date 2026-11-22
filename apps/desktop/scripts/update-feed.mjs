// Tavora's signature in latest.yml (src/main/update-signature.ts holds the format and the check the app runs).
// `pnpm release` signs on the maintainer's PC with the update key (TAVORA_UPDATE_KEY), after the files passed the
// hash and build-provenance checks; scripts/update-check.mjs signs its throwaway test feeds with the same code.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { rawUpdatePublicKey, readPinnedUpdateKeys, signUpdate, UPDATE_SIGNATURE_FIELD, updateProblem, verifyUpdateSignature } from "../src/main/update-signature.ts";

const SIGNATURE_LINE = new RegExp(`^${UPDATE_SIGNATURE_FIELD}:`, "m");

/** The version and the signature latest.yml says, read line by line like the server does (deploy/server/tavora-receive). */
export function readLatestYml(text) {
  const lines = String(text).split(/\r?\n/);
  const version = lines.find((line) => line.startsWith("version: "))?.slice("version: ".length) ?? null;
  const signatures = lines.filter((line) => SIGNATURE_LINE.test(line));
  const quoted = /^[^:]+: '([A-Za-z0-9+/=]*)'$/.exec(signatures[0] ?? "");
  return { version, signature: signatures.length === 1 && quoted ? quoted[1] : null, signatureLines: signatures.length };
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
 * Signs a release's latest.yml for this installer and checks the result the way the app will: the signature read
 * back from the new text must hold for this version, file and SHA-512 under the pinned keys. Throws otherwise.
 */
export function signLatestYml({ latestYml, version, file, sha512, privateKey, pinned }) {
  const update = { version, file, sha512 };
  const problem = updateProblem(update);
  if (problem) throw new Error(`can't sign: ${problem}`);
  const said = readLatestYml(latestYml).version;
  if (said !== version) throw new Error(`latest.yml says version ${said}, not ${version}`);
  const text = addSignatureToLatestYml(latestYml, signUpdate(update, privateKey));
  const keys = readPinnedUpdateKeys(pinned);
  if (!keys.ok) throw new Error(keys.problem);
  const layout = feedProblem(text, update);
  if (layout) throw new Error(`the update server would refuse it: ${layout}`);
  const back = readLatestYml(text);
  const check = verifyUpdateSignature(update, back.signature, keys.keys);
  if (!check.ok) throw new Error(`the signed latest.yml does not check out: ${check.reason}`);
  return { text, key: check.key };
}

/**
 * Why latest.yml is not exactly electron-builder's feed for this one installer, or null: the update server's own check
 * (feed_problem in deploy/server/tavora-update-signature), line for line, so `pnpm release` finds out before it signs and
 * uploads. `signed`: whether the tavoraSignature line must be there (after signing) or must not (as built).
 */
export function feedProblem(text, { version, file, sha512 }, { signed = true } = {}) {
  const lines = String(text).split("\n");
  if (lines.at(-1) === "") lines.pop();
  const seen = {};
  const count = (key) => (seen[key] = (seen[key] ?? 0) + 1);
  let state = "";
  let entry = 0;
  let urls = 0;
  for (const line of lines) {
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
    else if (line.startsWith("tavoraSignature: ")) count("tavoraSignature");
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
  if ((seen.releaseNotes ?? 0) > 1) return "latest.yml has more than one releaseNotes";
  return null;
}

/** What a release signs, as lines to show (the dry run's "would sign"). */
export function describeSigned({ version, file, sha512 }) {
  return [`version  ${version}`, `file     ${file}`, `sha512   ${sha512}`];
}
