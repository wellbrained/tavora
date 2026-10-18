// Adds community modules to the catalog by hand, until publishers upload their own (Milestone E, step 3):
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
import { readFileSync } from "node:fs";
import path from "node:path";
import { CatalogError, CatalogStore, isSignedList, SIGNED_LISTS } from "../src/catalog.ts";

const [command, argument, ...rest] = process.argv.slice(2);
const store = new CatalogStore(path.join(process.env.TAVORA_STATE_DIR ?? "data/state", "catalog"));

try {
  if (command === "add" && argument && rest.length === 0) {
    const added = store.add(readFileSync(argument === "-" ? 0 : argument));
    console.log(`Added ${added.manifest.id} ${added.manifest.version} by key ${added.owner} (${added.size} bytes, sha256 ${added.sha256}).`);
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
}
