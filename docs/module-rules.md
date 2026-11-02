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
   module. Never build a local version "for now". The specimen is one small file in
   `modules/playground/src/examples/<page>/`, listed under its page in `modules/playground/src/pages.ts` (its name
   goes in `locales.ts`, in English and German).
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
| A button that starts work that takes a while (install, update, import) | `ProgressButton`: the button fills as the percent, or a stripe moves, then shows a tick | a disabled `Button` with a spinner or "Working…" next to it |
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
| A number that changes while it is on screen (a count, a total) | `CountTo` / `useCountTo` (counts to the new value; not for a number that ticks every second or one being typed) | a plain `{{ n }}` that jumps |
| A list the user reorders by dragging | `useReorderMotion` and `liftedDragImage` from `ui/reorder`: the others slide aside, the dropped item settles; keys reorder at once | a hand-made drop line only |
| Menu | `ContextMenu`, `DropdownMenu`, or `sdk.ui.showMenu({ anchor: element })` | menu at the pointer, own popup |
| Tooltip | `Tooltip` / `TooltipRows`, or a `title` (connectModule turns it into the kit tooltip). A disabled `Button` with a `title` (or `hinted`, when you show the tooltip yourself) stays hoverable and focusable, so say why it is off there | own hover box, a wrapper `span` around a disabled button |
| Floating panel | `Popover` | absolutely positioned `div` |
| Dialog | `ConfirmDialog` (asks; only before what can't be put back, see [Deleting](#deleting)), `NameDialog` (asks for a name), else `Dialog` with `DialogHeader`, `DialogFooter`, `DialogButton` (see [Dialogs](#dialogs)) | own overlay |
| Nothing here yet | `EmptyState` (one sentence, one action) | a bare `<p>` |
| Loading with a known amount | `Progress` | "Loading…" in a `<p>` |
| A list, card or page that loads | `Skeleton` around the real template with placeholder data (see [Loading](#loading)) | generic grey bars, a spinner, "Loading…" |
| A picture that may arrive late | `FadeImage` (reserved box, fades in, keeps a fallback icon if it fails) | a bare `<img>` that pops in and shifts the layout |
| Error or warning in place | `Notice` | red text in a `<p>` |
| Short message | `toast()` from `ui/toast` (the `Toaster` follows the user's toast position) | own status line |
| Delete something that can be put back | `undoable()` from `ui/toast`: delete at once, then "… deleted" with Undo (see [Deleting](#deleting)) | "Are you sure?" first, a toast with an own Undo button |
| Key hint | `Kbd` | |
| Zoomable picture, map, tree or canvas | `ZoomPane` (one control group: −, %, +, Whole map, and your own buttons in `extras`; `hundred` sets what 100 % is; `persist-key` remembers the view; a game that draws itself, canvas or SVG, uses `view-only`) and `TileMap` for tiles and pins | own wheel, drag, double-click or zoom buttons, own zoom controls per game |
| A tooltip for a canvas node or anything without an element to hover | `ZoomTip` with `useZoomTip()`: you pass the box on the pane, the kit tooltip opens beside it | a tooltip at the pointer, own hover box |
| Small chart | `Sparkline` | |
| Rating | `StarRating` | |
| Module settings page | `ModuleSettings` and its parts; the menu with `settingsMenu` (own pages, then Overlays: Text, Look, In game, On stream) | own settings layout, own menu order or icons |
| A one-line text with `{placeholders}` | `TemplateInput` (marks the placeholders it knows; `insert` adds one at the cursor) | an `Input` with a hint about braces |
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
  page. A solid button or surface with text on it takes the fill (`bg-primary-fill` with `text-primary-fill-foreground`, `hover:bg-primary-fill-hover`);
  accents, rings, lines and coloured text stay `primary`.
- **Text sizes**: `text-xs` 12, `text-sm` 13, `text-base` 14, `text-lg` 16, `text-xl` 20 px. Nothing under 12 px, no
  sizes in between. Body text is 14, buttons and menus 13, hints 12. Weights 400, 500 and 600 only. Changing numbers
  use `tabular-nums`. Sentence case, no all caps; in a short "A & B" name both words start uppercase ("Updates & About").
- **Font**: the theme's (`font-sans`, `font-mono`, or `var(--font-sans)`); never write out `"Inter Variable"`.
- **Spacing**: 4, 8, 12, 16, 24, 32 px (Tailwind 1, 2, 3, 4, 6, 8). 8 inside controls, 16 inside a panel area, 24
  between sections.
- **Corners**: the kit's (`rounded-sm`, `rounded-md`, `rounded-lg`, from `--radius`); never a literal px radius.
  When you build something rounded close inside something rounded (items in a padded list, a chip in a card), give
  the inner one the step nearest to the outer radius minus the gap between them, so the corners run parallel. Only
  where it shows: from a gap of 8 px on, or when the inner part has no fill of its own, any step works. Don't change
  existing kit controls for it.
- **Depth**: areas separate by a surface step and a 1 px `border-border`. Shadows only on floating layers and on the kit's Primary and Secondary buttons (a faint
  top light, Primary also a hairline contact shadow); both come from the kit. No `z-index` of your own except inside a canvas or map.
- **Focus**: the kit controls bring the focus ring. Never remove it and never draw your own.
- **Icons**: Lucide (`@lucide/vue`), 16 px in controls, outline only.
- **Dropdown arrows**: a control where you pick a value shown in the field (`Select`, `Picker`) has the up/down arrow (`ChevronsUpDown`); the kit adds it. A button that opens a menu of actions has the single down arrow (`ChevronDown`). Never put a down arrow on a picker.
- **Dropdown lists**: a list opened from a field or a text button starts at its left edge, opens to the right (the kit flips it when there is no room) and is at least as wide as the field. A field whose choices are known is as wide as its longest choice and keeps that width whatever is picked (the kit's `Picker` does this); size a `Select` the same way.
- **Motion**: durations and curves come from the kit's tokens (`modules/shared/src/motion.css`: `--ease-out-strong`,
  `--ease-in-out-strong`, `--duration-press|tooltip|menu|panel|move|reorder`), never a hand-typed `cubic-bezier` or `ease-in`.
  Animate `transform` and `opacity` only (in Tailwind v4, `translate-*` and `scale-*` set the `translate` and `scale`
  properties, so name those in the transition), never `transition-all`, and nothing in the interface runs longer than
  `--duration-move`. Menus, popovers and tooltips grow from their trigger (the kit does it); a pressed button dips to
  0.97 and 1 px down on a fine pointer (Primary, Secondary and Destructive also turn their shadow softly inward). Nothing a key press starts is animated (undo, nudges, hotkeys, switching by key), nor
  anything shown all day. Reduced motion keeps a short fade and drops the movement.
  How often decides how much: what people use many times a day stays instant or gets at most a quick fade (150 ms or
  less); playful motion (springs, drawing) is only for rare moments or as direct feedback to a click.
  `--ease-spring` (a little overshoot) is only for small things popping in (a dot, a tick, a small icon), never for a
  panel or a menu; the kit's checkbox, radio dot and search clear button use it with `--duration-pop` (in) and
  `--duration-pop-out` (out). Choosing with the arrow keys in a radio group or style tiles does not animate; Space on
  a checkbox does, like a click. The height may animate in two places only, since what is
  below has to move along: a folding section (the kit's `Collapsible`) and a row the user adds to or removes from a
  vertical list (the kit's `AnimatedList`). Spacing goes on the content element (its padding, a divider, a top
  padding instead of a gap), never on the `Collapsible` root as a `gap` or as padding that depends on open/closed:
  the closed content is out of the layout, so such spacing would jump instead of growing with the height. No margins
  on the content either. For a
  done item, the kit's `tavora-strike` class (with `data-struck` while done) draws the line across the text.
  A highlight that follows the picked item of a row (segmented control, tabs) is one element that slides: use
  `useSlidingIndicator`, never a border per item. It measures the active item wherever it sits (tabs may be wrapped, e.g.
  in a tooltip's span); with none to measure, the active tab draws its own line. It slides only right after a click, never
  for keys or a value that arrives on its own.
  Dialogs rise 8 px and scale from 0.96 as they fade in (the kit's dialogs do it; centred, never from the trigger).
  A dialog a key opens (Ctrl+K, a hotkey, Enter on a button) appears at once, and Escape closes any dialog at once; the
  kit decides this itself, so use the kit's dialogs and don't add motion of your own. A dialog that must never animate
  takes the `instant` prop on `DialogContent`.
  Toasts slide 12 px in from the screen edge the stack sits on (up from the bottom, down from the top) and leave the
  same way, with no blur; their timers wait while the panel is hidden (the kit follows the page and `lifecycle`).
  Rows the user adds or removes in a vertical list use `AnimatedList`, and a page that replaces another in the same
  frame uses `usePageMotion`; don't hand-roll either. Neither moves for a key press or when a whole list is replaced.
  Waiting is the one thing that may repeat: a skeleton's slow pulse (`--duration-pulse`), off for reduced motion.
- **Page base**: one stylesheet per module for `html, body, #app` (no margin, full height, theme colours), imported by
  every panel; a panel's own CSS adds to it and never repeats it.

### Dialogs

Guidance, not a lint rule: stay on the kit and small deviations are fine. The UI Playground (Actions > Dialogs) shows
each pattern.

- **Header**: `<DialogHeader :icon="Share2" title="…" description="…" />`. The icon (Lucide) and the one-line
  description are optional; the close X on the right comes with it. `ConfirmDialog` and `NameDialog` take the same
  `icon`; `ConfirmDialog` picks one from its tone if you give none.
- **Layout**: 24 px padding, no line above the footer or under the header, and the same gap from header to content as
  from content to footer. Put the content in one element so that holds. Don't add your own `gap-*` to `DialogContent`.
- **Footer**: `<DialogFooter>` with `DialogButton`, the action last. A button that does something (Save, Import,
  Export, Add, Delete…) may carry `:icon`. A button that only closes (Cancel, Close, Done, OK) gets `close` and never
  an icon, even when it is the primary one: `<DialogButton close>Done</DialogButton>`.
- **Forms**: make the `form` `class="contents"` and put the `DialogFooter` inside it, so the Save button submits.
- **Texts**: a title of a few words, one short sentence under it, in English and German like everything else.

### Settings

A module's settings are one dialog built from `ModuleSettings` and its parts (guide: [module-settings.md](../apps/docs/guide/module-settings.md)).
The UI Playground (Tavora features > Settings) shows one page, several pages and pages with overlays.

- **One page has no menu.** `ModuleSettings` with a single page leaves the menu out: the rows sit straight on the dialog
  with thin lines between them, and the footer stays (Reset left, "Saved automatically" right). Ask the dialog for its
  size with `settingsDialogSize({ pages, rows })` (from `ui/module-settings`) and pass it to `panel.openDialog`, never
  numbers of your own: several pages get 960 × 680; one page is narrower by the menu (760) and at least six rows tall,
  then grows with its rows up to 680 and scrolls. A shorter dialog hangs from the same top edge as a 680 one.
- **No Done button.** Changes save at once and the frame has a close button; nothing in the settings closes the dialog.
- **Descriptions**: inside one section either every row has a description or none does. Never one row with and one
  without.
- **Units go in the description** ("In minutes.", "In percent."), never next to the last option or inside the options.

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
- **Act first, confirm later**: a change that waits for a request (the network, not a local save) shows at once, saves
  in the background and is put back with a short message if saving fails: `useOptimistic` / `useOptimisticKeyed` from
  `@tavora/official-ui` (`modules/shared/src/optimistic.ts`). It handles two quick changes: the later one wins, and an
  earlier failure never overwrites a newer value. Not for what can't be put back: deleting, publishing, money, keys,
  security. No disabled controls or "Saving…" while a local save runs.
- **Deleting**<a id="deleting"></a>: what can be put back exactly as it was (an item of the module's own document: a to-do, a
  group, a saved value) is deleted at once and saved, then `undoable({ title, undo })` shows "<Thing> deleted" with Undo
  for a few seconds; Ctrl+Z outside text fields takes back the newest one (`handleUndoKey(event)` in the page's
  keydown). Each delete gets its own toast; `undo` puts back only its own thing, in its place, with its id, and
  answers `false` when it can't any more (its place is gone, something took its name): the kit then says so. Check that
  on the list as it is now, since a store change may run again on a newer one. A closed panel or app keeps the delete
  (it is saved already); end open offers in `onBeforeUnmount` with `close()`. `ConfirmDialog` stays for what can't be
  put back: files, data outside the module, anything sent out, money, keys.
- **Panel state**: what one panel remembers (open item, view, tab, filters, folded parts, scroll or zoom) is saved with
  panel state and **read back on start**. Writing it without reading it is the common bug. The view of a `ZoomPane` or `TileMap` is the exception: give it a `persist-key` and the kit saves and restores it in the module's storage (nothing saved: the whole map), so don't copy it into panel state.
- **Lifecycle**: `onSuspend` flushes pending saves and panel state and pauses timers and animations; `onResume` starts
  them again; `onBehindChange(true)` says the window is behind the game (the panel still runs): the kit's toasts wait on it by themselves; `onDispose` flushes. Call `flushViewMemory()` (from `@tavora/official-ui`) in `onSuspend` and `onDispose` too, so a view still waiting to be saved is written. Every module registers them, even without timers, if anything saves after a delay.
- **One pane, many copies**: a component may be shown twice. Reach your own elements through refs, never
  `document.querySelector`. Keyboard shortcuts act on the focused pane only, not through a window-wide listener. Ctrl+K
  belongs to Tavora.
- **Menus and tooltips** open next to their element with a small gap, never at the pointer (see `CLAUDE.md`).
- **Actions are visible**: nothing is hover-only or right-click-only. A row's actions sit behind a visible ⋯ button too.
- **States**: every view has its empty, loading and error state from the kit (table above). Long work shows progress.
  Content that loads shows [a skeleton](#loading), not a text.
- **Size**: `viewport.minWidth` / `minHeight` in the manifest are the real minimum, and the panel works at exactly that
  size: fixed side columns fold away or become a view switch below it. A separate wide layout uses `viewport.wide` and
  `@media (orientation: landscape)` (each panel is its own page, so media queries measure the panel).
- **Overlays and drop targets** inside a panel use token colours and the kit's radius like everything else.
- **Data**: bundled with the module, loaded once and shared between panels. Modules have no network.
- **Accessibility**: icon-only buttons have a label, everything works by keyboard, a tree or list with a role also has
  its arrow keys, state is never shown by colour alone.

### Loading

Tavora shows its own loader (the campfire) while a module's page starts, because the page is a separate view the
host can't draw into. From the first frame of the module's own page on, loading is the module's job. When a view waits
for data (the document store, a file, a list), draw the **real template** with placeholder data inside `Skeleton`:

```vue
<Skeleton :loading="!loaded">
  <TaskList :tasks="loaded ? tasks : PLACEHOLDER_TASKS" />
</Skeleton>
```

- **Same boxes**: while `loading` is true every text, icon, picture and button inside turns into a muted bar of its own
  box. So the placeholder data has the shape of real data: the same number of rows, and text about as long as real text
  (`placeholderText(40)` makes a made-up text of that length; it is never seen). Don't build a separate "loading" layout.
- **Text next to an icon in the same element** (a heading with an icon in front) gets no bar of its own: put the text in a `<span>`.
- **Only the part that loads**: the wrapper pulses, so keep it off things that are already there (a toolbar, a title).
- **No flash**: a load shorter than 150 ms shows nothing at all. Longer, the bars appear with a slow pulse (none with
  reduced motion), and when the data arrives the content fades in over them in 200 ms. `loading` can go back to true
  (a retry) and it starts over.
- **Pictures** that arrive late use `FadeImage`, with its box sized by `class` (`size-12`, `aspect-video`), so nothing
  moves when they load. A picture that fails keeps its `#fallback` (an icon).
- **A known amount** (an import at 40 %) is a `Progress`, not a skeleton. An error is a `Notice` or `EmptyState`.
- **Not real until it arrives**: while it waits the wrapper is `inert` and `aria-hidden`, so a placeholder button can't
  be focused, clicked or read out. Keep a status text for screen readers (`sr-only`, `role="status"`) outside the
  wrapper, and put what is already known (a toolbar, a title) outside too: it must not turn into bars.
- **Same shape**: show only the parts every real page has. A part that appears only for some data (patch notes of a
  module with several versions, say) stays out of the skeleton and arrives with the data.

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
- [ ] Empty, loading and error states exist and use the kit; what loads is a `Skeleton` over the real template, a late picture a `FadeImage`.
- [ ] Menus and tooltips anchor to their element; no hover-only actions.
- [ ] Motion uses the kit's tokens, animates only `transform` and `opacity`, and leaves out anything a key starts.
- [ ] Dialogs use the header, footer and `DialogButton` as in [Dialogs](#dialogs); a close-only button has no icon.
- [ ] Settings use `ModuleSettings`, ask for their size with `settingsDialogSize`, have no Done button, and follow the [Settings](#settings) rules for descriptions and units.
- [ ] Keyboard: Tab reaches everything, Escape closes, focus ring visible.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] The module's `DESIGN.md` (if any) does not contradict this file.
