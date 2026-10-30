# Changelog

What changed in `@tavora/create-module`, newest first.

## 0.1.14

- New projects start on `@tavora/sdk` 0.2.20, which adds the result queue and the run store.

## 0.1.13

- New projects start on `@tavora/sdk` 0.2.19, which adds the anchor form for menus and tooltips.

## 0.1.12

- New projects start on `@tavora/sdk` 0.2.18, which adds the item session.

## 0.1.11

- New projects start on `@tavora/sdk` 0.2.17, which adds leaderboards, `compareAndSet`, panel dialogs, a test host, the document store and the module bootstrap.

## 0.1.10

- New projects ask `tavora.workspace.getCurrent()` for the workspace their panel is in (`@tavora/sdk` 0.2.12): "You're in Elden Ring." in a game workspace, the workspace's name in a personal one.

## 0.1.9

- New projects have a `README.md` that is the module's description in the catalog, with the headings users expect (Features, How to use, Settings, Requirements, Known issues), and the manifest names it as `readme`. The notes for developing the module moved to `DEVELOP.md`.

## 0.1.8

- New projects have no `zip` script any more: publish from Tavora with **Settings > Development > Publish**, or save a zip there. They start on `@tavora/pack` 0.3.0, for publishing from CI.

## 0.1.7

- New projects start on `@tavora/pack` 0.2.0: Tavora keeps the publisher key and signs `npm run zip` after you allow it.

## 0.1.5

- New projects start on `@tavora/pack` 0.1.3, which can publish to the module catalog.

## 0.1.4

- New projects start with `changelog.json` for their patch notes, on `@tavora/sdk` 0.2.7 and `@tavora/pack` 0.1.2, with `minTavora` 0.18.2.

## 0.1.3

- New projects start on `@tavora/sdk` 0.2.6 and `@tavora/pack` 0.1.1, with `minTavora` 0.18.1.

## 0.1.2

- A new project's `dev`, `build` and `zip` scripts say "Run npm install first" when its packages were never installed, instead of "'tavora-pack' is not recognized".
- Asks which game the module is for: any game, or one picked from Tavora's games by typing to search. `--game poe2` (or `--game any`) skips the question. Tavora offers a module made for one game only in that game.

## 0.1.1

- Asks with arrow keys: where the project goes (the empty folder you are in, or a new folder in it) and which template.
- The next steps say to leave `npm run dev` running and which folder to add in Tavora under Settings > Development; a folder with several projects works too (Tavora 0.17.20).

## 0.1.0

- First release on npm: `npm create @tavora/module` makes a vanilla TypeScript, Vue or React module project.
