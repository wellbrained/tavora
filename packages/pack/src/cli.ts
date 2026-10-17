#!/usr/bin/env node
// tavora-pack <module folder> [--out <file.zip>] [--key <key file>]
//   Packs a built module into a zip signed with your publisher key, made on
//   first use. Back the key up: a new key makes you a new publisher.
// tavora-pack link <code> [--key <key file>]
//   Links your publisher key to your Tavora account with a code from Tavora
//   (Settings > Account > Link a publisher key), so players see your
//   developer name. Only the key's public half leaves this PC.
// Installed from npm as @tavora/pack; in Tavora's own repository: pnpm tavora-pack ...
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { defaultKeyFile, loadOrCreateKey } from "./keys.ts";
import { DEFAULT_API_URL, LinkError, linkKey } from "./link.ts";
import { packModule, PackError } from "./pack.ts";
import { fingerprint } from "./signature.ts";

const USAGE = [
  "usage: tavora-pack <module folder> [--out <file.zip>] [--key <key file>]",
  "       tavora-pack link <code> [--key <key file>]",
].join("\n");

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      // --api points link at another copy of Tavora's service, for testing.
      options: { out: { type: "string" }, key: { type: "string" }, api: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const linking = positionals[0] === "link";
  if (values.help || positionals.length !== (linking ? 2 : 1) || (linking && values.out) || (!linking && values.api)) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }
  const keyFile = path.resolve(values.key ?? defaultKeyFile());
  const { key, created } = await loadOrCreateKey(keyFile);
  const owner = fingerprint(key);
  if (created) {
    console.log(`Made your publisher key: ${keyFile}`);
    console.log("Back this file up and never share it. Without it your next version counts as a different publisher.");
  }

  if (linking) {
    const linked = await linkKey({ key, code: positionals[1]!, apiUrl: values.api ?? DEFAULT_API_URL });
    console.log(`Linked publisher key ${linked.fingerprint} to your Tavora account.`);
    console.log(linked.name ? `Players now see your modules as "by ${linked.name}".` : "Choose a developer name in Tavora so players see it.");
    return 0;
  }

  const dir = path.resolve(positionals[0]!);
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
    console.error(error instanceof PackError || error instanceof LinkError ? `tavora-pack: ${error.message}` : error);
    process.exitCode = 1;
  },
);
