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
| Button, icon button | `Button` (`default`, `secondary`, `outline`, `ghost`, `link`, `destructive`, `danger` for a quieter red remove or delete; sizes `sm`, `default`, `lg` from the [size scale](#sizes), plus `xs` and `icon*`). A tile or row you draw yourself: `variant="bare"` has no frame, fill, padding, size, corners or text style, only the keyboard outline, the press dip and the off look; give it your own classes, and a hover only if it needs one (a design style may still round its corners, as on every button). A tile that stays on takes `aria-pressed` and draws its own on state: styles don't paint a bare button | raw `<button>` with own hover, focus or underline; a `ghost` Button with its looks taken off by classes |
| A name you can open inside text or a list (an item, a station, a recipe) | `TextLink`: takes the text's size and colour, turns primary and underlined on hover, cuts off with "…" (`wrap` inside a sentence); an `icon` slot in front; `as="a"` for a page link | a raw `<button>` with own hover, focus ring or underline; `Button variant="link"` (it has a fixed height) |
| A whole list row you click (a search hit, a place, a channel, a sound to add) | `ListRow` in your own `<li>`: `leading`, label, `description`, `trailing` slots; `selected` (current row, sets `aria-current`, or `aria-selected` with `role="option"`), `navigation` on a row that leads to a page or view (a selected one then says `aria-current="page"`), `highlighted` (a listbox's keyboard highlight), `as="div"` for a row that does nothing; `size` from the [scale](#sizes) sets its least height. For a start page's list of actions, `ActionList` | a raw `<button>` row with own hover or focus; a `Button variant="ghost"` stretched with `h-auto w-full justify-start` |
| A button that starts work that takes a while (install, update, import) | `ProgressButton`: the button fills as the percent, or a stripe moves, then shows a tick | a disabled `Button` with a spinner or "Working…" next to it |
| A row of things to add or start with one click, each with a picture (modules, templates) | `ActionTile`: a square tile with a picture, a name and a small +; `featured` gives the accent edge, `status`/`progress` make it the progress like a `ProgressButton`, and `kind="more"` is the dashed last tile ("+3 more") | a card grid of your own, a `Button` stretched into a square |
| Buttons joined into one control (a split button) | `ButtonGroup` | a `div` with a 1 px `span` as divider |
| A toolbar (a row of tools above a view or an editor) | `Toolbar` with a `label`: one Tab stop, the arrows move along it (Home and End to its ends), and Tab back in lands on the last item used. Put kit controls straight in: `Button`, `Toggle`, `ToggleGroup`, `SegmentedControl` and a menu trigger join by themselves (in a choice group the arrows only move, Space or Enter picks), a `Separator` stands upright, a switched-off `Button` stays reachable. A field (search, number, select, switch) keeps its own Tab stop, also in front of the tools. `orientation="vertical"` for a column. Each tool has its leading icon (an icon-only one its label), a menu button its trailing `ChevronDown` ([Button icons and labels](#3-look)). Its look is its `variant`: `bar` for the strip at the top of a panel (tinted, a line below, a control plus 8px tall; `wrap` gives a narrow panel a second row), `floating` for a bar over a map, canvas or text (`tavora-floating`; you set where it sits and its layer), `plain` (the default) for none. The `below` slot adds rows under the tools, still one toolbar: a search and filter header with its status line, chips or progress. In a `bar`, tool buttons and toggles are `ghost` and all one size, as tall as the field next to them and 4px apart (from the field too); the one exception is the panel's main action (New world, New build): one filled `Button` (`variant="default"`, the same height as the other tools), never more than one per bar; only a field (search, select, picker) has an edge, and a tool that is on shows it with a pressed `Toggle` (or a count), never with an outline | `role="toolbar"` on a `div` of your own (it promises arrow keys); own arrow-key handling; a copied strip (`border-b bg-primary/5 h-10`); a search header of your own; `outline` buttons mixed with `ghost` ones, a second filled button, or a smaller Settings button in one bar |
| On/off button (bold, pin, show history) | `Toggle`: `variant` `outline` (default) or `ghost` (no edge, for a toolbar or a bar over content), `size` from the [scale](#sizes); an icon alone makes it square and its `label` the name and tooltip, an icon and a word (or a word) make it as wide as the words; `disabled-reason`; in a `Toolbar` a switched-off one stays reachable. `ToggleGroup` for a row of them: `outline` joins them, `ghost` keeps them apart; an option shows its `icon`, its `text` or both, and takes `disabled` and `disabledReason` | `Button` with `aria-pressed` and a hand-picked "on" colour (a `variant="bare"` tile you draw yourself is the exception) |
| 2 to 4 views or choices | `SegmentedControl`. An option can have an `icon` (with `iconOnly`, the icon alone: its `label` becomes the tooltip and `aria-label`), be `disabled` by itself, and carry a `tooltip`. Say why an option is off with `disabledReason`: it shows as the option's tooltip, and the option stays hoverable and focusable (the arrow keys land on it) but can't be picked. `fill` stretches it across the width with equal options (a long label still takes the room it needs); `size` from the [scale](#sizes) | `w-full [&>*]:flex-1` on it, padding overrides on `[role=radio]`, a row of buttons acting as tabs, icons teleported into the items, a wrapper `span` with a tooltip around a disabled option |
| Tabs | `Tabs`; closable, reorderable or renamable tabs: `TabStrip`. Tabs that don't fit are reached as the user set under Settings > Appearance > Too many tabs (a list button or arrows), like the panel tabs; `overflow` fixes one for a strip. Tabs that should go on to a second row: `TabsList class="flex-wrap"`, and the list grows with them | own tab bar, own overflow menu or scroll arrows |
| Text, number, code field | `Input`, `Textarea`, `CodeInput`, `Label`; `Input`, `SearchInput`, `NumberField` and `ComboboxInput` take `size` from the [scale](#sizes). `Textarea` with `autosize` is as tall as its text, from one line | own input with an icon positioned by hand; `h-7` or `h-8` on a field |
| Text edited where it stands (a title, a name, a quick-add line, an address) | `Input` or `Textarea` with `variant="bare"`: no edge until hovered or focused. A fill of its own stays a class (`bg-muted dark:bg-muted`) | a raw `<input>` or `<textarea>` with its own focus look |
| A field's label, hint and error | `Field` around one control (`Input`, `Textarea`, `NumberField`, `Select`, `Combobox`, `Switch`, `Checkbox`): `label`, `hint` (or its `hint` slot) and `error` are tied to the control for screen readers, and the error is read out when it appears. `orientation="horizontal"` puts a short control beside the label and moves it under the label when the row is too narrow; a switch with its label stays a `SwitchField` | a `Label` with `for`, ids and `aria-describedby` wired by hand; an error shown only as a red border |
| Pick one | `Select` (short list), `Combobox` (searchable), `Picker` (a choice cut short on its button shows whole in its tooltip), `RadioGroup`. In a list (and in a menu's `DropdownMenuRadioItem` / `ContextMenuRadioItem`) the kit marks the chosen row with a soft primary fill, a thin edge and bold text; a submenu entry whose submenu holds the chosen one (Number › 2 decimals) gets the same look with `chosen` on its `DropdownMenuSubTrigger` / `ContextMenuSubTrigger` | native `<select>`, an own tick, dot or colour on the chosen row, own `data-[chosen]` classes on a submenu entry |
| A long value in a `Select` | Nothing to do: it stays on one line that ends in "…", and the trigger's tooltip says it whole (under your `title`, if the trigger has one). `<SelectValue wrap />` gives it a second line, only for a field that stands on its own where the whole value matters. Content of your own in `SelectValue` or the trigger cuts itself (`truncate`) and says itself whole (a `title`) | `wrap` on a field in a row of controls (it ends up taller than its neighbours), your own `line-clamp` or `whitespace-normal` on the value |
| A list that is always open to take one thing from (an "Add …" dialog, a page that starts with a choice) | `Listbox`: `options` with `description`, `meta`, `group` and `disabled` (a text says why, at the row's end); `search` adds a field on top that keeps the focus, so typing anywhere on the page goes there. ↑ ↓, Home, End and the page keys move the lit row, Enter or a click fires `pick`; a new search lights the top match and bolds what matched. `:filter="false"` with `v-model:query` when the module ranks the options itself; `v-model` marks the chosen row. An option's `icon` goes in front (the `leading` slot for a picture), `busy` spins at its end while its pick is being done. For a picker that is a whole dialog ("Add a recipe"), `size="lg"`: the big frameless search, taller rows, a line between groups and, with `hints`, the keys in a foot | a `SearchInput` with buttons under it, an own active index, `scrollIntoView`, focus retries or a key listener on the window |
| A big search list that keeps its own search, order and highlight (a Ctrl+K search, a picker with covers above its rows, a list under your own field) | The palette parts: `PaletteSearch` (the big frameless field; `list` and `active-id` make it the list's combobox, `variant="field"` frames it on its own), `PaletteList` (the listbox; the field keeps the focus), `PaletteGroup` (a heading, a line above), `PaletteItem` (a `ListRow` option: `icon` or `leading`, `label` with `match` bolded, `description`, `trailing`; `active`, `busy`, `disabled`) and `PaletteFooter` (key caps). You keep the keys. Tiles in a grid above the rows (game covers) may keep their own look as options of the same list | a raw `<input>` with a magnifier placed by hand, own `role="option"` rows with their own highlight, spinner or key hints |
| A field where the user types their own value or picks a suggestion (a format) | `Combobox` with `free` on its `ComboboxInput`, `ignore-filter` and a `ComboboxTrigger` chevron; the list starts at the field's left edge and is as wide | an `Input` with a "···" button beside it and a menu of its own |
| A value with a picture, icon or swatch in the field | `SelectTrigger`'s `value` slot (`<Mark /><SelectValue />`) or `Picker`'s `value` slot (the button stays as wide as its widest choice). Two lines or a big picture: `size="auto"` | `h-auto!` on a trigger, a rule that hides parts of a row |
| One option of a short list, with a label | `RadioField` inside a `RadioGroup` (`class="gap-0.5"`): `value`, `label`, `description`, hover row, `leading` and `trailing` slots, `size`, `disabled-reason` | a `Label` or `<label>` around a `RadioGroupItem` |
| Yes/no setting | `Switch` / `SwitchField` (`placement="end"` puts the switch after the label, for a toolbar or a dialog option), `Checkbox` | own switch |
| An option you tick, with a label (a layer, a filter, "I agree") | `CheckboxField`: the `Checkbox` with its label, an optional `description`, a hover row you click anywhere on, `leading` (swatch, icon) and `trailing` (count) slots, `v-model` of `true`, `false` or `"indeterminate"`, `size` from the [scale](#sizes), `disabled-reason`. A setting that is on or off stays a `SwitchField` | a `<label>` around a `Checkbox` with your own hover, spacing and `cursor-pointer` |
| A box with a border (a stat, a summary, a group of settings) | `Card`: `title`, `description`, `header`, `action` and `footer` slots, `size` (`sm`, default, `lg`) for the padding, `interactive` to make the whole card one button (or `as="a"`) with hover, press and focus, `selected` for the current one. Solid in every style | a `div` with `bg-card`, `border`, `rounded-lg` and `p-4` |
| One card to pick out of a few (a mode, a start choice), with a title, a line and maybe a picture | `ChoiceCard` inside a `RadioGroup` (`class="grid-cols-2"` lays them out): `value`, `title`, `icon` (or an `icon` slot) in front of the title, `description`, a `media` slot for the picture, `size`. The picked card shows it by its edge and fill, with no radio mark inside; arrow keys move between cards. Several can be picked: `CheckCard` (`v-model`, the box stays in the corner). Only a picture and a name: `StyleTiles` (the `tile` slot draws the picture, which screen readers skip; when it shows a state such as locked or 3 of 5 made, give the option a `description`, which they hear after the name) | a hidden `<input type="radio">` in a `label`, or a `button` with `aria-pressed` or `role="radio"` that you style as a card |
| Amount on a range | `Slider` / `SliderField`; `editable` makes its value a box to type in, `resetValue` adds a Reset button (see [Sliders](#sliders)) | |
| Colour | `ColorPicker` | |
| Show and hide a part | `Collapsible`, `Expandable` | native `<details>` |
| List of items to choose or open | `NavList`, `ActionList`, `ActionRow` | a hand-built `ul` of buttons |
| Entries inside entries (an outline, folders, a production chain) | `TreeView`: `items` (`id`, `label`, `children`, `icon`, `badge`, `disabled`), `label` for screen readers; `selection="single"` picks with `v-model` (the chevron opens), `"none"` picks nothing (a press opens); `select` on every press of a row (not its chevron); `v-model:expanded` (save it yourself) with `expandAll(items)` / `collapseAll()`, `default-expanded="all"`; `:guides="false"` drops the lines; `size="sm"` for dense rows (4 px under the control height); the `row` slot draws your own row after the chevron (extend `TreeNode` for your data; `@click.stop` on a button inside). Arrow keys, Home/End, `*` and typing a letter are built in. Not yet: picking many, loading children later, checkboxes, dragging, a filter, long virtual lists | nested `ul`s with own chevrons, `aria-expanded` and keys; a `NavList` with `level` for something that folds |
| Table of data | `Table` and its parts (`TableHeader`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`, `TableGroup`, `TableNote`) | raw `<table>` with own CSS |
| Table options: tight rows, header that stays, fixed columns, numbers, your row, better/worse values, groups, sorting | `Table density="compact"`, `sticky-header` (give it a height with `container-class`), `layout="fixed"`; `TableHead`/`TableCell` `align="end" numeric`; `TableRow current` (you), `selected`, `tone="success \| destructive \| warning \| muted"` (colours the numeric cells), `marked` (gold edge, bold numbers); `TableGroup :colspan` heading and `TableNote :colspan` under a group, each group in its own `TableBody`; `Table v-model:sort` with `TableHead sort-key` (and `sort-first="descending"` for scores) shows the sort and sets `aria-sort`, you sort the rows; `Table flush` drops the padding at its outer edges, so cells line up with the headings around it | `text-right tabular-nums` and padding classes on every cell, `bg-accent/60` on your row, own group heading rows, a Sort menu beside the table |
| Cells to edit like a spreadsheet, or a big table to scroll, select and copy | `DataGrid` (virtual rows and columns, A/B/C and 1/2/3 headers, range selection and its keys, in-cell editor, fill handle, resizing, frozen rows and columns, a `cell` slot, `readonly`); values go in as functions and edits come out as events, so it never holds your data | a `Table` with inputs in its cells, own keyboard handling, own virtual scrolling |
| Tag, count, status word | `Badge`; `numeric` for counts, levels and times (even-width digits), `size="sm"` for tight padding. It sits with text (beside a name or heading, in a table cell), never in a row of controls: it is lower than they are and reads as a broken button. There, what describes the thing goes on the line under its name, and a control's state ("Mixed", "No key") is `<span class="text-muted-foreground text-xs">` | muted `span` beside text; a Badge next to a `SegmentedControl`, `Select`, `Picker`, `Switch` or `Button` |
| A tag the user removes, or a filter pill they switch on and off | `Chip`: `removable` (a named ×, `remove` event), `toggle` with `v-model:selected` (on: primary fill with a check); Badge's variants, `size` `sm`/`default`/`lg`, an `icon` slot for an icon or colour dot; a text size from the scale by class (`text-sm`, `text-base`, `text-lg`) grows the whole chip | a `span` with an X `Button` inside, a `Toggle` or `Badge` restyled as a pill |
| The user's own tags, or several picks from a list | `TagInput`: `v-model` string[] plus `add`/`remove` events (one tag each), `suggestions`, `free` (default; Enter, a comma or a pasted list adds typed text; off: only suggestions), `max`, `maxlength`, `size` `sm`/`default`/`lg`, a text size from the scale by class for bigger chips. Duplicates in any case are skipped; Backspace marks the last chip and removes it on the second press, ←/→ move the mark | a `Combobox` with chips and X buttons built around it |
| A number that changes while it is on screen (a count, a total) | `CountTo` / `useCountTo` (counts to the new value; not for a number that ticks every second or one being typed) | a plain `{{ n }}` that jumps |
| A list the user reorders by dragging | `useReorderMotion` and `liftedDragImage` from `ui/reorder`: the others slide aside, the dropped item settles; keys reorder at once. A line where it would land: `:class="dropLine(place, row.id)"` (a list with gaps sets `--tavora-drop-gap`) | a hand-made drop line (a box-shadow or border of your own), a line instead of the motion |
| A drag of your own with the pointer (a splitter, a crop frame, a handle on a canvas) | `bindDrag` from `@tavora/official-ui/lib/bind-drag`, made once in `setup`: a threshold before it begins, Escape and `pointercancel` put it back, the click after a drop doesn't count, it ends when the panel unmounts; you keep the value from before and put it back in `cancel` | own `pointermove`/`pointerup` listeners on `document`, a drag that keeps its result when the system cancels the pointer |
| Dragging a thing onto a target (a card onto a slot, an item onto a folder) | `startDrag` on the source and `useDropTargets` for the targets, from `ui/drag-drop`: the drag is kept for every target to read, a target accepts or refuses, `over` says where it would land, `outside` takes a drop next to the targets; the source lifts as in a reordered list. What a drop does (place, swap, clear) and how the landing looks are yours | own drag state in a module, `dataTransfer` read on dragover, a drop that ignores what the target takes |
| Menu | `ContextMenu`, `DropdownMenu`, or `sdk.ui.showMenu({ anchor: element })` | menu at the pointer, own popup |
| Share a result (copy it as text, copy it as a picture, save the picture) | `ShareMenu` from `ui/share-menu`: a Share button with its menu; give it `text`, `image` (a PNG, drawn with `renderToImage`) and `name` (the file name Save as image suggests). Only the entries you give a source for show; each says how it went in a toast, the picture is made as the menu opens, and closing the save dialog says nothing. In a ⋯ menu of your own: `ShareMenuSub` (a Share row) or `ShareMenuItems` (the rows). Other button: the `trigger` slot | own share buttons or menu, own "Copied" toast, a picture drawn only after the click |
| Copy something from a click (a code, a result, a link) | `copyText(text)` / `copyImage(png)` from `@tavora/official-ui`: through Tavora's clipboard calls, one press copies once; they throw when it didn't work, so say so in a toast | `navigator.clipboard` (Tavora's panels refuse it), own `execCommand` copy, a copy of the helper in the module |
| A picture to copy or save (a result card, a build) | `renderToImage({ width, height, draw })`: waits for the fonts, draws twice as sharp and stays within what Tavora takes | own canvas sizing, `toBlob` by hand, a fixed scale that can go past the limits |
| A button whose work takes a moment, or that says it worked (Copy → Copied, Save → Saved) | `action` on `Button` (a function; a Promise keeps the button busy): it runs on the press, a second press does nothing while it runs (`aria-busy`, the button keeps its colours and the focus), a spinner shows after 300 ms on the leading icon (or over the text), `busy-label` ("Saving…") after 1 s, and `done-label` with a check for 2 s when it worked. Return `false` when nothing happened (a dialog closed): it goes back quietly. A failure goes back and shows the kit's error toast. The button is as wide as its widest state. Something done at once (a copy) never shows a spinner, so give it no busy label. A result you can see where you clicked (Copied, a ticked todo, a star) gets no success toast; only a failure does | `:disabled="busy"`, an own spinner or "Copied" swap, a "Copied" toast next to a copy button, a toast for a tick |
| A menu entry whose work takes a moment (a reload, a copy) | `action` on `DropdownMenuItem` / `ContextMenuItem` instead of `@select`: when it returns a Promise the menu stays open with the row busy (`aria-busy`, the slow waiting pulse), the row can't be chosen again, and the menu closes when it is done; a failure shows the kit's error toast. Not for an entry that opens a dialog or a file picker: that closes the menu first with `@select` | a "Working…" label, a spinner in the row, an own busy flag around `@select` |
| Tooltip | `Tooltip` / `TooltipRows`, or a `title` (connectModule turns it into the kit tooltip). Show it with `useTooltip()`: `v-bind="tip.on(card)"` on each target (`focusable` for one that can't take the focus) and one `<Tooltip v-bind="tip.props">` per panel; it waits on hover like title hints, shows at once by keyboard, closes on leave, press, blur and Escape, and names or describes the target (a target without a name of its own is named by its card). Per target: `toggle` for an info button whose press or tap opens and closes its card (touch), `keepOnPress` (copy, then "Copied"), `when` (`isTruncated` for a name cut short), `align` (`start`/`end` of a whole row or field). `useTooltip({ shared: sdk.ui.tooltip, pin })` shows the cards in Tavora's shared tooltip instead. `pin: true` (with or without `shared`) lets a press (or Enter) on a target that isn't a control pin its card (a target's own `pin` for a button whose only press job is its card, a slot on a board): pinned in the panel it takes the pointer, shows an X and stays while you hover other targets; the X or Escape closes it and gives the focus back. On touch, a long press shows a target's card. `maxHeight` holds a card to a height of its own, and it scrolls. A `title` takes a second line with `data-tooltip-description`. The card's colours, sizes and padding are tokens (`--tavora-tooltip-surface`, `-text`, `-muted`, `-accent`, `-band`, `--tavora-panel-tooltip-title-size`, … in `tooltip.css`): a game card sets them with a class on the card. Beside the title: `badge` (an outline badge) and `meta` (small text at the right), or the `title`, `badges` and `meta` slots; the title shortens to keep them on the line. `divider` draws the line under the head; `width` (`sm` 280 px, `md`, `lg` or pixels) makes room for wide rows. `TooltipRows` takes a `unit` per row (its own column, so numbers line up) and, for several values per row, `columns` headings with `values`; a "–" is drawn faint and `trend` can be one per value | own hover box, own `pointerenter`/`focus` wiring or tooltip directive, a `button` only so a tooltip shows by keyboard, own head with a badge, a `Separator` under the head, own grid for units or columns, own pin, X or Escape handling, a card's colours copied into its own rules |
| Your own pieces in a card (a skill card, a game's card, a note under a card's stats) | The tooltip's freestanding parts, each taking plain values, in a `Tooltip` (or `ZoomTip`) or between an `ItemCard`'s parts: `TooltipArt` (a band across the top with a picture, or pictures laid over each other in its `art` slot, the title and a line under it), `TooltipText` (`text` or `runs` with `accent`, `strong` and `italic` parts; a "\n" is a line break; `tone="muted"`, `size="small"`, `box` for the effect box), `TooltipHeading`, `TooltipList` (`items` with a `meta` at the right), `TooltipTags` (a tag's own `color` for a game's rarity), `TooltipIcons` (small pictures with a `label` for screen readers and a `count`) and `TooltipFooter` (a line across the bottom). A game's colours go on the card as tooltip tokens, with a `rules-allow: color` reason | `v-html` or an HTML string, a raw `<p>`, `<h4>` or `<ul>` with your own classes, a card's padding undone with negative margins |
| A row, cell or tile that shows a card on hover or keyboard focus but does nothing on a click (a skill with its numbers, a stat) | `HoverRow` (any content; `as="li"` in your list) or `StatTile hoverable`, with `v-bind="tip.on(card)"`: ghost-button hover fill outside the content, so it neither moves nor grows, the kit's focus ring, in the Tab order, no button role | own hover fill or focus ring on a `div`, a `button` that does nothing, a `tabindex` row with own styles |
| An item card (a game's card, tower, item) in the shared tooltip, the panel's tooltip or inline in a panel | One `TooltipContent` for all three: `sdk.ui.tooltip.show` (or `useTooltip({ shared: sdk.ui.tooltip })`) above the workspace, `ItemTooltip` (`<ItemTooltip v-bind="tip.props" :content="tip.content" />`) in the panel, `ItemCard` inline. `useTooltip({ shared, fallback: true })` shows the card in the panel when Tavora can't (an older Tavora, outside Tavora). A card of your own: the item card's parts (`ItemCardArt`, `ItemCardName`, `ItemCardType`, `ItemCardEffect`, `ItemCardStats`, `ItemCardSections`, `ItemCardRequirements`; for a unit `ItemCardPortrait`, `ItemCardBar`, `ItemCardUnitStats`, `ItemCardIcons`, `ItemCardPips`) in an `ItemCard`'s slot, with your own markup between them. The shared tooltip's content: `layout: "card"` (picture on top, title with its badges, type line, `effect` box, stats with an optional per-level column (`per`, `perHeading`), optional extra value columns with headings (`more`, `columns`, e.g. each level; a "–" there is drawn faint, "doesn't change"), up to 3 tags over the picture's bottom corners (`artTags`, e.g. a kind and a rarity, optionally in a colour) and an optional icon before a stat's label (`icon`), rows). The game's formatting goes in the same content: bold and italic runs and line breaks in the `effect`, `blocks` after the sections (a paragraph, a heading, a list, tags: the kit's `TooltipText`, `TooltipHeading`, `TooltipList`, `TooltipTags`) and a `footer` line (`TooltipFooter`, a cost or a state with a bold label); `ItemCard` draws them too (`ItemCardBlocks`, `ItemCardFooter`). The host takes picture paths in `dist/`; for the panel, `fromBundle(card)` turns them into addresses the page loads. A game look is a skin (`sdk.ui.tooltip.defineSkin`, see [Item-card skins](#item-card-skins)); `look: "poe"` with a rarity `tone` draws Path of Exile 2's look, the same in the panel as in the shared tooltip. In the panel, a card taller than the panel is held inside it and scrolls with the wheel: give it no height of your own | own card markup, own hover card with game colours, the same card built twice (once for the panel, once for the shared tooltip) |
| A game unit as the game shows it on the board (portrait, title bar with a count, stats, spells, level) in the shared tooltip or inline in a panel | `sdk.ui.tooltip.show` with `layout: "unit"` (portrait sticking out at the top left, title bar with `corner`, `effect`, stats with a `suffix` hanging past the values, `icons` row with counts, `pips` with `extra`) and, inline, `ItemCard` with the same content; the game's colours and font are a skin with a `bar` colour | own unit card markup, stats with values right-aligned at the card's edge |
| Say why a control is off | `disabled-reason` next to `disabled` on `Button`, `Toggle` (and a `ToggleGroup` option's `disabledReason`), `Switch` / `SwitchField`, `Checkbox` / `CheckboxField`, `RadioGroupItem` / `RadioField`, `Card` (`interactive`) and `CheckCard`, `Input`, `Select` (or its `SelectTrigger`), `Picker`, `DropdownMenuItem`, `DropdownMenuRadioItem` and `ContextMenuItem` (and an item of Tavora's own menu, `ui.showMenu`, with `disabledReason`): the control stays hoverable and focusable, shows the reason in the kit tooltip (a menu row shows it in the row, where its hint sits, instead of the hint) and does nothing when used. A destructive menu row that is off isn't red until it can be chosen. A `Button` also does this with a `title` (or `hinted`, when you show the tooltip yourself) | a wrapper `span` with a `title` around a disabled control, a `title` on a native `disabled` control (it never shows), the reason in the label ("Pin (already pinned)") |
| Floating panel | `Popover` | absolutely positioned `div` |
| A panel next to a field or a board that must never take the focus (suggestions while typing, a toolbar over the picked slot) | `PopoverContent focus="none"` with a `PopoverAnchor` (`reference` = the field or slot): the focus stays where it is, a press on the panel doesn't move it, and the panel isn't announced as a dialog, so what it holds brings its own role (a `PaletteList` is a listbox). `dismiss-ignore` (an element, a CSS selector or a list of them) names places a click or a focus move may land on without closing it (the board). Keys stay with the field: put `role="combobox"`, `aria-controls` and `aria-activedescendant` on it, as the playground specimen does | `@open-auto-focus.prevent`, `@close-auto-focus.prevent` and `@mousedown.prevent` by hand, reading `detail.originalEvent` in `@interact-outside`, a `data-` flag the page checks for clicks |
| A card with links or buttons that opens on hover (a preview, an item you can act on, a card to pin) | `HoverCard` with `HoverCardTrigger` and `HoverCardContent` (the tooltip's look: `title`, `description`, `width`, `TooltipRows` inside), or for many targets `useHoverCard()`: `v-bind="card.on(item)"` on each target and one `<HoverCard v-bind="card.props">`. It opens after 400 ms on hover (at once along a row), at once by keyboard, and stays while the pointer is on the target or the card; Tab goes from the target into the card and on past it, Escape closes it and gives the focus back. `pinnable`: a click on a target that isn't a button or link pins the card, with a close X (on touch, a tap pins). `bare` takes an `ItemCard` with your own buttons between its parts. Anything in the card must also be reachable without it (touch and screen readers may never open it). Text only: a `Tooltip` | a `Tooltip` with buttons in it, own hover box that stays open, own pin and close button, `Popover` opened from `pointerenter` |
| A card, tip or notice of your own floating in a pane (a card over a map, a node's tip), or small controls drawn over a map or canvas (a row of tools there is `Toolbar variant="floating"`) | The `tavora-floating` class: the popover's colours, a border, the kit's corner and elevation step 2, and the style's surface look (raised in Hardware, glass in Liquid Glass). Controls over a map add `shadow-elevation-1`. Stack it with `z-(--layer-floating)` (controls: `--layer-overlay`) | `bg-popover border rounded-md shadow-md`, a `z-20` or `z-50` of your own |
| Dialog | `ConfirmDialog` (asks; only before a final delete or what can't be put back, see [Deleting](#deleting)), `NameDialog` (asks for a name), else `Dialog` with `DialogHeader`, `DialogFooter`, `DialogButton` (see [Dialogs](#dialogs)) | own overlay |
| Nothing here yet | `EmptyState` (one sentence, one action). `framed` (default, a dashed frame) for an empty spot among other content; `variant="bare"` for a panel or list that is empty as a whole; `fill` takes the free height of its column and centres it | a bare `<p>`; `border-0` or `flex-1 justify-center` on it |
| Loading with a known amount | `Progress` | "Loading…" in a `<p>` |
| An amount on a known scale (an allowance left, how full a drive is, a share of all ratings) | `Meter` from `ui/meter`: it looks like `Progress` but is a measurement to screen readers (`role="meter"`). `model-value`, `min`, `max`; `tone` (`primary`, `success`, `warning`, `destructive`, `muted`); limits that change the colour: `warning-up-to` / `destructive-up-to` for an amount that runs low, `warning-from` / `destructive-from` for one that fills up; `value-text` for what is read out ("40 % left"); `size` `sm` 4, `default` 6, `lg` 8 px; an `aria-label`. It jumps to a new value, without motion. Show the number beside it, never the colour alone | `Progress` for something that isn't work under way, a bar of `div`s |
| A list, card or page that loads | `Skeleton` around the real template with placeholder data (see [Loading](#loading)) | generic grey bars, a spinner, "Loading…" |
| A game's tall cover | `GameCover` (2:3, the game's tile as fallback, name beside it; `loading` while the art is looked for, `busy` while something happens to the game) | an own `<img>` box per module |
| A picture that may arrive late | `FadeImage` (reserved box, fades in, keeps a fallback icon if it fails) | a bare `<img>` that pops in and shifts the layout |
| Error or warning in place | `Notice` (`info`, `success`, `warning`, `destructive`); a field's own error is the `error` of its `Field` | red text in a `<p>` |
| Short message | `toast()` from `ui/toast` (the `Toaster` follows the user's toast position) | own status line |
| Work a view waits for (a confirm, an import, a load) | `useTask()` from `@tavora/official-ui/use-task`: one `state` (`idle`, `running`, `failed` with its message), always ends, drops an answer that is no longer the newest (`mode: "latest"` for loads) | `busy` and `error` refs set by hand around an `await` |
| Delete a simple thing that can be put back (a row, a to-do, a value) | `undoable()` from `ui/toast`: delete at once, then "… deleted" with Undo (see [Deleting](#deleting)) | "Are you sure?" first, a toast with an own Undo button |
| A list whose rows can be deleted, or go away by themselves | `useFocusRecovery(list)` from `@tavora/official-ui` (in the app `@tavora/official-ui/focus-recovery`), each row marked `data-focus-row="<id>"`: when the focused row goes, the focus moves to the same spot in the next row, else the row before, else the first control of the empty state (`data-focus-empty`) or the list. `data-focus-target` names a row's main control, for rows that differ. Undo calls `restore(id)` (see [Deleting](#deleting)). `NavList` and `DataGrid` do it themselves | focusing a neighbour by hand after a timeout, `document.querySelector` for the next row, the focus left on the page |
| Key hint | `Kbd` | |
| Zoomable picture, map, tree or canvas | `ZoomPane` (one control group: −, %, +, Whole map, and your own buttons in `extras`; `hundred` sets what 100 % is; `persist-key` remembers the view; a game that draws itself, canvas or SVG, uses `view-only`; one that fills its panel is `bare`; `loading` hides the controls until the content is there) and `TileMap` for tiles and pins | own wheel, drag, double-click or zoom buttons, own zoom controls per game, CSS that strips the pane's frame or hides its controls |
| A tooltip for a canvas node or anything without an element to hover | `ZoomTip` with `useZoomTip()`: you pass the box on the pane, the kit tooltip opens beside it | a tooltip at the pointer, own hover box |
| Small chart | `Sparkline` (a tiny trend, no axes) | |
| A few numbers at a glance (played, win rate, best streak) | `StatStrip` of `StatTile`s from `ui/stat-tile`: a value (a number is written in the language shown; text such as "3:42" as it is), a `label`, optional `unit`, `trend` (`better`/`worse`, with an arrow) and a one-line `hint`; `variant="outlined"` on a busy background; the strip fits even columns at 7rem each (4, then 2×2); `animate` counts to a new number, `compact` writes 12.3m with the full number in a title | `dl` tiles of your own, a grid with fixed breakpoints, a trend told by colour alone |
| Label and value pairs in a panel (stats of a pin, facts of a boss) | `FactList` from `ui/fact-list`: the same rows as `TooltipRows` (`value` or `values` under `columns`, `unit`, `trend`); values lined up on the right, `align="start"` puts them right after the label, `layout="stacked"` puts the label over the value in columns that fit | a `dl` grid of your own, `text-right tabular-nums` by hand |
| A distribution or a count per item (games by guesses, play time per day) | `BarChart` from `ui/bar-chart`: one series, `orientation="horizontal"` (bars in a track, label and count beside) or `"vertical"` (on a value axis); `highlight` a bar, `title` and `tooltip` rows for its card, `show-share`, `format`, `max`, `empty-title`; one Tab stop, the arrow keys, Home and End go from bar to bar and the kit tooltip opens beside the bar. A single amount out of a total is a `Meter` | bars drawn with divs or SVG of your own, a tooltip at the pointer |
| One or two lines over time (a rating over dates, a count over game time) | `LineChart`: `axis="time"` (x in seconds, written m:ss) or `axis="date"` (x as `Date.getTime()`); the values show in the kit tooltip beside the point you hover or reach with the arrow keys, Home and End; `y-min` / `y-max` fix the value axis (`0` for counts); `empty-title` is the empty state; the second line is dashed. No legend, zoom or other chart types | own SVG or canvas chart, a tooltip at the pointer |
| Rating | `StarRating` (`size` from the [scale](#sizes)) | |
| A board of slots the keyboard moves through (a deck, a kingdom, a puzzle board, tiles that wrap) | `useSlotGrid({ slots, columns, selected, select, wrap, disabled })` from `@tavora/official-ui`: `v-bind="grid.root"` on the board, `v-bind="grid.slot(key)"` on each slot, your own markup and base look. One Tab stop (the chosen slot, else the last used); the arrows move, Home/End along the row, Ctrl+Home/End to the corners; `null` in `slots` is a hole the keys skip; `columns: "auto"` reads the row from the page. `select: "focus"` (default) picks the slot the focus lands on (`radiogroup`); `"none"` only moves. A slot `disabled` with a reason is still reached and says why. The kit draws the chosen slot, the focus ring and off; your own keys (digits, Delete) go on the board's `keydown` with `grid.focused` | own arrow-key maths, own roving `tabindex`, `aria-checked` set by hand, an own focus ring on the slots |
| Keys for one pane (typing on a board, Escape out of a mode, a panel shortcut) | `usePaneKeys(root, handler)` from `@tavora/official-ui`: runs for keys pressed inside `root`, or with nothing focused (the first pane listening takes those); stands down in text fields, menus, dialogs and popovers, while a kit dialog or menu is open, while text is being composed, and with Ctrl, ⌘ or Alt (`modifiers: true` lets them in). Return `true` when you used the key. Ctrl+Z stays with `handleUndoKey` | `addEventListener("keydown")` on the window or document, own checks for `[role=dialog]` or a focused input |
| A month to pick a day from (an archive of daily puzzles, a date) | `Calendar` with `CalendarLegend` from `ui/calendar`: days go in and out as `"YYYY-MM-DD"` (`v-model`, `pick` on every pick, also of the same day), the month as `v-model:month` (`"YYYY-MM"`); `marks` tint a day in a kit tone (`success`, `destructive`, `warning`, `info`, `muted`) and give screen readers its words; `min`, `max` and `isDisabled` grey out days and stop ‹ ›; `today` pins the ringed day; weeks start on Monday (`weekStartsOn`). It always shows 6 weeks, so it keeps its height; the days of the months around it are dimmed and can be picked (they turn to their month). Words follow the app language | a month grid of your own, `Date` maths for the weekday offset, own swatches for a legend |
| Module settings page | `ModuleSettings` and its parts; the menu with `settingsMenu` (own pages, then Overlays: Text, Look, In game, On stream). A tall or changing preview: `SettingsPreview` with `align="start"` | own settings layout, own menu order or icons |
| The text of an overlay (over the game, on stream) | `OverlayText`, or `mountOverlayText` on a page without Vue (from `ui/overlay-text`): the box grows with the text or is fixed, and a long text scrolls, shrinks or is cut off. Its settings are `OverlayTextSettings` (one section for the Look page; it says only what changed), and `@tavora/official-ui/overlay-text` reads and keeps what was saved without Vue. Sizes inside in `em`; in the module's source list, `grows` for a box that grows | a text scaled to fill its box, a marquee of your own, `transform: scale` on text, settings rows of your own for it |
| A one-line text with `{placeholders}` | `TemplateInput` (marks the placeholders it knows; `insert` adds one at the cursor) | an `Input` with a hint about braces |
| Welcome on first add (optional) | kit parts as in [module-welcome.md](../apps/docs/guide/module-welcome.md) (Palworld is the reference) | a tour, popups over the panel, own frame |

Known gaps (ask before building, then add to the kit): number field with steps, scroll area, input
with a leading icon, a date or time field and a date picker (a field that opens the `Calendar`). Remove an entry here once the kit has it.

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
  It is the font the user picked in Settings > Appearance and can change while the panel is open: text measured to fit a
  box measures again on the kit's `onFontChange` (the kit's `OverlayText` does). The one exception is an
  [item-card skin](#item-card-skins), and a font the user picks inside the module (Notes' fonts): those stay as they are.
- **Spacing**: 4, 8, 12, 16, 24, 32 px (Tailwind 1, 2, 3, 4, 6, 8). 8 inside controls, 16 inside a panel area, 24
  between sections.
- <a id="sizes"></a>**Sizes**: every kit control with a height takes `size`: `sm`, `default` or `lg`, worked out from the
  style's control height H (32 px in Classic and Liquid Glass, 30 px in Hardware): `sm` H − 4, `default` H, `lg` H + 8.
  `default` (M) is what a control has when you give no size, and it is right almost everywhere. Controls in one row take
  the same size, so they line up: `Button`, `Toggle`, `ToggleGroup`, `Input`, `SearchInput`, `NumberField`,
  `ComboboxInput`, `SelectTrigger`, `Picker`, `SegmentedControl`, `TagInput`, `StarRating`, `ListRow`, and `TreeView`
  rows (`default` or `sm`). Rows of `Listbox`, `Picker` and `NavList` are H tall too. Never set a control's height with a
  class (`h-7`, `h-8`); pick a size. Button also has `xs` and the square `icon*` sizes; `Chip` sizes with the text.
- **Names**: one word per meaning across the kit. Bad, failed or deleting is `destructive` (Button, Badge, Chip, Notice,
  menu items, `TableRow` and Tooltip `tone`); good is `success`. `busy` is work that runs (Button's `action`,
  `DialogButton`'s `action` or `busy`, `DialogContent busy`), `loading` is content that isn't there yet (`Skeleton`,
  `GameCover`). `fill` stretches a control into the room it is given. The old names (`error`, `positive`, `negative`,
  Tooltip `danger`, DialogButton `loading`, GameCover `pending`, StarRating `md`) still work for one round; don't use
  them in new code.
- **Corners**: the kit's (`rounded-sm`, `rounded-md`, `rounded-lg`, from `--radius`); never a literal px radius.
  When you build something rounded close inside something rounded (items in a padded list, a chip in a card), give
  the inner one the step nearest to the outer radius minus the gap between them, so the corners run parallel. Only
  where it shows: from a gap of 8 px on, or when the inner part has no fill of its own, any step works. Don't change
  existing kit controls for it.
- **Pill padding**: a kit control whose corners come close to a full round (a user's corner near 16) makes room for
  its round ends by itself: the text gets more room and a leading icon sits evenly in the curve; below that nothing
  changes (`modules/shared/src/pill.css`). A kit control with `rounded-full` gets it too. A pill of your own takes the
  `tavora-pill` class, its height and padding as `[--pill-height:…] [--pill-pad:…]` (with a leading icon or dot also
  `[--pill-pad-icon:…] [--pill-icon:…]`, with a border `[--pill-border:1px]`) and its side padding from
  `px-(--pill-px)` and `pl-(--pill-px-icon)`, never extra padding by eye.
- **Depth**: areas separate by a surface step and a 1 px `border-border`. Shadows only on floating layers and on the kit's Primary and Secondary buttons (a faint
  top light, Primary also a hairline contact shadow); both come from the kit. A floating layer of your own takes an
  elevation step (`modules/shared/src/elevation.css`), never `shadow-sm|md|lg` or a `box-shadow` of your own:
  `shadow-elevation-1` (or `var(--elevation-1)`) for a small control over a map or canvas, `-2` for a card or tip
  floating in a pane, `-3` for something dragged or a menu-like layer. The steps follow the style (Classic's are
  Tailwind's sm, md and lg; other styles scale them by their depth, Hardware adds its casing light, Liquid Glass a
  light top edge). Most of the time use the `tavora-floating` class, which brings step 2 and the style's surface too.
- **Layers**: no `z-index` of your own. Inside a pane use the kit's layers, `z-(--layer-…)` or
  `z-index: var(--layer-…)`: `--layer-lift` (one thing above its neighbours: a dragged node, a focused cell),
  `--layer-sticky` (sticky headers), `--layer-overlay` (toolbars and controls drawn over a canvas or map) and
  `--layer-floating` (tips, cards and notices in the pane; the kit's menus and dialogs sit there too). `-1` for a
  decoration behind its own box is fine.
- **Styles**: besides the theme's colours the user picks a style (Classic, Hardware, Liquid Glass, …) that changes how
  the kit's controls are shaped: keycaps or capsules, inset fields, inverted lists, small caps, a status light. Kit
  controls follow it by themselves, so a module built from them needs nothing. Build nothing that only looks right in
  Classic: no own shadows, bevels or pill shapes on things the kit already has, and use the kit's sizes, not fixed
  heights. A module may draw a part differently in a style: read `data-style` and
  `data-look-<part>` on `<html>` in CSS, or `theme.style` from the module bootstrap. Without them it must still look
  right. ([docs/features/style-system.md](features/style-system.md))
- **Canvas**: a canvas keeps the colours it was drawn with, so one that reads theme colours redraws when the theme
  changes (`onTheme` from the module bootstrap, or watch `<html>` as the kit's `Sparkline` does).
- **Focus**: the kit controls bring the focus ring. Never remove it and never draw your own.
- **Icons**: Lucide (`@lucide/vue`), 16 px in controls, outline only. The theme sets the line weight (1.5; 2 on icons of
  12-14 px, 1 from 32 px), so don't set `stroke-width` yourself. An icon after a button's text gets `data-icon="end"`, so the
  kit gives that side 2 px less room (an icon before the text needs nothing; a button with its own `px-*` keeps it). A
  play triangle is nudged right on its own.
- **Button icons and labels**: ask in this order and stop at the first yes (buttons and menu entries alike).
  1. Does it open a menu or a submenu? A **trailing** chevron: `ChevronDown` for a menu (Export ⌄); a submenu entry
     keeps the kit's chevron on the right. Only these get a chevron: a button or row that goes to another view or page,
     or does something after the click, has none. A link that leaves Tavora for a website gets a trailing
     `ArrowUpRight`.
  2. Is its symbol established and familiar (plus for Create/Add, trash for Delete, copy, search, download, pencil
     for Rename)? A **leading** icon.
  3. Does it sit in a group of actions (a toolbar, a menu, a row of item actions)? A **leading** icon on each, so the
     group scans by shape.
  4. None of these: **text only** (Publish, Save, Done).
  Never more than one icon on a button, and never an icon only for decoration. A label never ends in "…": a button or
  menu entry that opens a dialog or picker says what it does ("Rename", "Import from save"), and the dialog that
  opens makes the rest clear. A status that is under way ("Saving…") is not a button label and keeps its ellipsis.
  A submenu or a selection behind an entry keeps the kit's chevron on the right, in addition to the entry's own
  leading icon. A trigger that is only an icon (a "⋯" or settings button) may carry a `ChevronDown` beside it.
- **Pictures**: a picture that fills its box gets a faint edge, so it doesn't melt into the card: `FadeImage` does it for
  `fit="cover"`, a bare `<img>` puts `tavora-picture-edge` on its rounded box. Not for icons with see-through parts.
- **Line breaks**: headings balance their lines and paragraphs avoid a lone last word on their own (`details.css`); don't
  add `<br>` or `&nbsp;` to fix a break.
- **Dropdown arrows**: a control where you pick a value shown in the field (`Select`, `Picker`) has the up/down arrow (`ChevronsUpDown`); the kit adds it. A button that opens a menu of actions has the single down arrow (`ChevronDown`). Never put a down arrow on a picker.
- **Dropdown lists**: a list opened from a field or a text button starts at its left edge, opens to the right (the kit flips it when there is no room) and is at least as wide as the field. A field whose choices are known is as wide as its longest choice and keeps that width whatever is picked (the kit's `Picker` does this); size a `Select` the same way.
- **Motion**: durations and curves come from the kit's tokens (`modules/shared/src/motion.css`: `--ease-out-strong`,
  `--ease-in-out-strong`, `--duration-press|tooltip|menu|panel|move|reorder`), never a hand-typed `cubic-bezier` or `ease-in`.
  Animate `transform` and `opacity` only (in Tailwind v4, `translate-*` and `scale-*` set the `translate` and `scale`
  properties, so name those in the transition); a hover or state change may also fade colours (`transition-colors`,
  as the kit's controls do). Never `transition-all`, and nothing in the interface runs longer than
  `--duration-move`. Menus, popovers and tooltips grow from their trigger (the kit does it); a pressed small button dips to
  0.97 and 1 px down on a fine pointer, a wide one (a full-width button, `Picker`, `ActionList` rows) only 1 px down: the kit's `press="dip"`, which `w-full`, `block`, `flex`, `flex-1` and `grow` buttons get on their own, so never put your own scale on a button (Primary, Secondary and Destructive also turn their shadow softly inward). Nothing a key press starts is animated (undo, nudges, hotkeys, switching by key), nor
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
  same way, with no blur; a new front toast starts at the size of the one it covers and springs to its own (the kit does it,
  nothing to add); their timers wait while the panel is hidden (the kit follows the page and `lifecycle`).
  Rows the user adds or removes in a vertical list use `AnimatedList`, and a page that replaces another in the same
  frame uses `usePageMotion`; don't hand-roll either. Neither moves for a key press or when a whole list is replaced.
  Waiting is the one thing that may repeat: a skeleton's slow pulse (`--duration-pulse`), and the same pulse on a busy row of a menu
  or Ctrl+K (`tavora-busy`), off for reduced motion.
- **Game motion**: a game's board or overlay may move longer than the interface, with the kit's game tokens:
  `--duration-play-quick` (400 ms: a row shaking at a wrong guess, start tiles), `--duration-play` (600 ms: a tile
  turning over), `--duration-play-long` (1400 ms: a card folding open, a slow fade between covers),
  `--duration-celebrate` (2400 ms: confetti, a "found it" highlight), with `--ease-play` (flips and shakes),
  `--ease-fall` (only for things falling) and `--ease-loop` (linear, for a spin, a scrolling title or music bars; a
  loop's length may be a `calc()` of a play duration). Only for rare moments (a win, a wrong guess, a reveal) or while
  something plays. Never on kit controls, menus, dialogs, anything a key press starts or anything shown all day.
  Reduced motion brings these to 0 like the rest, so what is left must be the finished state: no confetti frozen
  in the middle of the board.
- **Page base**: one stylesheet per module for `html, body, #app` (no margin, full height, theme colours), imported by
  every panel; a panel's own CSS adds to it and never repeats it.

### Item-card skins

A game module may dress its item cards like the game's (`sdk.ui.tooltip.defineSkin(name, skin)`, then `skin: name` and
`layout: "card"` on a card; inline, the same skin with URLs on `ItemCard`). A skin is checked values, never CSS: a
nine-slice frame picture, its colours, a WOFF2 font, hard pixels, a title in capitals. This is a deliberate exception to
the theme font and to "no all caps", **for skins only** (decided 2026-11-12):

- The skin's font is only for the title and the effect box. The type line, properties, sections and footer always keep
  the theme font (a pixel font isn't readable enough there); letters the font lacks come from the theme font.
- Tavora sets every size (a skinned title 17 px, the effect 15 px; a plain card's title 15 px and effect 13 px; badges
  and the footer 12 px, the kit's small size; the rest 13 px), and refuses a skin whose text is hard to read (4.5:1,
  the accent on the surface 3:1, the effect box's edge `boxBorder` on the box 3:1).
- The effect box has an edge: on a plain card a 1 px line in the theme's line colour, on a skinned card a 2 px edge in
  the skin's `boxBorder`, or none when the skin has none.
- A stat may have an `icon` before its label, like the game's heart for health or sword for damage (decided
  2026-11-13): a small pictogram (a transparent PNG or WebP from `dist/`, up to 64 KB; inline, a URL). Only its shape
  counts: Tavora draws it 14 px high in the label's colour (the theme's softer text, or the skin's `muted`), with hard
  pixels on a pixel skin. Labels line up whether or not a stat has one. It is decoration; the label stays the name.
- A unit card (`layout: "unit"`, decided 2026-11-22) is the game's own unit tooltip: it takes the skin's font for the
  whole card (title, effect and stats; the footer keeps the theme font), the game's sizes (title 19 px, body 16 px,
  badges 12 px), and a `bar` colour for its title bar (the title needs 4.5:1 on it; without it, the surface). It wears
  no frame. Values line up on their right edge and a `suffix` ("E+12", " (MAX)") hangs past it.
- A skin's colours are the game's: they stay the same in every theme, like the PoE look. In the module's source they
  get a `rules-allow: color` comment with that reason.
- Files come from the module's own `dist/` (PNG or WebP frame, WOFF2 font, up to 512 KB each), and the font must be
  free to use in the module.

### Dialogs

Guidance, not a lint rule: stay on the kit and small deviations are fine. The UI Playground (Actions > Dialogs) shows
each pattern.

- **Header**: `<DialogHeader :icon="Share2" title="…" description="…" />`. The icon (Lucide) and the one-line
  description are optional; the close X on the right comes with it. `ConfirmDialog` and `NameDialog` take the same
  `icon`; `ConfirmDialog` picks one from its tone if you give none.
- **Size**: `size` on `DialogContent` and `DialogScrollContent`: `sm` 360, `md` 420 (the default, leave it out), `lg` 560, `xl` 760. Pick the nearest one and never set a width of your own (`sm:max-w-[…]`, `w-[min(…)]`, `max-w-none`). `anchor="top"` (on `DialogContent` only) puts a dialog near the top of the window instead of the middle: for a dialog whose height changes (a list, a search, steps), so the title stays put; it also keeps the dialog inside the window. `DialogContent` already caps its height and scrolls, so there is no `max-h-[…] overflow-y-auto` to add. Playground: Actions > Dialogs > Dialog sizes.
- **Layout**: 24 px padding, no line above the footer or under the header, and the same gap from header to content as
  from content to footer. Put the content in one element so that holds. Don't add your own `gap-*` to `DialogContent`.
- **Footer**: `<DialogFooter>` with `DialogButton`, the action last. A button that does something (Save, Import,
  Export, Add, Delete…) may carry `:icon`. A button that only closes (Cancel, Close, Done, OK) gets `close` and never
  an icon, even when it is the primary one: `<DialogButton close>Done</DialogButton>`. `close` only marks the button
  (secondary, no icon, `type="button"`); it doesn't close the dialog by itself, so wrap it in
  `<DialogClose as-child>` or give it an `@click` that closes. `DialogFooter`'s own close button (`show-close-button`)
  does close.
  Its work goes in `action`, as on a Button (busy, no second press, a spinner, the kit's error toast). For work you
  track yourself (`useTask`), pass `:busy`: the icon turns into a spinner and a press does nothing.
- **Forms**: make the `form` `class="contents"` and put the `DialogFooter` inside it, so the Save button submits. A
  `DialogButton` without `close` submits the form; a `close` one never does (it is `type="button"` unless you give it
  another `type`).
- **Closing**: Escape, a click outside and the X close a dialog. While work it waits for runs, pass `:busy` (`useTask`'s
  `busy`) to `DialogContent` (or `DialogScrollContent`, or the app's `ModalDialog`): nothing closes it and the X is off. Where closing would lose something (typed text), set
  `:dismissible="false"` and answer `@dismiss-attempt` (its `reason`: `escape`, `outside`, `close-button`), for example
  with "Discard changes?". Don't keep a dialog open with your own `escape-key-down` or `pointer-down-outside` handler; one that
  takes Escape for something inside the dialog first (folding an open list) may still prevent it, and the kit then
  doesn't count it as a try. Playground: Actions >
  Dialogs > Ask before closing.
- **Texts**: a title of a few words, one short sentence under it, in English and German like everything else.

### Sliders

`SliderField` is the slider with its value and unit at the end. Without options it is the slider and a read-only value.

- **Keys** (Reka's, on the thumb): arrows move one step; Shift+arrow and Page Up/Down move ten steps, kept between min
  and max; Home and End jump to the limits. Nothing to add in a module.
- **`editable`**: for an amount people will want to set exactly (a size, a volume, an opacity). The value becomes a
  small right-aligned box with the unit beside it. A typed number is clamped to min and max and moved onto the step
  when the box is left or on Enter; Escape puts the old number back (and only takes the key while there is something
  to put back). A comma works as the decimal mark. Leave it off where the number only needs to be read.
- **`resetValue`**: for a setting with a default people may want back. A "Reset" button shows before the slider while
  the value differs from it; its room is kept while it is hidden, so nothing jumps. Pass `reset-label` in the user's
  language ("Zurücksetzen"). After a reset the focus moves to the slider.
- **Room**: with either option the slider keeps a least width of 96 px and the box (or the value) moves under it when
  the row is too narrow, instead of squeezing. Inside a `SettingsRow` (224 px) that means the box sits under the slider
  with Reset and an editable box; check it in German, where "Zurücksetzen" is wider.

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
- **Give controls room.** Never squeeze a segmented choice, select or field so its labels overlap, touch the edges or
  lose their padding. When a row is too narrow, put the control under its label; when a page needs more width, ask
  `settingsDialogSize` for it. Check every page in German too, where words are longer.

## 4. Behaviour

- **Connect** with `connectModule({ texts: { en, de } })`. It applies the theme now and on every change, the language,
  toast position, title tooltips and `<html lang>`. No own theme or language plumbing. (Without Vue:
  `bootstrapModule` from `@tavora/sdk/bootstrap`.)
- **Texts**: every word the user sees goes through the translator, in English and German, following the Writing rules.
  That includes data labels (categories, regions, types, station names), fallback names ("Meal plan"), tab and window
  titles. No sentences glued together in templates (`{{ a }} · {{ b }}`); use one text with placeholders and `.one` /
  `.other` for counts. A `checkCatalogs(en, de)` test covers every catalog (a module without the kit: `expect(catalogProblems(en, de)).toEqual([])` from `@tavora/sdk/testing`). Stored data stays in one language; only
  the display is translated.
- **Saving**: through the SDK store (`openDocument` in `@tavora/sdk/store`, `useDocument`, `useItemSession` in the
  kit). No own conflict handling. Files: `files.saveJson` / `files.openJson`; pictures: `pictures.save`; stored files:
  the module file store.
- **Act first, confirm later**: a change that waits for a request (the network, not a local save) shows at once, saves
  in the background and is put back with a short message if saving fails: `useOptimistic` / `useOptimisticKeyed` from
  `@tavora/official-ui` (`modules/shared/src/optimistic.ts`). It handles two quick changes: the later one wins, and an
  earlier failure never overwrites a newer value. Not for what can't be put back: deleting, publishing, money, keys,
  security. No disabled controls or "Saving…" while a local save runs.
- **One value per flow**: work with steps (a load, a save, an install, a gesture, a dialog that waits) keeps its state in
  one `status` or `phase` union, not in several flags that can disagree (`loading` and `error` set at once, `dragging`
  left on after a pinch). Async work goes through `useTask` (or a run counter), so a late answer is dropped and nothing
  stays busy after a throw. A gesture is one union (`idle | pressing | panning | …`) that `pointerup` and
  `pointercancel` of its own pointer end. With real transitions, write a pure step function over the union and test it
  (the dock's `dockDragStep` in `apps/desktop/src/renderer/dock-drag.ts` is the model). Put the current value on the
  view's root as `data-status`, so tests and tools read one value.
- **Add, edit, delete**: What people can add, they can edit and delete; deletes of simple things use Undo, deletes of things with more to them ask first (see [Deleting](#deleting)). Fixed built-ins are the exception.
- **Deleting**<a id="deleting"></a>: a simple thing that can be put back exactly as it was (an item of the module's own
  document: a to-do, a group, a saved value) is deleted at once and saved, then `undoable({ title, undo })` shows "<Thing> deleted" with Undo
  for a few seconds; Ctrl+Z outside text fields takes back the newest one (`handleUndoKey(event)` in the page's
  keydown; it stands down while a kit dialog is open and for keys pressed inside a menu, list or popover). The focus stays in the list ([`useFocusRecovery`](#2-kit-map)); its `restore(id)` in `undo` gives the thing back the focus. Each delete gets its own toast; `undo` puts back only its own thing, in its place, with its id, and
  answers `false` when it can't any more (its place is gone, something took its name): the kit then says so. Check that
  on the list as it is now, since a store change may run again on a newer one. A closed panel or app keeps the delete
  (it is saved already); end open offers in `onBeforeUnmount` with `close()`.
  A thing with more logic to it, or with parts linked to it (a saved build with its data and marks, a plan with its
  world, a profile with its runs), asks first with `ConfirmDialog` and is then deleted for good, with no Undo (decided
  2026-11-27). `ConfirmDialog` also stays for what can't be put back: files, data outside the module, anything sent out,
  money, keys.
- **Panel state**: what one panel remembers (open item, view, tab, filters, folded parts, scroll or zoom) is saved with
  panel state and **read back on start**. Writing it without reading it is the common bug. The view of a `ZoomPane` or `TileMap` is the exception: give it a `persist-key` and the kit saves and restores it in the module's storage (nothing saved: the whole map), so don't copy it into panel state.
- **Wheel**: a map, tree or graph that fills its panel zooms with the plain wheel (`ZoomPane wheel="zoom"`; `TileMap`
  always does). One that sits inside something that scrolls, such as a page-like view or a graph inside a scrolling
  page, keeps `wheel="scroll"`: the plain wheel scrolls and Ctrl + wheel zooms. Lists and cards over a zooming map
  scroll themselves or ignore the wheel; they never zoom the map behind them.
- **Lifecycle**: `onSuspend` flushes pending saves and panel state and pauses timers and animations; `onResume` starts
  them again; `onBehindChange(true)` says the window is behind the game (the panel still runs): the kit's toasts wait on it by themselves; `onDispose` flushes. Call `flushViewMemory()` (from `@tavora/official-ui`) in `onSuspend` and `onDispose` too, so a view still waiting to be saved is written. Every module registers them, even without timers, if anything saves after a delay.
- **One pane, many copies**: a component may be shown twice. Reach your own elements through refs, never
  `document.querySelector`. Keyboard shortcuts act on the focused pane only (`usePaneKeys`), not through a window-wide listener. Ctrl+K
  belongs to Tavora.
- **Menus and tooltips** open next to their element with a small gap, never at the pointer (see `CLAUDE.md`).
- **A switched-off control says why**: where a user would wonder why something is off, give it a `disabled-reason` (a short, friendly sentence: "Sign in first.", "Already pinned.") and keep the label short. The control stays hoverable and focusable, the reason opens in the kit tooltip beside it and is the control's description for a screen reader. A menu row shows its reason in the row instead, muted where the hint sits (in place of a hint, cut with "…" when long), with no tooltip. A menu row with a reason can be reached with ↑ / ↓ but not chosen; one without a reason is skipped as before. Keep a menu row's reason short: a row cuts one wider than 45% of it. Where your menu has no width of its own, `[&_[data-slot=menu-reason]]:max-w-none` on the row shows it whole. A destructive row that is off loses its red and looks like any other off row; the red comes back once it can be chosen (the one exception to red for deleting). A control that is off for an obvious reason (an empty list's Select all, a first row's Move up) needs none. Not a `title` on a native `disabled` control, which never shows.
- **Actions are visible**: nothing is hover-only or right-click-only. A row's actions sit behind a visible ⋯ button too. One exception: a panel's list over the game (in the in-game layer) keeps only what you do there quickly (tick, rename, add) and leaves the rest to the panel in Tavora, as To-Dos does; a menu there would be cut off by the small window.
- **States**: every view has its empty, loading and error state from the kit (table above). Long work shows progress.
  Content that loads shows [a skeleton](#loading), not a text.
- **Size**: `viewport.minWidth` / `minHeight` in the manifest are the real minimum, and the panel works at exactly that
  size: fixed side columns fold away or become a view switch below it. A separate wide layout uses `viewport.wide` and
  `@media (orientation: landscape)` (each panel is its own page, so media queries measure the panel).
- **Fit on double-click**: a double-click on the line next to a panel gives it the room its most scrolling part needs.
  A side list beside the content (runs left of the open run) gets `data-tavora-fit="ignore"` on its scroller, so the
  panel fits the content and the list keeps scrolling.
- **Overlays and drop targets** inside a panel use token colours and the kit's radius like everything else.
- **Overlay pages** (the manifest's `overlay`) change what they show through `watchOverlay`, never by reloading or
  going to another page. In OBS the page may load again only within 30 seconds of OBS loading the source (at most 10
  times); after that a reload shows nothing until the user refreshes the source in OBS.
- **Running with the game** (a panel type's `withGame`): that panel also runs out of sight while its game runs, often
  as a hidden panel nobody sees. Keep the work that must go on there (watching a folder, saving runs) apart from what
  needs the user: it can't open a dialog, menu, picker or link then (`PERMISSION_DENIED`), and a toast there is never
  seen. Save as you go, so a crash (it starts once more) or the game closing loses nothing.
- **Data**: bundled with the module, loaded once and shared between panels. Modules reach the network only through the hosts the user granted (`permissions.network`, `network.fetch`), and a program on this PC, such as a game's local API, only read-only as `localhost:<port>`. A folder on this PC, such as a game's replays or saves, is read only through `permissions.folders` and `folders` once the user allowed it; for a single file the user picks, use `files.pickReadOnly`. A file input (`<input type="file">`) and the browser's file pickers open nothing in a panel ([security model](../apps/docs/guide/security.md#the-systems-file-picker)): pick with `files.pickReadOnly` and read with `files.read` (`files.forget` after it when the module keeps its own copy), or `files.open` / `files.openJson`.
- **Accessibility**: icon-only buttons have a label, everything works by keyboard, a tree or list with a role also has
  its arrow keys, state is never shown by colour alone. In component tests, `ariaProblems(root)` from
  `@tavora/official-ui/testing` finds ids that `aria-labelledby`, `aria-describedby`, `aria-controls` or a label's `for`
  point at but nothing has, and a radio group, tab list, menu or list that Tab stops on more than once;
  `focusLostAfter(action)` finds an action that drops the focus to the page body.

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
- [ ] `pnpm check:modules` shows no new breaks (see [Rules check](#6-rules-check)).
- [ ] No hex, `rgb()`, palette colour, hex fallback, literal font name, px radius or off-scale text size in the new code
      (search the diff for `#[0-9a-f]{3,6}`, `rgb(`, `neutral-`, `white`, `px` in CSS).
- [ ] Looked at in a dark and a light theme (for example Tavora Dark and Hearthwood Light), and in German.
- [ ] Looked at in Hardware and Liquid Glass too (the Playground's Style and Theme pickers show any page in them).
- [ ] Looked at at the manifest's minimum size and, if set, the wide minimum.
- [ ] Every visible text is in `en` and `de`; `checkCatalogs` passes; no glued sentences.
- [ ] Every button and menu entry follows [Button icons and labels](#3-look) (trailing chevron, leading icon or text only; no "…" on labels); headings follow the Writing rules in `CLAUDE.md` (no eyebrows, slogans or clever headings).
- [ ] Saves through the SDK store; panel state is read back after a reload.
- [ ] `onSuspend` / `onDispose` flush; nothing is lost when the panel is hidden or closed mid-edit.
- [ ] Each flow keeps one status value (no flags that can disagree); async work uses `useTask` or a run counter.
- [ ] Empty, loading and error states exist and use the kit; what loads is a `Skeleton` over the real template, a late picture a `FadeImage`.
- [ ] Menus and tooltips anchor to their element; no hover-only actions.
- [ ] Where a user would wonder why a control is off, it has a `disabled-reason`; no reason squeezed into a label.
- [ ] Motion uses the kit's tokens, animates only `transform` and `opacity` (colours may fade), and leaves out anything a key starts; game motion only on a board or overlay and looks right with reduced motion.
- [ ] A row of tools is a `Toolbar`: the strip at the top of a panel and a search and filter header are `variant="bar"` (with `below` for the rows under the tools), a bar over a map or canvas `variant="floating"`; the tools in a bar are `ghost` and one size, except one filled `Button` (`variant="default"`, same height) for the panel's main action.
- [ ] Floating layers use `tavora-floating` or an elevation step, and stack with the kit's `--layer-*`; no shadow or z-index of your own.
- [ ] Dialogs use the header, footer and `DialogButton` as in [Dialogs](#dialogs); a close-only button has no icon.
- [ ] Settings use `ModuleSettings`, ask for their size with `settingsDialogSize`, have no Done button, and follow the [Settings](#settings) rules for descriptions, units and room (checked in German).
- [ ] Keyboard: Tab reaches everything, Escape closes, focus ring visible.
- [ ] The layout and Tab checks of `@tavora/sdk/testing` pass on the real panel at those sizes, in both themes and in
      German, or each finding is looked at and written down with the reason ([Testing a panel in the browser](../apps/docs/guide/testing-panels.md)).
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] The module's `DESIGN.md` (if any) does not contradict this file.

## 6. Rules check

`pnpm check:modules` reads every module's source (`src/**/*.vue`, `.ts`, `.tsx`, `.css`, tests left out) and flags what
this file forbids and a script can see: colour literals and hex fallbacks, palette colours, font names, text sizes and
weights off the scale (also your own `--text-*` tokens), corners of your own, raw controls the kit has (also a `role="toolbar"` or a tinted tool strip of your own),
`document.querySelector` in components, your own `z-index` (anything but `auto`, `0`, `-1` and the kit's `--layer-*`), shadows, all caps and focus rings, motion outside the
tokens, menus at the pointer and browser downloads. Per module it also flags a delayed save without an `onSuspend` and
`onDispose` flush, a `persist-key` without `flushViewMemory()`, panel state that is never read back, texts without a
`checkCatalogs` test, and key listeners on the whole window outside the page's entry script and the component it
mounts (that is where the page's keydown with `handleUndoKey` goes). Text catalogs (`locales.ts`, `i18n.ts`, `texts/`)
skip the colour and motion rules, since a sentence like "Items #123" isn't a colour. It runs in CI and in `pnpm lint`.
In `tavora-modules`, `pnpm check:modules` runs the same script from the `../tavora` checkout.

- **Run it**: `pnpm check:modules` checks `modules/*` and `examples/*` (in `tavora-modules`, every module folder); name folders to check
  only those (`pnpm check:modules modules/todos`). Each break is one line: file and line, the rule, what it found and
  what to use instead.
- **Known breaks** are in `module-rules-baseline.json`; only new ones fail. A break is known by its file, rule and the
  text of its line, so moving a line keeps it known, and changing it makes it new: fix it then. When you fix known
  breaks, the check says so; `pnpm check:modules --update-baseline` takes them out. Don't use it to let new breaks
  in.
- **A real exception** (game art in its own colours, a game's meaningful colours, the paper of a document page, canvas
  drawing) gets a comment with the rule and the reason, on the line or alone on the line before. Several rules are
  separated by commas. Without a reason, or with a rule that doesn't exist, the comment itself fails the check.
  A file that is the exception as a whole (a game's rarity palette, the paper of a PDF page) takes `rules-allow-file`
  anywhere in it, in a comment (never in a string), with the same rules and reason; keep it to files where every line
  is the exception.

  ```ts
  // rules-allow: color rarity colours from the game
  ```

  ```vue
  <!-- rules-allow: kit-control the kit has no tree yet -->
  ```

  ```css
  /* rules-allow: color, font-family the paper of a PDF page */
  ```

  ```ts
  // rules-allow-file: color rarity colours from the game
  ```

- `--all` lists the known breaks too, `--summary` counts all of them per rule and per module.

A clean check doesn't replace the [Done checklist](#5-done-checklist): it can't see texts, layout, behaviour or a theme.
