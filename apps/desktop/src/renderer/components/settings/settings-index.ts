import { Keyboard, ScrollText, SlidersHorizontal, Trash2 } from "@lucide/vue";

// The section menu, in groups. New settings get a row in a section, or a
// new section here, rather than a longer page.
export const GROUPS = [
  {
    label: "Tavora",
    sections: [
      { id: "general", label: "General", icon: SlidersHorizontal },
      { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard },
      { id: "patch-notes", label: "Patch notes", icon: ScrollText },
    ],
  },
  { label: "Library", sections: [{ id: "trash", label: "Trash", icon: Trash2 }] },
] as const;

export type SettingsSection = (typeof GROUPS)[number]["sections"][number]["id"];

export const SECTION_LABEL: Record<SettingsSection, string> = Object.fromEntries(
  GROUPS.flatMap((group) => group.sections.map((section) => [section.id, section.label])),
) as Record<SettingsSection, string>;

/**
 * Every setting the Settings search and Ctrl+K can find. A row in
 * SettingsDialog with `data-setting` set to an id here is where a result
 * leads; add both together.
 */
export interface SettingEntry {
  id: string;
  section: SettingsSection;
  label: string;
  description: string;
  /** Other words players might search for. */
  keywords: string[];
}

export const SETTINGS: SettingEntry[] = [
  {
    id: "startup",
    section: "general",
    label: "When Tavora starts",
    description: "Show Home, or go straight back to the game you played last.",
    keywords: ["startup", "launch", "open", "home", "last game"],
  },
  {
    id: "sort",
    section: "general",
    label: "Game list order",
    description: "How games are sorted on the rail. In your own order, drag games to arrange them.",
    keywords: ["sort", "rail", "recently played", "manual", "order"],
  },
  {
    id: "grayscale-text",
    section: "general",
    label: "Grayscale text",
    description: "Smooths text without colour fringes. Turn it on if text looks blurry on an OLED screen. Applies after a restart.",
    keywords: ["oled", "cleartype", "font", "blurry", "sharp", "crisp", "antialiasing", "display"],
  },
  {
    id: "online-search",
    section: "general",
    label: "Online game search",
    description:
      "Finds more games than the built-in list on the Tavora service. It sees the text you type and nothing that identifies you. Turn it off to use the built-in games only.",
    keywords: ["internet", "network", "privacy", "offline", "database", "service", "online"],
  },
  {
    id: "shortcuts",
    section: "shortcuts",
    label: "Keyboard shortcuts",
    description: "Every shortcut Tavora has. Ctrl+/ opens this list from anywhere.",
    keywords: ["keys", "hotkeys", "keyboard", "ctrl", "keybindings"],
  },
  {
    id: "patch-notes",
    section: "patch-notes",
    label: "Patch notes",
    description: "What changed in each version of Tavora, newest first.",
    keywords: ["changelog", "changes", "version", "release notes", "what's new", "update"],
  },
  {
    id: "welcome-tour",
    section: "general",
    label: "Welcome tour",
    description: "The short introduction Tavora shows on its first start: your profile, your first games and a few tips.",
    keywords: ["onboarding", "first run", "intro", "tutorial", "tips", "start"],
  },
  {
    id: "trash",
    section: "trash",
    label: "Trash",
    description: "Removed games and all their data stay here for 30 days, then they are deleted for good.",
    keywords: ["deleted", "removed", "restore", "bin"],
  },
];
