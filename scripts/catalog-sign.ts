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
// pnpm tavora-catalog-sign <revocations|blocks|successions> <entries.json> --key <key file> --out <signed file>
//   Signs the entries as the next list of that kind. When <signed file>
//   exists (the list served now), its sequence number plus one is used, so
//   the app takes the new list over the old one; otherwise it starts at 1.
//   Each list holds every entry still in force, not only new ones.
// pnpm tavora-catalog-sign show <signed file> --key <key file>
//   Checks a signed file against the key and prints the list.
//
// Entries, as a JSON array:
//   revocations  [{ "fingerprint": "<32 hex>", "revoked": "2026-10-18T12:00:00Z", "allow": ["<zip SHA-256>", ...] }]
//                allow: zips the key signed before the revocation that players may still install.
//   blocks       [{ "sha256": "<zip SHA-256>", "reason": "Sends your files to a stranger's server." }]
//                reason: one line players read in Settings > Modules.
//   successions  [{ "old": "<32 hex>", "new": "<32 hex>", "account": "<account id>" }]
//                only after the service checked that the account linked the old key before it was lost.
import { createPrivateKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { CATALOG_LIST_KINDS, catalogPublicKey, nextCatalogList, readCatalogList, signCatalogList, type CatalogListKind } from "../packages/pack/src/catalog-lists.ts";

const USAGE = [
  "usage: tavora-catalog-sign key <key file>",
  "       tavora-catalog-sign public <key file>",
  "       tavora-catalog-sign <revocations|blocks|successions> <entries.json> --key <key file> --out <signed file>",
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

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { key: { type: "string" }, out: { type: "string" }, help: { type: "boolean", short: "h" } } });
  const [command, file] = positionals;
  if (values.help || positionals.length !== 2 || !command || !file) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }

  if (command === "key") {
    const { privateKey } = generateKeyPairSync("ed25519");
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    // "wx" never replaces a key; 0600 keeps it the owner's.
    await writeFile(file, privateKey.export({ format: "pem", type: "pkcs8" }), { flag: "wx", mode: 0o600 });
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
  const list = nextCatalogList(kind, entries, previous, new Date());
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
