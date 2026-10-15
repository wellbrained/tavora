import { Keyboard, SlidersHorizontal, Trash2 } from "@lucide/vue";

// The section menu, in groups. New settings get a row in a section, or a
// new section here, rather than a longer page.
export const GROUPS = [
  {
    label: "Tavora",
    sections: [
      { id: "general", label: "General", icon: SlidersHorizontal },
      { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard },
    ],
  },
  { label: "Library", sections: [{ id: "trash", label: "Trash", icon: Trash2 }] },
] as const;

/**
 * The patch notes are a page of their own, opened only by pressing the version
 * at the bottom of the sections list. They are not in the menu and not found by
 * the Settings search or Ctrl+K.
 */
export const PATCH_NOTES_SECTION = "patch-notes";

export type SettingsSection = (typeof GROUPS)[number]["sections"][number]["id"] | typeof PATCH_NOTES_SECTION;

export const SECTION_LABEL: Record<SettingsSection, string> = {
  ...(Object.fromEntries(GROUPS.flatMap((group) => group.sections.map((section) => [section.id, section.label]))) as Record<
    Exclude<SettingsSection, typeof PATCH_NOTES_SECTION>,
    string
  >),
  [PATCH_NOTES_SECTION]: "Patch notes",
};

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
      "Finds more games than the built-in list on the Tavora service, and lets Tavora ask it for the icons of your games. It sees the text you type and which icons are asked for, keeps no log and knows nothing that identifies you. Turn it off to use the built-in games and your own icons only.",
    keywords: ["internet", "network", "privacy", "offline", "database", "service", "online"],
  },
  {
    id: "auto-update",
    section: "general",
    label: "Download updates automatically",
    description: "New versions of Tavora download in the background and install when you close the app. Turn it off to choose when to download.",
    keywords: ["update", "updates", "upgrade", "new version", "download", "install", "automatic"],
  },
  {
    id: "check-updates",
    section: "general",
    label: "Check for updates",
    description: "Ask the update server right now whether there is a newer version of Tavora, without waiting for the next automatic check.",
    keywords: ["update", "updates", "upgrade", "new version", "check now", "latest"],
  },
  {
    id: "steam-icons",
    section: "general",
    label: "Game icons from this PC and Steam",
    description:
      "Uses each game's own icon. Tavora reads it from the installed game on this PC (Battle.net, Epic, GOG, EA and other launchers), then from the Steam folder, then from the icons the Tavora service hosts (only while Online game search is on), and last downloads Steam's small icon for the game from Steam. Icons are kept on this PC. Games without an icon, and any image you pick yourself, are not affected. Turn it off to use the plain badges.",
    keywords: ["icon", "ico", "image", "picture", "download", "internet", "network", "privacy", "offline", "badge", "steam", "battle.net", "epic", "gog", "launcher", "installed"],
  },
  {
    id: "shortcuts",
    section: "shortcuts",
    label: "Keyboard shortcuts",
    description: "Every shortcut Tavora has. Ctrl+/ opens this list from anywhere.",
    keywords: ["keys", "hotkeys", "keyboard", "ctrl", "keybindings"],
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
