// The playground's groups and the sections inside them. A group is one tab;
// the filter looks through all sections, whichever group they are in.
export const GROUPS = [
  { id: "basics", title: "Basics" },
  { id: "actions", title: "Actions" },
  { id: "inputs", title: "Inputs" },
  { id: "display", title: "Display" },
  { id: "canvas", title: "Canvas" },
] as const;
export type GroupId = (typeof GROUPS)[number]["id"];

export const SECTIONS = [
  { id: "colours", group: "basics", title: "Colours", keywords: "tokens theme palette swatches radius" },
  { id: "type", group: "basics", title: "Typography", keywords: "text fonts headings caption mono numbers link" },
  { id: "buttons", group: "actions", title: "Buttons", keywords: "primary secondary ghost outline destructive danger remove link icon loading split group menu" },
  { id: "tooltips", group: "actions", title: "Tooltips", keywords: "tooltip hover help readable keyboard shortcut arrow values rows divider" },
  { id: "menus", group: "actions", title: "Menus", keywords: "dropdown menu context right-click submenu actions" },
  { id: "popovers", group: "actions", title: "Popovers", keywords: "popover floating panel form anchor close" },
  { id: "toasts", group: "actions", title: "Toasts", keywords: "toast snackbar undo message notification status" },
  { id: "dialogs", group: "actions", title: "Dialogs", keywords: "dialog modal confirm delete" },
  { id: "fields", group: "inputs", title: "Text fields", keywords: "input textarea search label hint error invalid code one-time" },
  { id: "choices", group: "inputs", title: "Choices", keywords: "checkbox switch radio segmented select picker dropdown combobox autocomplete search slider" },
  { id: "ratings", group: "inputs", title: "Star rating", keywords: "stars rating review score" },
  { id: "colors", group: "inputs", title: "Colour picker", keywords: "color colour swatch custom palette" },
  { id: "toggles", group: "inputs", title: "Toggle buttons", keywords: "toggle pressed bold italic underline format group style tiles looks pictures" },
  { id: "status", group: "display", title: "Badges and status", keywords: "badge chip tag status dot kbd shortcut" },
  { id: "progress", group: "display", title: "Progress, charts and loading", keywords: "progress spinner skeleton loading sparkline chart graph line" },
  { id: "notices", group: "display", title: "Notices", keywords: "notice alert callout info warning error success inline message" },
  { id: "empty", group: "display", title: "Empty state", keywords: "empty state nothing placeholder no items" },
  { id: "expandable", group: "display", title: "Show more", keywords: "expand collapse more less long text read clamp" },
  { id: "collapsible", group: "display", title: "Collapsible sections", keywords: "collapsible disclosure accordion details summary open close fold section notes" },
  { id: "tabs", group: "display", title: "Tabs", keywords: "tabs views" },
  { id: "navlist", group: "display", title: "Side navigation", keywords: "nav list categories settings sidebar sections menu" },
  { id: "lists", group: "display", title: "Lists and rows", keywords: "list row hover selected settings divider card" },
  { id: "settings", group: "display", title: "Module settings", keywords: "settings dialog overlay preview page reset saved control column row" },
  { id: "zoom", group: "canvas", title: "Pan and zoom", keywords: "zoom pan drag pinch fit width scroll graph tree map canvas viewport" },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

export const sectionTitle = (id: SectionId) => SECTIONS.find((section) => section.id === id)!.title;
