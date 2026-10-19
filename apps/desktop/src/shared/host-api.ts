import type { Language, LanguageSetting, MessageKey } from "./i18n";
// Contract between the trusted host UI (renderer) and the main process.
// Types only: imported by both sides, so it must not import Electron or Node.
import type { IconTone } from "./icon-tone";
import type { LayoutTemplateId } from "./layout-templates";

/**
 * loading: the page is loading. ready: loaded and running. failed: the page
 * could not be loaded. unresponsive: the page stopped answering and may
 * recover. crashed: the renderer is gone until the panel is reloaded.
 */
/** `unavailable`: the module no longer offers this panel's type, so nothing runs in it. */
export type InstanceStatus = "loading" | "ready" | "failed" | "unresponsive" | "crashed" | "unavailable";

export type Screen = "welcome" | "game";
export type RootSort = "recent" | "manual";
export type Startup = "welcome" | "last-game";
/** What Tavora does when a game of the library starts: switch to it, ask, only mark it on the rail, or not look at all. */
export type GameStart = "switch" | "ask" | "show" | "off";
export type RootItem = { kind: "game"; id: string } | { kind: "folder"; id: string };

export type IconView = { kind: "monogram"; text: string } | { kind: "image"; url: string };

/** Tavora's own pages for module developers that Settings > Development opens in the browser. */
export type DeveloperLink = "docs" | "discussions" | "issue";

/** Why a development project did not load, for the fix Settings suggests. */
export type DevelopmentProblemKind = "not-built" | "no-module" | "missing";

/** One version of a module's patch notes, as its changelog file says; plain text. */
export interface ModuleNote {
  version: string;
  date?: string;
  notes: string[];
}

export interface GameView {
  id: string;
  /** A game, or a personal workspace that belongs to no game. */
  kind: "game" | "workspace";
  name: string;
  icon: IconView;
  /**
   * The game's own icon (a file kept on this PC, from the installed game or Steam, as an address in the
   * host's own protocol), or null. Shown only while the player has not picked
   * an image and the setting is on; the host UI sets it on a tile.
   */
  steamIcon: string | null;
  /** How that icon sits in its tile: filling it, or on a light or dark backdrop (see shared/icon-tone.ts). Null without an icon. */
  steamIconTone: IconTone | null;
  /** What the player chose: the game's own icon, their letters, or their own image. */
  iconChoice: "original" | "letters" | "image";
  /**
   * The game's own icon from this PC or Steam, as an address, when Tavora does not have an icon for the game
   * yet and the player could offer this one; otherwise null. Never the player's own picture.
   */
  shareIcon: string | null;
  /** Picked from the built-in list rather than added by name. */
  builtIn: boolean;
  addedAt: string;
  lastPlayedAt: string | null;
  /** The game is running on this PC (main/game-watch.ts); always false while that is off. */
  running: boolean;
}

export interface FolderView {
  id: string;
  name: string;
  /** Up to three characters shown instead of the icon collage. */
  label: string | null;
  games: string[];
}

export interface PanelView {
  instanceId: string;
  moduleId: string;
  /** Which of the module's panel types this is; null for a module without types. */
  panelType: string | null;
  /** The tab's name: the panel type's short name, or the module's name. */
  name: string;
  status: InstanceStatus;
  /** A module panel whose page is still loading: the host UI shows a loader in its place. */
  waiting: boolean;
  /** The full name of what the panel shows, as the module last set it (panel.setContent); the tab's hover text. */
  content: string | null;
  /** Set for Browser panels: what their toolbar shows. */
  browser?: BrowserState;
  /** A Browser tab opened from another one: docked beside it, and left in the background when asked. */
  openedFrom?: { instanceId: string; background: boolean };
}

/** One of a module's named panel types, as Add module and the tabs show it. */
export interface PanelTypeView {
  id: string;
  name: string;
  /** The type's own icon (or the module's) as a data address, or null. */
  icon: string | null;
  minWidth: number;
  minHeight: number;
}

/** A Browser panel's page, as its toolbar shows it. Nothing here comes from the page but its title. */
export interface BrowserState {
  /** The page's address; empty before anything was opened. */
  url: string;
  /** The page's host as the toolbar shows it (punycode for lookalike scripts). */
  host: string;
  title: string;
  /** https, so the toolbar shows no "Not secure". */
  secure: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The site the page belongs to (its registrable domain), or null. */
  site: string | null;
  /** The page uses the sign-in shared by all games, rather than this game's own. */
  shared: boolean;
  /** Ad blocking is on for this site. */
  adblock: boolean;
  /** Ads and trackers blocked on this page. */
  blocked: number;
  /** Why the page is not shown, or null; the host UI words it. */
  error: BrowserError | null;
  /** A video or other element fills the page view. */
  fullscreen: boolean;
  audible: boolean;
  muted: boolean;
  /** Counts refused downloads, so the host UI can say so each time one is refused. */
  downloadsRefused: number;
}

/**
 * The Discord connector's connection. off: no module panel uses it. signed-out:
 * Tavora was never approved, or the player signed out. not-running: the Discord
 * app was not found (Tavora keeps looking). approving: Discord shows its pop-up.
 * error: `error` says what went wrong.
 */
export type DiscordStatus = "off" | "signed-out" | "connecting" | "not-running" | "approving" | "connected" | "error";

export type DeviceOs = "windows" | "linux" | "macos" | "other";

/** A Tavora install signed into the account, as the service lists it. */
export interface AccountDevice {
  id: string;
  os: DeviceOs;
  /** The PC's name, or null for a sign-in from before devices had names. */
  name: string | null;
  createdAt: string;
  lastUsedAt: string;
  /** This PC. */
  current: boolean;
}

/** Where a code is waiting: signing in (and, for a new address, asking to create the account), changing the email, deleting. */
export type AccountPending =
  | { kind: "sign-in"; email: string; step: "code" | "create" }
  /** A Discord login with no account yet: the player is asked before one is made. */
  | { kind: "discord-create"; name: string }
  | { kind: "change-email"; email: string }
  /** Removing the email waits for the code sent to it. */
  | { kind: "remove-email" }
  /** Connecting or disconnecting Discord waits for the code sent to the account's address. */
  | { kind: "connect-discord" }
  | { kind: "remove-discord" }
  | { kind: "delete" };

/** Settings > Account. Sent on its own channel; the sign-in token never leaves the main process. */
export interface AccountView {
  /** False in release builds until accounts go live. */
  enabled: boolean;
  /** False where the sign-in cannot be kept encrypted: it lasts until Tavora quits. */
  canKeepSignIn: boolean;
  /** The sign-in methods: an email address, a Discord login (its username), or both. */
  account: { email: string | null; discord: { name: string } | null; createdAt: string } | null;
  /** Whether this build offers Discord login. */
  discordLogin: boolean;
  /** Null until read from the service. */
  devices: AccountDevice[] | null;
  pending: AccountPending | null;
  /** On a first sign-in here, the account's profile when it differs from this PC's: the player picks one, once. */
  profileChoice: { name: string; initials: string; picture: boolean } | null;
  /** The public name players see on modules signed with the account's linked keys, and when it can change again; null without one. */
  developer: { name: string; nextChangeAt: string } | null;
  /** Publisher keys linked to the account (fingerprints only); null until read from the service. */
  publisherKeys: { fingerprint: string; linkedAt: string }[] | null;
  /** A one-time code for `tavora-pack link`, while it is valid. */
  linkCode: { code: string; expiresAt: string } | null;
}

/** Settings > Integrations > Discord: the Discord connector's sign-in. Sent on its own channel. */
export interface DiscordView {
  status: DiscordStatus;
  /** The key of the text that says what went wrong; the host UI words it. */
  error: MessageKey | null;
  /** False where this PC can't encrypt, so the sign-in lasts only until Tavora closes. */
  canSaveSignIn: boolean;
  /** Who Tavora is signed in to Discord as. */
  user: { id: string; name: string } | null;
}

/** Which subscription an AI usage account belongs to. */
export type AiProvider = "claude" | "codex";

/** An account of the AI Usage connector, as Settings > Integrations shows it. */
export interface AiUsageAccount {
  id: string;
  provider: AiProvider;
  label: string;
  /** The CLI profile folder, such as C:\Users\you\.claude. Settings shows it; modules never get it. */
  directory: string;
  /** The plan from the saved login, such as "Pro" or "Max 5×"; null when unknown. */
  plan: string | null;
}

/** The AI Usage connector's accounts. Tokens never leave the main process. */
export interface AiUsageView {
  accounts: AiUsageAccount[];
}

/** Toolbar buttons of a Browser panel. */
export type BrowserCommand = "back" | "forward" | "reload" | "stop" | "open-external" | "mute" | "unmute" | "exit-fullscreen";

/**
 * A docking layout: a tree of splits whose leaves are tab groups of panels.
 * A group without panels is an empty slot, waiting for a module.
 * Splits alternate direction level by level, starting with `direction` at
 * the root. Sizes are in pixels of the `width` by `height` area the layout
 * was saved at; restoring scales them to the area there is.
 */
export interface SavedLayout {
  width: number;
  height: number;
  /** "row" places the root's children side by side, "column" stacks them. */
  direction: "row" | "column";
  root: LayoutSplit;
}

export interface LayoutSplit {
  kind: "split";
  size: number;
  children: LayoutNode[];
}

export interface LayoutGroup {
  kind: "group";
  size: number;
  /** Panel instance ids, in tab order; none in an empty slot. */
  panels: string[];
  /** The panel whose tab is selected; null in an empty slot. */
  active: string | null;
}

export type LayoutNode = LayoutSplit | LayoutGroup;

/** A named layout the player saved for a game. */
export interface SnapshotView {
  id: string;
  name: string;
  savedAt: string;
}

/** Where a visible panel's content is, in window content coordinates. */
export interface PanelBounds {
  instanceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the host UI renders. Contains no module data. */
/**
 * Idle: nothing new (when it was last checked, and whether that check failed). Available: found,
 * waiting for the player (automatic download off).
 */
export type UpdateState =
  | { status: "idle"; checkedAt: string | null; failed: boolean }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string }
  | { status: "ready"; version: string };

/** One variation of an installed theme, with its full palette for the preview. */
export interface ThemeVariationView {
  id: string;
  name: string;
  mode: "dark" | "light";
  radius: number;
  /** Every semantic colour token, as #rrggbb. */
  colors: Record<string, string>;
}

export interface ThemeView {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  /** Official themes ship with Tavora; local ones are in the player's themes folder. */
  provenance: "official" | "local";
  variations: ThemeVariationView[];
}

export interface AppearanceView {
  /** The theme and variation in use; the default when the picked one is not installed. */
  themeId: string;
  variationId: string;
  /** Whether the Tavora default is what is in use, so Reset has nothing to do. */
  isDefault: boolean;
  /** The Dark or Light version follows the system's setting, and changes with it. */
  followSystem: boolean;
  themes: ThemeView[];
  /** Theme folders that could not be used, and why, for theme authors. */
  problems: { folder: string; message: string }[];
}

export interface HostViewState {
  screen: Screen;
  currentGameId: string | null;
  library: {
    /** Games not in Trash. */
    games: Record<string, GameView>;
    folders: Record<string, FolderView>;
    /** Top level of the rail in display order. */
    root: RootItem[];
    favorites: string[];
    /** Most recently played first, for the Welcome page. */
    recent: string[];
    trash: { game: GameView; trashedAt: string; purgeAt: string }[];
    sort: RootSort;
    startup: Startup;
    gameStart: GameStart;
    /** The personal workspace to go back to when the open game closes, or null to stay. */
    gameEndWorkspace: string | null;
    grayscaleText: boolean;
    /** Whether search may ask the Tavora service online. */
    onlineSearch: boolean;
    /** New versions of Tavora download by themselves (installed builds only). */
    autoUpdate: boolean;
    /** Whether game icons may be taken from Steam on this PC. */
    steamIcons: boolean;
    /** Whether panel tabs show an icon before the module name. */
    moduleIcons: boolean;
    /** The Steam profile the player asked Tavora to remember for the import, or null. */
    steamProfile: string | null;
    /** False until the player finished or skipped the first-run welcome. */
    onboarded: boolean;
    rail: { expanded: boolean; width: number };
    /** Sites the player marked: signed in for all games, and ad blocking off. */
    browser: { sharedSites: string[]; adblockOff: string[] };
  };
  modules: {
    id: string;
    name: string;
    description: string | null;
    available: boolean;
    /** The smallest panel content area the module works in. */
    minWidth: number;
    minHeight: number;
    /** Its panel types, in the manifest's order; empty for a module with one panel and no types. */
    panels: PanelTypeView[];
    /** Official modules ship with Tavora; local ones were found on disk. */
    provenance: "official" | "local";
    /** A playground or example for module authors, listed under Development. */
    development: boolean;
    version: string;
    /** Where it was found, without a full path: Tavora itself, an example, the player's modules folder or a development folder. */
    origin: { kind: "official" | "example" | "own" | "dev"; folder: string };
    /** Only a module in the player's own modules folder can be removed from Settings. */
    removable: boolean;
    /** Installed from Tavora's module catalog, so it can be reported from Settings. */
    fromCatalog: boolean;
    /** The fingerprint of the key that signed it, for a module installed from a signed zip; null otherwise. */
    publisher: string | null;
    /** The developer name the publisher key is linked to, as Tavora's service said ("by <name>"); null when unknown or unlinked. */
    publisherName: string | null;
    /** Signed, and an unsigned local copy of the same id left data that can be moved to it. */
    localDataWaiting: boolean;
    /** The icon from the module's manifest as a data address (PNG or WebP), or null. */
    icon: string | null;
    /** What the module may do: what its manifest asks for (`asks`), what the player granted of it, and what is still to answer. */
    permissions: { asks: ModulePermissions; granted: ModulePermissions; missing: ModulePermissions };
    /** Games (ids in the library) with a panel of this module, for the dialogs that remove them. */
    usedIn: string[];
    /** The newest version the module's patch notes cover (null without any), and whether some are new to the player. */
    notes: { latest: string | null; unseen: boolean };
    /**
     * A catalog update that asks for more than the installed version and waits for the player's yes;
     * the installed version keeps running until then. Null when none is waiting.
     */
    update: { version: string; asks: ModulePermissions; notes: ModuleNote[] } | null;
  }[];
  /** Folders in the modules folder that could not be loaded, and why, for module authors. */
  /** `path` is the folder's full path; `kind` "not-built" gets its own text in Settings, the others show `message`. */
  moduleProblems: { folder: string; path: string; message: string; kind?: "not-built" | "no-module" | "missing" }[];
  /**
   * Folders added in Settings > Development: a module project, or a folder of projects. `problem` is
   * set when the folder itself has none or is gone; each project says the module it loads or why not.
   * `kind` lets Settings suggest the fix: "not-built", "no-module" or "missing".
   */
  developmentFolders: {
    folder: string;
    problem: string | null;
    kind: DevelopmentProblemKind | null;
    projects: { project: string; moduleId: string | null; problem: string | null; kind: DevelopmentProblemKind | null }[];
  }[];
  /** Saved data of modules that are not installed (or of another publisher than the installed one), kept until deleted. */
  leftoverModuleData: { owner: string; moduleId: string; publisher: string | null }[];
  /** Panels of the current game, in the order they were opened. */
  panels: PanelView[];
  /** The current game's saved layout; panels missing from it are placed by the host UI. */
  layout: SavedLayout | null;
  /** Changes whenever `layout` was replaced by the main process, e.g. by applying a snapshot. */
  layoutEpoch: number;
  /** The game was just opened and its panels are still loading; the host UI covers them, and they are shown together once all have their data. */
  opening: boolean;
  /** Where modules keep their pictures, and how that stands. */
  moduleFiles: { folder: string; custom: boolean; /** The folder is there (a custom one on a drive that is unplugged is not). */ available: boolean; moving: boolean };
  /** A web address a module asked to open while the game has no Browser panel; the host UI asks where it should open (link-choice). */
  pendingLink: string | null;
  /**
   * A panel of a module could not switch to content another of its panels asked for (panels.open); the host UI asks
   * whether to open it in a new panel (navigation-choice). `panel` is the panel type's name, `content` the title.
   */
  pendingNavigation: { panel: string; content: string } | null;
  /** A game that just started, while the player chose to be asked; the host UI asks whether to switch to it (game-switch). */
  pendingGameSwitch: string | null;
  snapshots: SnapshotView[];
  notice: string | null;
  /** The player's local profile. */
  profile: { name: string; initials: string; pictureUrl: string | null };
  /** A setting that only applies on start was changed since Tavora started. */
  restartPending: boolean;
  /** Where the app is with finding and installing a newer version. */
  update: UpdateState;
  /** The app's version as major.minor.patch, from apps/desktop/package.json. */
  appVersion: string;
  appearance: AppearanceView;
  /** The language setting, and the language it comes to now (the system's, when following it). */
  language: { setting: LanguageSetting; resolved: Language };
}

/** What a module may do as far as grants decide it (main/grants.ts): hosts for network.fetch and connectors. */
export interface ModulePermissions {
  network: string[];
  /** Connectors whose sign-in it may use, such as "ai-usage". */
  connectors: ModuleConnector[];
}

/** The connectors Tavora has (module-schema CONNECTORS). */
export type ModuleConnector = "ai-usage" | "discord";

/** Everything the host UI can ask the main process to do. Parsed strictly in main. */
export type HostAction =
  | { type: "show-welcome" }
  /** The answer to pendingLink: a new Browser panel, the system browser, or nothing. */
  | { type: "link-choice"; choice: "panel" | "system" | "cancel" }
  /** The answer to pendingNavigation: open the content in a new panel, or leave it. */
  | { type: "navigation-choice"; choice: "new-panel" | "cancel" }
  /** The answer to pendingGameSwitch: switch to the game, or stay. */
  | { type: "game-switch"; choice: "switch" | "cancel" }
  /** Opens the system dialog to pick the place for the pictures of modules, then moves them there. */
  | { type: "module-files-change" }
  /** Moves the pictures of modules back to the default folder. */
  | { type: "module-files-reset" }
  | { type: "module-files-open" }
  | { type: "restart" }
  | { type: "open-game"; gameId: string }
  | { type: "add-game"; catalogId: string }
  | { type: "add-game"; name: string }
  | { type: "add-game"; workspace: string }
  /** A game found by the online search. */
  | { type: "add-game"; online: OnlineGame }
  | { type: "rename-game"; gameId: string; name: string }
  | { type: "set-game-label"; gameId: string; label: string | null }
  | { type: "choose-game-image"; gameId: string }
  | { type: "use-original-icon"; gameId: string }
  | { type: "share-icons"; gameIds: string[] }
  /** Offers the icons of games from the last Steam import look-up that are not in the library (prepared by steamShareIcons). */
  | { type: "share-steam-icons"; appids: number[] }
  /** Adds the chosen games of a Steam library that the player does not have yet. */
  | { type: "import-steam-games"; games: SteamImportGame[] }
  | { type: "trash-game"; gameId: string }
  | { type: "restore-game"; gameId: string }
  | { type: "delete-game"; gameId: string }
  /** The same for many games at once, from Settings > Games and Trash. */
  | { type: "trash-games"; gameIds: string[] }
  | { type: "restore-games"; gameIds: string[] }
  | { type: "delete-games"; gameIds: string[] }
  | { type: "favorite"; gameId: string; index?: number }
  | { type: "unfavorite"; gameId: string }
  | { type: "move-game"; gameId: string; folderId: string | null; index?: number }
  | { type: "create-folder"; name: string; gameIds: string[] }
  | { type: "rename-folder"; folderId: string; name: string }
  | { type: "set-folder-label"; folderId: string; label: string | null }
  | { type: "delete-folder"; folderId: string }
  | { type: "move-folder"; folderId: string; index: number }
  | { type: "set-sort"; sort: RootSort }
  | { type: "set-startup"; startup: Startup }
  | { type: "set-game-start"; gameStart: GameStart }
  /** A personal workspace's id, or null to stay on the game. */
  | { type: "set-game-end"; workspaceId: string | null }
  | { type: "set-grayscale-text"; enabled: boolean }
  | { type: "set-online-search"; enabled: boolean }
  | { type: "set-auto-update"; enabled: boolean }
  /** Starts the download of a version that was found while automatic download is off. */
  | { type: "download-update" }
  /** How long the screen took to show something the player asked for, measured where it is drawn. */
  | { type: "record-timing"; name: "game-switch"; ms: number }
  /** Puts the version, system, timings, update log and last errors on the clipboard, to paste to whoever is helping. */
  | { type: "copy-diagnostics" }
  /** Opens the folder with the daily copies of the player's data. */
  | { type: "open-backups" }
  /** Asks the update server now, without waiting for the next scheduled check. */
  | { type: "check-for-updates" }
  /** Quits, installs the downloaded version and starts Tavora again. */
  | { type: "restart-to-update" }
  | { type: "set-steam-icons"; enabled: boolean }
  | { type: "set-module-icons"; enabled: boolean }
  | { type: "set-language"; language: LanguageSetting }
  /** Remembers the Steam profile for the import on this PC; null forgets it. */
  | { type: "set-steam-profile"; profile: string | null }
  /** ixed turns Follow System off; without it the pick keeps following the system. */
  | { type: "set-theme"; themeId: string; variationId: string; fixed?: boolean }
  /** Follow the system's light or dark setting, or stay in one mode. */
  | { type: "set-appearance-mode"; mode: "system" | "dark" | "light" }
  /** Back to the Tavora default theme, whatever is active. */
  | { type: "reset-theme" }
  /** Looks for themes again, after the player changed their themes folder. */
  | { type: "reload-themes" }
  /** Opens the player's themes folder in the file manager, creating it first. */
  | { type: "open-themes-folder" }
  /** Opens the player's modules folder in the file manager, creating it first. */
  | { type: "open-modules-folder" }
  /** Opens a folder Settings lists as not loading (a `moduleProblems` path) in the file manager. */
  | { type: "open-module-problem-folder"; path: string }
  /** Picks a module project folder to load from (answers with the folder), or forgets one. */
  | { type: "add-development-folder" }
  | { type: "remove-development-folder"; folder: string }
  | { type: "open-developer-link"; link: DeveloperLink }
  /** Looks for modules again, after the player changed their modules folder. */
  | { type: "reload-modules" }
  /** Moves a module from the player's modules folder to the recycle bin, after removing its panels in every game; its data stays. */
  | { type: "remove-module"; moduleId: string }
  /** The player's yes in the consent dialog: exactly what it showed (only what the module still asks for is granted). */
  | { type: "grant-module"; moduleId: string; network: string[]; connectors: ModuleConnector[] }
  /** Takes back everything granted to a module, after removing its panels in every game; its data stays. */
  | { type: "revoke-module"; moduleId: string }
  /** Asks for a module zip and installs it into the player's modules folder; answers with the module's id. */
  | { type: "install-module" }
  /** Downloads a module from the catalog, checks it and installs it like a zip. */
  | { type: "install-catalog-module"; moduleId: string }
  /** Looks for updates of the modules installed from the catalog now; answers with `updated` and `waiting`. */
  | { type: "check-module-updates" }
  /**
   * Reports a catalog module to Tavora after the player pressed Report: the installed zip when it came
   * from the catalog, otherwise the listed one. Sends only the module id, its key and the zip's hash.
   */
  | { type: "report-catalog-module"; moduleId: string }
  /** Opens a catalog module's homepage like a module link: the address is the one the main process reads from the listing again. */
  | { type: "open-catalog-homepage"; moduleId: string }
  /** The player said yes to a catalog update that asks for more: installs exactly that version and grants what it asked for. */
  | { type: "apply-module-update"; moduleId: string; version: string }
  /** Deletes the data a module that is not installed left behind (owner as in leftoverModuleData). */
  | { type: "delete-module-data"; owner: string; moduleId: string }
  /** Moves a signed module's data from its unsigned local copy to it; Tavora restarts to do it. */
  | { type: "move-local-data"; moduleId: string }
  /** The player opened a module's patch notes: none of them are new any more. */
  | { type: "seen-module-notes"; moduleId: string }
  /** Copies the Tavora theme into the themes folder as a new theme to change; answers with its id. */
  | { type: "create-starter-theme" }
  /** Done ends the first-run welcome; false shows it again. */
  | { type: "set-onboarded"; done: boolean }
  | { type: "save-profile"; name: string; initials: string }
  /** A cropped 256 px PNG, base64-encoded. */
  | { type: "set-profile-picture"; png: string }
  | { type: "remove-profile-picture" }
  | { type: "set-rail"; expanded?: boolean; width?: number }
  /** Opens a new panel; `panelType` picks one of the module's panel types (its continuing type when left out). */
  | { type: "open-module"; moduleId: string; panelType?: string }
  /** Gives a panel whose type an update removed another type of the same module. */
  | { type: "choose-panel-type"; instanceId: string; panelType: string }
  | { type: "close-panel"; instanceId: string }
  /** Closes all of a module's panels in the current game, leaving empty slots; it stays installed. */
  | { type: "remove-module-from-game"; moduleId: string }
  | { type: "reload-panel"; instanceId: string }
  | { type: "stop-panel"; instanceId: string }
  /** An empty Browser tab beside this one. */
  | { type: "browser-new-tab"; instanceId: string }
  /** What the player typed in a Browser panel's address bar. */
  | { type: "browser-navigate"; instanceId: string; address: string }
  | { type: "browser-command"; instanceId: string; command: BrowserCommand }
  /** Signs the page's site in for all games (true) or for each game on its own. */
  | { type: "browser-set-shared"; instanceId: string; shared: boolean }
  | { type: "browser-set-adblock"; instanceId: string; enabled: boolean }
  /** Removes a site from one of the lists in Settings > Browser. */
  | { type: "browser-forget-site"; list: "shared" | "adblock-off"; site: string }
  /** Deletes cookies, logins and caches: the current game's, or the ones shared by all games. */
  | { type: "clear-browser-data"; scope: "game" | "shared" }
  /** Connects to the Discord app, asking for approval in Discord if Tavora was never approved. */
  | { type: "discord-connect" }
  /** Forgets Tavora's Discord sign-in on this PC. */
  | { type: "discord-sign-out" }
  /** Mails a sign-in code to an address. */
  | { type: "account-send-code"; email: string }
  /** The code typed in; for an address without an account the view then asks to create one. */
  | { type: "account-verify"; code: string }
  /** Yes to "Create a Tavora account", with the age tick box (an account is only made when it is ticked). */
  | { type: "account-create"; ageConfirmed: boolean }
  /** Leaves a waiting code (sign-in, email change or delete). */
  | { type: "account-cancel" }
  /** Reads the account and its devices from the service again. */
  | { type: "account-refresh" }
  | { type: "account-sign-out" }
  | { type: "account-sign-out-device"; deviceId: string }
  | { type: "account-rename-device"; deviceId: string; name: string }
  | { type: "account-email-code"; email: string }
  | { type: "account-change-email"; code: string }
  | { type: "account-delete-code" }
  | { type: "account-delete"; code: string }
  /** Discord login in the browser: sign in (or create), connect to the signed-in account, disconnect. */
  | { type: "account-discord-sign-in" }
  | { type: "account-discord-connect-code" }
  | { type: "account-discord-connect"; code: string }
  | { type: "account-discord-disconnect-code" }
  | { type: "account-discord-disconnect"; code: string }
  | { type: "account-email-remove-code" }
  | { type: "account-email-remove"; code: string }
  /** Deletes the account by a fresh Discord sign-in (an account without an email address). */
  | { type: "account-delete-discord" }
  /** The answer to "Which profile?" on a first sign-in. */
  | { type: "account-profile-choice"; keep: "account" | "pc" }
  /** The developer side: the public name, a code to link a publisher key, and unlinking one. */
  | { type: "account-developer-name"; name: string }
  | { type: "account-link-code" }
  /** Copies `tavora-pack link <code>` for the code shown now. */
  | { type: "account-copy-link-command" }
  | { type: "account-unlink-key"; fingerprint: string }
  /** Adds an account for a CLI profile folder. */
  | { type: "ai-usage-add"; provider: AiProvider; label: string; directory: string }
  /** Renames an account or points it at another profile folder. */
  | { type: "ai-usage-update"; accountId: string; label: string; directory: string }
  | { type: "ai-usage-remove"; accountId: string }
  /** Null when nothing is docked any more. */
  | { type: "save-layout"; layout: SavedLayout | null }
  /** Rearranges the workspace into empty slots of a layout template; open panels fill the first ones. */
  | { type: "apply-layout-template"; templateId: LayoutTemplateId }
  /** The same, for an even grid (at most GRID_LIMITS). */
  | { type: "apply-layout-grid"; columns: number; rows: number }
  | { type: "save-snapshot"; name: string }
  | { type: "update-snapshot"; snapshotId: string }
  | { type: "apply-snapshot"; snapshotId: string }
  | { type: "rename-snapshot"; snapshotId: string; name: string }
  | { type: "delete-snapshot"; snapshotId: string };

/** `id` is set when the action created something (a game, a folder). */
/** One entry of a module's menu, as the main process checked it (the SDK's MenuEntry). */
export type ModuleMenuEntry =
  | { type: "item"; id: string; label: string; hint?: string; color?: string; checked?: boolean; radio?: boolean; disabled?: boolean; danger?: boolean }
  | { type: "separator" }
  | { type: "heading"; label: string }
  | { type: "submenu"; label: string; color?: string; disabled?: boolean; items: ModuleMenuEntry[] };

/** A module's menu for the host UI to draw over its panel (ui.showMenu); `at` is in the panel's CSS pixels. */
export interface ModuleMenu {
  requestId: number;
  instanceId: string;
  items: ModuleMenuEntry[];
  at: { x: number; y: number; width?: number; height?: number };
  side?: "bottom" | "top" | "right" | "left";
  align?: "start" | "center" | "end";
}

/** `limited`: the service took only some icons for now (it takes so many an hour); the rest can be shared later. */
export type ActionResult =
  | { ok: true; id?: string; shared?: number; limited?: true; added?: number; updated?: number; waiting?: number }
  | { ok: false; error: string };

export interface CatalogMatch {
  id: string;
  name: string;
}

/** Why a Browser panel's page is not shown: `detail` is what the engine said, for the "unknown" kind. */
export interface BrowserError {
  kind: "cert" | "notFound" | "offline" | "noAnswer" | "badAddress" | "unknown" | "crashed";
  detail: string;
}

/** A game from the Tavora service. `id` is its canonical id. */
export interface OnlineGame {
  id: string;
  name: string;
  /** The game's Steam application id, or null; used to fetch its icon on this PC. */
  steamAppId: number | null;
}

/**
 * `unreachable` means the service did not answer in time, so the list falls
 * back to the built-in games; `off` means the player turned online search off.
 */
export interface OnlineSearchResult {
  status: "ok" | "unreachable" | "off";
  games: OnlineGame[];
}

/** A game in a Steam library, with Tavora's id for it when the service knows one. */
export interface SteamImportGame {
  appid: number;
  name: string;
  id: string | null;
}

/** `status` says whether the player already has the game (`trash`: removed, not deleted yet). */
export interface SteamGameView extends SteamImportGame {
  status: "new" | "owned" | "trash";
}

export type SteamLibraryResult = { status: "ok"; games: SteamGameView[] } | { status: "error"; error: string };

/** A game of a Steam import, not in the library, with the icon this PC has for it as a data address. */
export interface SteamShareView {
  appid: number;
  name: string;
  icon: string;
}

export type SteamShareResult = { status: "ok"; games: SteamShareView[] } | { status: "error"; error: string };

/** A module listed in Tavora's module catalog, as the main process checked it. Every text is plain text. */
export interface CatalogModuleView {
  id: string;
  name: string;
  description: string | null;
  version: string;
  minTavora: string | null;
  /** What its manifest asks for; the player is asked again when it is added. */
  permissions: ModulePermissions;
  /** The fingerprint of the publisher key that signed it. */
  owner: string;
  /** The developer name of that key's account, for "by <name>"; null when it has none. */
  publisher: string | null;
  /** The zip's size in bytes. */
  size: number;
  publishedAt: string;
  /** The module's web page, http or https, shown as plain text; open-catalog-homepage opens it. */
  homepage: string | null;
  /** How many screenshots the listing has; catalogPage fetches them. */
  screenshots: number;
  /** Whether the listing has an icon; catalogIcon fetches it. */
  icon: boolean;
}

/** One block of a catalog module's readme, as plain text (catalog-readme.ts). */
export type ReadmeBlock =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string };

/** What a catalog module's page shows beyond its card, checked by the main process. Every text is plain text. */
export interface CatalogPage {
  /** The listing as the main process just read it again. */
  module: CatalogModuleView;
  /** Checked PNG or WebP data addresses, in the listing's order; the ones that failed a check are left out. */
  screenshots: string[];
  readme: ReadmeBlock[];
  /** Every published version with its patch notes, newest first. */
  versions: { version: string; publishedAt: string; notes: string[] }[];
}

export type CatalogPageResult = ({ status: "ok" } & CatalogPage) | { status: "off" | "unavailable" | "busy" | "unreachable" | "gone" };

/**
 * `off`: the player turned the online features off. `unavailable`: the catalog is switched off on the
 * service. `busy`: too many requests, try later. `unreachable`: no usable answer.
 */
export type CatalogListResult = { status: "ok"; modules: CatalogModuleView[] } | { status: "off" | "unavailable" | "busy" | "unreachable" };

/** Exposed to the host UI as `window.tavoraHost` by the host preload. */
export interface TavoraHostApi {
  getState(): Promise<HostViewState | null>;
  act(action: HostAction): Promise<ActionResult>;
  searchCatalog(query: string): Promise<CatalogMatch[]>;
  /** A module's patch notes, newest first, up to the installed version; empty without any. */
  moduleNotes(moduleId: string): Promise<ModuleNote[]>;
  /** Asks the Tavora service; a newer call cancels an older one. Never rejects. */
  searchOnline(query: string): Promise<OnlineSearchResult>;
  /** The games a Steam profile (link or SteamID64) owns, through the Tavora service. Never rejects. */
  steamLibrary(profile: string): Promise<SteamLibraryResult>;
  /** Of these games from the last steamLibrary answer, the ones not added whose icon this PC has and Tavora lacks. Never rejects. */
  steamShareIcons(appids: number[]): Promise<SteamShareResult>;
  /** The catalog modules for the current game or personal workspace. Never rejects. */
  browseCatalog(): Promise<CatalogListResult>;
  /** A catalog module's page: its readme, screenshots and versions. Never rejects. */
  catalogPage(moduleId: string): Promise<CatalogPageResult>;
  /** The icon of a module from the last catalog list, as a checked data address, or null. Never rejects. */
  catalogIcon(moduleId: string): Promise<string | null>;
  /** Where the visible panels are. Panels not listed are hidden. */
  setPanelBounds(bounds: PanelBounds[]): void;
  /**
   * Hides module panels while a menu, dialog or drag would be drawn under
   * them. Before hiding, the host sends a still image of each visible panel
   * to `onFrozen`, so the workspace does not go blank.
   */
  setOverlay(open: boolean): void;
  onState(listener: (state: HostViewState) => void): void;
  onFrozen(listener: (images: Record<string, string>) => void): void;
  /** Tavora-wide keyboard shortcuts, also when a module panel has focus. */
  onShortcut(listener: (shortcut: HostShortcut) => void): void;
  getDiscord(): Promise<DiscordView | null>;
  onDiscord(listener: (view: DiscordView) => void): void;
  getAiUsage(): Promise<AiUsageView | null>;
  onAiUsage(listener: (view: AiUsageView) => void): void;
  getAccount(): Promise<AccountView | null>;
  onAccount(listener: (view: AccountView) => void): void;
  /** A module asked for a menu (or null: close the one shown). */
  onModuleMenu(listener: (menu: ModuleMenu | null) => void): void;
  /** The player chose an item of the module menu, or closed it (null). */
  answerModuleMenu(requestId: number, id: string | null): void;
}

/** `address:<instance id>` focuses that Browser panel's address bar (Ctrl+L in its page). */
export type HostShortcut = "search" | "shortcuts" | "settings" | "toggle-rail" | "home" | `game-${number}` | `address:${string}` | `panel:${string}`;
