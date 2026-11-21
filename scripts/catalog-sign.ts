#!/usr/bin/env node
// tavora-catalog-sign: signs the lists of Tavora's module catalog with the
// catalogue key, offline on the maintainer's PC (catalog threat model, C2).
// The secret key never goes to the service: upload only the signed files it
// writes, which the service serves as they are and the app checks.
//
// pnpm tavora-catalog-sign key <key file>
//   Makes the catalogue key (never replaces a file) and prints its public
//   half, for CATALOGUE_PUBLIC_KEY in apps/desktop/src/main/safety-lists.ts.
// pnpm tavora-catalog-sign public <key file>
//   Prints the public half of the catalogue key again.
// pnpm tavora-catalog-sign <revocations|blocks|successions> <entries.json> --key <key file> --out <signed file> [--allow-change <id> ...]
//   Signs the entries as the next list of that kind. When <signed file>
//   exists (the list served now), its sequence number plus one is used, so
//   the app takes the new list over the old one; otherwise it starts at 1.
//   Each list holds every entry still in force, not only new ones.
//   First it prints every entry the new list adds (+), drops (-) or changes (~)
//   against <signed file>. It signs nothing that drops or changes an entry in
//   force unless each one is named with --allow-change: the block's sha256,
//   the revoked key's fingerprint or the succession's old key.
// pnpm tavora-catalog-sign show <signed file> --key <key file>
//   Checks a signed file against the key and prints the list.
//
// Entries, as a JSON array:
//   revocations  [{ "fingerprint": "<32 hex>", "revoked": "2026-10-18T12:00:00Z", "allow": ["<zip SHA-256>", ...] }]
//                allow: zips the key signed before the revocation that users may still install.
//                The admin panel's revocations.json can add "decide": versions listed between the first request about
//                the key and its leak report. Nothing is signed until each is moved to allow or left out and the field is gone.
//   blocks       [{ "sha256": "<zip SHA-256>", "reason": "Sends your files to a stranger's server." }]
//                reason: one line users read in Settings > Modules. sha256 may also be the hash of what the zip's
//                signature covers (signedHash in packages/pack), which a repack of the same files can't change: list
//                both for each blocked zip, as older apps know only the zip's. The admin panel's blocks.json does
//                (signedSha256 in the catalog), and adds the one a block already in force lacks.
//   successions  [{ "old": "<32 hex>", "new": "<32 hex>", "account": "<account id>" }]
//                only after the service checked that the account linked the old key before it was lost.
import { createPrivateKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { TAVORA_PUBLISHER_KEY } from "../packages/module-schema/src/index.ts";
import { writePrivateFile } from "../packages/pack/src/keys.ts";
import { CATALOG_LIST_KINDS, catalogPublicKey, nextCatalogList, readCatalogList, signCatalogList, type CatalogListKind, type Succession } from "../packages/pack/src/catalog-lists.ts";
import { reviewCatalogList, undecidedRevocations } from "./catalog-sign-review.ts";

const USAGE = [
  "usage: tavora-catalog-sign key <key file>",
  "       tavora-catalog-sign public <key file>",
  "       tavora-catalog-sign <revocations|blocks|successions> <entries.json> --key <key file> --out <signed file> [--allow-change <id> ...]",
  "       tavora-catalog-sign show <signed file> --key <key file>",
].join("\n");

async function loadKey(file: string): Promise<KeyObject> {
  const key = createPrivateKey(await readFile(file, "utf8"));
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${file} is not an Ed25519 key`);
  return key;
}

async function readIfThere(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * A succession that starts at Tavora's pinned publisher key, or continues from a key that replaced it, hands the
 * power to publish Tavora's own modules to the new key. Say so loudly, so it is never signed by accident.
 */
function warnPinnedChain(entries: unknown, previous: { successions?: { old: string; new: string }[] } | null): void {
  const statements = Array.isArray(entries) ? (entries as { old?: unknown; new?: unknown }[]) : [];
  const chain = new Set([TAVORA_PUBLISHER_KEY]);
  const all = [...(previous?.successions ?? []), ...statements];
  for (let grew = true; grew; ) {
    grew = false;
    for (const { old, new: next } of all) {
      if (typeof old === "string" && typeof next === "string" && chain.has(old) && !chain.has(next)) {
        chain.add(next);
        grew = true;
      }
    }
  }
  const touching = statements.filter(({ old, new: next }) => (typeof old === "string" && chain.has(old)) || (typeof next === "string" && chain.has(next)));
  if (touching.length === 0) return;
  console.error("\n!!! WARNING: this list touches the pinned Tavora publisher key's chain. !!!");
  console.error("!!! Whoever holds the new key may then publish Tavora's own modules. Sign it only if you meant that. !!!");
  for (const { old, new: next } of touching) console.error(`!!!   ${String(old)} -> ${String(next)}`);
  console.error("");
}

/** Every new or changed succession lets its new key update that publisher's modules: check each one. */
function warnSuccessions(successions: readonly Succession[]): void {
  if (successions.length === 0) return;
  console.error("\n!!! Check every new or changed succession: whoever holds the new key may then update that publisher's modules. !!!");
  console.error("!!! Sign it only if you know that account linked the old key and asked for this. !!!");
  for (const { old, new: next, account } of successions) console.error(`!!!   ${old} -> ${next} (account ${account})`);
  console.error("");
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { key: { type: "string" }, out: { type: "string" }, "allow-change": { type: "string", multiple: true }, help: { type: "boolean", short: "h" } },
  });
  const [command, file] = positionals;
  if (values.help || positionals.length !== 2 || !command || !file) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }

  if (command === "key") {
    const { privateKey } = generateKeyPairSync("ed25519");
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    // Never replaces a key; readable by its owner only (on Windows its access list is cut down to this user).
    await writePrivateFile(file, privateKey.export({ format: "pem", type: "pkcs8" }));
    console.log(`Made the catalogue key: ${path.resolve(file)}`);
    console.log("Keep it offline and back it up. Whoever holds it can revoke keys, block modules and move a publisher's data.");
    console.log(`Public key for CATALOGUE_PUBLIC_KEY: ${catalogPublicKey(privateKey)}`);
    return 0;
  }
  if (command === "public") {
    console.log(catalogPublicKey(await loadKey(file)));
    return 0;
  }
  if (!values.key) {
    console.error(USAGE);
    return 2;
  }
  const key = await loadKey(values.key);
  const publicKey = catalogPublicKey(key);

  if (command === "show") {
    const text = await readFile(file, "utf8");
    for (const kind of CATALOG_LIST_KINDS) {
      const list = readCatalogList(kind, text, publicKey);
      if (list) {
        console.log(JSON.stringify(list, null, 2));
        return 0;
      }
    }
    console.error(`${file} is not a list signed by this catalogue key.`);
    return 1;
  }

  if (!(CATALOG_LIST_KINDS as readonly string[]).includes(command) || !values.out) {
    console.error(USAGE);
    return 2;
  }
  const kind = command as CatalogListKind;
  const entries: unknown = JSON.parse(await readFile(file, "utf8"));
  const previousText = await readIfThere(values.out);
  const previous = previousText === null ? null : readCatalogList(kind, previousText, publicKey);
  if (previousText !== null && previous === null) throw new Error(`${values.out} is not a ${kind} list signed by this key; move it away or pass another --out`);
  if (kind === "successions" && TAVORA_PUBLISHER_KEY !== "") warnPinnedChain(entries, previous);
  if (kind === "revocations") {
    const undecided = undecidedRevocations(entries);
    if (undecided.length > 0) {
      console.error("Signed nothing: these versions were listed after the key was first asked about and before it was reported as leaked, while whoever had it could still publish:");
      for (const line of undecided) console.error(`  ${line}`);
      console.error(`In ${file}, put the zip of each one the developer really published into that entry's "allow", leave out the others, then delete the "decide" field.`);
      return 1;
    }
  }
  const list = nextCatalogList(kind, entries, previous, new Date());
  // The entries come from the service: show what they change before anything is signed.
  const review = reviewCatalogList(kind, previous, list, values["allow-change"] ?? []);
  for (const line of review.lines) console.log(line);
  warnSuccessions(review.successions);
  for (const id of review.unused) console.error(`--allow-change ${id} names no entry this list drops or changes.`);
  if (review.refused.length > 0) {
    console.error(`\nSigned nothing: ${review.refused.length} ${review.refused.length === 1 ? "entry" : "entries"} in force would be dropped or changed (- and ~ above).`);
    console.error("Check where each change came from. To sign it anyway, name each one: " + review.refused.map((id) => `--allow-change ${id}`).join(" "));
    return 1;
  }
  await writeFile(values.out, signCatalogList(list, key));
  console.log(`Signed ${kind} list ${list.sequence} (${list.issued}) into ${path.resolve(values.out)}. Upload it as ${kind}.json.`);
  return 0;
}

main().then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    console.error(`tavora-catalog-sign: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
