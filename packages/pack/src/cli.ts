// pnpm pack-module <module folder> [--out <file.zip>] [--key <key file>]
// Packs a built module into a zip signed with your publisher key, made on
// first use. Back the key up: a new key makes you a new publisher.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { defaultKeyFile, loadOrCreateKey } from "./keys.ts";
import { packModule, PackError } from "./pack.ts";
import { fingerprint } from "./signature.ts";

const USAGE = "usage: pnpm pack-module <module folder> [--out <file.zip>] [--key <key file>]";

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, key: { type: "string" }, help: { type: "boolean", short: "h" } } });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length !== 1) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }
  const dir = path.resolve(positionals[0]!);
  const keyFile = path.resolve(values.key ?? defaultKeyFile());
  const { key, created } = await loadOrCreateKey(keyFile);
  const owner = fingerprint(key);
  if (created) {
    console.log(`Made your publisher key: ${keyFile}`);
    console.log("Back this file up and never share it. Without it your next version counts as a different publisher.");
  }
  const { manifest, zip } = await packModule(dir, key);
  const out = path.resolve(values.out ?? `${manifest.id}-${manifest.version}.zip`);
  await writeFile(out, zip);
  console.log(`Packed ${manifest.name} ${manifest.version} into ${out} (${zip.length} bytes)`);
  console.log(`Signed by publisher ${owner}`);
  return 0;
}

main().then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    console.error(error instanceof PackError ? `pack-module: ${error.message}` : error);
    process.exitCode = 1;
  },
);
