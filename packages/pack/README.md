# @tavora/pack

Packs a built [Tavora](https://mytavora.app) module into a signed zip and publishes it to Tavora's module catalog, from CI.

To publish by hand, you don't need this package: open Tavora, go to **Settings > Development** and press **Publish** on your module. Tavora packs, signs and uploads it for you.

```sh
npx @tavora/pack . --key publisher-key.pem                              # packs into <id>-<version>.zip
TAVORA_PUBLISH_TOKEN=tvp_… npx @tavora/pack publish <id>-<version>.zip --key publisher-key.pem
```

## Set up CI

1. In Tavora, publish the module once, or claim your id prefix there. A publish token only publishes under prefixes your account already holds.
2. Under **Settings > Development > Publisher keys and CI**, export your publisher key to a file and make a publish token.
3. Store both as secrets in your CI: the key file's text, and the token as `TAVORA_PUBLISH_TOKEN`.

Keep the key file secret: whoever has it can sign updates in your name. A token works for a year; remove it in Tavora when you don't need it any more.

## Build settings

`@tavora/pack/vite` has the Vite settings a module shares, so `vite.config.ts` stays short:

```ts
import { moduleConfig } from "@tavora/pack/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig(moduleConfig({ pages: ["index", "overlay"], plugins: [vue()], notices: { VUE: "vue", MODULE: "./LICENSE" } }));
```

`pages` are the HTML files in `src/` (default `["index"]`); `notices` copy licence files into `dist/` as `<NAME>-LICENSE.txt`, from a package name or a `./file` in your project. Also `publicDir`, `dedupe`, `alias`, `define` and `chunkSizeWarningLimit`. A project's `tsconfig.json` can extend `@tavora/pack/tsconfig.module.json`.

## Pack

`tavora-pack <module folder> --key <key file> [--out <file.zip>]` checks `tavora.module.json`, takes the manifest, the folder its `entry` page is in (usually `dist/`), the icon and the changelog, and writes a zip with a signature of every file. Build the module first.

## Publish

`tavora-pack publish <file.zip> --key <key file>` lists the zip in Tavora's module catalog, where users find it under **Browse** in the module library. It needs a publish token in `TAVORA_PUBLISH_TOKEN`, and the key must be linked to your account (Tavora links the keys it makes).

The upload carries the signature over the zip's SHA-256 by the key that packed it, so only you can publish what you packed. Your account's email address gets a mail for every upload.

Every new version is checked automatically. If all is well it is listed at once. If not, or if it's your first module or has new pictures, the command prints **Waiting for review** with the reasons: the version is uploaded but not listed until a person at Tavora has looked at it, and you get an email either way. That is not an error (the exit code is 0). `tavora-pack withdraw <file.zip | sha256>` takes a waiting version back; it needs only `TAVORA_PUBLISH_TOKEN`. What's not allowed: https://docs.mytavora.app/guide/catalog-rules

- The part of the module id before the first dot (`wellbrained` in `wellbrained.timer`) is your prefix. An account holds at most 3; prefixes with `tavora` and a few other reserved words are refused.
- A module stays with the key that published its first version. Every new version must be newer, and plain `major.minor.patch`: pre-releases such as `1.0.0-beta.1` are refused.
- An account can publish 10 versions a day and store 200 MB of zips.
- The catalog checks each zip the way Tavora's installer does, and Tavora checks it again on the user's PC.

## Link a key file

`tavora-pack link <code> --key <key file>` links a key that Tavora didn't make, so users see your developer name. In Tavora, press **Get a link code** under **Settings > Development > Publisher keys and CI**. The code works once for 10 minutes. The command signs it with your key and sends the key's public half; the private key never leaves your PC.

## From code

```ts
import { loadExistingKey, packModule } from "@tavora/pack";

const { key } = await loadExistingKey("publisher-key.pem");
const { zip } = await packModule(".", key);
```

`packModule`, `readZip` and `verifyFiles` are what Tavora's installer uses too. More in the [developer docs](https://docs.mytavora.app/guide/publishing#publish-from-ci).
