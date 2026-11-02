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
| `colors` | yes | Every token below, each as `#rrggbb`. No transparency. `primary-fill`, `primary-fill-hover`, `primary-fill-foreground`, `toast` and `toast-foreground` may be left out. |

## Tokens

The names are shadcn-vue's semantic tokens plus a few of Tavora's own. Modules get the same values as `--tavora-<name>` properties and through `ui.getTheme`, and `ui.onThemeChange` tells them when the user picks another theme.

`background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-hover`, `primary-foreground`, `primary-fill`, `primary-fill-hover`, `primary-fill-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `border`, `input`, `ring`, `rail`, `success`, `warning`, `info`, `toast`, `toast-foreground`.

`primary-fill` is the colour of solid surfaces that carry text, such as the Primary button and badges, `primary-fill-hover` is that surface under the pointer, and `primary-fill-foreground` is the text on it. All three are optional and a theme that leaves them out gets `primary`, `primary-hover` and `primary-foreground`, so it looks the same as before. Use them when a bright `primary` is right for links, highlights and the active-tab line, but too bright for a button with light text. Set `primary-fill` and `primary-fill-hover` together (Tavora refuses one without the other), keep the hover as dark as the fill so the text stays readable, and Tavora fills the three in before modules see them. `primary` keeps everything that is not a text surface: links, focus and selection accents, switches, checkboxes, progress and the lines under the active tab.

`toast` is the background of the notification pills and `toast-foreground` the text on them. Both are optional: a theme that leaves them out gets a flipped pill, `foreground` as the background and `background` as the text, and Tavora fills the two tokens in before modules see them.

## Contrast rules

Tavora checks every variation against the colour pairs it really draws. Text needs 4.5:1 (7:1 in a high-contrast variation), and outlines and the focus ring need 3:1:

- Text: `foreground` on `background` and `rail`; `card-foreground`, `popover-foreground`, `secondary-foreground` and `accent-foreground` on their surfaces; `muted-foreground` on `background`, `card` and `muted`; `primary-foreground` on `primary` and `primary-hover`; `primary-fill-foreground` on `primary-fill` and `primary-fill-hover`; `primary` on `background` and `card`; `destructive` on `background`, `card` and `secondary`; `success`, `warning` and `info` on `background`; `toast-foreground` on `toast`.
- Outlines: `input` on `background`, and `ring` on `background` and `card`.

A variation that misses one is not loaded, and Settings shows which pair failed and by how much.

## Older Tavora

Unknown colours are refused, so a Tavora released before `primary-fill`, `primary-fill-hover` and `primary-fill-foreground` does not load a theme that sets them; it lists the folder with "unknown colors" instead. Tavora's own themes ship with the app, so they are fine. Leave the three out if your theme should work everywhere. A published theme that sets them would need a minimum Tavora version, and themes have no such field yet.
