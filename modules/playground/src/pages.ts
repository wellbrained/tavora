// The playground's pages, in the order of the side menu. Each page lists its examples by file name: an example is
// `examples/<page id>/<Name>.vue`, and its title, its optional note and its optional rule are the texts
// `ex.<page id>.<Name>`, `….note` and `….rule` in locales.ts. A page without examples shows that it is coming.
// The search looks through a page's title in both languages, its group, its keywords and its examples' titles.

export const GROUPS = ["foundations", "actions", "inputs", "display", "navigation", "canvas", "features"] as const;
export type GroupId = (typeof GROUPS)[number];

export interface PageDef {
  id: string;
  group: GroupId;
  /** Extra words the search finds the page by, in English. */
  keywords: string;
  examples: readonly string[];
}

export const PAGES = [
  // Foundations
  { id: "colours", group: "foundations", keywords: "color tokens theme palette swatches tailwind class hex background foreground primary fill", examples: ["Tokens", "TextOnSurface", "DoDont"] },
  { id: "text", group: "foundations", keywords: "typography fonts headings caption mono numbers size weight tabular case capitals sentence", examples: ["TypeScale", "Weights", "Numbers", "Capitals", "Mono"] },
  { id: "spacing", group: "foundations", keywords: "radius rounded corners nested gap padding margin scale grid depth shadow border surface elevation floating layer layers stack stacking sticky overlay", examples: ["Scale", "Radius", "NestedCorners", "Depth", "Elevation", "Layers"] },
  { id: "motion", group: "foundations", keywords: "animation duration ease curve spring transition timing reduced press play game shake flip confetti fall loop spin celebrate", examples: ["Curves", "Durations", "GameMotion", "Rules", "ReducedMotion"] },
  { id: "writing", group: "foundations", keywords: "texts words copy tone german english translation you du plain short friendly", examples: ["FewWords", "Descriptions", "PlainWords", "YouDu", "Names"] },
  // Actions
  { id: "buttons", group: "actions", keywords: "size scale small default large primary secondary ghost outline destructive danger remove link icon loading busy spinner copied saved done action progress install split group menu toggle tile tiles add card square text link inline entity name toolbar arrow keys strip bar floating header search filter", examples: ["Variants", "Bare", "Sizes", "SizeScale", "WithIcons", "TextLinks", "ActionButtons", "ProgressButtons", "ActionTiles", "IconOnly", "ToggleButtons", "SplitButtons", "Toolbar", "ToolbarBar", "ToolbarFields", "ToolbarFloating", "WideButtons"] },
  { id: "menus", group: "actions", keywords: "dropdown menu context right-click submenu actions icon description row async wait busy pending promise share copy clipboard picture image save png", examples: ["DescribedMenu", "Dropdown", "RightClick", "WaitingMenu", "Share"] },
  { id: "tooltips", group: "actions", keywords: "tooltip hover help readable keyboard shortcut arrow values rows divider disabled reason why off switched switch checkbox input select menu item card skin frame game effect stat icon unit portrait level pips spell column heading tag rarity badge corner meta width wide shared pin pinned workspace parts compose own toggle touch tap copied truncated align row tile hover inspect", examples: ["FromTitle", "OnDisabled", "Rich", "Options", "HoverRows", "Values", "Parts", "Shared", "ItemCards", "TallCard", "CardParts", "UnitCards", "DisabledReasons"] },
  { id: "popovers", group: "actions", keywords: "popover floating panel form anchor close focus suggestions autocomplete typing keeps ignore outside click", examples: ["WithField", "NoFocus"] },
  { id: "hovercards", group: "actions", keywords: "hover card interactive pin pinned preview link button close keyboard tab item card list", examples: ["Pinnable", "ManyTargets", "WithItemCard"] },
  { id: "dialogs", group: "actions", keywords: "dialog modal confirm delete rename name prompt busy footer size width wide narrow anchor top scroll dismiss escape discard unsaved", examples: ["NameDialogs", "ConfirmDialogs", "FooterButtons", "AskBeforeClosing", "DialogSizes", "LongDialog"] },
  { id: "toasts", group: "actions", keywords: "toast snackbar undo message notification status", examples: ["Kinds", "Loading", "WithButton", "DeleteWithUndo"] },
  // Inputs
  { id: "fields", group: "inputs", keywords: "bare edit in place inline title autosize grow quick add input textarea search clear escape magnifier label hint error invalid field aria describedby beside horizontal code one-time mono template placeholder braces insert highlight", examples: ["Basic", "Errors", "FieldControls", "FieldBeside", "Search", "Monospace", "Code", "TextArea", "InPlace", "Template"] },
  { id: "checks", group: "inputs", keywords: "checkbox tick strike done switch field label description row hover swatch count indeterminate some all", examples: ["Checkbox", "Switch", "SwitchField", "SwitchFieldEnd", "CheckboxField", "DoneItem"] },
  { id: "pick", group: "inputs", keywords: "radio field row value picture icon trigger auto height radio segmented fill full width stretch icon tooltip select empty choice none clear picker dropdown combobox autocomplete search pictures free text suggestions format groups badges filters tags tag input chips multi multiple token paste comma listbox list always open add palette command big search ctrl k busy spinner key hints", examples: ["RadioGroup", "RadioFields", "Segmented", "SegmentedFill", "SegmentedSliding", "SegmentedIcons", "SegmentedNone", "Select", "SelectDescribed", "SelectEmpty", "SelectPictures", "SelectValues", "Combobox", "ComboboxFree", "Tags", "TagFilter", "Picker", "PickerGroups", "Listbox", "ListboxChosen", "ListboxPalette", "PaletteParts", "DropdownIcons"] },
  { id: "numbers", group: "inputs", keywords: "slider range number field stepper quantity plus minus editable type reset value box", examples: ["Slider", "SliderField", "SliderSpoken", "NumberField"] },
  { id: "colour-stars", group: "inputs", keywords: "color colour picker swatch custom palette stars rating review score", examples: ["Swatches", "CustomColour", "StarsShown", "StarSizes", "StarsPick"] },
  { id: "dates", group: "inputs", keywords: "date day calendar month week today archive marks picker datum kalender tag monat", examples: ["PickDay", "DayMarks"] },
  { id: "boards", group: "inputs", keywords: "board slot slots grid tiles keyboard arrows roving tabindex focus pick locked hole wrap keys pane shortcut typing hotkey brett feld tasten", examples: ["Board", "Tiles", "PaneKeys"] },
  { id: "toggles", group: "inputs", keywords: "toggle pressed bold italic underline format group style tiles looks pictures ghost outline size small large", examples: ["Toggles", "ToggleSizes", "ToggleGroup", "StyleTiles"] },
  // Display
  { id: "status", group: "display", keywords: "numeric count compact small badge chip chips tag tags remove removable toggle filter pill status dot kbd shortcut keys", examples: ["Badges", "BadgeNumbers", "Chips", "StatusDot", "Keys"] },
  { id: "stats", group: "display", keywords: "stats statistics numbers tile tiles strip kpi value caption trend better worse facts fact list label value definition dl unit columns stacked bar bars chart distribution histogram guesses count per day share axis", examples: ["StatTiles", "StatOutlined", "StatLive", "Facts", "FactsStacked", "BarChart", "BarChartVertical", "BarChartEmpty"] },
  { id: "loading", group: "display", keywords: "progress spinner skeleton loading sparkline chart graph line time axis dates rating curve hover value count picture image fade game cover art box", examples: ["ProgressBar", "CountingNumbers", "Sparkline", "LineChart", "LineChartDates", "LineChartEmpty", "Spinner", "SkeletonCard", "LatePicture", "PictureEdge", "GameCovers"] },
  { id: "notices", group: "display", keywords: "notice alert callout info warning error success inline message empty state nothing placeholder no items action list start bare frame fill panel", examples: ["Notices", "Empty", "EmptyBare", "EmptyActions"] },
  { id: "cards", group: "display", keywords: "card surface box border panel tile header footer padding size interactive press link choice pick radio option picture media tick check multiple karte auswahl", examples: ["Card", "CardParts", "CardInteractive", "ChoiceCards", "CheckCards"] },
  { id: "lists", group: "display", keywords: "table rows columns sort sorted sticky compact density leaderboard group note tone numeric current grid data cells spreadsheet sheet fill handle frozen virtual header list stats compare row hover selected settings divider card add remove animated reorder drag drop slot target zone focus delete keyboard list row hit result place channel", examples: ["Table", "TableLeaderboard", "TableGroups", "TableFlush", "DataGrid", "DataGridReadOnly", "SelectableList", "ListRows", "AnimatedRows", "FocusAfterDelete", "ReorderRows", "DropLine", "DropOnSlots", "SettingRows"] },
  { id: "folding", group: "display", keywords: "expand collapse more less long text read clamp collapsible disclosure accordion details summary open close fold section force-mount height", examples: ["ShowMoreLong", "ShowMoreShort", "Collapsible", "CollapsibleDivider"] },
  // Navigation
  { id: "tabs", group: "navigation", keywords: "tabs views strip close closable reorder drag rename middle-click scroll overflow add list arrows hidden more", examples: ["Tabs", "TabStrip", "TabIcon", "TabsCrowded", "TabOverflow"] },
  { id: "navlist", group: "navigation", keywords: "nav list categories settings sidebar sections menu plates", examples: ["Grouped", "Plates"] },
  { id: "tree", group: "navigation", keywords: "tree view outline contents chapters folders branch expand collapse open close nested hierarchy chain levels indent guides", examples: ["Outline", "RichRows"] },
  // Canvas
  { id: "zoom", group: "canvas", keywords: "zoom pan drag pinch fit width scroll graph tree map canvas viewport double-click percent 100 whole extras view-only remember persist glide tooltip hide show hidden ausblenden einblenden", examples: ["WideContent", "AutoFitOff", "RememberView", "HideAndShow", "HundredExtras", "PersistView", "ViewOnly", "BoxTooltip", "FitWidth", "Bare"] },
  { id: "map", group: "canvas", keywords: "map tiles pins markers cluster group dots spawns highlight world game zoom fog layer", examples: ["TileMap"] },
  // Tavora features
  { id: "settings", group: "features", keywords: "align start top auto height module settings dialog overlay preview page reset saved control column row menu divider heading in game on stream dot status danger delete one single narrow description unit size", examples: ["OnePage", "SeveralPages", "ModuleSettings", "PreviewStart", "SettingsMenu"] },
  { id: "overlay-text", group: "features", keywords: "overlay stream obs game text box scroll marquee ticker loop shrink cut ellipsis fixed grows scale song now playing soft edges fade pause", examples: ["TextBox"] },
] as const satisfies readonly PageDef[];

export type PageId = (typeof PAGES)[number]["id"];
export const FIRST_PAGE: PageId = "colours";

export const isPageId = (value: unknown): value is PageId => PAGES.some((page) => page.id === value);
export const pageById = (id: PageId): PageDef => PAGES.find((page) => page.id === id)!;

/** Where a panel saved by the tabbed playground (0.1.x before the side menu) lands: the first page of its tab. */
export const OLD_TABS: Record<string, PageId> = { basics: "colours", actions: "buttons", inputs: "fields", display: "status", canvas: "zoom" };

/** Text keys for a page and its examples. */
export const keys = {
  group: (group: GroupId) => `group.${group}`,
  page: (id: string) => `page.${id}`,
  intro: (id: string) => `intro.${id}`,
  example: (page: string, name: string) => `ex.${page}.${name}`,
  note: (page: string, name: string) => `ex.${page}.${name}.note`,
  rule: (page: string, name: string) => `ex.${page}.${name}.rule`,
};

/** The words a page is found by: its title and its examples' titles (as `text` reads them), its group and keywords. */
export function searchText(page: PageDef, text: (key: string) => string | undefined): string {
  const words = [text(keys.page(page.id)), text(keys.group(page.group)), page.keywords, ...page.examples.map((name) => text(keys.example(page.id, name)))];
  return words.filter(Boolean).join(" ").toLowerCase();
}

/** Every word of the query has to be found, in any order. */
export function matches(haystack: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => haystack.includes(word));
}
