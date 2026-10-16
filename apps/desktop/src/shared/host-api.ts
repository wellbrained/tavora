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
export type InstanceStatus = "loading" | "ready" | "failed" | "unresponsive" | "crashed";

export type Screen = "welcome" | "game";
export type RootSort = "recent" | "manual";
export type Startup = "welcome" | "last-game";
export type RootItem = { kind: "game"; id: string } | { kind: "folder"; id: string };

export type IconView = { kind: "monogram"; text: string } | { kind: "image"; url: string };

export interface GameView {
  id: string;
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
  name: string;
  status: InstanceStatus;
  /** Set for Browser panels: what their toolbar shows. */
  browser?: BrowserState;
  /** A Browser tab opened from another one: docked beside it, and left in the background when asked. */
  openedFrom?: { instanceId: string; background: boolean };
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

/** Someone in a Discord voice channel, as the Discord panel shows them. Names come from Discord and are shown as text only. */
export interface DiscordMember {
  id: string;
  name: string;
  /** Their Discord picture as a data address, or null until it is loaded (or when they have none). */
  avatar: string | null;
  speaking: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Muted or deafened by a moderator. */
  serverMute: boolean;
  serverDeaf: boolean;
  /** The player's own volume for this person (0 to 200, 100 normally) and whether the player muted them for themselves. */
  volume: number;
  mutedForMe: boolean;
}

export interface DiscordChannel {
  id: string;
  name: string;
  members: DiscordMember[];
}

/**
 * off: no Discord panel is open. signed-out: Tavora was never approved, or the
 * player signed out. not-running:
 * the Discord app was not found (Tavora keeps looking). approving: Discord shows
 * its pop-up. error: `error` says what went wrong.
 */
export type DiscordStatus = "off" | "signed-out" | "connecting" | "not-running" | "approving" | "connected" | "error";

/** The Discord panel and Settings > Discord. Sent on its own channel, because speaking changes often. */
export interface DiscordView {
  status: DiscordStatus;
  /** The key of the text that says what went wrong; the host UI words it. */
  error: MessageKey | null;
  /** False where this PC can't encrypt, so the sign-in lasts only until Tavora closes. */
  canSaveSignIn: boolean;
  /** Who Tavora is signed in to Discord as. */
  user: { id: string; name: string } | null;
  /** The server of the voice channel the player is in; null in a direct or group call. */
  server: { id: string; name: string; icon: string | null } | null;
  /** The voice channel or call the player is in, or null. */
  call: DiscordChannel | null;
  /** The server the panel lists channels of: the open game's remembered server, else the one of the call. */
  browseServer: { id: string; name: string; icon: string | null } | null;
  /** All of that server's voice channels in the server's own order, read again every 5 minutes. The panel shows the call's channel live, in its place. */
  channels: DiscordChannel[];
  /** The channel the panel offers to join again: the open game's last one, or the last one anywhere. */
  last: { channelId: string; name: string; serverName: string | null } | null;
  /** "Remember the server on this game" for the open game, and the server it remembers. */
  game: { remember: boolean; serverId: string | null };
  /** The servers the player is on, to choose one for a game. */
  servers: { id: string; name: string }[];
  /** Tavora may mute and deafen the player; false until the player approves that in Discord. */
  canControl: boolean;
  /** The player's own mute and deafen state while in a call. */
  self: { mute: boolean; deaf: boolean } | null;
}

/** Which subscription an AI usage account belongs to. */
export type AiProvider = "claude" | "codex";

/**
 * One allowance window of a subscription. `five-hour` and `weekly` are worded by
 * the host UI; `other` windows (an odd duration) use `name` as their whole label.
 */
export interface AiUsageWindow {
  kind: "five-hour" | "weekly" | "other";
  /** The model or limit the window is for, such as "Sonnet"; null for the plain window. */
  name: string | null;
  /** 0 to 100, as the provider reported it. */
  usedPercent: number;
  /** Milliseconds since 1970, or null when the provider gave no reset time. */
  resetsAt: number | null;
}

/**
 * waiting: not read yet. ready: a reading. sign-in: the profile has no usable
 * login. rate-limited: the provider asked Tavora to slow down. unavailable: the
 * provider answered with nothing usable. cli-missing: the Codex command was not found.
 */
export type AiUsageState = "waiting" | "ready" | "sign-in" | "rate-limited" | "unavailable" | "cli-missing";

/** An account of the AI usage panel and the last thing known about its allowance. */
export interface AiUsageAccount {
  id: string;
  provider: AiProvider;
  label: string;
  /** The CLI profile folder, such as C:\Users\you\.claude. */
  directory: string;
  /** The plan from the saved login, such as "Pro" or "Max 5×"; null when unknown. */
  plan: string | null;
  state: AiUsageState;
  /** Milliseconds since 1970 of the last successful reading, or null. */
  fetchedAt: number | null;
  /** The windows shown are older than they should be, or the newest attempt failed. */
  stale: boolean;
  windows: AiUsageWindow[];
  /** The signed-in email the provider reports, kept in memory only; null when unknown. */
  email: string | null;
  /** Codex's manual resets: how many are available and when the first expires. Null when unknown, which is not the same as 0. */
  resets: { available: number; earliestExpiry: number | null } | null;
}

/** The AI usage panel and its settings. Tokens never leave the main process. */
export interface AiUsageView {
  accounts: AiUsageAccount[];
  /** Minutes between readings, 1 to 60. */
  refreshMinutes: number;
  /** A reading is under way. */
  refreshing: boolean;
  /** Whether bars and numbers show what is left or what is used. */
  style: AiUsageStyle;
}

export type AiUsageStyle = "remaining" | "used";

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
    /** Official modules ship with Tavora; local ones were found on disk. */
    provenance: "official" | "local";
    /** A playground or example for module authors, listed under Development. */
    development: boolean;
    version: string;
    /** Where it was found, without a full path: Tavora itself, an example, the player's modules folder or a development folder. */
    origin: { kind: "official" | "example" | "own" | "dev"; folder: string };
    /** Only a module in the player's own modules folder can be removed from Settings. */
    removable: boolean;
    /** The fingerprint of the key that signed it, for a module installed from a signed zip; null otherwise. */
    publisher: string | null;
    /** Signed, and an unsigned local copy of the same id left data that can be moved to it. */
    localDataWaiting: boolean;
    /** The icon from the module's manifest as a data address (PNG or WebP), or null. */
    icon: string | null;
  }[];
  /** Folders in the modules folder that could not be loaded, and why, for module authors. */
  moduleProblems: { folder: string; message: string }[];
  /** Saved data of modules that are not installed (or of another publisher than the installed one), kept until deleted. */
  leftoverModuleData: { owner: string; moduleId: string; publisher: string | null }[];
  /** Panels of the current game, in the order they were opened. */
  panels: PanelView[];
  /** The current game's saved layout; panels missing from it are placed by the host UI. */
  layout: SavedLayout | null;
  /** Changes whenever `layout` was replaced by the main process, e.g. by applying a snapshot. */
  layoutEpoch: number;
  /** A web address a module asked to open while the game has no Browser panel; the host UI asks where it should open (link-choice). */
  pendingLink: string | null;
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

/** Everything the host UI can ask the main process to do. Parsed strictly in main. */
export type HostAction =
  | { type: "show-welcome" }
  /** The answer to pendingLink: a new Browser panel, the system browser, or nothing. */
  | { type: "link-choice"; choice: "panel" | "system" | "cancel" }
  | { type: "restart" }
  | { type: "open-game"; gameId: string }
  | { type: "add-game"; catalogId: string }
  | { type: "add-game"; name: string }
  /** A game found by the online search. */
  | { type: "add-game"; online: OnlineGame }
  | { type: "rename-game"; gameId: string; name: string }
  | { type: "set-game-label"; gameId: string; label: string | null }
  | { type: "choose-game-image"; gameId: string }
  | { type: "use-original-icon"; gameId: string }
  | { type: "share-icons"; gameIds: string[] }
  /** Adds the chosen games of a Steam library that the player does not have yet. */
  | { type: "import-steam-games"; games: SteamImportGame[] }
  | { type: "trash-game"; gameId: string }
  | { type: "restore-game"; gameId: string }
  | { type: "delete-game"; gameId: string }
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
  /** Looks for modules again, after the player changed their modules folder. */
  | { type: "reload-modules" }
  /** Moves a module from the player's modules folder to the recycle bin; its data stays. */
  | { type: "remove-module"; moduleId: string }
  /** Asks for a module zip and installs it into the player's modules folder; answers with the module's id. */
  | { type: "install-module" }
  /** Deletes the data a module that is not installed left behind (owner as in leftoverModuleData). */
  | { type: "delete-module-data"; owner: string; moduleId: string }
  /** Moves a signed module's data from its unsigned local copy to it; Tavora restarts to do it. */
  | { type: "move-local-data"; moduleId: string }
  /** Copies the Tavora theme into the themes folder as a new theme to change; answers with its id. */
  | { type: "create-starter-theme" }
  /** Done ends the first-run welcome; false shows it again. */
  | { type: "set-onboarded"; done: boolean }
  | { type: "save-profile"; name: string; initials: string }
  /** A cropped 256 px PNG, base64-encoded. */
  | { type: "set-profile-picture"; png: string }
  | { type: "remove-profile-picture" }
  | { type: "set-rail"; expanded?: boolean; width?: number }
  | { type: "open-module"; moduleId: string }
  | { type: "close-panel"; instanceId: string }
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
  /** Join a voice channel in the Discord app: the last one, or one of the server's listed channels. */
  | { type: "discord-join"; channelId: string }
  /** Leaves the voice channel in the Discord app. */
  | { type: "discord-leave" }
  /** Mutes or deafens the player in the Discord app (turning either on or off). */
  | { type: "discord-voice"; mute?: boolean; deaf?: boolean }
  /** Sets how loud a person in the player's call is (0 to 200) and/or mutes them for the player only. */
  | { type: "discord-user-voice"; userId: string; volume?: number; mute?: boolean }
  /** Asks Discord to approve muting and deafening, for sign-ins made before it existed. */
  | { type: "discord-allow-control" }
  /** Reads the server list and the browsed server's channels now. */
  | { type: "discord-refresh" }
  /** The tick box "Remember the server on this game". */
  | { type: "discord-game-remember"; gameId: string; remember: boolean }
  /** Chooses the server of a game from the servers the player is on. */
  | { type: "discord-game-server"; gameId: string; guildId: string }
  /** Forgets Tavora's Discord sign-in on this PC. */
  | { type: "discord-sign-out" }
  /** Reads every account's allowance now (a provider's own wait time still applies). */
  | { type: "ai-usage-refresh" }
  /** Adds an account for a CLI profile folder. */
  | { type: "ai-usage-add"; provider: AiProvider; label: string; directory: string }
  /** Renames an account or points it at another profile folder. */
  | { type: "ai-usage-update"; accountId: string; label: string; directory: string }
  | { type: "ai-usage-remove"; accountId: string }
  | { type: "ai-usage-set-interval"; minutes: number }
  | { type: "ai-usage-set-style"; style: AiUsageStyle }
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
export type ActionResult = { ok: true; id?: string; shared?: number; added?: number } | { ok: false; error: string };

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

/** Exposed to the host UI as `window.tavoraHost` by the host preload. */
export interface TavoraHostApi {
  getState(): Promise<HostViewState | null>;
  act(action: HostAction): Promise<ActionResult>;
  searchCatalog(query: string): Promise<CatalogMatch[]>;
  /** Asks the Tavora service; a newer call cancels an older one. Never rejects. */
  searchOnline(query: string): Promise<OnlineSearchResult>;
  /** The games a Steam profile (link or SteamID64) owns, through the Tavora service. Never rejects. */
  steamLibrary(profile: string): Promise<SteamLibraryResult>;
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
}

/** `address:<instance id>` focuses that Browser panel's address bar (Ctrl+L in its page). */
export type HostShortcut = "search" | "shortcuts" | "settings" | "toggle-rail" | "home" | `game-${number}` | `address:${string}`;
