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
  { id: "colours", group: "foundations", keywords: "color tokens theme palette swatches", examples: ["Tokens"] },
  { id: "text", group: "foundations", keywords: "typography fonts headings caption mono numbers link size weight", examples: ["TypeScale", "MonoNumbersLinks"] },
  { id: "spacing", group: "foundations", keywords: "radius rounded corners gap padding", examples: ["Corners"] },
  { id: "motion", group: "foundations", keywords: "animation duration ease curve transition", examples: [] },
  { id: "writing", group: "foundations", keywords: "texts words tone german english translation", examples: [] },
  // Actions
  { id: "buttons", group: "actions", keywords: "primary secondary ghost outline destructive danger remove link icon loading progress install split group menu toggle", examples: ["Variants", "Sizes", "WithIcons", "ProgressButtons", "IconOnly", "ToggleButtons", "SplitButtons"] },
  { id: "menus", group: "actions", keywords: "dropdown menu context right-click submenu actions icon description row", examples: ["DescribedMenu", "Dropdown", "RightClick"] },
  { id: "tooltips", group: "actions", keywords: "tooltip hover help readable keyboard shortcut arrow values rows divider disabled", examples: ["FromTitle", "OnDisabled", "Rich", "Values"] },
  { id: "popovers", group: "actions", keywords: "popover floating panel form anchor close", examples: ["WithField"] },
  { id: "dialogs", group: "actions", keywords: "dialog modal confirm delete rename name prompt busy footer scroll", examples: ["NameDialogs", "ConfirmDialogs", "FooterButtons", "LongDialog"] },
  { id: "toasts", group: "actions", keywords: "toast snackbar undo message notification status", examples: ["Kinds", "Loading", "WithButton"] },
  // Inputs
  { id: "fields", group: "inputs", keywords: "input textarea search clear escape magnifier label hint error invalid code one-time mono", examples: ["Basic", "Errors", "Search", "Monospace", "Code", "TextArea"] },
  { id: "checks", group: "inputs", keywords: "checkbox tick strike done switch field label description", examples: ["Checkbox", "Switch", "SwitchField", "DoneItem"] },
  { id: "pick", group: "inputs", keywords: "radio segmented select empty choice none clear picker dropdown combobox autocomplete search pictures", examples: ["RadioGroup", "Segmented", "SegmentedSliding", "SegmentedNone", "Select", "SelectDescribed", "SelectEmpty", "SelectPictures", "Combobox", "Picker", "DropdownIcons"] },
  { id: "numbers", group: "inputs", keywords: "slider range number field stepper quantity plus minus", examples: ["Slider", "SliderField", "NumberField"] },
  { id: "colour-stars", group: "inputs", keywords: "color colour picker swatch custom palette stars rating review score", examples: ["Swatches", "CustomColour", "StarsShown", "StarSizes", "StarsPick"] },
  { id: "toggles", group: "inputs", keywords: "toggle pressed bold italic underline format group style tiles looks pictures", examples: ["Toggles", "ToggleGroup", "StyleTiles"] },
  // Display
  { id: "status", group: "display", keywords: "badge chip tag status dot kbd shortcut keys", examples: ["Badges", "StatusDot", "Keys"] },
  { id: "loading", group: "display", keywords: "progress spinner skeleton loading sparkline chart graph line count picture image fade", examples: ["ProgressBar", "CountingNumbers", "Sparkline", "Spinner", "SkeletonCard", "LatePicture"] },
  { id: "notices", group: "display", keywords: "notice alert callout info warning error success inline message empty state nothing placeholder no items action list start", examples: ["Notices", "Empty", "EmptyActions"] },
  { id: "lists", group: "display", keywords: "table rows columns grid data cells header list stats compare row hover selected settings divider card add remove animated", examples: ["Table", "SelectableList", "AnimatedRows", "SettingRows", "Card"] },
  { id: "folding", group: "display", keywords: "expand collapse more less long text read clamp collapsible disclosure accordion details summary open close fold section force-mount height", examples: ["ShowMoreLong", "ShowMoreShort", "Collapsible", "CollapsibleDivider"] },
  // Navigation
  { id: "tabs", group: "navigation", keywords: "tabs views strip close closable reorder drag rename middle-click scroll overflow add", examples: ["Tabs", "TabStrip", "TabIcon", "TabsCrowded"] },
  { id: "navlist", group: "navigation", keywords: "nav list categories settings sidebar sections menu plates", examples: ["Grouped", "Plates"] },
  // Canvas
  { id: "zoom", group: "canvas", keywords: "zoom pan drag pinch fit width scroll graph tree map canvas viewport", examples: ["WideContent", "AutoFitOff", "RememberView", "FitWidth"] },
  { id: "map", group: "canvas", keywords: "map tiles pins markers cluster group dots spawns highlight world game zoom fog layer", examples: ["TileMap"] },
  // Tavora features
  { id: "settings", group: "features", keywords: "module settings dialog overlay preview page reset saved control column row", examples: ["ModuleSettings"] },
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
