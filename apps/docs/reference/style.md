# Style packages (`tavora.style.json`)

**Status:** new; the format may still grow. Styles are local: Tavora's own ship with the app, and users can add their own to their styles folder. There is no style catalog.

A style changes how Tavora and every module built on the shared kit are drawn: the shape of surfaces, tabs, buttons, inputs and lists, how deep things look, the font and a few sizes. It never changes colours (those come from the [theme](./theme), and any style works with any theme) and never changes layout. A style is data only: one `tavora.style.json` that picks one look per part and sets a few numbers. Tavora reads nothing else from the folder, so a style cannot run code, add CSS, load fonts or reach the app.

## Trying your own style

1. In Tavora, open **Settings > Appearance** and press **New style** under "Your styles". It copies the style you use into a `my-…` folder in your styles folder (say `my-hardware`, named "My Hardware") and opens it. [Tavora's own styles](https://github.com/wellbrained/tavora/tree/main/styles) are good to copy too.
2. Change `looks` and `values` in its `tavora.style.json`, and its `id` and `name` before you share it (ids starting with `tavora.` are reserved).
3. Press **Reload** and pick it under **Style**.

If something is wrong, "Your styles" lists the folder and the first problem instead. A number outside its range doesn't stop the style: Tavora keeps it in the range and says so under the folder. **Reset theme** goes back to Classic.

```json
{
  "id": "community.chunky",
  "name": "Chunky",
  "description": "Big keys and inset screens.",
  "author": "Your name",
  "version": "1.0.0",
  "looks": {
    "surface": "raised",
    "tabs": "keycap",
    "content": "inset",
    "buttons": "keycap",
    "inputs": "inset",
    "lists": "inverted",
    "labels": "caps-mono",
    "status": "led"
  },
  "values": {
    "borderWidth": 1,
    "depth": 2,
    "textSize": 13,
    "controlHeight": 34,
    "spacing": 1.05,
    "glassOpacity": 0.8
  },
  "radius": 4,
  "font": "saira",
  "themes": ["tavora.hardware"]
}
```

## Fields

Unknown fields, parts and looks are refused, so a typo is reported as an error, not ignored.

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | `publisher.style-name`, with the same rules as a [module id](./manifest), at most 64 characters. The user's choice is saved under it. |
| `name` | yes | 1 to 40 characters. |
| `description` | no | At most 200 characters. |
| `author` | no | At most 60 characters. |
| `version` | yes | `major.minor.patch`. |
| `looks` | yes | One look for every part below. |
| `values` | yes | Every value below. |
| `radius` | yes | The corner radius in px, 0 (square) to 16. The user can still pick their own in Settings. |
| `font` | yes | One of the fonts Tavora ships (below). The user can still pick their own. |
| `themes` | no | Up to 8 theme ids, shown first in the theme list while this style is in use. Any other theme still works. |

## Parts and looks

| Part | Looks | What it draws |
| --- | --- | --- |
| `surface` | `flat`, `raised`, `glass` | The app background, rail, top bar and panels; menus, popovers and dialogs follow it. `glass` is see-through with blur on Tavora's own frames; a panel's content stays solid. |
| `tabs` | `pill`, `keycap` | A panel's tab strip. |
| `content` | `plain`, `inset` | A panel's content area. `inset` sets it in like a screen: over a light theme, module panels get the theme's dark colours. |
| `buttons` | `soft`, `keycap`, `capsule` | Buttons. |
| `inputs` | `soft`, `inset`, `capsule` | Inputs, checkboxes and switches. |
| `lists` | `fill`, `inverted` | Lists and the selected row. |
| `labels` | `normal`, `caps-mono` | Labels and small headings. |
| `status` | `none`, `led` | A small glowing light on what is on or open. |

The same lists are `STYLE_LOOKS` in `@tavora/sdk/protocol`. A look that doesn't exist yet is a change to Tavora's kit first; then styles can pick it.

## Values

| Value | Range | What it sets |
| --- | --- | --- |
| `borderWidth` | 0 to 2 | Border width in px. |
| `depth` | 0 to 3 | How deep things look, from none to strong; each look turns it into its own shadows. |
| `textSize` | 12 to 15 | The size of control and interface text in px (13 in Classic); the rest of the type scales from it. |
| `controlHeight` | 28 to 40 | The height of buttons and fields in px (32 in Classic). |
| `spacing` | 0.85 to 1.2 | A factor on spacing (1 in Classic). |
| `glassOpacity` | 0.55 to 0.95 | How solid glass surfaces are. Only the `glass` look uses it. Tavora raises it as far as a theme needs for text on glass to stay readable. |

A number outside its range is kept in it (and `radius` rounded to a whole number), with a note under "Your styles". The ranges are `STYLE_RANGES` in `@tavora/sdk/protocol`.

## Fonts

`inter`, `allo`, `mona-sans`, `rubik`, `nunito`, `saira`, `atkinson` (Atkinson Hyperlegible Next), `jetbrains-mono` and `outfit`. A style can't bring a font of its own.

## In modules

Modules get the style in use with the theme (`ui.getTheme`, `ui.theme`), as `theme.style`; the kit's controls follow it by themselves. See [Look and languages](../guide/look-and-languages#design-styles).
