# Module manifest (`tavora.module.json`)

**Status:** Milestone B, 2026-10-14. `apiVersion` `"1"`.

Every module package has a `tavora.module.json` at its root. Tavora refuses to load a module whose manifest has errors, including fields it does not know: a typo should fail loudly, not be ignored.

```json
{
  "$schema": "./node_modules/@tavora/module-schema/schema/tavora.module.schema.json",
  "id": "community.example.campaign-companion",
  "name": "Campaign Companion",
  "description": "Tracks quests and campaign progress per character.",
  "version": "1.0.0",
  "apiVersion": "1",
  "entry": "dist/index.html",
  "icon": "assets/icon.png",
  "games": ["poe2"],
  "viewport": { "minWidth": 320, "minHeight": 240, "preferredWidth": 720, "preferredHeight": 600 },
  "permissions": { "network": [] }
}
```

The JSON Schema ([download](/schema/tavora.module.schema.json), [source](https://github.com/wellbrained/tavora/blob/main/packages/module-schema/schema/tavora.module.schema.json)) gives editors completion and errors. The validator in `@tavora/module-schema` is what Tavora actually runs; tests keep the two in agreement.

## Fields

| Field | Required | Rules |
| --- | --- | --- |
| `$schema` | no | Any string. Ignored by Tavora. |
| `id` | yes | `publisher.module-name`: 2 to 5 dot-separated parts, lowercase letters, digits and `-`, starting with a letter, at most 128 characters. Data and (later) permissions are keyed on it, so never change it after release. |
| `name` | yes | 1 to 80 characters, not only spaces. |
| `description` | no | 1 to 300 characters, not only spaces. |
| `version` | yes | Semver, e.g. `1.0.0` or `2.0.0-beta.1`. |
| `apiVersion` | yes | `"1"` (a string). The [bridge protocol](./protocol.md) major version the module was built for. |
| `minTavora` | no | The oldest Tavora the module works with, as `major.minor.patch` (e.g. `0.18.0`). An older Tavora refuses to install the zip or load the folder and tells the player which version is needed. Set it to the Tavora version that added the newest SDK feature you use (see the [changelog](./changelog.md)). |
| `entry` | yes | The HTML page to load, as a path inside the package. Must end in `.html`. |
| `icon` | no | A `.png` or `.webp` file inside the package, square, at least 128 × 128. |
| `changelog` | no | A `.json` file inside the package with the module's [patch notes](../guide/getting-started.md#patch-notes): an array of `{ "version", "date"?, "notes": [...] }`, newest first, each version once, 1 to 20 plain lines of at most 500 characters per version, at most 100 versions and 64 KB. Players read them in Settings > Modules. Needs Tavora 0.18.2 or newer. |
| `homepage` | no | The module's web page, an `http` or `https` address of at most 300 characters, without a user name or password. The catalog shows it, and Tavora opens it like a module link: in a Browser panel or where the player picks. Needs Tavora 0.18.17 or newer. |
| `support` | no | Where players send feedback: an `https` address or an email address of at most 300 characters (a web address without a user name or password; an email address as a plain `name@example.com`, not `mailto:`). Your module's page gets one **Send feedback** button for it. A click opens the web page like a module link, or your players' mail app. Tavora never opens it by itself and never sends anything with it. Needs Tavora 0.20.39 or newer. |
| `readme` | no | A `.md` or `.txt` file inside the package introducing the module, at most 20 KB of UTF-8 text. Its catalog page shows it as the module's description, sorted into [fixed sections](../guide/publishing.md#writing-the-description): headings, paragraphs, lists, code, bold, italic and `http` or `https` links as text; pictures and HTML are never shown. Needs Tavora 0.18.19 or newer. |
| `screenshots` | no | 1 to 5 `.png` or `.webp` files inside the package, each once, shown in the catalog before players install. Each must really be that kind of picture, at most 1 MB and 4096 × 4096 pixels; the catalog refuses the upload otherwise. A wide picture (16:9) shows best. Needs Tavora 0.18.17 or newer. |
| `games` | yes | Game ids the module is made for, e.g. `["poe2"]`; see [Game ids](#game-ids). Tavora lists the module in Add module only in these games. An empty array means any game. |
| `workspaces` | no | `false` keeps a module for any game out of personal workspaces, which belong to no game. Left out, a module with an empty `games` is offered there too; a module for one game never is, and `true` is refused next to a non-empty `games`. Needs Tavora 0.18.1 or newer. |
| `viewport.minWidth`, `viewport.minHeight` | yes | Smallest usable panel size in CSS pixels, 1 to 10000. Tavora refuses to open a panel it cannot give this much room. |
| `viewport.preferredWidth`, `viewport.preferredHeight` | no | Size the module looks best at, 1 to 10000. Used by the docking layout later. |
| `permissions.network` | yes | Hosts the module asks to reach with [`network.fetch`](./protocol.md#network), at most 32, e.g. `["api.example.com"]`; `[]` for none. Exact lowercase public names only: no scheme, port, path, wildcard, IP address, `localhost`, `.local` or `.internal`. Each one works only once the player has granted it. |
| `permissions.connectors` | no | Connectors the module asks to use: `"ai-usage"` to read the usage of the player's Claude and Codex accounts, `"discord"` to use the Discord app on this PC with Tavora's Discord sign-in (see [Connectors](./protocol.md#connectors)), `"stream-overlay"` to show its [`overlay`](#overlay) page in streaming software on this PC, `"system-info"` to read this PC's hardware and how busy it is (Tavora 0.21.1 or newer; set `minTavora`). Each name once; each works only once the player has granted it. |
| `permissions.onRequest` | no | Connectors from `permissions.connectors` that Tavora asks for only when your module first needs one, not when it is added, so it works without them. Only `"stream-overlay"` so far: Tavora asks on the first `overlay.copyLink`. Needs Tavora 0.19.32 or newer. |
| `permissions.webAssembly` | no | `true` lets the page compile WebAssembly (the page's security policy gets `'wasm-unsafe-eval'`). Only Tavora's own modules may ask for it; a module from your modules folder that does is not loaded, and the Modules page says why. |

| `panels` | no | Named [panel types](#panel-types) the module offers, 1 to 16. Without it the module has one panel, made from `entry`, `icon` and `viewport`. |
| `overlay` | no | The page for streaming software, see [Overlay](#overlay). The `"stream-overlay"` connector (for OBS links) needs this page, but the page needs no connector: without it the page serves game overlays only, and `minTavora` must be newer than `0.20.50`, because older Tavoras refuse it. Needs Tavora 0.19.26 or newer. |
| `actions` | no | What the module can do on a key press, 1 to 16, see [Actions](#actions). Needs Tavora 0.19.26 or newer. |
| `translations` | no | The name, description, panel and action names in other languages, see [Translations](#translations). Needs a `minTavora` newer than `0.20.12`. |

Paths (`entry`, `icon`, `readme`, `screenshots`, `overlay`, and the same fields of a panel type) are relative to the package root and must stay inside it: no leading `/`, no `.` or `..` segments, no empty segments, no backslashes or `:`. Tavora also checks that both files exist when it discovers the module.

## Panel types

A module can offer several tools as separate panels, such as an Inventory, a Build planner and a Map tracker. Players add each one on its own from the module library, dock it anywhere and may open several copies side by side. All panel types of a module share its saved content (`storage`, `documents`, `blobs`) and its permissions; each open panel keeps its own `panel` state. Needs Tavora 0.17.12 or newer, so set `minTavora` to at least `0.17.12`.

```json
"panels": [
  { "id": "overview", "name": "Overview", "continues": true },
  { "id": "planner", "name": "Build planner", "entry": "dist/planner.html", "icon": "dist/icons/planner.png",
    "viewport": { "minWidth": 480, "minHeight": 320 } },
  { "id": "inventory", "name": "Inventory" }
]
```

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | Stable identity: lowercase letters, digits and `-`, starting with a letter, at most 32 characters, unique in the module. Saved layouts and open panels keep it, so never change it after release. |
| `name` | yes | The short name on the panel's tab, 1 to 24 characters. Renaming it keeps every saved layout. |
| `entry` | no | This type's page. The module's `entry` when left out, so one page can serve every type and ask [`panel.type`](./protocol.md#methods) which one it is. |
| `icon` | no | This type's tab icon. The module's `icon` when left out. |
| `viewport` | no | This type's sizes, with the same rules as the module's `viewport`. The module's when left out. |
| `continues` | no | `true` on the type that panels opened before the module had panel types become, keeping their state. At most one type; without it, the first type. |
| `inGame` | no | `true` when the player may show this panel in their game: its menu offers **Show in game**, and the panel appears over the game only while the player holds Tavora's in-game layer open (see [Game overlays](./protocol.md#game-overlays)). Types without it get no such item. Needs Tavora 0.21.3 or newer, so `minTavora` must be newer than `0.20.54` (except Tavora's own modules); Tavora refuses the manifest otherwise. |

When an update removes a panel type, its open panels keep their place and say the type is gone; the player can remove them or pick another type of the same module. The module's saved content is not touched. Each panel can also show content of its own, such as a different build; see [Content per panel](./protocol.md#content-per-panel). The Panel Types Example in Tavora's examples folder shows every option, and [Several panels](../guide/panels.md) walks through a module built this way.

## Overlay

`overlay` names an `.html` page inside the package that OBS or other streaming software shows as a Browser Source, on top of the game on stream. The player copies its link from your panel (`overlay.copyLink`); Tavora serves it with the files next to it from this PC only, and passes on what your panels publish for it. It runs outside Tavora, so it has no bridge: it reads its data with `watchOverlay` from the SDK. See [Stream overlays](./protocol.md#stream-overlays).

The same page is what `overlay.showOverGame` shows over the player's game, in a window of Tavora's own; see [Game overlays](./protocol.md#game-overlays). That needs no connector. List `stream-overlay` (with `onRequest`, the player is asked only if they copy an OBS link) only if you want OBS links too. A module that lists no connector needs a `minTavora` newer than `0.20.50`; Tavora refuses the manifest otherwise.

```json
"overlay": "dist/overlay.html",
"permissions": { "network": [], "connectors": ["stream-overlay"] }
```

The page loads only its own files: bundle your fonts, and give it colours and texts in what you publish, since it gets neither the theme nor the language. Its background should stay transparent.

## Actions

`actions` lists what your module can do on a key press, such as Start/Pause or Counter +1. Players bind the keys in Tavora (`hotkeys.set`), per target and game; your panels hear `hotkeys.pressed`. See [Hotkeys](./protocol.md#hotkeys).

```json
"actions": [
  { "id": "start-pause", "name": "Start/Pause" },
  { "id": "reset", "name": "Reset" }
]
```

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | Stable identity: lowercase letters, digits and `-`, starting with a letter, at most 32 characters, unique in the module. Saved hotkeys keep it, so never change it after release. |
| `name` | yes | What Tavora shows next to the key, 1 to 40 characters on one line. |

## Translations

`translations` gives your module's name, description, panel names and action names in other languages, so players see them in the language they picked in Tavora. Key each language by its lowercase code, such as `de` or `pt-br`:

```json
"translations": {
  "de": {
    "name": "Kampagnen-Begleiter",
    "description": "Plant deine Builds.",
    "panels": { "planner": "Planer" },
    "actions": { "reset": "Zurücksetzen" }
  }
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `name` | no | Like `name`: 1 to 80 characters. |
| `description` | no | Like `description`: 1 to 300 characters. |
| `panels` | no | Panel type `id` to its tab name, 1 to 24 characters on one line. Only ids `panels` lists. |
| `actions` | no | Action `id` to its name, 1 to 40 characters on one line. Only ids `actions` lists. |

Each text Tavora shows comes from the translation for exactly the player's language, else from its base language (`pt` for `pt-br`), else from the plain field. Leave out what stays the same; the plain fields are what players in every other language see, so write them in English. At most 32 languages; codes Tavora doesn't speak yet are fine. The readme and patch notes have one language for now.

Older Tavoras refuse a manifest with `translations`, so set `minTavora` to a version newer than `0.20.12`; Tavora refuses the manifest otherwise. The catalog then doesn't offer your module to older Tavoras.

## Game ids

The games built into Tavora, with the ids to put in `games`.

| Id | Game |
| --- | --- |
| `age-of-empires-2` | Age of Empires II |
| `alchemy-factory` | Alchemy Factory |
| `apex-legends` | Apex Legends |
| `baldurs-gate-3` | Baldur's Gate 3 |
| `battlefield-6` | Battlefield 6 |
| `civilization-6` | Sid Meier's Civilization VI |
| `counter-strike-2` | Counter-Strike 2 |
| `cyberpunk-2077` | Cyberpunk 2077 |
| `dark-souls-3` | Dark Souls III |
| `dead-by-daylight` | Dead by Daylight |
| `deep-rock-galactic` | Deep Rock Galactic |
| `destiny-2` | Destiny 2 |
| `diablo-4` | Diablo IV |
| `dota-2` | Dota 2 |
| `elden-ring` | Elden Ring |
| `enshrouded` | Enshrouded |
| `factorio` | Factorio |
| `final-fantasy-14` | Final Fantasy XIV |
| `fortnite` | Fortnite |
| `genshin-impact` | Genshin Impact |
| `grand-theft-auto-5` | Grand Theft Auto V |
| `guild-wars-2` | Guild Wars 2 |
| `hades-2` | Hades II |
| `helldivers-2` | Helldivers 2 |
| `hollow-knight` | Hollow Knight |
| `last-epoch` | Last Epoch |
| `league-of-legends` | League of Legends |
| `lost-ark` | Lost Ark |
| `minecraft` | Minecraft |
| `monster-hunter-wilds` | Monster Hunter Wilds |
| `no-mans-sky` | No Man's Sky |
| `overwatch-2` | Overwatch 2 |
| `oxygen-not-included` | Oxygen Not Included |
| `palworld` | Palworld |
| `path-of-exile` | Path of Exile |
| `poe2` | Path of Exile 2 |
| `red-dead-redemption-2` | Red Dead Redemption 2 |
| `rimworld` | RimWorld |
| `rocket-league` | Rocket League |
| `rust` | Rust |
| `satisfactory` | Satisfactory |
| `skyrim` | The Elder Scrolls V: Skyrim |
| `slay-the-spire` | Slay the Spire |
| `starcraft-2` | StarCraft II |
| `stardew-valley` | Stardew Valley |
| `starfield` | Starfield |
| `stellaris` | Stellaris |
| `terraria` | Terraria |
| `the-sims-4` | The Sims 4 |
| `the-witcher-3` | The Witcher 3: Wild Hunt |
| `total-war-warhammer-3` | Total War: Warhammer III |
| `valheim` | Valheim |
| `valorant` | Valorant |
| `warframe` | Warframe |
| `world-of-warcraft` | World of Warcraft |

## What is not in v1 yet

- Permissions other than `network`, `connectors` and `webAssembly`. `sharedData`, `files` and `clipboard` arrive with their capabilities (see [Capabilities](./protocol.md#capabilities)).
- Author, homepage, license and screenshots. These belong to the catalog listing (Milestone E), not to what the desktop host needs to run a module.
- Localized names.
