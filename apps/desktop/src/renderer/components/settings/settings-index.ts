import { Blocks, Cloud, FolderCode, Globe, Info, Keyboard, LayoutGrid, Palette, PictureInPicture2, Plug, Radio, SlidersHorizontal, Trash2, UserRound } from "@lucide/vue";
import type { MessageKey } from "../../../shared/i18n";
import { t } from "../../i18n";

// The section menu, in groups. New settings get a row in a section, or a
// new section here, rather than a longer page. Names come from the locale
// files: `settings.group.<id>` and `settings.section.<id>`.
export const GROUPS = [
  {
    id: "app",
    sections: [
      { id: "account", icon: UserRound },
      { id: "general", icon: SlidersHorizontal },
      { id: "appearance", icon: Palette },
      { id: "online", icon: Cloud },
      { id: "shortcuts", icon: Keyboard },
      { id: "about", icon: Info },
    ],
  },
  {
    id: "modules",
    sections: [
      { id: "modules", icon: Blocks },
      { id: "integrations", icon: Plug },
      { id: "streaming", icon: Radio },
      { id: "overlays", icon: PictureInPicture2 },
      { id: "browser", icon: Globe },
      { id: "development", icon: FolderCode },
    ],
  },
  {
    id: "library",
    sections: [
      { id: "workspaces", icon: LayoutGrid },
      { id: "trash", icon: Trash2 },
    ],
  },
] as const;

/**
 * The patch notes are a page of their own, opened only by pressing the version
 * at the bottom of the sections list. They are not in the menu and not found by
 * the Settings search or Ctrl+K.
 */
export const PATCH_NOTES_SECTION = "patch-notes";

export type SettingsSection = (typeof GROUPS)[number]["sections"][number]["id"] | typeof PATCH_NOTES_SECTION;

export const sectionLabel = (section: SettingsSection): string => t(`settings.section.${section}` as MessageKey);
export const groupLabel = (group: (typeof GROUPS)[number]["id"]): string => t(`settings.group.${group}` as MessageKey);

/**
 * Every setting the Settings search and Ctrl+K can find, with the section it
 * is on, in the order they rank on a tie. A row in SettingsDialog with
 * `data-setting` set to an id here is where a result leads; add both
 * together, and the texts `settings.<id>.label`, `.search` and `.keywords`
 * to the locale files.
 */
export const SETTING_SECTIONS: readonly (readonly [id: string, section: SettingsSection])[] = [
  ["account", "account"],
  ["language", "general"],
  ["startup", "general"],
  ["game-start", "general"],
  ["game-end", "general"],
  ["sort", "general"],
  ["welcome-tour", "general"],
  ["theme", "appearance"],
  ["appearance-mode", "appearance"],
  ["theme-variation", "appearance"],
  ["module-icons", "appearance"],
  ["grayscale-text", "appearance"],
  ["own-themes", "appearance"],
  ["reset-theme", "appearance"],
  ["online-search", "online"],
  ["steam-icons", "online"],
  ["share-icons", "online"],
  ["auto-update", "about"],
  ["app-version", "about"],
  ["check-updates", "about"],
  ["backups", "about"],
  ["diagnostics", "about"],
  ["installed-modules", "modules"],
  ["own-modules", "modules"],
  ["auto-update-modules", "modules"],
  ["module-grants", "modules"],
  ["module-files", "modules"],
  ["discord-connection", "integrations"],
  ["steam-import", "workspaces"],
  ["ai-usage-accounts", "integrations"],
  ["stream-overlays", "streaming"],
  ["overlay-port", "streaming"],
  ["overlay-links", "streaming"],
  ["hotkeys", "streaming"],
  ["game-overlays", "overlays"],
  ["overlays-stay", "overlays"],
  ["overlay-layer-key", "overlays"],
  ["overlay-hide-all", "overlays"],
  ["overlay-layout", "overlays"],
  ["browser-shared-sites", "browser"],
  ["browser-adblock-off", "browser"],
  ["browser-clear-workspace", "browser"],
  ["browser-clear-shared", "browser"],
  ["development-folders", "development"],
  ["development-examples", "development"],
  ["module-developer", "development"],
  ["publish-ci", "development"],
  ["developer-docs", "development"],
  ["shortcuts", "shortcuts"],
  ["workspaces", "workspaces"],
  ["trash", "trash"],
];

export interface SettingEntry {
  id: string;
  section: SettingsSection;
  label: string;
  description: string;
  /** Other words users might search for, in the current language. */
  keywords: string[];
}

/** The searchable settings, worded in the current language, leaving out sections and settings that are hidden here. */
export function settingEntries(hidden: ReadonlySet<SettingsSection> = new Set(), hiddenIds: ReadonlySet<string> = new Set()): SettingEntry[] {
  return SETTING_SECTIONS.filter(([id, section]) => !hidden.has(section) && !hiddenIds.has(id)).map(([id, section]) => ({
    id,
    section,
    label: t(`settings.${id}.label` as MessageKey),
    description: t(`settings.${id}.search` as MessageKey),
    keywords: t(`settings.${id}.keywords` as MessageKey)
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean),
  }));
}
