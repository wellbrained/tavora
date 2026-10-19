# Changelog

What changed in `@tavora/module-schema`, newest first.

## Unreleased

- `homepage`: the module's web page, `http` or `https`, shown in the catalog (`isHomepage`, `MAX_HOMEPAGE_LENGTH`). Needs Tavora 0.18.17 or newer.
- `screenshots`: 1 to 5 PNG or WebP files in the package, shown in the catalog before installing (`MAX_SCREENSHOTS`, `MAX_SCREENSHOT_BYTES`). `manifestFiles` lists them, so `tavora-pack` packs them. Needs Tavora 0.18.17 or newer.

## 0.1.2

- `changelog`: the path of a JSON file with the module's patch notes. `validateChangelog` checks its contents: at most 100 versions, each once, with 1 to 20 plain lines of at most 500 characters; `CHANGELOG_LIMITS` holds the limits. Needs Tavora 0.18.2 or newer.

## 0.1.1

- `workspaces`: whether a module for any game may be added to a personal workspace, which belongs to no game. Optional, true when left out; it can only be true while `games` is empty. Needs Tavora 0.18.1 or newer.

## 0.1.0

- First release on npm: `validateManifest`, `needsNewerTavora` and the JSON Schema for `tavora.module.json`.
