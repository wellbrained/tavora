import { Blocks, Keyboard, Palette, SlidersHorizontal, Trash2 } from "@lucide/vue";

// The section menu, in groups. New settings get a row in a section, or a
// new section here, rather than a longer page.
export const GROUPS = [
  {
    label: "Tavora",
    sections: [
      { id: "general", label: "General", icon: SlidersHorizontal },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "modules", label: "Modules", icon: Blocks },
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
    id: "backups",
    section: "general",
    label: "Backups",
    description: "Tavora keeps a copy of your games, layouts, notes and settings from the last 7 days, made when it first starts each day. Open the folder to go back.",
    keywords: ["backup", "restore", "copy", "recover", "undo", "data", "safety", "export"],
  },
  {
    id: "diagnostics",
    section: "general",
    label: "Diagnostic info",
    description: "Copy version, system, timings, update log and last errors to share when something goes wrong.",
    keywords: ["diagnostic", "debug", "bug", "problem", "error", "log", "report", "support", "help", "copy", "version", "slow", "performance"],
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
    id: "theme",
    section: "appearance",
    label: "Theme",
    description: "How Tavora looks: its colours and corners. Modules get the same colours.",
    keywords: ["theme", "colour", "color", "look", "style", "dark", "palette", "skin", "appearance"],
  },
  {
    id: "appearance-mode",
    section: "appearance",
    label: "Light or dark",
    description: "Follow System, or stay in Dark or Light. Follow System switches with your system's setting.",
    keywords: ["follow system", "system", "automatic", "auto", "dark", "light", "dark mode", "light mode", "night", "day", "os", "windows", "mac"],
  },
  {
    id: "theme-variation",
    section: "appearance",
    label: "Variation",
    description: "Dark or Light, in the versions the theme comes in.",
    keywords: ["variation", "variant", "dark", "light", "dark mode", "light mode", "bright"],
  },
  {
    id: "own-themes",
    section: "appearance",
    label: "Your own themes",
    description: "Start from a copy of the Tavora theme, change its colours in tavora.theme.json, then press Reload.",
    keywords: ["custom theme", "make a theme", "create theme", "new theme", "example", "starter", "template", "folder", "tavora.theme.json", "reload", "developer"],
  },
  {
    id: "reset-theme",
    section: "appearance",
    label: "Reset to Tavora Default",
    description: "Go back to Tavora's own look, whatever theme is active.",
    keywords: ["reset", "default", "restore", "undo", "original"],
  },
  {
    id: "share-icons",
    section: "general",
    label: "Share game icons",
    description:
      "Offer the icons your PC has for games Tavora does not have an icon for yet. You choose which, and see exactly what is sent. A person at Tavora checks each one before anyone else sees it. Needs Online game search.",
    keywords: ["icon", "share", "upload", "send", "contribute", "offer", "missing", "logo", "help"],
  },
  {
    id: "steam-import",
    section: "general",
    label: "Import from Steam",
    description:
      "Add the games you own on Steam, by pasting your profile link. You see the list first and choose which to add. Tavora does not start games. Needs Online game search.",
    keywords: ["steam", "import", "library", "games", "profile", "add", "valve"],
  },
  {
    id: "own-modules",
    section: "modules",
    label: "Your own modules",
    description:
      "Put a module's folder into your modules folder, then press Reload. Only add modules from people you trust: a module runs on your PC and can see the game it is opened in.",
    keywords: ["module", "modules", "folder", "reload", "install", "add", "plugin", "extension"],
  },
  {
    id: "installed-modules",
    section: "modules",
    label: "Installed modules",
    description: "Every module Tavora found, where it came from, and a way to remove the ones in your own folder.",
    keywords: ["module", "modules", "installed", "remove", "uninstall", "delete", "notes", "to-dos", "list"],
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
