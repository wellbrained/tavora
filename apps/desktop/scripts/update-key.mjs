#!/usr/bin/env node
// tavora-update-key: Tavora's update keys (src/main/update-signature.ts), offline on the maintainer's PC. `pnpm release`
// signs each release's latest.yml with the release key; the app installs an update only when one of the two keys
// pinned in src/main/update-keys.ts signed it. The private keys never go to CI, the repo or the server.
//
// pnpm tavora-update-key key <key file>
//   Makes a new update key (never replaces a file), readable only by you, and prints its public half for
//   update-keys.ts. Run it twice: once for the release key, once for the backup key, which you keep apart.
// pnpm tavora-update-key public <key file>
//   Prints the public half of a key again.
// pnpm tavora-update-key check
//   Whether update-keys.ts pins two real, different keys (`pnpm release` and the Release build run this).
// pnpm tavora-update-key verify <latest.yml> <installer>
//   Checks a signed latest.yml and its installer the way the app does, against the pinned keys.
import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_UPDATE_KEYS } from "../src/main/update-keys.ts";
import { makeUpdateKey, rawUpdatePublicKey, readPinnedUpdateKeys, verifyUpdateSignature } from "../src/main/update-signature.ts";
import { readLatestYml } from "./update-feed.mjs";

/** Windows' own icacls by its full path: by its bare name, Windows looks in the current folder first (audit run 7). */
const ICACLS = path.win32.join(process.env.SystemRoot && path.win32.isAbsolute(process.env.SystemRoot) ? process.env.SystemRoot : "C:\\Windows", "System32", "icacls.exe");

const USAGE = [
  "usage: tavora-update-key key <key file>",
  "       tavora-update-key public <key file>",
  "       tavora-update-key check",
  "       tavora-update-key verify <latest.yml> <installer>",
].join("\n");

/**
 * Writes a new private key file that only this user can read (on Windows, its ACL lists only this user). Never
 * replaces a file. On Windows the file is made empty first and limited before the key goes in; where that can't be
 * done (a drive without permissions, such as a FAT USB stick), nothing is written and it throws.
 */
export function writeKeyFile(file, pem) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  // "wx" never replaces a key; 0600 keeps it the owner's where modes count.
  if (process.platform !== "win32") {
    writeFileSync(file, pem, { flag: "wx", mode: 0o600 });
    return;
  }
  writeFileSync(file, "", { flag: "wx" });
  const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${userInfo().username}` : userInfo().username;
  const result = spawnSync(ICACLS, [path.resolve(file), "/inheritance:r", "/grant:r", `${user}:F`], { encoding: "utf8" });
  if (result.status !== 0) {
    rmSync(file, { force: true });
    throw new Error(`could not limit who can read ${path.resolve(file)}, so no key was written there. Make it on an NTFS drive (your user folder), then copy it where you keep it.`);
  }
  writeFileSync(file, pem);
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === "key" && rest.length === 1) {
    const { privateKey, publicKey } = makeUpdateKey();
    writeKeyFile(rest[0], privateKey.export({ format: "pem", type: "pkcs8" }));
    console.log(`Made an update key: ${path.resolve(rest[0])} (only you can read it)`);
    console.log("Keep it offline and back it up. Whoever holds it can sign a Tavora update that every installed app accepts.");
    console.log(`Public key for apps/desktop/src/main/update-keys.ts: ${publicKey}`);
    return 0;
  }
  if (command === "public" && rest.length === 1) {
    console.log(rawUpdatePublicKey(createPrivateKey(readFileSync(rest[0], "utf8"))));
    return 0;
  }
  if (command === "check" && rest.length === 0) {
    const keys = readPinnedUpdateKeys(PINNED_UPDATE_KEYS);
    if (!keys.ok) {
      console.error(`The app's update keys are not ready: ${keys.problem}.`);
      console.error("An app built like this installs no update, so it must not be released (deploy/README.md, \"The update key\").");
      return 1;
    }
    console.log(`The app pins two update keys: release ${PINNED_UPDATE_KEYS.release}, backup ${PINNED_UPDATE_KEYS.backup}.`);
    return 0;
  }
  if (command === "verify" && rest.length === 2) {
    const keys = readPinnedUpdateKeys(PINNED_UPDATE_KEYS);
    if (!keys.ok) {
      console.error(`Can't check: ${keys.problem}.`);
      return 1;
    }
    const { version, signature, signatureLines } = readLatestYml(readFileSync(rest[0], "utf8"));
    if (signatureLines > 1) {
      console.error("latest.yml has more than one signature line.");
      return 1;
    }
    const sha512 = createHash("sha512").update(readFileSync(rest[1])).digest("base64");
    const check = verifyUpdateSignature({ version, file: path.basename(rest[1]), sha512 }, signature, keys.keys);
    if (!check.ok) {
      console.error(`Not signed for this installer: ${check.reason}.`);
      return 1;
    }
    console.log(`${path.basename(rest[1])} ${version} is signed by the ${check.key} key.`);
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`tavora-update-key: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
