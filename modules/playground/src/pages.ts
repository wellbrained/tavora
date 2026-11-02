// The playground's menu: groups, the pages in them and the examples on each page. An example is one file in
// examples/<page>/<Name>.vue; the page shows it live and, on request, its own source. Titles of groups and pages are
// translated (locales.ts); intros, example names and rules are sample content and stay in English.
import type { de } from "./locales";

export const GROUPS = ["foundations", "actions", "inputs", "display", "navigation", "canvas", "features"] as const;
export type GroupId = (typeof GROUPS)[number];

export interface ExampleDef {
  /** The file in examples/, without `.vue`: "buttons/Variants". */
  file: string;
  title: string;
  /** A rule from docs/module-rules.md this example shows. */
  rules?: string;
}

export interface PageDef {
  id: string;
  group: GroupId;
  /** More words the search finds the page by, besides its title. */
  keywords: string;
  intro?: string;
  examples: ExampleDef[];
  /** The page is filled in a later stage; it says so. */
  coming?: boolean;
}

type TextKey = keyof typeof de;
export const groupKey = (group: GroupId) => `group.${group}` as TextKey;
export const pageKey = (page: string) => `page.${page}` as TextKey;

export const PAGES: PageDef[] = [
  {
    id: "colours",
    group: "foundations",
    keywords: "tokens theme palette swatches colors",
    intro: "The theme tokens every module receives, with their current values.",
    examples: [{ file: "colours/ThemeTokens", title: "Theme tokens", rules: "Colours come from these tokens, never hex, rgb() or palette colours." }],
  },
  {
    id: "text",
    group: "foundations",
    keywords: "typography text fonts headings caption mono numbers link",
    intro: "Inter for the interface, JetBrains Mono for code and ids. Nothing is smaller than 12 px.",
    examples: [
      { file: "text/Scale", title: "Sizes" },
      { file: "text/MonoNumbersLinks", title: "Mono, tabular numbers and links", rules: "Changing numbers use tabular-nums." },
    ],
  },
  {
    id: "spacing",
    group: "foundations",
    keywords: "radius corners rounded spacing gap padding",
    intro: "Corners come from the theme's radius.",
    examples: [{ file: "spacing/Radius", title: "Radius", rules: "Use the kit's rounded-sm to rounded-xl, never a px radius." }],
    coming: true,
  },
  { id: "motion", group: "foundations", keywords: "animation easing duration transition reduced motion", examples: [], coming: true },
  { id: "writing", group: "foundations", keywords: "texts words copy tone english german", examples: [], coming: true },

  {
    id: "buttons",
    group: "actions",
    keywords: "button primary secondary ghost outline destructive danger remove link icon loading split group progress install",
    intro: "Primary and secondary have a faint top light (primary also a hairline shadow) and dip when pressed; the rest stay flat.",
    examples: [
      { file: "buttons/Variants", title: "Variants", rules: "One primary button per view; secondary for everything else." },
      { file: "buttons/Sizes", title: "Sizes" },
      { file: "buttons/WithIcons", title: "With icons" },
      { file: "buttons/ProgressButtons", title: "Progress button (the button is the progress; press one)" },
      { file: "buttons/IconOnly", title: "Icon only (each has a label and a shared tooltip)", rules: "Icon-only buttons have a label." },
      { file: "buttons/ToggleButtons", title: "Toggle buttons" },
      { file: "buttons/SplitButtons", title: "Split buttons (an action with its ▾ menu)" },
    ],
  },
  {
    id: "menus",
    group: "actions",
    keywords: "dropdown menu context right-click submenu actions icon description row",
    intro: "Every menu opens from a visible ⋯ button, next to the element it is for.",
    examples: [
      { file: "menus/WithDescriptions", title: "Dropdown menu with icons and a line under each entry" },
      { file: "menus/Dropdown", title: "Dropdown menu", rules: "Icons go on every entry or on none. Destructive items sit last, in red, after a separator." },
      { file: "menus/RightClick", title: "Right-click menu" },
    ],
  },
  {
    id: "tooltips",
    group: "actions",
    keywords: "tooltip hover help readable keyboard shortcut arrow values rows divider",
    intro: "Hover help sits beside the control with a small gap, only its arrow pointing at it. Works with a mouse and keyboard.",
    examples: [
      { file: "tooltips/FromTitle", title: "From a title (any element)" },
      { file: "tooltips/OnDisabled", title: "On a disabled button (says why; Tab reaches it, a click does nothing)", rules: "A disabled button with a title says why it is off." },
      { file: "tooltips/Rich", title: "Rich: title, text, shortcut, warning" },
      { file: "tooltips/Values", title: "Values: a chart bar, a game item" },
    ],
  },
  {
    id: "popovers",
    group: "actions",
    keywords: "popover floating panel form anchor close",
    intro: "A small panel next to a button for a quick edit. Escape or a click outside closes it.",
    examples: [{ file: "popovers/WithField", title: "Popover with a field" }],
  },
  {
    id: "dialogs",
    group: "actions",
    keywords: "dialog modal confirm delete rename name prompt busy",
    intro: "A dialog rises a little as it fades in over a dimmed page and leaves quicker; with reduced motion it only fades.",
    examples: [
      { file: "dialogs/Dialogs", title: "Dialogs", rules: "420 px wide: an icon, a title and one short line, then the buttons bottom right with the action last." },
      { file: "dialogs/FooterButtons", title: "Footer buttons", rules: "A button that does something may have an icon; Cancel, Close and Done never do." },
      { file: "dialogs/LongDialog", title: "A long dialog scrolls inside the page (DialogScrollContent)" },
    ],
  },
  {
    id: "toasts",
    group: "actions",
    keywords: "toast snackbar undo message notification status",
    intro: "A short message in a pill, where the user wants it (Settings > Appearance). Up to three stack; pointing at them spreads them out and stops their time.",
    examples: [
      { file: "toasts/Kinds", title: "Kinds" },
      { file: "toasts/Loading", title: "Loading, then done" },
      { file: "toasts/WithButton", title: "With a button" },
    ],
  },

  {
    id: "text-fields",
    group: "inputs",
    keywords: "input textarea search clear escape magnifier label hint error invalid code one-time monospace",
    intro: "Fields with a label above them and, when it helps, a hint or an error below.",
    examples: [
      { file: "text-fields/LabelAndHint", title: "Label and hint" },
      { file: "text-fields/Placeholder", title: "With a placeholder" },
      { file: "text-fields/Errors", title: "With an error", rules: "Errors show red text under the field, not only a red border." },
      { file: "text-fields/Search", title: "Search (× or Escape clears)" },
      { file: "text-fields/Monospace", title: "Monospace" },
      { file: "text-fields/Code", title: "Code (digits only, pasted spaces are fine)" },
      { file: "text-fields/TextArea", title: "Text area (grows with its text)" },
    ],
  },
  {
    id: "checkboxes",
    group: "inputs",
    keywords: "checkbox tick strike done switch field label description toggle on off",
    intro: "Checkboxes for independent options, a switch for a setting that is on or off.",
    examples: [
      { file: "checkboxes/Checkbox", title: "Checkbox" },
      { file: "checkboxes/Switch", title: "Switch" },
      { file: "checkboxes/SwitchFields", title: "Switch field (label, optional line, click the label)" },
      { file: "checkboxes/DoneItem", title: "Done item (the tick draws, then the strike follows)" },
    ],
  },
  {
    id: "pick-one",
    group: "inputs",
    keywords: "choices radio segmented select empty choice none clear picker dropdown combobox autocomplete search pictures",
    intro: "Radios and segments for one of a few, a select for one of many.",
    examples: [
      { file: "pick-one/RadioGroup", title: "Radio group (the dot springs in; arrow keys move without animating)" },
      { file: "pick-one/Segmented", title: "Segmented control" },
      { file: "pick-one/SegmentedSlide", title: "Segmented control: the pill slides when you click, jumps with the arrow keys" },
      { file: "pick-one/SegmentedEmpty", title: "Segmented control with nothing picked (no pill), and a disabled one (no pill)" },
      { file: "pick-one/Select", title: "Select" },
      { file: "pick-one/SelectDescribed", title: "Select with a line under each choice (SelectItem description)" },
      { file: "pick-one/SelectEmpty", title: "Select with an empty choice (SelectItem value=\"\")" },
      { file: "pick-one/SelectPictures", title: "Select with pictures" },
      { file: "pick-one/Combobox", title: "Combobox (type to search)" },
      { file: "pick-one/Picker", title: "Picker (a button with the list under it)" },
      { file: "pick-one/DropdownIcons", title: "Dropdown icons: pick a value with ⇕ (Select, Picker), open a menu of actions with ⌄", rules: "A picker shows ⇕, a menu of actions ⌄. Never a down arrow on a picker." },
    ],
  },
  {
    id: "numbers",
    group: "inputs",
    keywords: "slider range number field stepper quantity plus minus opacity volume",
    intro: "An amount on a range, or a count you step with plus and minus.",
    examples: [
      { file: "numbers/Slider", title: "Slider" },
      { file: "numbers/SliderField", title: "Slider with its value (steps of 5)" },
      { file: "numbers/NumberField", title: "Number field (plus and minus, 1 to 99)" },
    ],
  },
  {
    id: "colours-stars",
    group: "inputs",
    keywords: "color colour picker swatch custom palette stars rating review score",
    intro: "Pick one colour from a few, with arrow keys between the swatches. Stars round to the nearest half when shown and take whole stars when picked.",
    examples: [
      { file: "colours-stars/Swatches", title: "Swatches" },
      { file: "colours-stars/CustomColour", title: "With a custom colour" },
      { file: "colours-stars/StarsShown", title: "Shown (4.7, 4.2 and 4.8)" },
      { file: "colours-stars/StarSizes", title: "Sizes" },
      { file: "colours-stars/StarsPick", title: "Pick a rating (arrow keys work too)" },
    ],
  },
  {
    id: "toggles",
    group: "inputs",
    keywords: "toggle pressed bold italic underline format group style tiles looks pictures",
    intro: "Buttons that stay pressed, such as Bold next to a text size. Tiles pick one look out of a few by its picture. Both dip when you press them with the mouse.",
    examples: [
      { file: "toggles/Toggles", title: "Toggles (separate buttons)" },
      { file: "toggles/ToggleGroup", title: "Toggle group (joined)" },
      { file: "toggles/StyleTiles", title: "Style tiles" },
    ],
  },

  {
    id: "badges",
    group: "display",
    keywords: "badge chip tag status dot kbd keyboard key shortcut",
    intro: "Tags, status words and key hints.",
    examples: [
      { file: "badges/Badges", title: "Badges" },
      { file: "badges/StatusDots", title: "Status dot and word", rules: "State is never shown by colour alone: a dot always comes with a word." },
      { file: "badges/Keys", title: "Keyboard keys" },
    ],
  },
  {
    id: "loading",
    group: "display",
    keywords: "progress spinner skeleton loading sparkline chart graph line count numbers picture fade image",
    intro: "Show progress the user started. Skeleton and FadeImage keep a view from jumping while it loads.",
    examples: [
      { file: "loading/ProgressAndCounts", title: "Progress bar, and numbers that count to the new value" },
      { file: "loading/Sparkline", title: "Sparkline" },
      { file: "loading/Spinner", title: "Spinner" },
      { file: "loading/Skeleton", title: "Skeleton: the real card, drawn as bars while it loads", rules: "Draw the real template with placeholder data, not a loading layout of its own." },
      { file: "loading/LatePicture", title: "Picture that loads late: box first, fades in; a failed one keeps the icon" },
    ],
  },
  {
    id: "notices",
    group: "display",
    keywords: "notice alert callout info warning error success inline message empty state nothing placeholder no items action list start",
    intro: "Inline notices inside a module, and what a list shows while it has nothing in it yet.",
    examples: [
      { file: "notices/Notices", title: "Notices", rules: "An icon and a sentence; colour only tints. Errors are announced at once." },
      { file: "notices/EmptyState", title: "Empty state", rules: "A short title, one line and one action." },
      { file: "notices/EmptyActions", title: "With a list of actions (ActionList)" },
    ],
  },
  {
    id: "lists",
    group: "display",
    keywords: "table rows columns grid data cells header stats compare list row hover selected settings divider card add remove animated grow fold",
    intro: "Rows highlight on hover with the accent surface, never a glow. A table wider than its panel scrolls sideways.",
    examples: [
      { file: "lists/Table", title: "Table: plain, with a selected row and a caption", rules: "Put numbers in a right-aligned column." },
      { file: "lists/Selectable", title: "Selectable list" },
      { file: "lists/AddRemove", title: "Rows added and removed: a new row grows in with a fade and a small drop; a removed one fades and folds away while the rows below slide up. Replacing the whole list stays still." },
      { file: "lists/SettingRows", title: "Setting rows" },
      { file: "lists/Card", title: "Card" },
    ],
  },
  {
    id: "folding",
    group: "display",
    keywords: "expand collapse more less long text read clamp collapsible disclosure accordion details summary open close fold section notes force-mount height",
    intro: "Long text cut to a set height with Show more below, or a heading that opens and closes the part below it.",
    examples: [
      { file: "folding/LongText", title: "Show more: long text" },
      { file: "folding/ShortText", title: "Show more: short text shows in full" },
      { file: "folding/Collapsible", title: "Collapsible: closed and open" },
      { file: "folding/CollapsibleDivider", title: "Collapsible with its own divider and padding (as in Settings), and one that stays in the page while closed (force-mount)" },
    ],
  },

  {
    id: "tabs",
    group: "navigation",
    keywords: "tabs views strip close closable reorder drag rename middle-click scroll overflow add",
    intro: "Switch between views of the same thing. The selected tab's line slides to the tab you click and jumps for the arrow keys; the closable strip keeps its line still.",
    examples: [
      { file: "tabs/Tabs", title: "Tabs" },
      { file: "tabs/TabStrip", title: "Tabs you can close, drag and rename (TabStrip)" },
      { file: "tabs/TabIcon", title: "A tab with an icon before its name (TabStrip, icon slot)" },
      { file: "tabs/Crowded", title: "Too many for the width: the wheel scrolls, the edges fade" },
    ],
  },
  {
    id: "side-nav",
    group: "navigation",
    keywords: "nav list navlist categories settings sidebar sections menu",
    intro: "The list of categories beside a page, like in Settings. Arrow keys, Home and End move through it.",
    examples: [
      { file: "side-nav/Grouped", title: "Grouped, with counts" },
      { file: "side-nav/Plates", title: "Groups as plates, each in a colour of its own" },
    ],
  },

  {
    id: "pan-zoom",
    group: "canvas",
    keywords: "zoom pan drag pinch fit width scroll graph tree canvas viewport",
    intro: "Drag to move, Ctrl + scroll or pinch to zoom. A plain scroll keeps scrolling the page, unless the pane fits only the width.",
    examples: [
      { file: "pan-zoom/Wide", title: "Wide content, starting at its right end when it doesn't fit at 60 %" },
      { file: "pan-zoom/Growing", title: "auto-fit off: growing content keeps the view (fit only on first show or the button)" },
      { file: "pan-zoom/Remembered", title: "view, setView and showArea: remember a view, show a chosen area" },
      { file: "pan-zoom/FitWidth", title: "Tall content with fit=\"width\": fills the width, starts at the top, a plain scroll moves it" },
    ],
  },
  {
    id: "tile-map",
    group: "canvas",
    keywords: "map tiles pins markers cluster group dots spawns highlight world game zoom fog layer",
    intro: "A map made of picture tiles with pins that keep their size: drag to move, scroll or pinch to zoom. Pins close together merge into a group with a count; dots (spawns) merge only among themselves.",
    examples: [
      {
        file: "tile-map/TileMap",
        title: "Tiles per zoom level, pins with the pin slot, done, selected, highlight, showPins and a saved camera",
        rules: "Give keyboards the same places as a list next to the map.",
      },
    ],
  },

  {
    id: "settings",
    group: "features",
    keywords: "module settings dialog overlay preview page reset saved control column row",
    intro: "A module's settings in its dialog: pages left, one column right, controls lined up in one column. Changes apply at once.",
    examples: [{ file: "settings/ModuleSettings", title: "Dialog (960 × 680 in the app)" }],
  },
];

export const FIRST_PAGE = PAGES[0]!.id;

export const pageById = (id: string) => PAGES.find((page) => page.id === id);

/** Where an old saved tab (before the side menu) opens now. */
export const OLD_TABS: Record<string, string> = { basics: "colours", actions: "buttons", inputs: "text-fields", display: "badges", canvas: "pan-zoom" };

/**
 * The pages the search finds, in menu order: every word of the query must appear in the page's title (in the
 * language shown or in English), its group's name or its keywords.
 */
export function findPages(query: string, title: (page: PageDef) => string, group: (page: PageDef) => string): PageDef[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return PAGES;
  return PAGES.filter((page) => {
    const haystack = `${title(page)} ${page.id.replace(/-/g, " ")} ${group(page)} ${page.keywords}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * The code "Show code" shows: the example's own file without the playground's "Show disabled" wiring (`useOff`),
 * which a module doesn't have.
 */
export function exampleCode(source: string): string {
  return source
    .replace(/^import \{ useOff \} from "[./]+dev";\r?\n/m, "")
    .replace(/^const off = useOff\(\);\r?\n/m, "")
    .replace(/ :disabled="off"/g, "")
    .replace(/:disabled="off \|\| /g, ':disabled="')
    .replace(/<script setup lang="ts">\s*<\/script>\s*/, "")
    .replace(/(<script setup lang="ts">\r?\n)(\r?\n)+/, "$1")
    .replace(/(\r?\n){2,}<\/script>/, "\n</script>")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
}
