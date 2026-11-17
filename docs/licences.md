# Third-party licences

Tavora ships the copyright and licence notices of everything it bundles, and shows them in Settings > Updates & About > Licences. The notices are written at build time by `apps/desktop/scripts/licences.mjs`; nobody edits a generated file.

## What it covers

- **npm packages that ship.** The app's `dependencies` and the `devDependencies` that get bundled into it (everything except the build tools named in `TOOLING`), the `dependencies` of every module in `modules/` (through the shared kit too), and `allo-font` (subset into `src/fonts`). Each package is found by walking `dependencies` and `optionalDependencies` through `node_modules`. Fonts are npm packages too (OFL-1.1) and are listed under Fonts with the copyright line of their own licence file.
- **The media helper's Rust crates.** `packages/media-helper/licences.json` is the list of crates built for Windows with their licence texts. Cargo isn't needed to build the app: a test checks the list against `Cargo.lock`, so a changed crate fails CI until you run `node apps/desktop/scripts/licences.mjs --update-crates` (needs Rust) and commit the file.
- **Electron and Chromium** keep their own `LICENSE.electron.txt` and `LICENSES.chromium.html`, which electron-builder puts next to `Tavora.exe`. The notices file points to them.

Not listed: `@tavora/*` packages (our own code), build and test tools, and packages that are dependencies but not in the bundle (`NOT_SHIPPED`, each with its reason: Mermaid, which the Whiteboard stubs out, and `@napi-rs/canvas`, which pdf.js only uses in Node).

## What it writes

- `out/licences/licences.json`: what the app reads (Settings > Licences, through `api.licences()`). Inside `app.asar`.
- `out/licences/THIRD_PARTY_NOTICES.txt`: the readable file, copied by electron-builder to `resources/THIRD_PARTY_NOTICES.txt`. The Checks workflow's packaged-start job fails when it is missing from the package or the installed app.
- `modules/<name>/dist/THIRD_PARTY_NOTICES.txt` for each built-in module (`pnpm build` runs `licences.mjs --modules` after the modules are built), so the module's catalog copy carries its own notices in its zip.

Identical licence texts are stored once.

## The licence check

The build fails when a shipped package has no licence, a licence that isn't on `ALLOWED_LICENCES`, or no licence text. Copyleft ones (GPL, LGPL, AGPL and the like) are reported as such, never shipped silently. For `A OR B` one allowed side is enough; for `A AND B` every side must be allowed.

When a new dependency fails:

1. A permissive licence that is missing from the list: add it to `ALLOWED_LICENCES` (the maintainer decides).
2. A package that declares MIT or ISC but ships no LICENSE file gets the standard text with the holder from its `package.json`, marked as such in Settings (`inferred`). Other licences need their file.
3. A package whose metadata is wrong or missing: add a reasoned entry to `OVERRIDES`.
4. Anything copyleft: don't ship it; find another package.
