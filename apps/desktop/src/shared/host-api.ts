import type { Language, LanguageSetting, MessageKey } from "./i18n";
// Contract between the trusted host UI (renderer) and the main process.
// Types only: imported by both sides, so it must not import Electron or Node.
import type { IconTone } from "./icon-tone";
import type { ModuleProblemKind, ModuleProblemValues } from "./module-problem";
import type { HostAction } from "./host-actions";

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
export type DevelopmentProblemKind = ModuleProblemKind;

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
  /** The panel is over the game right now (the in-game layer is open); its slot says so. */
  overGame?: boolean;
  /** The panel's type may be shown in the game (the manifest's `inGame`); its menu offers Show in game. */
  canInGame?: boolean;
  /** The player shows this panel in their game (it appears when the in-game layer opens). */
  inGame?: boolean;
  /** The tab shows the Live badge: the panel is in the game, or its module has an overlay that shows over the game. */
  live?: boolean;
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
  /** "I lost this key": requests to replace a linked key, and where each stands; null until read from the service. */
  keyRequests: KeyRequestView[] | null;
  /** A one-time code for `tavora-pack link`, while it is valid. */
  linkCode: { code: string; expiresAt: string } | null;
  /** Tokens that let CI publish with a key file; null until read from the service. */
  publishTokens: AccountPublishToken[] | null;
  /** A token just made: its secret is shown this once. */
  newPublishToken: { name: string; token: string } | null;
  /** The module id prefixes the account holds, and how many it may; null until read from the service. */
  prefixes: { held: AccountPrefix[]; max: number } | null;
  /** The prefix checked last (Check, Claim it), and what the catalog said about it. */
  prefixCheck: { prefix: string; state: PrefixState } | null;
}

/** A module id prefix (the part before the first dot) the account holds in the catalog. */
export interface AccountPrefix {
  prefix: string;
  /** When it was claimed, or first published under (milliseconds). */
  claimedAt: number;
  /** Something was published under it already. */
  published: boolean;
}

/**
 * What the catalog says about an id prefix for this account: "held" is yours, "free" can become yours,
 * "taken" is another developer's, "reserved" nobody may have, "too-many" means you hold as many as you
 * may, and "invalid" isn't a prefix at all.
 */
export type PrefixState = "held" | "free" | "taken" | "reserved" | "too-many" | "invalid";

export interface AccountPublishToken {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

/** A request to replace a lost or leaked publisher key, which Tavora signs offline. */
export interface KeyRequestView {
  old: string;
  new: string;
  leaked: boolean;
  requestedAt: string;
  status: "waiting" | "done" | "declined";
}

/**
 * Settings > Account > Module developer: the publisher keys Tavora keeps in the account's key vault. Sent
 * on its own channel; the keys themselves stay in the main process.
 */
export interface DeveloperKeysView {
  /**
   * "ready": the keys are read. "none": the account has no key yet (making a publisher key makes it, and
   * shows its recovery key). "ask": another PC made it; its recovery key is typed in here first.
   */
  status: "loading" | "ready" | "none" | "ask" | "signed-out" | "offline";
  keys: { fingerprint: string }[];
  /** Whether this PC has the account's key (the recovery key opens it). */
  hasKey: boolean;
  /** The account's recovery key, while the player looks at it (made just now, or asked to see). */
  recoveryKey: string | null;
}

/**
 * The review screen before a dev module goes to the catalog (module-publish.ts). Tavora packs the project
 * folder as it is, signed with a kept publisher key, and shows what would be published. Its Publish uploads
 * exactly that zip; the click is the approval. Sent on its own channel; null while no review is open.
 */
export interface PublishView {
  /** The project folder, as Settings > Development lists it. */
  project: string;
  /** "checking": packing and asking the catalog; "publishing": uploading; "published": done (see `published`). */
  status: "checking" | "ready" | "publishing" | "published";
  /** From the manifest; null when it can't be read. */
  module: { id: string; name: string; version: string; icon: string | null } | null;
  /** This version's patch notes from the project's changelog. */
  notes: string[];
  asks: ModulePermissions;
  /** The zip's size in bytes, once packed. */
  size: number | null;
  /** When the newest built file was written (milliseconds), and whether source files changed after it. */
  builtAt: number | null;
  sourceNewer: boolean;
  /** What the catalog lists: nothing yet, an older version, or unknown (offline). */
  catalog: { kind: "first" } | { kind: "update"; version: string } | { kind: "unknown" };
  /** The module's readme as its page will show it; null when the manifest names none or it can't be read. */
  readme: ReadmeBlock[] | null;
  /** What stops publishing, each with its fix on the screen. Publish works when this is empty. */
  problems: PublishProblem[];
  /** The id prefix becomes the account's with this publish (it may also be claimed right away). */
  newPrefix: { prefix: string; max: number } | null;
  /** The prefix the account would use for a new id: one it holds, or one made from the developer name. */
  ownPrefix: string | null;
  /** Why the last Publish didn't go through, in words. */
  error: string | null;
  published: { id: string; version: string } | null;
}

export type PublishProblem =
  /** The catalog lists this version or a newer one: the screen offers the next versions. */
  | { kind: "version"; listed: string; next: { patch: string; minor: string; major: string } }
  /** The id's prefix isn't the account's; the id can be changed while nothing is published under it. */
  | { kind: "prefix"; prefix: string; state: Exclude<PrefixState, "held" | "free"> }
  | { kind: "not-built" }
  /** Packing or the installer's checks refused it; `message` says why. */
  | { kind: "invalid"; message: string };

/**
 * Approving a new PC from an old one, instead of typing the recovery key. Sent on its own channel; the
 * keys stay in the main process.
 */
export interface PairingView {
  /** This PC asks another one for the account's key. */
  asking: {
    /** Through Tavora's service (signed in), or the cloud copy's folder (signed out), which can take minutes. */
    via: "service" | "folder";
    /** "code": another PC answered; both show `code`. The rest end it: the player starts again or types the key in. */
    step: "waiting" | "code" | "declined" | "expired" | "failed";
    code: string | null;
    /** The name of the PC that answered. */
    from: string | null;
  } | null;
  /** Another PC asks this one: "Add <name>?", with the code both show. */
  approve: { id: string; name: string | null; code: string } | null;
}

/** Why the cloud copy could not sync last time, worded by the host UI. */
export type CloudCopyProblem = "offline" | "signed-out" | "too-big" | "failed" | "deleted" | "new-key" | "no-folder" | "not-arrived";

/**
 * Settings > Account > Cloud copy, and the questions it asks over the app. Sent on its own channel;
 * the copy key stays in the main process, except as the recovery key the player asks to see.
 */
export interface CloudCopyView {
  /** False where this PC can't keep the key encrypted: the copy can't be turned on here. */
  canKeepKey: boolean;
  /** A development run in its own desktop-dev folder: turning on asks first, as the copy belongs in the installed app. */
  devData: boolean;
  on: boolean;
  /** What it is doing right now. */
  busy: "checking" | "uploading" | "downloading" | null;
  /** Bytes read and sent of what changed, while uploading. */
  progress: { done: number; total: number } | null;
  /** The copy as it was last seen; null when there is none or it was not read yet. */
  copy: { size: number; savedAt: string } | null;
  /** The folder the copy is kept in, or null for Tavora's service. */
  folder: string | null;
  /** The most a copy may hold, or null for no limit (a folder). */
  limit: number | null;
  /** False when the last copy left the pictures out to fit. */
  pictures: boolean;
  /** The recovery key, while the player looks at it (right after turning on, or when asked for). */
  recoveryKey: string | null;
  /** Turning on found a copy from another PC: its recovery key is asked for. */
  askKey: boolean;
  /** This PC and the copy both changed since they last matched: the player keeps one side. */
  conflict: boolean;
  /** A newer copy from another PC is downloaded; a restart takes it. */
  restartToTake: boolean;
  /** Closing waits for the last upload. */
  closing: boolean;
  problem: CloudCopyProblem | null;
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
  hidden?: true;
  children: LayoutNode[];
}

export interface LayoutGroup {
  kind: "group";
  size: number;
  hidden?: true;
  /** Panel instance ids, in tab order; none in an empty slot. */
  panels: string[];
  /** The panel whose tab is selected; null in an empty slot. */
  active: string | null;
  /** The group fills the workspace (Maximize); one group of a layout at most. */
  maximized?: true;
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
  /** The panel's group fills the workspace (Maximize). */
  maximized?: true;
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
    /** Catalog module updates that ask for nothing new install by themselves. */
    autoUpdateModules: boolean;
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
    /** Loaded from a project folder (Settings > Development), so it can be published or saved as a zip. */
    project: boolean;
    version: string;
    /** Where it was found, without a full path: Tavora itself, an example, the player's modules folder or a development folder. */
    origin: { kind: "official" | "example" | "own" | "dev"; folder: string };
    /** Only a module in the player's own modules folder can be removed from Settings. */
    removable: boolean;
    /** Installed from Tavora's module catalog, so it can be reported from Settings. */
    fromCatalog: boolean;
    /** The support link from the module's manifest (an https address or an email address), or null. */
    support: string | null;
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
  /** `path` is the folder's full path. Settings words the problem from `kind` and `values`; `message` is the English line for logs. */
  moduleProblems: { folder: string; path: string; message: string; kind?: ModuleProblemKind; values?: ModuleProblemValues }[];
  /**
   * Folders added in Settings > Development: a module project, or a folder of projects. `problem` is
   * set when the folder itself has none or is gone; each project says the module it loads or why not.
   * `kind` lets Settings suggest the fix: "not-built", "no-module" or "missing".
   */
  developmentFolders: {
    folder: string;
    problem: string | null;
    kind: DevelopmentProblemKind | null;
    values?: ModuleProblemValues;
    /** `name` and `version` are what the manifest of a project that didn't load gives, when it has them. */
    projects: { project: string; moduleId: string | null; problem: string | null; kind: DevelopmentProblemKind | null; values?: ModuleProblemValues; name: string | null; version: string | null }[];
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
  /**
   * The running game the rail offers to switch to (main/game-watch.ts): the one that started last, other than
   * the game open now. Null when none, or while "When a game starts" is off.
   */
  runningGameId: string | null;
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
  /** Settings > Streaming: Stream overlays and the hotkeys set for module actions. */
  streaming: StreamingView;
  /** Settings > Overlays: Game overlays over the player's games. */
  gameOverlays: GameOverlaysView;
  /** Tavora's hotkey dialog, opened by a module's hotkeys.set; null while it is closed. */
  hotkeyRequest: HotkeyRequestView | null;
  /**
   * A connector a module asks for on request (permissions.onRequest), such as stream overlays on its first Copy OBS link:
   * the host UI shows the consent dialog for it and answers with connector-answer.
   */
  pendingConnector: { id: number; moduleId: string; connectors: ModuleConnector[] } | null;
}

/**
 * Stream overlays (main/overlays.ts): whether they are on, the port, and how the server stands: off, running, or
 * not running because the port is in use or something else failed.
 */
export interface StreamingView {
  overlays: { enabled: boolean; port: number; status: "off" | "running" | "in-use" | "failed" };
  /** The overlay links OBS can use, for the Preview buttons. */
  links: { owner: string; moduleId: string; moduleName: string; gameId: string; gameName: string; key: string }[];
  /** Every hotkey set for a module action, in every game (main/hotkeys.ts). `taken`: another program holds the key right now. */
  hotkeys: HotkeyView[];
}

/** A key set for game overlays (the layer key, an overlay's toggle key), and whether another program holds it right now. */
export interface OverlayKeyView {
  accelerator: string;
  taken: boolean;
}

/**
 * Settings > Overlays (main/game-overlays.ts): the master switch, the layer key, the overlays grouped by game (the group
 * with `name` null is "All games": overlays made in a workspace that is no game) and the panels shown in the game.
 * `supported` is false where Tavora can't draw over a game (not Windows); Settings then hides the section.
 */
export interface GameOverlaysView {
  supported: boolean;
  enabled: boolean;
  /** "Hide all for now" is on: nothing shows until Tavora starts again or the player shows it again. */
  hidden: boolean;
  layerKey: OverlayKeyView | null;
  groups: {
    id: string;
    name: string | null;
    overlays: {
      owner: string;
      moduleId: string;
      /** The workspace the overlay was made in. */
      gameId: string;
      key: string;
      /** The module's name, and the overlay's key when the module has several in this place. */
      name: string;
      mode: "always" | "toggle";
      opacity: 100 | 75 | 50 | 25;
      hideFromCapture: boolean;
      hotkey: OverlayKeyView | null;
    }[];
  }[];
  panels: {
    instanceId: string;
    owner: string;
    moduleId: string;
    /** The workspace the panel was made in. */
    gameId: string;
    name: string;
    /** Null for a general panel (made in a workspace that is no game). */
    gameName: string | null;
    /** Its live view (the module's overlay page over the game while the layer is closed): always there, or with a key. */
    mode: "always" | "toggle";
    opacity: 100 | 75 | 50 | 25;
    hideFromCapture: boolean;
    hotkey: OverlayKeyView | null;
    /** The module has an overlay page, so the panel can have a live view at all. */
    live: boolean;
  }[];
}

export interface HotkeyView {
  owner: string;
  gameId: string;
  gameName: string;
  moduleId: string;
  moduleName: string;
  action: string;
  actionName: string;
  target: string;
  label: string;
  accelerator: string;
  taken: boolean;
}

/** What Tavora's hotkey dialog shows: which action of which module, for what, and the key it has now. */
export interface HotkeyRequestView {
  id: number;
  moduleName: string;
  actionName: string;
  label: string;
  current: string | null;
  /** Why the last key was refused, in the player's language. */
  error: string | null;
}

/** What a module may do as far as grants decide it (main/grants.ts): hosts for network.fetch and connectors. */
export interface ModulePermissions {
  network: string[];
  /** Connectors whose sign-in it may use, such as "ai-usage". */
  connectors: ModuleConnector[];
}

/** The connectors Tavora has (module-schema CONNECTORS). */
export type ModuleConnector = "ai-usage" | "discord" | "media" | "stream-overlay" | "system-info";

/** Everything the host UI can ask the main process to do: the table in host-actions.ts. */
export type { HostAction, HostActionType } from "./host-actions";

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
  /** How many times it was installed from Browse, as the catalog counts it. */
  installs: number;
  /** Whether it may go where the player is (the open game or personal workspace); Browse lists the rest too. */
  fits: boolean;
  /** The games it is made for, by name; empty for any game. */
  forGames: string[];
  publishedAt: string;
  /** The module's web page, http or https, shown as plain text; open-catalog-homepage opens it. */
  homepage: string | null;
  /** Where players send feedback: an https address or an email address, shown only as a Send feedback button; open-module-support opens it. */
  support: string | null;
  /** How many screenshots the listing has; catalogPage fetches them. */
  screenshots: number;
  /** Whether the listing has an icon; catalogIcon fetches it. */
  icon: boolean;
  /** Every version's ratings together, or null without any. Below MIN_RATINGS_SHOWN the app says "New". */
  rating: CatalogRating | null;
}

/** Ratings a module needs before its average shows; below that it says "New". */
export const MIN_RATINGS_SHOWN = 3;

/** A catalog module's ratings: the average to one decimal, how many, and how many gave 1, 2, 3, 4 and 5 stars. */
export interface CatalogRating {
  average: number;
  count: number;
  stars: [number, number, number, number, number];
}

/** A review on a catalog module's page. Every text is plain text; the account behind it is never known here. */
export interface CatalogReviewView {
  id: string;
  stars: number;
  text: string;
  /** The version it was given on. */
  version: string;
  /** When it was written or last changed. */
  date: string;
  /** The author's profile name and picture (a checked PNG data address); null when they have none. */
  author: { name: string | null; initials: string | null; picture: string | null };
  /** The publisher's one reply. */
  reply: { text: string; date: string } | null;
}

/** The player's own rating of a module. `hidden`: Tavora hid its text after a report; its stars still count. */
export interface CatalogOwnReview {
  stars: number;
  text: string | null;
  version: string;
  hidden: boolean;
}

/** A catalog module's ratings and reviews, and what the player can do there. */
export interface CatalogReviews {
  rating: CatalogRating | null;
  /** The newest reviews with text, newest first. */
  reviews: CatalogReviewView[];
  /** The player's own rating; null without one, or signed out. */
  mine: CatalogOwnReview | null;
  /**
   * `rate`: signed in, with the module installed. `sign-in`: signed out. `install`: not installed.
   * `own`: the player's own module, which they can't rate but can reply under its reviews.
   */
  can: "rate" | "sign-in" | "install" | "own";
  /** The installed version a new rating is given on; null when it isn't installed. */
  installedVersion: string | null;
}

/** What a release copy still needs: a first publish, a newer version, or nothing. */
export type ReleaseStatus = "not-published" | "new-version" | "current";

/** A release copy loaded from a development folder: its id and the version in its manifest. */
export interface ReleaseCopy {
  id: string;
  version: string;
}

export type CatalogReviewsResult = ({ status: "ok" } & CatalogReviews) | { status: "off" | "unavailable" | "busy" | "unreachable" | "gone" };

/**
 * One piece of inline text in a readme: its words, and how they are marked. Only the words are ever
 * shown, as text. A `url` is an http or https address a click may open (open-readme-link).
 */
export interface ReadmeSpan {
  text: string;
  bold?: true;
  italic?: true;
  code?: true;
  url?: string;
}

/** A list item: its words, and the items nested under it (one level). */
export interface ReadmeItem {
  spans: ReadmeSpan[];
  children?: ReadmeSpan[][];
}

/** One block of a module's readme, as plain text with typed spans (catalog-readme.ts). */
export type ReadmeBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; spans: ReadmeSpan[] }
  | { kind: "list"; ordered: boolean; items: ReadmeItem[] }
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

/** An installed module's page from its own files: its readme and screenshots, as plain text and checked pictures. */
export type ModulePageResult = { status: "ok"; readme: ReadmeBlock[]; screenshots: string[] } | { status: "gone" };

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
  /** An installed module's page from its own folder: readme and screenshots. Works offline. Never rejects. */
  modulePage(moduleId: string): Promise<ModulePageResult>;
  /** The icon of a module from the last catalog list, as a checked data address, or null. Never rejects. */
  catalogIcon(moduleId: string): Promise<string | null>;
  /** A catalog module's ratings and reviews, and the player's own rating. Never rejects. */
  catalogReviews(moduleId: string): Promise<CatalogReviewsResult>;
  /** Of these release copies, which still need publishing, from one look at the catalog; null when it can't be reached. Never rejects. */
  releaseStatuses(copies: ReleaseCopy[]): Promise<Record<string, ReleaseStatus> | null>;
  /** Where the visible panels are. Panels not listed are hidden. */
  setPanelBounds(bounds: PanelBounds[]): void;
  /** Where the workspace is (the card that covers it while a game opens), or null when it is not on screen. */
  setWorkspaceBounds(bounds: { x: number; y: number; width: number; height: number } | null): void;
  /**
   * Hides module panels while a menu, dialog or drag would be drawn under
   * them. Before hiding, the host sends a still image of each visible panel
   * to `onFrozen`, so the workspace does not go blank. After it closes, the
   * host sends `{}` once every panel has drawn again.
   */
  setOverlay(open: boolean): void;
  /** Dims the window buttons along with the page while a dialog backdrop covers it. */
  setDimmed(dimmed: boolean): void;
  onState(listener: (state: HostViewState) => void): void;
  onFrozen(listener: (images: Record<string, string>) => void): void;
  /** The still images from `onFrozen` are on screen: the host hides the panels only then, so their slots never show empty. */
  frozenShown(): void;
  /** Tavora-wide keyboard shortcuts, also when a module panel has focus. */
  onShortcut(listener: (shortcut: HostShortcut) => void): void;
  getDiscord(): Promise<DiscordView | null>;
  onDiscord(listener: (view: DiscordView) => void): void;
  getAiUsage(): Promise<AiUsageView | null>;
  onAiUsage(listener: (view: AiUsageView) => void): void;
  getAccount(): Promise<AccountView | null>;
  onAccount(listener: (view: AccountView) => void): void;
  getCloudCopy(): Promise<CloudCopyView | null>;
  onCloudCopy(listener: (view: CloudCopyView) => void): void;
  getDeveloperKeys(): Promise<DeveloperKeysView | null>;
  onDeveloperKeys(listener: (view: DeveloperKeysView) => void): void;
  getPublish(): Promise<PublishView | null>;
  onPublish(listener: (view: PublishView | null) => void): void;
  getPairing(): Promise<PairingView | null>;
  onPairing(listener: (view: PairingView) => void): void;
  /** A module asked for a menu (or null: close the one shown). */
  onModuleMenu(listener: (menu: ModuleMenu | null) => void): void;
  /** The player chose an item of the module menu, or closed it (null). */
  answerModuleMenu(requestId: number, id: string | null): void;
}

/**
 * `address:<instance id>` focuses that Browser panel's address bar (Ctrl+L in its page). `maximize:<instance id>` and
 * `restore:<instance id>` make that panel's group fill the workspace or put it back (panel.setMaximized).
 */
export type HostShortcut = "search" | "shortcuts" | "settings" | "toggle-rail" | "home" | `game-${number}` | `address:${string}` | `panel:${string}` | `maximize:${string}` | `restore:${string}` | `setting:${string}`;
