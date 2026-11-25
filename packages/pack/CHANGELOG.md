# Changelog

What changed in `@tavora/pack`, newest first.

## 0.3.8

- `tavora-pack <folder>` warns when the catalog wouldn't take the zip (the checks `publish` runs before sending). The zip is still made: it installs by hand.
- A `third-party.json` that isn't a list of `{ name, license, files }` entries stops the build with a message that names the entry, instead of a crash.
- Licence files of a package are read in the same order whatever the case of their names. The licence copy (`notices`) no longer runs when a dev server closes.

## 0.3.7

- `publish` says what the catalog would refuse only after the whole zip arrived, before sending it: a version longer than 64 characters, more than 100 games, a readme that isn't UTF-8 text of at most 20 KB, a screenshot that isn't the PNG or WebP it is named as (at most 1 MB and 4096 px), and a zip whose files unpacked take more than 88 MB with it (`catalogUploadProblem` in `@tavora/module-schema` 0.2.5).
- The catalog's `too-many` answer now says that another upload from your account may still be running: it takes one at a time.
- A module folder named `link`, `key`, `publish` or `withdraw` is packed when it is the only argument (`tavora-pack link --key k`), not read as that command.

## 0.3.6

- The Vite plugin keeps `dist/THIRD_PARTY_NOTICES.txt` when a dev server (`vite` without `build`) closes; before, it wrote an empty list over it. In `--watch`, each build lists only what it bundled.
- A `package.json` that can't be read (a byte order mark, broken JSON) no longer stops the build: the package is reported as a problem (`unreadable`), as other package problems are. The same for a BOM in `third-party.json` and an entry there without `files`.
- Licence files are found by more names: `MIT-LICENSE`, `LICENSE-MIT`, `COPYRIGHT` and REUSE's `LICENSES/<id>.txt`; a picture or other file that is not text (`license.png`) is never read into the notices. `notices` in the plugin's options finds the same names (`noticeSource` is async now).
- The old `license: ["MIT", "Apache-2.0"]` form reads as `MIT OR Apache-2.0`. A string `contributors` or `maintainers` no longer gives the first letter as the holder, and `(url)` is cut only at the end of an author. Packages without a name or version are no longer merged into one.
- A file named `__proto__` at the zip's root keeps its hash, and `packModule` checks the signature of the zip it made, so it never hands back one Tavora would refuse.
- A zip holding a file and a folder of the same name (`a` and `a/b`, also in another case) is refused.
- Its messages name Tavora's settings as the app does: Settings > Developer > Your modules, and Settings > Developer > Publishing > Publisher keys and CI.
- Packs with `@tavora/module-schema` 0.2.4.

## 0.3.5

- A zip may no longer hold a file or folder named like a Windows device with a superscript digit (`COM¹`, `LPT³`) or `CONIN$` / `CONOUT$`, also with an extension. The rule is module-schema's `isWindowsDeviceName` (0.2.1).

## 0.3.4

- Packs with `@tavora/module-schema` 0.2.0: a manifest with the old field `workspaces` is refused, and the `personalWorkspaces` message no longer sends you to it.

## 0.3.3

- `packModule`, `collectFiles` and `tavora-pack` stop with a `PrivateKeyError` (a `PackError` naming the `file`) when the zip would hold a private key: a key file by module-schema's `KEY_EXTENSIONS` (`.pem`, `.key`, `.p12`, `.pfx`, `.ppk`), the `--key` file (`PackOptions.keyFile`, the new last argument of both), or a file holding a PEM, OpenSSH, PGP or PuTTY private key. Before, `tavora-pack . --key publisher-key.pem` packed the key when `entry` sat next to the manifest. The catalog refuses such zips too.
- New `privateKeyFile(files)` names the first file of a zip that is or holds a private key.

## 0.3.2

- `packModule` (and `tavora-pack`) refuses a pre-release version such as `1.0.0-beta.1`: module versions are plain `major.minor.patch`. The catalog refuses them too.

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
