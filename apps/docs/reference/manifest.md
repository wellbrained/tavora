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
| `games` | yes | Game ids the module is made for, e.g. `["poe2"]`. An empty array means any game. |
| `viewport.minWidth`, `viewport.minHeight` | yes | Smallest usable panel size in CSS pixels, 1 to 10000. Tavora refuses to open a panel it cannot give this much room. |
| `viewport.preferredWidth`, `viewport.preferredHeight` | no | Size the module looks best at, 1 to 10000. Used by the docking layout later. |
| `permissions.network` | yes | Hosts the module asks to reach with [`network.fetch`](./protocol.md#network), at most 32, e.g. `["api.example.com"]`; `[]` for none. Exact lowercase public names only: no scheme, port, path, wildcard, IP address, `localhost`, `.local` or `.internal`. Each one works only once the player has granted it. |
| `permissions.connectors` | no | Connectors the module asks to use: `"ai-usage"` to read the usage of the player's Claude and Codex accounts, `"discord"` to use the Discord app on this PC with Tavora's Discord sign-in (see [Connectors](./protocol.md#connectors)). Each name once; each works only once the player has granted it. |
| `permissions.webAssembly` | no | `true` lets the page compile WebAssembly (the page's security policy gets `'wasm-unsafe-eval'`). Only Tavora's own modules may ask for it; a module from your modules folder that does is not loaded, and the Modules page says why. |

| `panels` | no | Named [panel types](#panel-types) the module offers, 1 to 16. Without it the module has one panel, made from `entry`, `icon` and `viewport`. |

Paths (`entry`, `icon`, and the same fields of a panel type) are relative to the package root and must stay inside it: no leading `/`, no `.` or `..` segments, no empty segments, no backslashes or `:`. Tavora also checks that both files exist when it discovers the module.

## Panel types

A module can offer several tools as separate panels, such as an Inventory, a Build planner and a Map tracker. Players add each one on its own from the module library, dock it anywhere and may open several copies side by side. All panel types of a module share its saved content (`storage`, `documents`, `blobs`) and its permissions; each open panel keeps its own `panel` state. Needs Tavora 0.17.9 or newer, so set `minTavora` to at least `0.17.9`.

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

When an update removes a panel type, its open panels keep their place and say the type is gone; the player can remove them or pick another type of the same module. The module's saved content is not touched. The Panel Types Example in Tavora's examples folder shows every option.

## What is not in v1 yet

- Permissions other than `network`, `connectors` and `webAssembly`. `sharedData`, `files` and `clipboard` arrive with their capabilities (see [Capabilities](./protocol.md#capabilities)).
- Author, homepage, license and screenshots. These belong to the catalog listing (Milestone E), not to what the desktop host needs to run a module.
- Localized names.
