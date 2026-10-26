#!/usr/bin/env node
// For publishing from CI. Developers publish from Tavora itself (Settings > Development), which packs,
// signs and uploads with one button; this command signs with a key file exported from Tavora.
// tavora-pack <module folder> --key <key file> [--out <file.zip>]
//   Packs a built module into a zip signed with your publisher key.
// tavora-pack link <code> --key <key file>
//   Links a key file to your Tavora account with a code from Tavora, so players see your developer
//   name. Keys Tavora keeps are linked by Tavora. Only the key's public half leaves this PC.
// tavora-pack publish <file.zip> --key <key file>
//   Publishes a zip packed with your key to Tavora's module catalog. TAVORA_PUBLISH_TOKEN holds a publish
//   token from Tavora. The key must be linked; its first module id prefix is yours from then on.
// tavora-pack withdraw <file.zip | sha256>
//   Takes back a version that is waiting for review (TAVORA_PUBLISH_TOKEN). No key needed.
// Installed from npm as @tavora/pack; in Tavora's own repository: pnpm tavora-pack ...
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadExistingKey } from "./keys.ts";
import { DEFAULT_API_URL, LinkError, linkKey } from "./link.ts";
import { packModule, PackError } from "./pack.ts";
import { CATALOG_RULES_URL, PublishError, publishZip, withdrawVersion } from "./publish.ts";
import { fingerprint } from "./signature.ts";

const USAGE = [
  "usage: tavora-pack <module folder> --key <key file> [--out <file.zip>]",
  "       tavora-pack link <code> --key <key file>",
  "       tavora-pack publish <file.zip> --key <key file>",
  "       tavora-pack withdraw <file.zip | sha256>",
].join("\n");

/** What the command says without --key: publishing lives in Tavora now. */
const NO_KEY = "Publish from Tavora: Settings > Development. For CI, export your key there and pass --key <file>.";

/** The key in the file --key names. */
async function keyFrom(file: string, fail: (message: string) => Error) {
  const { key } = await loadExistingKey(path.resolve(file)).catch((error: unknown) => {
    throw fail((error as Error).message);
  });
  return key;
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      // --api points link and publish at another copy of Tavora's service, for testing.
      options: { out: { type: "string" }, key: { type: "string" }, api: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const linking = positionals[0] === "link";
  const publishing = positionals[0] === "publish";
  const withdrawing = positionals[0] === "withdraw";
  const command = linking || publishing || withdrawing;
  if (values.help || positionals.length !== (command ? 2 : 1) || (command && values.out) || (!command && values.api)) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }
  if (withdrawing) {
    const target = positionals[1]!;
    const sha256 = /^[0-9a-f]{64}$/i.test(target)
      ? target.toLowerCase()
      : createHash("sha256")
          .update(
            await readFile(path.resolve(target)).catch(() => {
              throw new PublishError(`Cannot read ${path.resolve(target)}.`);
            }),
          )
          .digest("hex");
    const withdrawn = await withdrawVersion({ token: process.env.TAVORA_PUBLISH_TOKEN?.trim() || undefined, sha256, apiUrl: values.api ?? DEFAULT_API_URL });
    console.log(`Withdrawn: ${withdrawn.id} ${withdrawn.version} is not waiting for review any more.`);
    return 0;
  }
  if (!values.key) {
    console.error(`tavora-pack: ${NO_KEY}`);
    return 2;
  }

  if (linking) {
    const key = await keyFrom(values.key, (message) => new LinkError(message));
    const linked = await linkKey({ key, code: positionals[1]!, apiUrl: values.api ?? DEFAULT_API_URL });
    console.log(`Linked publisher key ${linked.fingerprint} to your Tavora account.`);
    console.log(linked.name ? `Players now see your modules as "by ${linked.name}".` : "Choose a developer name in Tavora so players see it.");
    return 0;
  }

  if (publishing) {
    const zipFile = path.resolve(positionals[1]!);
    const zip = await readFile(zipFile).catch(() => {
      throw new PublishError(`Cannot read ${zipFile}.`);
    });
    const key = await keyFrom(values.key, (message) => new PublishError(message));
    const token = process.env.TAVORA_PUBLISH_TOKEN?.trim() || undefined;
    const published = await publishZip({ key, zip, token, apiUrl: values.api ?? DEFAULT_API_URL });
    if (published.status === "waiting") {
      // Not an error: the upload is safe and complete, but not listed until a person at Tavora has looked at it.
      console.log(`Waiting for review: ${published.id} ${published.version} is uploaded, but players can't see it yet.`);
      console.log("A person at Tavora looks at it first. Why:");
      for (const reason of published.reasons) console.log(`  - ${reason.text}`);
      console.log("You'll get an email when it's decided. Nothing else to do.");
      console.log(`Zip sha256 ${published.sha256}. To take it back: tavora-pack withdraw ${published.sha256}`);
    } else {
      console.log(`Published ${published.id} ${published.version} to Tavora's module catalog.`);
      console.log(`Players find it under Browse in the module library. Zip sha256 ${published.sha256}`);
    }
    console.log(`What's not allowed in the catalog: ${CATALOG_RULES_URL}`);
    return 0;
  }

  const key = await keyFrom(values.key, (message) => new PackError(message));
  const dir = path.resolve(positionals[0]!);
  const { manifest, zip } = await packModule(dir, key);
  const out = path.resolve(values.out ?? `${manifest.id}-${manifest.version}.zip`);
  await writeFile(out, zip);
  console.log(`Packed ${manifest.name} ${manifest.version} into ${out} (${zip.length} bytes)`);
  console.log(`Signed by publisher ${fingerprint(key)}`);
  return 0;
}

main().then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    console.error(error instanceof PackError || error instanceof LinkError || error instanceof PublishError ? `tavora-pack: ${error.message}` : error);
    process.exitCode = 1;
  },
);
