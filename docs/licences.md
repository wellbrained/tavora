# Third-party licences

Tavora ships the copyright and licence notices of everything it bundles, and shows them in Settings > Updates & About > Licences. The notices are written at build time; nobody edits a generated file. The generic parts (the allowlist, SPDX judging, finding licence texts) are in `packages/pack/src/notices.ts`, which every module's build uses too; Tavora's own list is `apps/desktop/scripts/licences.mjs`.

## What it covers

- **npm packages that ship.** The app's `dependencies` and the `devDependencies` that get bundled into it (everything except the build tools named in `TOOLING`), the `dependencies` of every module in `modules/` (through the shared kit too), and `allo-font` (subset into `src/fonts`). Each package is found by walking `dependencies`, `optionalDependencies` and peers (also those only named in `peerDependenciesMeta`, like `supports-color` for `debug`) through `node_modules`. Fonts from npm are OFL-1.1 and are listed under Fonts with the copyright line of their own licence file. Licence files one folder down count too (pdf.js keeps OpenJPEG's, Foxit's and Liberation's in `wasm/` and `standard_fonts/`).
- **Fonts and data without an npm package**, kept in a `third-party.json` next to the thing that ships them: `[{ "name", "version", "license", "group": "fonts" | "data", "files": ["third-party/Foo-OFL.txt"] }]`, the files holding the real copyright line and licence text. The Whiteboard's Excalidraw fonts are in `modules/whiteboard/third-party.json`; the filter lists the ad blocker is compiled from (EasyList and EasyPrivacy, CC BY-SA 3.0) are in `apps/desktop/third-party.json`. CC BY-SA is allowed for those two named data entries (`ALLOWED_DATA_LICENCES`) and for nothing else.
- **The media helper's Rust crates.** `packages/media-helper/licences.json` is the list of crates built for Windows with their licence texts. Cargo isn't needed to build the app: a test checks the list against `Cargo.lock` (the list plus `otherPlatforms` must be exactly what is locked), so a changed crate fails CI until you run `node apps/desktop/scripts/licences.mjs --update-crates` (needs Rust) and commit the file.
- **Electron and Chromium** keep their own `LICENSE.electron.txt` and `LICENSES.chromium.html`, which electron-builder puts next to `Tavora.exe`. The notices file points to them.

Not listed: `@tavora/*` packages (our own code), build and test tools, and packages that are dependencies but not in the bundle (`NOT_SHIPPED`, each with its reason: Mermaid, which the Whiteboard stubs out, and `@napi-rs/canvas`, which pdf.js only uses in Node).

## What it writes

- `out/licences/licences.json`: what the app reads (Settings > Licences, through `api.licences()`). Inside `app.asar`.
- `out/licences/THIRD_PARTY_NOTICES.txt`: the readable file, copied by electron-builder to `resources/THIRD_PARTY_NOTICES.txt`. The Checks workflow's packaged-start job fails when it is missing from the package or the installed app.
- `modules/<name>/dist/THIRD_PARTY_NOTICES.txt` for every module: the pack Vite plugin (`moduleConfig`, `packages/pack/src/vite.ts`) writes it at the end of every module build, from the packages that build bundled plus the module's own `third-party.json`. Vite empties `dist/` on each build, so the catalog publish (`pnpm --filter <pkg>... build`) carries it into the zip, and a shipped copy and a catalog copy of the same version have the same file. A package without a recognisable licence only warns there; the app's build is what fails.

Identical licence texts are stored once.

## The licence check

The build fails when a shipped package has no licence, a licence that isn't on `ALLOWED_LICENCES`, or no licence text. Copyleft ones (GPL, LGPL, AGPL and the like) are reported as such, never shipped silently. For `A OR B` one allowed side is enough; for `A AND B` every side must be allowed.

Two safety nets keep the walk honest:

- The desktop build lists what its bundles really contain (esbuild's metafile for main, preloads and the worker; Rollup's chunk modules for the host UI) and fails when a package in them is missing from the notices (`assertBundled`).
- `pnpm build` ends with `licences.mjs --check-modules`: every built module has its `dist/THIRD_PARTY_NOTICES.txt`, and every package listed in one is in the app's notices.

When a new dependency fails:

1. A permissive licence that is missing from the list: add it to `ALLOWED_LICENCES` (the maintainer decides).
2. A package that declares MIT or ISC but ships no LICENSE file gets the standard text with the holder from its `package.json`, marked as such in Settings (`inferred`). Other licences need their file.
3. A package whose metadata is wrong or missing: add a reasoned entry to `OVERRIDES` (for example the real upstream copyright holder, as for Radix and Excalidraw).
4. Anything copyleft: don't ship it; find another package.
