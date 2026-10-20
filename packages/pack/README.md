# @tavora/pack

Packs a built [Tavora](https://mytavora.app) module into a zip signed with your publisher key and publishes the zip to Tavora's module catalog. Tavora keeps the key and signs for you.

```sh
npm install --save-dev @tavora/pack
npx tavora-pack .                 # packs the module in this folder into <id>-<version>.zip
npx tavora-pack publish <id>-<version>.zip   # lists it in Tavora's module catalog
```

## Pack

`tavora-pack <module folder> [--out <file.zip>] [--key <key file> | --publisher <fingerprint>]` checks `tavora.module.json`, takes the manifest, the folder its `entry` page is in (usually `dist/`) and the icon, and writes a zip with a signature of every file.

## Your publisher key

Tavora knows a publisher by the key, not by a name: an update must be signed with the same key, and the data your module saves for players belongs to it.

Tavora keeps the key for you (Tavora 0.19.11 or newer). In Tavora, sign in under **Settings > Account**, choose a developer name under **Module developer** and press **Make a key**. Your recovery key keeps it safe, and Tavora links it to your account so players see your name. When you pack or publish, `tavora-pack` asks Tavora on this PC to sign, and Tavora asks you first. The secret key never reaches `tavora-pack`. With several keys, pick one with `--publisher <fingerprint>`.

`tavora-pack` never makes a key. A key file works with `--key <file>`, for CI: export the key in Tavora. A key in `~/.tavora/publisher-key.pem`, from an older `tavora-pack`, is used when it's there; add it to Tavora with **Add from a file**, then delete the file.

Players install the zip with **Settings > Modules > Install from zip**.

## Link a key file

`tavora-pack link <code> --key <key file>`: in Tavora, press **Get a link code** under **Module developer**. It shows a code that works once for 10 minutes. The command signs the code with your key and sends the key's public half; the private key never leaves your PC. Tavora links the keys it keeps by itself.

## Publish

`tavora-pack publish <file.zip> [--key <key file> | --publisher <fingerprint>]` lists the zip in Tavora's module catalog, where players find it under **Browse** in the module library. The key must be linked to your account, and publishing needs the account too: with a key Tavora keeps, Tavora uploads the zip with your sign-in once you press **Allow**. With a key file (CI), set `TAVORA_PUBLISH_TOKEN` to a publish token from **Settings > Account > Module developer > Publish tokens**:

```sh
TAVORA_PUBLISH_TOKEN=tvp_… npx tavora-pack publish <id>-<version>.zip --key <key file>
```

The upload carries the signature over the zip's SHA-256 by the key that packed it, so only you can publish what you packed, even after you shared the zip by hand. Your account's email address gets a mail for every upload.

- The part of the module id before the first dot (`wellbrained` in `wellbrained.timer`) is your prefix. The first time you publish under a prefix it becomes yours, and nobody else can publish under it. An account holds at most 3; prefixes with `tavora` and a few other reserved words are refused.
- A module stays with the key that published its first version. Every new version must be newer.
- A publish token publishes only under prefixes your account has, so publish a module's first version from Tavora. A token works for a year.
- An account can publish 10 versions a day and store 200 MB of zips.
- The catalog checks each zip the way Tavora's installer does, and Tavora checks it again on the player's PC.

## From code

```ts
import { loadExistingKey, packModule, tavoraSigner } from "@tavora/pack";

const { zip } = await packModule(".", (await tavoraSigner()) ?? (await loadExistingKey("key.pem")).key);
```

`packModule`, `readZip` and `verifyFiles` are what Tavora's installer uses too. More in the [developer docs](https://docs.mytavora.app/guide/getting-started#share-the-module).
