// Adds community modules to the catalog by hand, next to what publishers upload with tavora-pack publish:
//
//   pnpm --filter @tavora/api catalog add <module.zip>     a zip packed and signed with tavora-pack
//   pnpm --filter @tavora/api catalog delist <module id>   takes a module out; its versions are kept
//   pnpm --filter @tavora/api catalog relist <module id>
//   pnpm --filter @tavora/api catalog list
//   pnpm --filter @tavora/api catalog set-list <revocations|blocks|successions> <file.json>
//                                                         a list signed offline with pnpm tavora-catalog-sign, served unchanged
//
// It works on the catalog in TAVORA_STATE_DIR (default data/state). On the server it is
// `tavora-api-catalog`, which runs the release's catalog.mjs as the service's user; `add -` reads the zip from stdin.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AccountStore } from "../src/account-store.ts";
import { addByHand } from "../src/catalog-add.ts";
import { CatalogError, CatalogStore, isSignedList, SIGNED_LISTS } from "../src/catalog.ts";

const [command, argument, ...rest] = process.argv.slice(2);
const stateDir = process.env.TAVORA_STATE_DIR ?? "data/state";
const store = new CatalogStore(path.join(stateDir, "catalog"));
// Accounts exist only where the server sends mail; without them nobody holds a prefix.
const accountsFile = path.join(stateDir, "accounts.sqlite");
const accounts = existsSync(accountsFile) ? new AccountStore(accountsFile) : undefined;

try {
  if (command === "add" && argument && rest.length === 0) {
    const { added, reservedFor, unheld } = addByHand(store, accounts, readFileSync(argument === "-" ? 0 : argument));
    console.log(`Added ${added.manifest.id} ${added.manifest.version} by key ${added.owner} (${added.size} bytes, sha256 ${added.sha256}).`);
    const prefix = added.manifest.id.split(".")[0];
    if (reservedFor) console.log(`Reserved the prefix "${prefix}" for account ${reservedFor}, which the key is linked to.`);
    else if (unheld) console.log(`Nobody holds the prefix "${prefix}": it stays taken until the key is linked to an account, which may then claim it.`);
  } else if ((command === "delist" || command === "relist") && argument && rest.length === 0) {
    const changed = store.setListed(argument, command === "relist");
    console.log(changed ? `${command === "relist" ? "Listed" : "Delisted"} ${argument}.` : `There is no module ${argument} in the catalog.`);
    if (!changed) process.exitCode = 1;
  } else if (command === "set-list" && argument && isSignedList(argument) && rest.length === 1) {
    store.setList(argument, readFileSync(rest[0] === "-" ? 0 : rest[0]!));
    console.log(`Now serving the ${argument} list.`);
  } else if (command === "list" && argument === undefined) {
    const modules = store.modules();
    if (modules.length === 0) console.log("The catalog is empty.");
    for (const module of modules) console.log(`${module.id} ${module.latest} (${module.versions} versions, key ${module.owner})${module.listed ? "" : " delisted"}`);
  } else {
    console.error(`Usage:\n  catalog add <module.zip | ->\n  catalog delist <module id>\n  catalog relist <module id>\n  catalog list\n  catalog set-list <${SIGNED_LISTS.join("|")}> <file.json | ->`);
    process.exitCode = 2;
  }
} catch (error) {
  if (!(error instanceof CatalogError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  store.close();
  accounts?.close();
}
