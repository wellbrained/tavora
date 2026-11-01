# Module rules

Every module is built on Tavora's kit, theme and SDK, so it looks and behaves like part of the app. This file is the
rulebook for that. It applies to:

- every new module, official (`modules/`) or game module (`wellbrained/tavora-modules`),
- every new panel, view or feature added to an existing module.

Read it before you start. Go through the [Done checklist](#done-checklist) before you call the work done, and say in
your summary which items you checked and which you could not.

The rules in the repo's `CLAUDE.md` (Writing, UI controls, Menus and tooltips, Save as image, Save and open files) apply
in full; this file adds the how. Background: the style guide (vault `Github/Tavora/docs/design/style-guide.md`) and
[Look and languages](../apps/docs/guide/look-and-languages.md).

## 1. Before you write code

1. **List what the feature shows and does**, then map every control to the kit with the [table](#2-kit-map) below.
2. **Anything without a match is a kit gap.** Ask the maintainer before building it. Once agreed it goes into
   `modules/shared/src/components` with a specimen in the UI Playground (`modules/playground`), and only then into the
   module. Never build a local version "for now".
3. **Start from a module that does it right**, not from the panel next door. Copying another panel's CSS copies its
   mistakes: hard-coded fallbacks, pixel values, private icon rules. References: `modules/notes` and `modules/todos`
   (document store, suspend flush, panel state), `modules/playground` (every kit control in use).
4. **A module's own `DESIGN.md` or `PRODUCT.md` (for example from Impeccable) can only add to these rules**: game art,
   game colours that carry meaning (rarity, weapon sets), a game-specific layout. It never sets its own type scale,
   spacing, colours or controls. Where it disagrees with this file, this file wins; fix the design doc.

## 2. Kit map

All from `@tavora/official-ui/components/ui/…` (or `@tavora/official-ui` for the top-level exports). Restyle with
classes where you use a control; never copy it.

| You need | Use | Not |
| --- | --- | --- |
| Button, icon button, text link | `Button` (`default`, `secondary`, `outline`, `ghost`, `link`, `destructive`; sizes `xs` to `lg`, `icon*`) | raw `<button>` with own hover, focus or underline |
| Group of buttons, toolbar | `ButtonGroup`, `Separator` between groups | a `div` with a 1 px `span` as divider |
| On/off button (bold, show outline) | `Toggle`, `ToggleGroup` | `Button` with `aria-pressed` |
| 2 to 4 views or choices | `SegmentedControl` | a row of buttons acting as tabs |
| Tabs | `Tabs`; closable, reorderable or renamable tabs: `TabStrip` | own tab bar |
| Text, number, code field | `Input`, `Textarea`, `CodeInput`, `Label` | own input with an icon positioned by hand |
| Pick one | `Select` (short list), `Combobox` (searchable), `Picker`, `RadioGroup` | native `<select>` |
| Yes/no setting | `Switch` / `SwitchField`, `Checkbox` | own switch |
| Amount on a range | `Slider` / `SliderField` | |
| Colour | `ColorPicker` | |
| Show and hide a part | `Collapsible`, `Expandable` | native `<details>` |
| List of items to choose or open | `NavList`, `ActionList`, `ActionRow` | a hand-built `ul` of buttons |
| Table of data | `Table` and its parts (`TableHeader`, `TableRow`, `TableCell`, `TableCaption`) | raw `<table>` with own CSS |
| Tag, count, status word | `Badge` | muted `span` |
| Menu | `ContextMenu`, `DropdownMenu`, or `sdk.ui.showMenu({ anchor: element })` | menu at the pointer, own popup |
| Tooltip | `Tooltip` / `TooltipRows`, or a `title` (connectModule turns it into the kit tooltip). A disabled `Button` with a `title` (or `hinted`, when you show the tooltip yourself) stays hoverable and focusable, so say why it is off there | own hover box, a wrapper `span` around a disabled button |
| Floating panel | `Popover` | absolutely positioned `div` |
| Dialog | `Dialog`, `ConfirmDialog`, `NameDialog` | own overlay |
| Nothing here yet | `EmptyState` (one sentence, one action) | a bare `<p>` |
| Loading | `Progress` | "Loading…" in a `<p>` |
| Error or warning in place | `Notice` | red text in a `<p>` |
| Short message, Undo | `toast()` from `ui/toast` (the `Toaster` follows the user's toast position) | own status line |
| Key hint | `Kbd` | |
| Zoomable picture or canvas | `ZoomPane` | own wheel and drag handling |
| Small chart | `Sparkline` | |
| Rating | `StarRating` | |
| Module settings page | `ModuleSettings` and its parts | own settings layout |
| Welcome on first add (optional) | kit parts as in [module-welcome.md](../apps/docs/guide/module-welcome.md) (Palworld is the reference) | a tour, popups over the panel, own frame |

Known gaps (ask before building, then add to the kit): number field with steps, tree, drop zone, scroll area, input
with a leading icon. Remove an entry here once the kit has it.

## 3. Look

Colours, sizes and fonts come from the theme, never from the module. Users switch between dark, light and their own
themes; anything hard-coded breaks in one of them.

- **Colours**: token classes (`bg-card`, `text-muted-foreground`, `border-border`, `text-primary`, `text-destructive`,
  `text-success`, …) or `var(--card)` etc. in CSS. No hex, `rgb()` or named colours, no Tailwind palette colours
  (`neutral-500`, `white`, `black`), no hex fallbacks such as `var(--warning, #f5c518)`. Allowed exceptions, each with a
  comment saying why: game artwork in its own colours, a game's meaningful colours (rarity), the paper of a document
  page.
- **Text sizes**: `text-xs` 12, `text-sm` 13, `text-base` 14, `text-lg` 16, `text-xl` 20 px. Nothing under 12 px, no
  sizes in between. Body text is 14, buttons and menus 13, hints 12. Weights 400, 500 and 600 only. Changing numbers
  use `tabular-nums`. Sentence case, no all caps.
- **Font**: the theme's (`font-sans`, `font-mono`, or `var(--font-sans)`); never write out `"Inter Variable"`.
- **Spacing**: 4, 8, 12, 16, 24, 32 px (Tailwind 1, 2, 3, 4, 6, 8). 8 inside controls, 16 inside a panel area, 24
  between sections.
- **Corners**: the kit's (`rounded-sm`, `rounded-md`, `rounded-lg`, from `--radius`); never a literal px radius.
- **Depth**: areas separate by a surface step and a 1 px `border-border`. Shadows only on floating layers, and those
  come from the kit. No `z-index` of your own except inside a canvas or map.
- **Focus**: the kit controls bring the focus ring. Never remove it and never draw your own.
- **Icons**: Lucide (`@lucide/vue`), 16 px in controls, outline only.
- **Dropdown arrows**: a control where you pick a value shown in the field (`Select`, `Picker`) has the up/down arrow (`ChevronsUpDown`); the kit adds it. A button that opens a menu of actions has the single down arrow (`ChevronDown`). Never put a down arrow on a picker.
- **Motion**: durations and curves come from the kit's tokens (`modules/shared/src/motion.css`: `--ease-out-strong`,
  `--ease-in-out-strong`, `--duration-press|tooltip|menu|panel|move`), never a hand-typed `cubic-bezier` or `ease-in`.
  Animate `transform` and `opacity` only (in Tailwind v4, `translate-*` and `scale-*` set the `translate` and `scale`
  properties, so name those in the transition), never `transition-all`, and nothing in the interface runs longer than
  `--duration-move`. Menus, popovers and tooltips grow from their trigger (the kit does it); a pressed button dips to
  0.97 on a fine pointer. Nothing a key press starts is animated (undo, nudges, hotkeys, switching by key), nor
  anything shown all day. Reduced motion keeps a short fade and drops the movement.
- **Page base**: one stylesheet per module for `html, body, #app` (no margin, full height, theme colours), imported by
  every panel; a panel's own CSS adds to it and never repeats it.

## 4. Behaviour

- **Connect** with `connectModule({ texts: { en, de } })`. It applies the theme now and on every change, the language,
  toast position, title tooltips and `<html lang>`. No own theme or language plumbing. (Without Vue:
  `bootstrapModule` from `@tavora/sdk/bootstrap`.)
- **Texts**: every word the user sees goes through the translator, in English and German, following the Writing rules.
  That includes data labels (categories, regions, types, station names), fallback names ("Meal plan"), tab and window
  titles. No sentences glued together in templates (`{{ a }} · {{ b }}`); use one text with placeholders and `.one` /
  `.other` for counts. A `checkCatalogs(en, de)` test covers every catalog. Stored data stays in one language; only
  the display is translated.
- **Saving**: through the SDK store (`openDocument` in `@tavora/sdk/store`, `useDocument`, `useItemSession` in the
  kit). No own conflict handling. Files: `files.saveJson` / `files.openJson`; pictures: `pictures.save`; stored files:
  the module file store.
- **Panel state**: what one panel remembers (open item, view, tab, filters, folded parts, scroll or zoom) is saved with
  panel state and **read back on start**. Writing it without reading it is the common bug.
- **Lifecycle**: `onSuspend` flushes pending saves and panel state and pauses timers and animations; `onResume` starts
  them again; `onDispose` flushes. Every module registers them, even without timers, if anything saves after a delay.
- **One pane, many copies**: a component may be shown twice. Reach your own elements through refs, never
  `document.querySelector`. Keyboard shortcuts act on the focused pane only, not through a window-wide listener. Ctrl+K
  belongs to Tavora.
- **Menus and tooltips** open next to their element with a small gap, never at the pointer (see `CLAUDE.md`).
- **Actions are visible**: nothing is hover-only or right-click-only. A row's actions sit behind a visible ⋯ button too.
- **States**: every view has its empty, loading and error state from the kit (table above). Long work shows progress.
- **Size**: `viewport.minWidth` / `minHeight` in the manifest are the real minimum, and the panel works at exactly that
  size: fixed side columns fold away or become a view switch below it. A separate wide layout uses `viewport.wide` and
  `@media (orientation: landscape)` (each panel is its own page, so media queries measure the panel).
- **Overlays and drop targets** inside a panel use token colours and the kit's radius like everything else.
- **Data**: bundled with the module, loaded once and shared between panels. Modules have no network.
- **Accessibility**: icon-only buttons have a label, everything works by keyboard, a tree or list with a role also has
  its arrow keys, state is never shown by colour alone.

## 5. Done checklist

Before you say it is done, check each item and name in your summary any you could not check.

- [ ] Every control is a kit control (section 2); any new one was agreed and is in the kit with a Playground specimen.
- [ ] No hex, `rgb()`, palette colour, hex fallback, literal font name, px radius or off-scale text size in the new code
      (search the diff for `#[0-9a-f]{3,6}`, `rgb(`, `neutral-`, `white`, `px` in CSS).
- [ ] Looked at in a dark and a light theme (for example Tavora Dark and Hearthwood Light), and in German.
- [ ] Looked at at the manifest's minimum size and, if set, the wide minimum.
- [ ] Every visible text is in `en` and `de`; `checkCatalogs` passes; no glued sentences.
- [ ] Saves through the SDK store; panel state is read back after a reload.
- [ ] `onSuspend` / `onDispose` flush; nothing is lost when the panel is hidden or closed mid-edit.
- [ ] Empty, loading and error states exist and use the kit.
- [ ] Menus and tooltips anchor to their element; no hover-only actions.
- [ ] Motion uses the kit's tokens, animates only `transform` and `opacity`, and leaves out anything a key starts.
- [ ] Keyboard: Tab reaches everything, Escape closes, focus ring visible.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] The module's `DESIGN.md` (if any) does not contradict this file.
