import { Blocks, Globe, Keyboard, Palette, Plug, SlidersHorizontal, Trash2 } from "@lucide/vue";
import type { MessageKey } from "../../../shared/i18n";
import { t } from "../../i18n";

// The section menu, in groups. New settings get a row in a section, or a
// new section here, rather than a longer page. Names come from the locale
// files: `settings.group.<id>` and `settings.section.<id>`.
export const GROUPS = [
  {
    id: "tavora",
    sections: [
      { id: "general", icon: SlidersHorizontal },
      { id: "appearance", icon: Palette },
      { id: "modules", icon: Blocks },
      { id: "browser", icon: Globe },
      { id: "integrations", icon: Plug },
      { id: "shortcuts", icon: Keyboard },
    ],
  },
  { id: "library", sections: [{ id: "trash", icon: Trash2 }] },
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
  ["startup", "general"],
  ["sort", "general"],
  ["language", "general"],
  ["grayscale-text", "general"],
  ["online-search", "general"],
  ["auto-update", "general"],
  ["check-updates", "general"],
  ["backups", "general"],
  ["diagnostics", "general"],
  ["steam-icons", "general"],
  ["theme", "appearance"],
  ["appearance-mode", "appearance"],
  ["theme-variation", "appearance"],
  ["own-themes", "appearance"],
  ["reset-theme", "appearance"],
  ["module-icons", "appearance"],
  ["share-icons", "general"],
  ["steam-import", "integrations"],
  ["own-modules", "modules"],
  ["module-files", "modules"],
  ["installed-modules", "modules"],
  ["browser-shared-sites", "browser"],
  ["browser-adblock-off", "browser"],
  ["browser-clear-game", "browser"],
  ["browser-clear-shared", "browser"],
  ["discord-connection", "integrations"],
  ["ai-usage-accounts", "integrations"],
  ["ai-usage-interval", "integrations"],
  ["ai-usage-style", "integrations"],
  ["shortcuts", "shortcuts"],
  ["welcome-tour", "general"],
  ["trash", "trash"],
];

export interface SettingEntry {
  id: string;
  section: SettingsSection;
  label: string;
  description: string;
  /** Other words players might search for, in the current language. */
  keywords: string[];
}

/** The searchable settings, worded in the current language. */
export function settingEntries(): SettingEntry[] {
  return SETTING_SECTIONS.map(([id, section]) => ({
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
