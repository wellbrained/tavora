#!/usr/bin/env node
// tavora-pack <module folder> [--out <file.zip>] [--key <key file>] [--publisher <fingerprint>]
//   Packs a built module into a zip signed with your publisher key. Tavora keeps the key and signs
//   after you allow it there (Settings > Account > Module developer makes one); --key signs with a key
//   file instead, for CI. The pack command never makes a key.
// tavora-pack link <code> [--key <key file>]
//   Links a key file to your Tavora account with a code from Tavora, so players see your developer
//   name. Keys Tavora keeps are linked by Tavora. Only the key's public half leaves this PC.
// tavora-pack publish <file.zip> [--key <key file>]
//   Publishes a zip packed with your key to Tavora's module catalog. Tavora signs and uploads it with your
//   sign-in; with a key file (CI), TAVORA_PUBLISH_TOKEN holds a publish token from Tavora. The key must
//   be linked; its first module id prefix is yours from then on.
// Installed from npm as @tavora/pack; in Tavora's own repository: pnpm tavora-pack ...
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { defaultKeyFile, loadExistingKey } from "./keys.ts";
import { DEFAULT_API_URL, LinkError, linkKey } from "./link.ts";
import { packModule, PackError } from "./pack.ts";
import { PublishError, publishZip } from "./publish.ts";
import { verifyFiles } from "./signature.ts";
import { keySigner, SignerError, tavoraSigner, type Signer } from "./signer.ts";
import { readZip, ZipError } from "./zip.ts";

const USAGE = [
  "usage: tavora-pack <module folder> [--out <file.zip>] [--key <key file> | --publisher <fingerprint>]",
  "       tavora-pack link <code> [--key <key file>]",
  "       tavora-pack publish <file.zip> [--key <key file> | --publisher <fingerprint>]",
].join("\n");

/** The key file to sign with: --key, or the one older versions made, when it is there. Null: Tavora signs. */
async function keyFile(given: string | undefined): Promise<string | null> {
  if (given) return path.resolve(given);
  const old = defaultKeyFile();
  return (await access(old).then(() => true, () => false)) ? old : null;
}

async function signer(options: { key?: string | undefined; publisher?: string | undefined }, fail: (message: string) => Error): Promise<Signer> {
  const file = await keyFile(options.key);
  if (file) {
    const { key } = await loadExistingKey(file).catch((error: unknown) => {
      throw fail((error as Error).message);
    });
    const byFile = keySigner(key);
    // The old key file is skipped when another key is asked for: then Tavora may keep that one.
    if (options.key || !options.publisher || byFile.fingerprint.startsWith(options.publisher.toLowerCase())) {
      if (!options.key) console.log(`Signing with ${file}. Add it to Tavora (Settings > Account > Module developer > Add a key), then delete the file, so only Tavora keeps it.`);
      return byFile;
    }
  }
  const tavora = await tavoraSigner({ ...(options.publisher ? { publisher: options.publisher } : {}) }).catch((error: unknown) => {
    throw error instanceof SignerError ? fail(error.message) : error;
  });
  if (!tavora) throw fail("Open Tavora on this PC: it keeps your publisher key and signs for you. Or sign with a key file: --key <file>.");
  console.log("Allow the request in Tavora to sign.");
  return tavora;
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      // --api points link and publish at another copy of Tavora's service, for testing.
      options: { out: { type: "string" }, key: { type: "string" }, publisher: { type: "string" }, api: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const linking = positionals[0] === "link";
  const publishing = positionals[0] === "publish";
  const command = linking || publishing;
  if (values.help || positionals.length !== (command ? 2 : 1) || (command && values.out) || (!command && values.api) || (values.key && values.publisher) || (linking && values.publisher)) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }

  if (linking) {
    const file = await keyFile(values.key);
    if (!file) throw new LinkError("Tavora links the publisher keys it keeps by itself. Link only a key file: --key <file>.");
    const { key } = await loadExistingKey(file).catch((error: unknown) => {
      throw new LinkError((error as Error).message);
    });
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
    // Tavora signs with the key that packed the zip, unless told otherwise.
    let owner: string | undefined;
    try {
      const verified = verifyFiles(readZip(zip));
      if (verified.ok && verified.signed) owner = verified.owner;
    } catch (error) {
      if (!(error instanceof ZipError)) throw error;
    }
    const by = await signer({ key: values.key, publisher: values.publisher ?? owner }, (message) => new PublishError(message));
    const token = process.env.TAVORA_PUBLISH_TOKEN?.trim() || undefined;
    const published = await publishZip({ key: by, zip, token, apiUrl: values.api ?? DEFAULT_API_URL });
    console.log(`Published ${published.id} ${published.version} to Tavora's module catalog.`);
    console.log(`Players find it under Browse in the module library. Zip sha256 ${published.sha256}`);
    return 0;
  }

  const by = await signer({ key: values.key, publisher: values.publisher }, (message) => new PackError(message));
  const dir = path.resolve(positionals[0]!);
  const { manifest, zip } = await packModule(dir, by);
  const out = path.resolve(values.out ?? `${manifest.id}-${manifest.version}.zip`);
  await writeFile(out, zip);
  console.log(`Packed ${manifest.name} ${manifest.version} into ${out} (${zip.length} bytes)`);
  console.log(`Signed by publisher ${by.fingerprint}`);
  return 0;
}

main().then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    console.error(error instanceof PackError || error instanceof LinkError || error instanceof PublishError || error instanceof SignerError ? `tavora-pack: ${error.message}` : error);
    process.exitCode = 1;
  },
);
