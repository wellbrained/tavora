# @tavora/pack

Packs a built [Tavora](https://mytavora.app) module into a zip signed with your publisher key, and links that key to your Tavora account so players see your developer name.

```sh
npm install --save-dev @tavora/pack
npx tavora-pack .                 # packs the module in this folder into <id>-<version>.zip
npx tavora-pack link ABCD-EFGH    # links your key, with a code from Tavora
```

## Pack

`tavora-pack <module folder> [--out <file.zip>] [--key <key file>]` checks `tavora.module.json`, takes the manifest, the folder its `entry` page is in (usually `dist/`) and the icon, and writes a zip with a signature of every file.

The first run makes your publisher key in `~/.tavora/publisher-key.pem`. **Back it up and never share it.** Tavora knows a publisher by the key, not by a name: an update must be signed with the same key, and the data your module saves for players belongs to it. A new key makes you a new publisher.

Players install the zip with **Settings > Modules > Install from zip**.

## Link your key

`tavora-pack link <code> [--key <key file>]`: in Tavora, sign in under **Settings > Account**, choose a developer name under **Module developer** and press **Link a publisher key**. It shows a code that works once for 10 minutes. The command signs the code with your key and sends the key's public half; the private key never leaves your PC.

## From code

```ts
import { loadOrCreateKey, packModule } from "@tavora/pack";
```

`packModule`, `readZip` and `verifyFiles` are what Tavora's installer uses too. More in the [developer docs](https://docs.mytavora.app/guide/getting-started#share-the-module).
