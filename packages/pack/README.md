# @tavora/pack

Packs a built [Tavora](https://mytavora.app) module into a zip signed with your publisher key, links that key to your Tavora account so players see your developer name, and publishes the zip to Tavora's module catalog.

```sh
npm install --save-dev @tavora/pack
npx tavora-pack .                 # packs the module in this folder into <id>-<version>.zip
npx tavora-pack link ABCD-EFGH    # links your key, with a code from Tavora
npx tavora-pack publish <id>-<version>.zip   # lists it in Tavora's module catalog
```

## Pack

`tavora-pack <module folder> [--out <file.zip>] [--key <key file>]` checks `tavora.module.json`, takes the manifest, the folder its `entry` page is in (usually `dist/`) and the icon, and writes a zip with a signature of every file.

The first run makes your publisher key in `~/.tavora/publisher-key.pem`. **Back it up and never share it.** Tavora knows a publisher by the key, not by a name: an update must be signed with the same key, and the data your module saves for players belongs to it. A new key makes you a new publisher.

Players install the zip with **Settings > Modules > Install from zip**.

## Link your key

`tavora-pack link <code> [--key <key file>]`: in Tavora, sign in under **Settings > Account**, choose a developer name under **Module developer** and press **Link a publisher key**. It shows a code that works once for 10 minutes. The command signs the code with your key and sends the key's public half; the private key never leaves your PC.

## Publish

`tavora-pack publish <file.zip> [--key <key file>]` lists the zip in Tavora's module catalog, where players find it under **Browse** in the module library. Link your key first. The command sends the zip and your key's signature over its SHA-256, so only you can publish what you packed, even after you shared the zip by hand.

- The part of the module id before the first dot (`wellbrained` in `wellbrained.timer`) is your prefix. The first time you publish under a prefix it becomes yours, and nobody else can publish under it. An account holds at most 3; prefixes with `tavora` and a few other reserved words are refused.
- A module stays with the key that published its first version. Every new version must be newer.
- An account can publish 10 versions a day and store 200 MB of zips.
- The catalog checks each zip the way Tavora's installer does, and Tavora checks it again on the player's PC.

## From code

```ts
import { loadOrCreateKey, packModule } from "@tavora/pack";
```

`packModule`, `readZip` and `verifyFiles` are what Tavora's installer uses too. More in the [developer docs](https://docs.mytavora.app/guide/getting-started#share-the-module).
