## 0.2.13

Leaderboards, with Tavora 0.21.92 or newer. Everything else still works on every Tavora the SDK supports (Tavora 0.19.32), so `MIN_TAVORA` stays; a module that uses leaderboards sets `minTavora` to 0.21.92.

- `leaderboards`: the boards a manifest's `leaderboards` declares, kept on Tavora's service with the user's Tavora account, through the new `leaderboards` connector. `status()` says whether Tavora's service answered (`online`, so it never fails offline), whether the user is signed in, whether the boards run for the module, and whether the user agreed to be shown, with their public name once they did. `show()` (after a click) has Tavora ask the user in the panel; `hide()` (after a click) takes them off and deletes their results. `submit(board, results)` sends up to 50 games, each taken or refused on its own, and `top(board, { day, limit })` reads a board as `{ rows }`. A module never gets an account id, only a `self` mark on the user's own line.
- `storage.compareAndSet(key, expected, value)` and `storage.app.compareAndSet`: set a value only while the key still holds what you read, so two panels can't overwrite each other's change.

## 0.2.12

From Tavora 0.21.43 every item on its rail is a workspace: a game workspace, linked to a game, or a personal workspace.

- `workspace.getCurrent()` answers the `TavoraWorkspace` the panel is in: `{ id, displayName, kind }`, with `kind` `"game"` (its id is the game's, the one your manifest's `games` lists) or `"personal"`. It works on every Tavora the SDK supports (Tavora 0.19.32): an older one is asked `game.getCurrent` instead and answered in the new words, so `MIN_TAVORA` stays.
- `game.getCurrent()` and `TavoraGame` are deprecated: they still answer, with `kind` `"workspace"` for a personal workspace, until Tavora's 1.0 preparation.

## 0.2.11

Stream overlays and hotkeys (Tavora 0.19.26). `MIN_TAVORA` is now `0.19.32`, for `permissions.onRequest`.

- Stream overlays: a manifest `overlay` page that OBS or other streaming software shows as a Browser Source, with the new `stream-overlay` connector. `overlay.publish(key, state)` sets what an overlay shows (Tavora keeps it while no panel runs), `overlay.copyLink(key)` copies its link after a click, `overlay.remove` and `overlay.resetLink`. The overlay page reads its state with `watchOverlay(fn)`.
- `permissions.onRequest`: list `"stream-overlay"` there too, and players are asked for it on the first `overlay.copyLink` instead of when they add the module; the call then gives `"denied"` if they say no (Tavora 0.19.32).
- Hotkeys: manifest `actions`, which players bind to keys in Tavora's own dialog (`hotkeys.set(action, target, label)` after a click). Panels hear `hotkeys.onPress` while their game is shown; `hotkeys.list` and `hotkeys.remove` manage them. A module never learns the key.
- In-game overlays: `overlay.showOverGame`, `hideOverGame`, `overGame` and `preview` show, remove, list and preview a module's overlay. `panel.setLive` supplies the read-only live view for a panel shown in game. See each method's host-version requirement.
- Panels: `isMaximized`, `setMaximized` and `onMaximizedChange` share the host's Maximize state; maximizing requires a real click or key press.
- Files: remember a file chosen with `pickReadOnly`, reread it with `read`, and revoke its reference with `forget`. `saveJson` and `openJson` use Tavora's dialogs without exposing paths. `exportJson` is deprecated in favour of `saveJson`; its limit is now 8 MiB. `pictures.save` also uses a save dialog.
- System info: the consented `system-info` connector adds PC readings, running apps, connection checks and history, and Windows traffic totals. Sampling and host-version requirements are documented on the methods and protocol types.
- Media: the consented `media` connector reads Windows media sessions, watches changes, and sends play/pause, previous or next only after a real click or key press. No player sign-in or token reaches a module.

## 0.2.10

Requires the JSON export host (Tavora 0.19.17). Adds `files.exportJson(value, name?)`: gesture-gated, bounded JSON export to a new file in Downloads/Tavora.

# Changelog

What changed in `@tavora/sdk` and the bridge protocol it speaks, newest first. Before Tavora 1.0 the SDK may still change in ways that break modules; each such change raises the minor version (0.2 → 0.3) and is marked **Breaking** here. Anything else raises the patch version. To make sure players have a Tavora that knows what your module uses, set [`minTavora`](https://docs.mytavora.app/reference/manifest) in its manifest.

## 0.2.9

- `network.readPage(url)` (Tavora 0.19.3): bounded public HTML capture in a fresh hidden sandbox, using existing exact-domain grants. No module script execution API, interactions or player cookies. Owner disconnect cancels it. `MIN_TAVORA` is now `0.19.3`.

## 0.2.8

- Shared rich tooltips (Tavora 0.18.18). Adds `ui.tooltip.show/move/hide/close/onClose` for checked rich details over neighbouring panels. Hover is pointer-transparent; a pin requires real input. One shared pin remains until closed or its source goes away.

## 0.2.7

- Manifest `changelog`: a JSON file in the package with the module's patch notes, `[{ "version", "date", "notes": [...] }]`, newest first. Players read them under the module in Settings > Modules, and an update marks the new ones (Tavora 0.18.2). `MIN_TAVORA` is now `0.18.2`.

## 0.2.6

- `game.getCurrent()` answers `kind`: `"game"`, or `"workspace"` for a personal workspace the player made for modules that belong to no game, such as notes (Tavora 0.18.1). An older Tavora leaves it out, which means a game. `MIN_TAVORA` is now `0.18.1`.
- Manifest `workspaces`: modules for any game are offered in personal workspaces too. Set `"workspaces": false` for one that only makes sense in a game; a module for one game is never offered there (Tavora 0.18.1).

## 0.2.5

- `pictures.save(png, name)`: saves a PNG as a new file in the player's `Pictures\Tavora` folder, right after a click or key press in the panel; resolves with the file name it got (Tavora 0.17.19). `MIN_TAVORA` is now `0.17.19`.

## 0.2.4

- Opening another panel: `panels.open(type, { content })` opens one of the module's own panel types in the current game, right after a click or key press. Tavora brings forward a panel of that type already showing the content, else asks the one used last to switch through `panel.onNavigate(fn)` (save pending edits, then resolve; throw to refuse; 5 seconds), else opens a new one, whose `panel.getLaunch()` is `{ reason: "open", content }`. It resolves with `"shown"`, `"switched"`, `"opened"` or `"failed"`; when a switch fails, the player is offered the content in a new panel (Tavora 0.17.18). Set `minTavora` to `0.17.18` or newer when you use them.

## 0.2.3

- Content per panel: `panel.setContent({ id, title } | null)` tells Tavora what the panel shows now, such as the build picked in your toolbar. Tavora keeps it with the panel across game switches and restarts and shows the title when the player hovers the tab. `panel.getLaunch()` says why the page is loading: `{ reason: "add" }` for a panel the player just added (pick the content yourself, such as the last one used), or `{ reason: "restore", content }` for one that was open before (Tavora 0.17.17). Set `minTavora` to `0.17.17` or newer when you use them.

## 0.2.2

- `MIN_TAVORA`: the oldest Tavora that has everything this SDK version offers, for `minTavora` in your manifest.
- Panel types: a manifest may list `panels`, named tools such as Inventory and Build planner that players add, dock and copy on their own, all sharing the module's saved content and permissions. `panel.type` says which one a page runs as; the handshake carries it as `panel.type` (Tavora 0.17.12). Set `minTavora` to `0.17.12` or newer when you use them: an older Tavora refuses the `panels` field.

## 0.2.1

- `ui.showMenu(request)`: a menu Tavora draws above every panel, so it is never cut off at the panel's edge. Items with an optional colour dot, check or radio mark, hint and danger style; separators; headings; one level of submenus. Only right after a click, right-click or key press in the panel; resolves with the chosen id or null (Tavora 0.17.9).

## 0.2.0

Needs Tavora 0.17.8 or newer for `minTavora`; everything else works from the Tavora version named next to it.

- `minTavora` in the manifest: the oldest Tavora a module works with. An older Tavora refuses to install or load it and says why (Tavora 0.17.8).
- `connectors.discord`: the Discord app on the player's PC through Tavora's Discord sign-in: `state()`, `connect()`, `allowControl()`, `command()` for a fixed list of RPC commands, `subscribe()` and `onEvent()` for voice events, and `image()` for avatars and server icons. Needs `"discord"` in `permissions.connectors` and the player's consent (Tavora 0.16.11).
- `connectors.aiUsage`: the usage of the player's Claude and Codex accounts, without ever seeing a login. Needs `"ai-usage"` in `permissions.connectors` (Tavora 0.16.10).
- `storage.app`: small settings shared by every game, next to `storage` for the current game (Tavora 0.16.10).
- `network.fetch`: web requests to the hosts in `permissions.network`, after the player allowed them; HTTPS only, no cookies (Tavora 0.16.8).
- `clipboard.writeImage(png)`: puts a PNG on the clipboard right after a click or key press in the panel (Tavora 0.14.1).
- `blobs`: pictures a module keeps for a game, served from the module's own address (Tavora 0.12.0).
- `links.open(url)`: opens a web address in the game's Browser panel, right after a click or key press (Tavora 0.11.0).
- `ui.getLanguage()` and `ui.onLanguageChange()`: the language Tavora shows its texts in (Tavora 0.5.9).

## 0.1.0

The first version: `connect()`, the current game, `storage`, `documents` with revisions and change events, panel state, the panel's size, the theme and its changes, and the suspend, resume and dispose lifecycle. Bridge protocol v1.
