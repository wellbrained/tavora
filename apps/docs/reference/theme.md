# Theme packages (`tavora.theme.json`)

**Status:** first version, 2026-10-15. Themes are local only for now: Tavora's own ship with the app, and users can add their own to their themes folder. Publishing themes comes with the catalog.

A theme recolours Tavora and every module in it. It is data only: one `tavora.theme.json` with colour tokens and a corner radius. Tavora reads nothing else from the folder, so a theme cannot run code, add CSS or reach the app. Fonts and other assets are not supported yet.

## Trying your own theme

1. In Tavora, open **Settings > Appearance** and press **New theme** under "Your themes". It copies the Tavora theme, Dark and Light, into a `my-theme` folder in your themes folder and opens it. The same starter is in the repository as [`examples/theme-starter`](https://github.com/wellbrained/tavora/tree/main/examples/theme-starter), and [Tavora's own themes](https://github.com/wellbrained/tavora/tree/main/themes) are good to copy too.
2. Change the colours in its `tavora.theme.json`, and its `id` and `name` before you share it (ids starting with `tavora.` are reserved).
3. Press **Reload**.

The theme shows up next to the official ones. If something is wrong, Appearance lists the folder and the first problem instead, for example a colour pair without enough contrast. Picking a theme applies it at once. **Reset to Tavora Default** always brings the default back.

```json
{
  "id": "community.ash",
  "name": "Ash",
  "description": "Grey stone and a cold blue accent.",
  "author": "Your name",
  "version": "1.0.0",
  "variations": [
    {
      "id": "dark",
      "name": "Dark",
      "mode": "dark",
      "radius": 8,
      "colors": {
        "background": "#171412",
        "foreground": "#f2ece0",
        "…": "every token below"
      }
    }
  ]
}
```

## Fields

Unknown fields are refused, so a typo fails loudly rather than being ignored.

| Field | Required | Rules |
| --- | --- | --- |
| `$schema` | no | Any string. Ignored. |
| `id` | yes | `publisher.theme-name`, with the same rules as a [module id](./manifest). The user's choice is saved under it. |
| `name` | yes | 1 to 40 characters. |
| `description` | no | At most 200 characters. |
| `author` | no | At most 60 characters. |
| `version` | yes | `major.minor.patch`. |
| `variations` | yes | 1 to 4 variations. Users switch between them in Settings. |

Each variation:

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | Lowercase letters, digits and `-`, at most 32 characters, unique in the theme. When a user switches themes, a variation with the same id (say `light`) is kept. |
| `name` | yes | 1 to 24 characters, shown in a segmented control. |
| `mode` | yes | `"dark"` or `"light"`. Native menus, scrollbars and form controls follow it. Users can follow the system (the default): Tavora then shows the variation whose mode matches the system's light or dark setting, so a theme that comes in Dark and Light works with it unchanged. |
| `contrast` | no | `"normal"` (default) or `"high"`. High-contrast variations need 7:1 for text instead of 4.5:1. |
| `radius` | no | Corner radius in px, a whole number from 4 to 12. Default 8. |
| `colors` | yes | Every token below, each as `#rrggbb`. No transparency. |

## Tokens

The names are shadcn-vue's semantic tokens plus four of Tavora's. Modules get the same values as `--tavora-<name>` properties and through `ui.getTheme`, and `ui.onThemeChange` tells them when the user picks another theme.

`background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-hover`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `border`, `input`, `ring`, `rail`, `success`, `warning`, `info`.

## Contrast rules

Tavora checks every variation against the colour pairs it really draws. Text needs 4.5:1 (7:1 in a high-contrast variation), and outlines and the focus ring need 3:1:

- Text: `foreground` on `background` and `rail`; `card-foreground`, `popover-foreground`, `secondary-foreground` and `accent-foreground` on their surfaces; `muted-foreground` on `background`, `card` and `muted`; `primary-foreground` on `primary` and `primary-hover`; `primary` on `background` and `card`; `destructive` on `background`, `card` and `secondary`; `success`, `warning` and `info` on `background`.
- Outlines: `input` on `background`, and `ring` on `background` and `card`.

A variation that misses one is not loaded, and Settings shows which pair failed and by how much.
