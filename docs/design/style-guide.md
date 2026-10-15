# Tavora style guide

Decided by Dominik on 2026-10-14. This file is the source of truth for how
Tavora looks and behaves; the tokens live in
[`apps/desktop/src/renderer/styles.css`](../../apps/desktop/src/renderer/styles.css).

## Status and scope

This guide defines the **Tavora default theme** and the rules every later theme
must keep. It covers the host app (rail, Home, Settings, workspace, dialogs)
and the official modules (Notes, To-Dos, later Browser and Boards). Community
modules get the same tokens and may follow it.

- **Stack:** Electron, Vue 3, Reka UI for accessible primitives, shadcn-vue for
  owned component source (`src/renderer/components/ui`), Tailwind CSS with CSS
  custom properties. Not Nuxt UI.
- **Look:** warm charcoal and firelight gold. Since 0.5.0 other installed
  theme packages can replace these colours (see "Themes" below); personal
  overrides come later.
- **How it is enforced:** tokens are defined once as CSS custom properties and
  mapped into Tailwind and the shadcn-vue components. Components use semantic
  tokens only, never raw hex values. Later theme packages supply the same
  tokens and are validated against the rules in this guide.

## Principles

2026-10-14 rail exception (PR #4): game and Home entries use a gold pill, short on hover and full height when active. Game, Home, folder and Add game icons may tilt, scale and glow on hover; reduced motion disables transforms. Game icon wrappers and Add game tiles use a 12 px radius; Add game uses a 24 px / 1.75 px plus icon. Other controls retain the sizing and hover rules below. This records the explicitly requested rail treatment while keeping the general theme rules.

Tavora should feel like a quiet campfire next to the game: warm, calm and out
of the way.

1. **Content first.** Notes, lists and pages carry the screen. Chrome (rail,
   headers, buttons) stays dark and low contrast so it recedes.
2. **Gold is rare.** The accent marks the one thing that matters right now: the
   active game, the primary action, focus. Never decoration, glow or large
   fills.
3. **Dense but readable.** Tavora often runs on a second monitor or a
   half-width window. Sizes favour compact layouts that still read at arm's
   length.
4. **Calm while playing.** No animation that loops, pulses or demands
   attention. Nothing moves unless the player caused it.
5. **Plain, not fantasy.** The brand hints at fantasy through the emblem and
   warm tones only. No parchment, ornate borders, medieval fonts or textures.

## Colour tokens

Tokens use shadcn-vue's semantic names, so its components work unchanged, plus
four Tavora extras. All text pairs pass WCAG AA; contrast is against
`--background` unless noted.

| Token | Hex | Use | Contrast |
| --- | --- | --- | --- |
| `--background` | #171412 | Window and workspace background | – |
| `--foreground` | #f2ece0 | Primary text, warm ivory | 15.6:1 |
| `--card`, `--popover` | #201c19 | Panels, cards, menus, dialogs (text: `--foreground`) | 1.08:1 |
| `--secondary` | #2a2521 | Secondary buttons, raised inputs (text: `--foreground`) | 1.21:1 |
| `--muted` | #2a2521 | Quiet backgrounds such as empty states | 1.21:1 |
| `--muted-foreground` | #9a958c | Secondary text, hints, timestamps | 6.2:1 (5.1:1 on `--muted`) |
| `--accent` | #2a2521 | Hover and selected rows (shadcn's meaning; **not** the gold) | 1.21:1 |
| `--primary` | #e0a243 | Firelight gold: active game, primary button, links | 8.2:1 |
| `--primary-foreground` | #171412 | Text on gold | 8.2:1 on gold |
| `--ring` | #e0a243 | Focus ring | 8.2:1 |
| `--border` | #35302b | Dividers and panel edges (decorative) | 1.4:1 |
| `--input` | #6b665c | Input and checkbox outlines | 3.2:1 |
| `--destructive` | #e5675a | Delete, failed panels, errors | 5.6:1 |
| `--rail` (Tavora) | #100e0d | Game rail, the darkest layer | 1.05:1 |
| `--success` (Tavora) | #8cbf7f | Saved, running | 8.6:1 |
| `--warning` (Tavora) | #e3c75f | Warnings such as low space | 11.0:1 |
| `--info` (Tavora) | #6fa8dc | Neutral notices, unresponsive panel | 7.3:1 |

- Gold hover is #f0b85c (10.2:1). A 15% gold tint marks drop targets.
- Gold fills are limited to the primary button and small markers. Large areas
  are never gold.
- State is never shown by colour alone: a failed panel also shows a dot and the
  words "Could not load".
- Modules receive these values through `ui.getTheme`
  (`apps/desktop/src/main/games.ts`).

## Typography

**Inter** for all interface text and **JetBrains Mono** for code and IDs, both
under the SIL Open Font License, bundled with the app and never loaded from the
web. The logo wordmark stays an image and is never re-typeset.

| Role | Size / line height | Weight | Use | Tailwind |
| --- | --- | --- | --- | --- |
| Display | 28 / 34 px | 600 | Welcome greeting only | `text-3xl` |
| Title | 20 / 26 px | 600 | Page and dialog titles | `text-xl` |
| Heading | 16 / 22 px | 600 | Section headings | `text-lg` |
| Body | 14 / 20 px | 400 | Default text, inputs, notes | `text-base` |
| Compact | 13 / 18 px | 500 | Rail, menus, panel headers, buttons | `text-sm` |
| Caption | 12 / 16 px | 400 | Hints, timestamps, labels | `text-xs` |

- Nothing is smaller than 12 px. Only weights 400, 500 and 600. No italics in
  UI chrome; italics stay available inside notes.
- No all-caps text except monogram icons and three-letter game labels.
- Numbers that change (timers, counts) use tabular figures.

## Spacing, shape, icons and logo

Everything sits on a 4 px grid with one 8 px corner radius.

| Token | Value | Use |
| --- | --- | --- |
| Spacing | 4, 8, 12, 16, 24, 32 px | 8 inside controls, 16 inside panels and dialogs, 24 between page sections |
| Radius | 8 px (4 px for small chips, round for avatars) | Buttons, inputs, cards, menus, game icons |
| Rail | 72 px collapsed; 256 px default, 180 to 420 px when resized | Game rail |
| Game icon | 48 px in the rail, 64 px on Home | Monogram or uploaded image |
| Panel tab | 28 px | Tab bar of each panel group |
| Control height | 32 px (28 px compact) | Buttons, inputs, menu rows |
| Hit target | at least 28 px | Anything clickable |

- **Elevation:** surfaces separate by colour step and a 1 px `--border`, not
  shadows. Only floating layers (menus, dialogs, toasts) get one soft shadow.
- **Icons:** [Lucide](https://lucide.dev) outline icons (`@lucide/vue`, ISC
  licence, the shadcn-vue default), 16 px in chrome and 20 px in the rail,
  1.5 px stroke, `--muted-foreground` and `--foreground` on hover. No filled or
  multicolour icons.
- **Logo:** the flame mark sits at the top of the rail (32 px) and is the Home
  button. The full emblem appears once on Home (about 120 px). The app icon and
  taskbar use the emblem kit files. The logo is never recoloured, stretched
  or outlined. It sits on a light background only in light themes (since 0.5.0). Vector masters live in
  [`brand/logo`](../../brand/logo/README.md).
- **Game art:** Tavora ships no game logos or cover art. Games show a monogram
  (for example PE2 for Path of Exile 2) on a tone derived from the game id, or
  an image the player uploads.

## Components and interaction

Components come from shadcn-vue, kept as editable source in the repo and built
on Reka UI primitives. Docking, the rail, the workspace and security dialogs
stay Tavora's own and no theme can replace them.

| Component | Rule |
| --- | --- |
| Primary button | `--primary` fill, `--primary-foreground` text. At most one per view or dialog. |
| Secondary button | `--secondary` fill, `--foreground` text. The default for everything else. |
| Danger button | `--destructive` text on `--secondary`; red fill only on the final confirm of a delete. |
| Input | `--card` fill, `--input` outline, `--ring` outline on focus. Errors show red text under the field, not only a red border. |
| Menus | Open on right-click and on a visible ⋯ button, so nothing is right-click only. Destructive items sit last, in red, after a separator. Submenus open to the side. |
| Dialog | 420 px wide, title plus one sentence, buttons bottom right with the primary last. Escape and the backdrop cancel. Focus stays inside. |
| Toast | Top centre over the toolbar, because module panels draw above the lower area. One line. |
| Rail | Flame (Home) at the top, then favorites, then games and folders, then Add game, Settings and Collapse at the bottom. The active game gets a 3 px gold bar on its left edge. |
| Panel tab | 28 px, module name in Compact text. Close is always shown; Reload or Stop appear when the panel needs them. A status dot plus a word shows loading, unresponsive or failed. The selected tab of the focused group carries a 2 px gold underline; other tabs have none. |
| Docking | Panels sit in groups of tabs, and groups split side by side or stacked, nested as deep as needed. A new panel goes beside the focused group when its row has room for every panel's minimum width, then below it, then beside or below the roomiest other group, and only then becomes a tab. The row or column it joins is shared out evenly. A drag or split that would push a panel below its module's minimum size is refused. While a panel is dragged over a group, a drop guide (five cells in a cross at its centre) shows where it can go: aim at a cell, or near an edge, to place it beside the group, or at the middle to add it as a tab. The landing area is highlighted with a label (Place left, Add as a tab…), and cells for drops that would not fit are dimmed and show no highlight. Splits have no visible handle until hovered, then a gold line. |
| Panel menu | Right-click on a tab or the group's ⋯ button: Split right, Split down, Move to next or previous group, Maximize or Restore, Close panel. Everything a drag can do is here too. |
| Layouts menu | In the workspace toolbar: Save current layout, then each saved layout with Apply, Update, Rename and Delete. Applying keeps open panels of the same module and their content. Below them, a grid of Templates (2, 3 or 4 columns, 2 or 3 rows, 2 × 2, 3 × 2 and 2 × 3 grids, main + side, side + main, main + 2 stacked, top + 2 below), shown as large previews of their slots with no label (the name shows on hover), lay out empty slots: open panels fill the first slots, and each empty slot offers Add module and Remove slot. Add module in the toolbar fills an empty slot before splitting. |
| Settings | A large dialog over the app (1040 by 760 px, smaller windows minus a 24 px margin), as in Claude and Discord. A grouped section menu on the left, then one section at a time: a title, then rows with the setting's name and one sentence on the left and its control on the right, separated by dividers rather than cards. Two to four short choices use a segmented control. |
| Empty state | One sentence and one action. No illustrations. |

- **Focus:** every interactive element shows a 2 px `--ring` outline with 2 px
  offset on keyboard focus. Focus rings are never removed.
- **Hover:** the `--accent` surface, never a glow or scale.
- **Motion:** short fades for menus and dialogs. No looping animation. With the
  system's reduced-motion setting, all motion is off.
- **Wording:** sentence case, verbs on buttons ("Add game", not "OK"), and say
  what will happen ("Move to Trash", "Delete for good").
- **Native views:** module panels are separate native views drawn above the
  host page. Anything that floats over the workspace (menus, dialogs) hides the
  panels while it is open, showing a still image of each in its place, so the
  workspace does not flash empty. Dragging a tab and resizing a split do the
  same. Tooltips use the native `title` so they are never hidden.
- **Layouts:** the arrangement autosaves per game. Closing a panel or deleting
  a saved layout never deletes module data.

## Accessibility

Tavora targets WCAG 2.2 level AA for the host and official modules.

- **Contrast:** text at least 4.5:1, large text and control outlines at least
  3:1. New colours need a contrast check before use.
- **Keyboard:** everything works without a mouse. Tab order follows the screen,
  arrow keys move inside the rail and menus, Enter opens, Escape closes, the
  menu key or Shift+F10 opens an item's menu, Ctrl+K opens search.
- **Screen readers:** every icon-only button has a label, the rail is a
  navigation landmark, dialogs are announced as dialogs, and panel status
  changes are announced.
- **Scaling:** the UI stays usable at 200% system zoom without text being cut
  off. Tavora's own zoom is in the [backlog](../backlog.md).
- **Motion and colour:** reduced-motion is respected, and no state is shown by
  colour alone.

## Themes and what players and modules may change

In Milestone C players personalise their library and layout only. Later they
pick an installed theme and variation and may make bounded personal overrides,
but Tavora's usability rules always win.

| Area | Milestone C | Later |
| --- | --- | --- |
| Theme | Tavora default only (this guide, dark). Since 0.5.0: installed theme packages, each with up to four variations; Tavora ships Tavora, Nightfall and Hearthwood, each in Dark and Light | Published themes from the catalog |
| Personal overrides | None | Accent colour, density, corner radius (4 to 12 px), base text size (13 to 16 px), clamped |
| Fonts | Inter and JetBrains Mono | Themes may bundle any font under OFL, Apache 2.0 or MIT, packaged locally |
| Rail | Collapse or expand, width 180 to 420 px | Same |
| Games | Name, icon letters, uploaded icon, favorites, folders, order | Same |
| Workspace | Open modules, panel layout, saved layouts (C2) | Same |
| App behaviour | Start on Home or last game, list order | Same |
| Tavora's own controls | Never changeable | Never changeable: panel headers, docking controls, permission and security dialogs, recovery actions |
| Modules | Every module page starts from Tavora's default look (font, colours, buttons, fields, scrollbars, no page margin) and gets the tokens as `--tavora-*` properties and through `ui.getTheme`. Any framework, no Tailwind or shadcn-vue needed. A module's own styles win; matching is recommended, not required | Same, taken from the active theme |

- **Precedence:** Tavora's usability rules, then the installed theme and chosen
  variation, then personal overrides, each checked and clamped against the
  rules.
- **Scope:** one global theme; per-game themes only if players ask for them.
- **Theme packages are data:** a `tavora.theme.json` with the colour tokens
  and a radius per variation ([format](../../apps/docs/reference/theme.md)).
  No CSS, Tailwind classes, JavaScript or Electron access; bundled fonts and
  other licensed local assets come later. Each theme card in Settings >
  Appearance is drawn in the theme's own colours, so it is previewed before
  it applies.
- **Recovery:** the default theme is the fallback, and **Reset to Tavora
  Default** is always reachable and works whatever theme is active.
- **Validation** uses the rules in this guide: contrast (AA for every theme,
  AAA for High Contrast variants), 12 px minimum text, focus visibility,
  distinguishable error and warning states, hit targets, reduced motion and
  text scaling. Themes only set colours and the radius, so today the check is
  contrast on every pair the host draws and a radius from 4 to 12 px; a
  variation that fails is not loaded and Settings names the failing pair.
- **Timing:** theme packages, variations and Reset shipped in 0.5.0, ahead of
  Browser at Dominik's request. Personal overrides follow later. Theme publishing opens after Milestone E, once the theme
  validator and review run.
