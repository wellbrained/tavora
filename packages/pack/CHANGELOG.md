# Changelog

What changed in `@tavora/pack`, newest first.

## 0.3.1

- New `@tavora/pack/vite`: `moduleConfig({ pages, plugins, notices, publicDir, … })` returns the Vite settings every module shares (relative paths, Chrome 130, one input per page, the SDK from its source in Tavora's repository) for `defineConfig`. `notices` copies licence files into `dist/`, found from your project. No Vite dependency is added: it is the project's own Vite.
- New `@tavora/pack/tsconfig.module.json`, a TypeScript base for module projects to `extends`.

## 0.3.0

- Publishing can answer **Waiting for review**: the version is uploaded but not listed until a person at Tavora has looked at it (your first module, new pictures, or a failed automatic check). `tavora-pack publish` prints it with the reasons and exits 0. `publishZip` resolves with `status: "published" | "waiting"` and `reasons`.
- New `tavora-pack withdraw <file.zip | sha256>` (and `withdrawVersion`) takes a waiting version back. It needs only the publish token.
- `tavora-pack publish` links to [what's not allowed in the catalog](https://docs.mytavora.app/guide/catalog-rules). A banned account or a declined zip get their own messages.

- Publish from Tavora now: **Settings > Development**, then **Publish** on your module. It packs, signs and uploads with one button. `tavora-pack` is for CI.
- `tavora-pack` signs only with a key file: `--key <file>` is required. Export your key in Tavora under **Settings > Development > Publisher keys and CI**. Without `--key` it tells you where to publish instead.
- Tavora doesn't sign for `tavora-pack` any more, so there's no **Allow** prompt. `--publisher`, `tavoraSigner`, `askTavora`, `signerAddress` and the signer request types are gone.
- `~/.tavora/publisher-key.pem` isn't picked up by itself any more; pass it with `--key`. `defaultKeyFile` is gone.
- `Signer` has no `publish` any more, and `signPublish` is required.

## 0.2.0

- Tavora keeps your publisher key now (Tavora 0.19.11, Settings > Account > Module developer). `tavora-pack` asks Tavora on this PC to sign, and Tavora asks you first. The secret key never reaches `tavora-pack`.
- `tavora-pack` never makes a key any more. A key file still works with `--key <file>`, for CI, and `~/.tavora/publisher-key.pem` is used when it's there.
- `--publisher <fingerprint>` picks one of the keys Tavora keeps.
- `tavora-pack link` is only for key files; Tavora links the keys it keeps.
- `packModule` and `publishZip` take a key or a `Signer` (`keySigner`, `tavoraSigner`). `loadOrCreateKey` is gone; use `loadExistingKey`.
- Publishing needs your account now, not only the key. With a key Tavora keeps, `tavora-pack publish` hands the zip to Tavora, which uploads it with your sign-in after you press Allow. With a key file (CI), set `TAVORA_PUBLISH_TOKEN` to a publish token from Settings > Account > Module developer. Older versions can't publish any more.
- `publishZip` takes `token` and `language`, and resolves with `Published`.

## 0.1.3

- `tavora-pack publish <file.zip>` publishes a zip packed with your key to Tavora's module catalog. The key must be linked to your account; the first id prefix you publish under is yours from then on.
- Reads and checks the lists Tavora signs with its catalogue key: revoked publisher keys, blocked zips and key successions.

## 0.1.2

- Packs the changelog the manifest names, and refuses one that is missing or that Tavora could not show.

## 0.1.1

- Accepts the manifest's new `workspaces` field (`@tavora/module-schema` 0.1.1).

## 0.1.0

- First release on npm: `tavora-pack <folder>` packs and signs a module, `tavora-pack link <code>` links your publisher key to your Tavora account.
