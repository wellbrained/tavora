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
| `entry` | yes | The HTML page to load, as a path inside the package. Must end in `.html`. |
| `icon` | no | A `.png` or `.webp` file inside the package, square, at least 128 × 128. |
| `games` | yes | Game ids the module is made for, e.g. `["poe2"]`. An empty array means any game. |
| `viewport.minWidth`, `viewport.minHeight` | yes | Smallest usable panel size in CSS pixels, 1 to 10000. Tavora refuses to open a panel it cannot give this much room. |
| `viewport.preferredWidth`, `viewport.preferredHeight` | no | Size the module looks best at, 1 to 10000. Used by the docking layout later. |
| `permissions.network` | yes | Must be `[]` for now. Mediated network access is designed separately. |

Paths (`entry`, `icon`) are relative to the package root and must stay inside it: no leading `/`, no `.` or `..` segments, no empty segments, no backslashes or `:`. Tavora also checks that both files exist when it discovers the module.

## What is not in v1 yet

- Permissions other than an empty `network` list. `sharedData`, `files` and `clipboard` arrive with their capabilities (see [Capabilities](./protocol.md#capabilities)).
- Author, homepage, license and screenshots. These belong to the catalog listing (Milestone E), not to what the desktop host needs to run a module.
- Localized names.
