import { Blocks, CodeXml, Gamepad2, Globe, House, Keyboard, Package, Palette, PictureInPicture2, Plug, SlidersHorizontal } from "@lucide/vue";
import type { MessageKey } from "../../../shared/i18n";
import { t } from "../../i18n";

// The section menu, in groups. It stays short on purpose, so it fits a normal window without scrolling: a new setting
// gets a row or a block on a page, and a long list opens inside its row or as a page of its own (SUB_PAGES). Names
// come from the locale files: `settings.group.<id>` and `settings.section.<id>`. Each group is a plate in a colour of
// its own (SettingsDialog.vue), with its icon beside the heading.
export const GROUPS = [
  {
    id: "app",
    icon: House,
    sections: [
      { id: "general", icon: SlidersHorizontal },
      { id: "appearance", icon: Palette },
      { id: "games", icon: Gamepad2 },
      { id: "shortcuts", icon: Keyboard },
    ],
  },
  {
    id: "modules",
    icon: Blocks,
    sections: [
      { id: "modules", icon: Blocks },
      { id: "connections", icon: Plug },
      { id: "overlays", icon: PictureInPicture2 },
      { id: "browser", icon: Globe },
    ],
  },
  // For module developers: one entry, its pages are tabs (DEVELOPER_TABS). Players see it as Make modules until they
  // start; the badge counts what waits for Publish.
  {
    id: "development",
    icon: CodeXml,
    sections: [{ id: "development", icon: Package }],
  },
] as const;

/** About & updates sits at the foot of the menu, beside the version. */
export const ABOUT_SECTION = "about";

/** Pages that open from a row on another page, with a way back; their parent stays lit in the menu. */
export const SUB_PAGES = { workspaces: "games", trash: "games", "patch-notes": "about" } as const;

/** The patch notes open from About & updates or the version; the search doesn't find them. */
export const PATCH_NOTES_SECTION = "patch-notes";

/** The developer pages, as tabs under one menu entry. The first is Your modules. */
export const DEVELOPER_TABS = ["development", "dev-folders", "dev-publishing", "dev-help"] as const;

export type SettingsSection = (typeof GROUPS)[number]["sections"][number]["id"] | typeof ABOUT_SECTION | keyof typeof SUB_PAGES | (typeof DEVELOPER_TABS)[number];

/** The developer tabs after Your modules; opening one counts as starting to make modules. */
export const DEVELOPER_SECTIONS = ["dev-folders", "dev-publishing", "dev-help"] as const satisfies readonly SettingsSection[];

/** Where a search result can lead: a Settings page, or the account, which lives in the profile dialog. */
export type SettingsPlace = SettingsSection | "account";

/** The menu entry lit for a page: its own, its parent's for a sub-page, Developer for every developer tab. */
export function menuEntry(section: SettingsSection): SettingsSection {
  if (section in SUB_PAGES) return SUB_PAGES[section as keyof typeof SUB_PAGES];
  if ((DEVELOPER_TABS as readonly string[]).includes(section)) return "development";
  return section;
}

/** A page's own name. Your modules is Make modules for someone who doesn't make modules yet (`makesModules`). */
export const sectionLabel = (section: SettingsPlace, makesModules = true): string =>
  t((section === "development" && !makesModules ? "settings.section.development-start" : `settings.section.${section}`) as MessageKey);

/** The name in the menu and the page header: one name for all developer tabs. */
export const menuLabel = (section: SettingsSection, makesModules = true): string =>
  menuEntry(section) === "development" ? t(makesModules ? "settings.nav.development" : "settings.section.development-start") : sectionLabel(section, makesModules);

export const groupLabel = (group: (typeof GROUPS)[number]["id"]): string => t(`settings.group.${group}` as MessageKey);

/**
 * Every setting the Settings search and Ctrl+K can find, with the page it
 * is on, in the order they rank on a tie. A row with `data-setting` set to an
 * id here is where a result leads; add both together, and the texts
 * `settings.<id>.label`, `.search` and `.keywords` to the locale files.
 */
export const SETTING_SECTIONS: readonly (readonly [id: string, section: SettingsPlace])[] = [
  ["account", "account"],
  ["language", "general"],
  ["startup", "general"],
  ["welcome-tour", "general"],
  ["theme", "appearance"],
  ["appearance-mode", "appearance"],
  ["theme-variation", "appearance"],
  ["corner-radius", "appearance"],
  ["module-icons", "appearance"],
  ["toasts", "appearance"],
  ["grayscale-text", "appearance"],
  ["own-themes", "appearance"],
  ["reset-theme", "appearance"],
  ["game-start", "games"],
  ["game-end", "games"],
  ["sort", "games"],
  ["steam-import", "games"],
  ["online-search", "games"],
  ["steam-icons", "games"],
  ["share-icons", "games"],
  ["auto-update", "about"],
  ["app-version", "about"],
  ["check-updates", "about"],
  ["backups", "about"],
  ["diagnostics", "about"],
  ["installed-modules", "modules"],
  ["own-modules", "modules"],
  ["auto-update-modules", "modules"],
  ["module-files", "modules"],
  ["module-grants", "connections"],
  ["discord-connection", "connections"],
  ["ai-usage-accounts", "connections"],
  ["system-info", "connections"],
  ["media", "connections"],
  ["leaderboards", "connections"],
  ["game-overlays", "overlays"],
  ["overlay-layer-key", "overlays"],
  ["overlays-stay", "overlays"],
  ["overlay-sidebar", "overlays"],
  ["stream-overlays", "overlays"],
  ["overlay-port", "overlays"],
  ["overlay-links", "overlays"],
  ["hotkeys", "overlays"],
  ["browser-shared-sites", "browser"],
  ["browser-adblock-off", "browser"],
  ["browser-clear-workspace", "browser"],
  ["browser-clear-shared", "browser"],
  ["module-contact", "development"],
  ["development-folders", "dev-folders"],
  ["module-developer", "dev-publishing"],
  ["contact-default", "dev-publishing"],
  ["publish-ci", "dev-publishing"],
  ["development-examples", "dev-help"],
  ["developer-docs", "dev-help"],
  ["shortcuts", "shortcuts"],
  ["workspaces", "workspaces"],
  ["trash", "trash"],
];

/**
 * Settings that are new, with the version they came in. Their row says New, and their page has a dot in the menu,
 * until the user has seen the page (new-settings.ts). Add a setting here when it ships; old entries can go once
 * nobody runs a version from before them.
 */
export const NEW_SETTINGS: readonly (readonly [id: string, since: string])[] = [];

export interface SettingEntry {
  id: string;
  section: SettingsPlace;
  label: string;
  description: string;
  /** Other words users might search for, in the current language. */
  keywords: string[];
}

/** The searchable settings, worded in the current language, leaving out pages and settings that are hidden here. */
export function settingEntries(hidden: ReadonlySet<SettingsPlace> = new Set(), hiddenIds: ReadonlySet<string> = new Set()): SettingEntry[] {
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
