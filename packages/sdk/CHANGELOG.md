# Changelog

What changed in `@tavora/sdk` and the bridge protocol it speaks, newest first. Before Tavora 1.0 the SDK may still change in ways that break modules; each such change raises the minor version (0.2 → 0.3) and is marked **Breaking** here. Anything else raises the patch version. To make sure players have a Tavora that knows what your module uses, set [`minTavora`](https://docs.mytavora.app/reference/manifest) in its manifest.

## 0.2.1

- `MIN_TAVORA`: the oldest Tavora that has everything this SDK version offers, for `minTavora` in your manifest.
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
