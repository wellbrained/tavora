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
  let key;
  try {
    key = createPrivateKey(readFileSync(file, "utf8"));
  } catch (error) {
    return { problem: `Can't read the update key at ${file} (${error instanceof Error ? error.message : String(error)}).` };
  }
  if (key.asymmetricKeyType !== "ed25519") return { problem: `${file} is not an Ed25519 key.` };
  const publicKey = rawUpdatePublicKey(key);
  const which = publicKey === pinned.release ? "release" : publicKey === pinned.backup ? "backup" : null;
  if (!which) return { problem: `The update key at ${file} (public key ${publicKey}) is neither of the keys pinned in apps/desktop/src/main/update-keys.ts.` };
  return { key, which };
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
  const back = readLatestYml(text);
  const check = verifyUpdateSignature(update, back.signature, keys.keys);
  if (!check.ok) throw new Error(`the signed latest.yml does not check out: ${check.reason}`);
  return { text, key: check.key };
}

/** What a release signs, as lines to show (the dry run's "would sign"). */
export function describeSigned({ version, file, sha512 }) {
  return [`version  ${version}`, `file     ${file}`, `sha512   ${sha512}`];
}
