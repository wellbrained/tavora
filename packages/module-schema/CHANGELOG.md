# Changelog

What changed in `@tavora/module-schema`, newest first.

## 0.1.5

- `leaderboards`: the boards a module keeps on Tavora's service (`LeaderboardBoard`): `{ id, kind: "streak", daily? }` or `{ id, kind: "score", order? }`, up to `MAX_LEADERBOARD_BOARDS` (20) with ids checked by `isLeaderboardId`. It needs the new `leaderboards` connector, the connector needs it, and both need a `minTavora` newer than `LAST_TAVORA_WITHOUT_LEADERBOARDS` (0.21.91), except Tavora's own modules.

## 0.1.4

- `personalWorkspaces`: whether a module for any game may be added to a personal workspace, which belongs to no game. It replaces `workspaces`, its name from before Tavora called every item on the rail a workspace (Tavora 0.21.43). `workspaces` is still read until Tavora's 1.0 preparation; never set both. A manifest with `personalWorkspaces` needs a `minTavora` newer than `LAST_TAVORA_WITHOUT_PERSONAL_WORKSPACES` (0.21.42), except Tavora's own modules. `allowsPersonalWorkspaces(manifest)` tells under either name.

## 0.1.3

- Connector permissions include `stream-overlay`, `system-info` and `media`, with the matching host-version checks. `permissions.onRequest` lets a module ask for supported access when the user uses it.
- Overlay pages and manifest `actions` describe stream overlays and host-managed hotkeys. Optional in-game sizes let overlays and panels start at the module's preferred size.

- `inGame` at the top for a module without panel types, the same as a panel type's `inGame`; not together with `panels`.
- Panel types: `inGame`, whether the user may show the panel in their game (`LAST_TAVORA_WITHOUT_IN_GAME_PANELS`, 0.21.2). The panel appears over the game only while the user holds Tavora's in-game layer open. A manifest with it needs a `minTavora` newer than that, except Tavora's own modules.
- `overlay` no longer needs the `stream-overlay` connector: game overlays (`overlay.showOverGame`) show the page without it. The connector still needs an `overlay`. A manifest with an `overlay` and no connector needs a `minTavora` newer than `LAST_TAVORA_WITHOUT_GAME_OVERLAYS` (0.20.50), except Tavora's own modules, because older Tavoras refuse it.
- `translations`: the module's name, description, panel and action names in other languages, keyed by language code (`ModuleTranslation`, `isLanguageCode`, `MAX_TRANSLATIONS`). `translateManifest` gives the manifest in a language, `translationsFor` the translations that apply. A manifest with them needs a `minTavora` newer than `LAST_TAVORA_WITHOUT_TRANSLATIONS` (0.20.12), except Tavora's own modules.
- `support`: where users send feedback, an `https` address or an email address (`isSupportLink`, `isSupportEmail`, `MAX_SUPPORT_LENGTH`). The module's page has a Send feedback button for it. Needs Tavora 0.20.39 or newer.
- `homepage`: the module's web page, `http` or `https`, shown in the catalog (`isHomepage`, `MAX_HOMEPAGE_LENGTH`). Needs Tavora 0.18.17 or newer.
- `readme`: a `.md` or `.txt` file of at most 20 KB introducing the module (`MAX_README_BYTES`), shown as plain text on its catalog page. `tavora-pack` packs it. Needs Tavora 0.18.19 or newer.
- `screenshots`: 1 to 5 PNG or WebP files in the package, shown in the catalog before installing (`MAX_SCREENSHOTS`, `MAX_SCREENSHOT_BYTES`). `manifestFiles` lists them, so `tavora-pack` packs them. Needs Tavora 0.18.17 or newer.

## 0.1.2

- `changelog`: the path of a JSON file with the module's patch notes. `validateChangelog` checks its contents: at most 100 versions, each once, with 1 to 20 plain lines of at most 500 characters; `CHANGELOG_LIMITS` holds the limits. Needs Tavora 0.18.2 or newer.

## 0.1.1

- `workspaces`: whether a module for any game may be added to a personal workspace, which belongs to no game. Optional, true when left out; it can only be true while `games` is empty. Needs Tavora 0.18.1 or newer.

## 0.1.0

- First release on npm: `validateManifest`, `needsNewerTavora` and the JSON Schema for `tavora.module.json`.
