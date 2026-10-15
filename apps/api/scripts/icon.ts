// Adds a game icon to the hosted set, or removes one (a publisher's takedown request):
//
//   pnpm --filter @tavora/api icon add <id> "<name>[|<other name>...]" <file.png|file.ico> "<where it came from>"
//   pnpm --filter @tavora/api icon remove <id>
//
// Then commit apps/api/data/icons and deploy with scripts/Deploy-Api.ps1.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addIcon, IconFileError, removeIcon } from "../src/icon-files.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../data/icons");
const [command, id, ...rest] = process.argv.slice(2);

try {
  if (command === "add" && id && rest.length === 3) {
    const [names, file, source] = rest as [string, string, string];
    const result = addIcon(dir, { id, names: names.split("|"), bytes: new Uint8Array(readFileSync(file)), source });
    console.log(`Added ${result.id} (${result.size} bytes, sha256 ${result.sha256}).`);
  } else if (command === "remove" && id && rest.length === 0) {
    console.log(removeIcon(dir, id) ? `Removed ${id}.` : `There was no icon ${id}.`);
  } else {
    console.error('Usage:\n  icon add <id> "<name>[|<other name>...]" <file.png|file.ico> "<source>"\n  icon remove <id>');
    process.exitCode = 2;
  }
} catch (error) {
  if (!(error instanceof IconFileError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
