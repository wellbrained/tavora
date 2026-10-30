import { ReadOnlyFiles } from './read-only-files';
import { showInBackground, windowLook, type WindowStart } from "./background-window";
import { saveDialogDirectory } from './save-dialog-folder';
import { randomUUID } from "node:crypto";
import { existsSync, watch, type FSWatcher } from "node:fs";
import os from "node:os";
import { appendFile, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { allowsPersonalWorkspaces, continuingPanelType, isModuleId, isOwnerId, LOCAL_OWNER, OFFICIAL_OWNER, panelTypes, translateManifest, type Connector, type ModuleManifest, type ResolvedPanelType } from "@tavora/module-schema";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  nativeImage,
  nativeTheme,
  protocol,
  screen,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type WebContents,
  type WebContentsView,
} from "electron";
import type { TavoraTheme, TavoraWorkspace } from "@tavora/sdk/protocol";
import type { IconTone } from "../shared/icon-tone";
import type { PanelDialogSize } from "./bridge";
import type { AccountView, ActionResult, AiUsageView, AppearanceView, BrowserCommand, CatalogListResult, CatalogPageResult, CatalogReviews, CatalogReviewsResult, DeveloperLink, ModulePageResult, WorkspaceView, HostViewState, ModuleMenu, OnlineSearchResult, PanelDialog, ProfileRanksView, ReleaseStatus, Screen, SteamImportGame, SteamLibraryResult, SteamShareResult, SteamShareView } from "../shared/host-api";
import { resolveLanguage, translate, type Language, type MessageKey } from "../shared/i18n";
import { suggestPrefix } from "../shared/id-prefix";
import { compareModuleVersions } from "../shared/module-version";
import { UserError } from "./messages";
import { buildReport, errorLog, timings } from "./diagnostics";
import { popularGames } from "./catalog";
import { gridTemplate, layoutTemplate, type LayoutTemplate } from "../shared/layout-templates";
import { parseAction, runAction, type ActionHandlers } from "./actions";
import { contentTypeFor, HOST_CSP, HOST_SCHEME, resolveAsset } from "./assets";
import { deleteModuleData, deleteModuleDataOf, listModuleData, migrateModuleData, orphanedPartitions, queueLocalDataMove } from "./module-data";
import { AI_USAGE_MODULE_ID, DISCORD_MODULE_ID, movedModule, MOVED_MODULES_OWNER, moveOfficialModules } from "./moved-modules";
import { checkZipData, readOwnerRecords } from "./installer";
import { Installed, loadInstalledModules, type InstalledModules } from "./installed-modules";
import { PendingQuestions } from "./pending-questions";
import { createOverlayServices } from "./overlay-wiring";
import { readModulePage } from "./module-page";
import { hasUnseenNotes, installedNotes } from "./module-notes";
import { GrantStore } from "./grants";
import { boardsModuleId, ModuleLeaderboards, type LeaderboardQuestion } from "./leaderboards";
import { profileRanks, type ProfileRankSource } from "./profile-ranks";
import { ModuleLifecycle } from "./module-lifecycle";
import type { TestHosts } from "./network";
import { shortcutFor } from "./shortcuts";
import { IconError, importIcon, removeIcon } from "./icons";
import { clipInitials, clipName, type Profile, removePicture, savePicture } from "./profile";
import {
  addWorkspace,
  createFolder,
  deleteFolder,
  iconFileShared,
  deleteTrashedWorkspace,
  cleanDevelopmentFolders,
  setDevelopmentFolderCollapsed,
  isLive,
  LibraryError,
  liveWorkspaces,
  MAX_DEVELOPMENT_FOLDERS,
  markOpened,
  openedTimes,
  moveDevelopmentFolder,
  moveFolder,
  moveWorkspace,
  placeFavorite,
  purgeDate,
  purgeExpired,
  recentWorkspaces,
  removeFavorite,
  setSiteListed,
  renameFolder,
  renameWorkspace,
  restoreWorkspace,
  searchCatalog,
  setFolderLabel,
  setWorkspaceImage,
  markIconOffered,
  markIconShared,
  setWorkspaceLabel,
  setRail,
  sortedRoot,
  trashedWorkspaces,
  trashWorkspace,
  useOriginalWorkspaceIcon,
  type DialogPlace,
  type WorkspaceEntry,
  type WorkspaceIcon,
  type Library,
} from "./library";
import { MODULE_FONTS } from "./module-fonts";
import { moduleBaseCss } from "./module-style";
import { backupData, backupsDir } from "./backup";
import { loadLibrary, SavedData } from "./saved-data";
import { CatalogClient, catalogView, type CatalogScope } from "./catalog-client";
import { parseReadme, readmeAllowsLink } from "./catalog-readme";
import { CHECK_INTERVAL_MS } from "./catalog-updates";
import { isReleaseCopies, releaseStatuses } from "./release-pending";
import { OnlineSearch } from "./online";
import { countAppUpdate } from "./usage-counts";
import { PublisherNames } from "./publisher-names";
import { UpdateManager, type UpdaterLike } from "./updates";
import { fetchHostedList, type HostedList } from "./hosted-icons";
import { CATALOGUE_PUBLIC_KEY, SAFETY_REFRESH_MS, SafetyLists } from "./safety-lists";
import { createToneReader, iconVersion } from "./icon-tone";
import { syncIcons } from "./icon-sync";
import { fetchSteamLibrary, importSteamGames, MAX_IMPORT_GAMES, steamGameStatus, steamLibraryView } from "./steam-import";
import { icoFrameNear, isShareCandidate, largestIcoFrame, shareableIconFile, shareSource, steamShareGames, submitIcon } from "./share-icons";
import { AppInfoError, readClientIcons } from "./steam-appinfo";
import { GameOverlayWindow, type OverlayPanel } from "./game-overlay-window";
import { GameOverlays, layerBinding, toggleBinding, type OverlayWindowRequest, type PanelInfo, type PanelLoan } from "./game-overlay-service";
import { scopeForKind } from "./game-overlays";
import { OverlayLayout, type SourcePanel } from "./overlay-layout";
import { OverlayCanvas } from "./overlay-canvas";
import { PICTURES_FOLDER } from "./layout-pictures";
import { parseLayoutMessage } from "../shared/layout-view";
import { OverlayPreviews } from "./overlay-previews";
import { GameWatcher } from "./game-watch";
import { moveToWorkspaces } from "./workspace-move";
import { Streaming } from "./streaming";
import { findInstalledGames } from "./launcher-games";
import { findSteamDir, isSteamAppId, loadAppInfo, readSteamClientIcon, removeSteamIcon } from "./steam-icons";
import { readShortcutIcons, shortcutFolders } from "./steam-shortcuts";
import { documentsFolder, ModuleView, picturesFolder, REVEAL_CAP_MS } from "./module-view";
import { readJsonText } from "./json-file-http";
import { freeFileName } from "./picture-save-http";
import { HostError } from "./errors";
import { loadAdBlocker, type AdBlocker } from "./browser-filter";
import { isPrivateUrl, isWebUrl, siteOfUrl } from "./browser-url";
import { supportTarget } from "./module-support";
import { defaultFilesRoot } from "./module-files";
import { ModuleFilesFolder } from "./module-files-folder";
import { BrowserPanel, browserPartition, browserSession, browserUserAgent, type BrowserKind, type BrowserSessionHooks } from "./browser-view";
import { BROWSER_MODULE_ID, developmentProjects, isExampleModule, buildFolderName, MANIFEST, mayHoldProject, projectEntry, waitingModules, type InstalledModule, type ModuleInfo, type ModuleProblem } from "./registry";
import { DataRegistry } from "./storage";
import type { CheckedMenu } from "./module-menu";
import {TooltipWindow} from "./tooltip-window";
import { AiUsageConnector } from "./ai-usage";
import { ConnectionFile, ConnectionWatcher, SYSTEM_MONITOR_ID } from "./connection";
import { connectionProbe } from "./connection-windows";
import { SystemMonitorThread } from "./system-info-thread";
import { TrafficFile } from "./traffic";
import { MediaConnector } from "./media";
import { helperPath, mediaDeps } from "./media-windows";
import { readClaudeEmail } from "./ai-usage-claude";
import { readCodexUsage } from "./ai-usage-codex";
import { DiscordConnector, DISCORD_CLIENT_ID } from "./discord";
import { RpcClient } from "./discord-rpc";

import { DeveloperKeys } from "./developer-keys";
import { ModulePublisher } from "./module-publish";
import { Pairing } from "./pairing";
import { osEncryptor } from "./os-encryptor";
import { SignIn } from "./sign-in";
import { accountServiceUrl, serviceUrl } from "./service-url";
import { LibraryWorkspaces } from "./workspace-lookup";
import type { Shell } from "./shell";

import { CopySync } from "./cloud-copy-sync";
import { Inbox } from "./inbox";
import { AccountClient, deviceOs, linkCommand, loadAccount, saveAccount, type AccountClientOptions, type ProfileData } from "./account";
import { discordLogin } from "./discord-login";
import { loadDiscordSecrets, saveDiscordSecrets, type Encryptor } from "./discord-store";
import {
  DEFAULT_THEME,
  discoverThemes,
  moduleTheme,
  resolveTheme,
  variationForMode,
  STARTER_README,
  starterTheme,
  THEME_MANIFEST,
  themeManifest,
  veiled,
  type InstalledTheme,
  type ThemeProblem,
} from "./themes";
import { copyExample, slugOf } from "./example-copy";
import { writeFileAtomic } from "./fsutil";
import {
  emptyWorkspace,
  Workspaces,
  settlePanelTypes,
  WorkspaceError,
  type InstanceRecord,
  type WorkspaceState,
} from "./workspace";
import type { PanelContent, PanelLaunch } from "./panel-content";
import type { PanelOpenResult } from "@tavora/sdk/protocol";
import { initialBounds, MIN_SIZE, type WindowState } from "./window-state";
import { layoutKey, OpenTimes, PanelCover } from "./panel-cover";
import { BrowserPanelView, ModulePanelView } from "./panel-view-adapters";
import { clampRect, PanelViews, type PanelViewAdapter } from "./panel-views";

/**
 * How long a workspace's panels may keep each other waiting when it opens; past it, every panel shows. Each page gives up on
 * its own REVEAL_CAP_MS after it starts loading, which ends the wait; this only catches a page that never starts. When
 * Tavora starts, pages start late, so a cap close to REVEAL_CAP_MS took the cover away while they still waited.
 */
const OPENING_CAP_MS = REVEAL_CAP_MS * 4;
/** A development run with TAVORA_TIMINGS set logs how long workspaces and panels take to draw. */
const timingLog = !app.isPackaged && process.env.TAVORA_TIMINGS ? (line: string) => console.log(`[tavora] ${line}`) : null;
/** How long to wait for the host UI to show the panels' still images before hiding the panels anyway. */
const FROZEN_SHOWN_CAP_MS = 300;
/** How long a development folder's build must be quiet before its panels reload. */
const DEVELOPMENT_RELOAD_MS = 300;
/** The pages Settings > Development links to. */
const DEVELOPER_LINKS: Record<DeveloperLink, string> = {
  docs: "https://docs.mytavora.app/guide/getting-started",
  discussions: "https://github.com/wellbrained/tavora/discussions",
  issue: "https://github.com/wellbrained/tavora/issues/new?template=module-developer.yml",
};

/** The command that starts a module project, which the developer onboarding copies. */
const CREATE_MODULE_COMMAND = "npm create @tavora/module";

/** Folders watched in one development folder for a new project, at most. */
const MAX_DEVELOPMENT_SUBFOLDERS = 100;

/** The user's own modules, next to the themes folder in their data folder. */
function userModulesDir(options: HostOptions): string {
  return path.join(options.userData, "modules");
}

/** The modules folder as module roots name it (they are real paths). */
async function realUserModulesDir(options: HostOptions): Promise<string> {
  return realpath(userModulesDir(options)).catch(() => path.resolve(userModulesDir(options)));
}

/** Leaves the workspace header's bottom border visible below the window controls. */
const TITLE_BAR_HEIGHT = 47;
/** How dark the kit's dialog backdrop is (bg-black/80 in DialogOverlay). */
const DIALOG_BACKDROP_OPACITY = 0.8;
/** How long a dialog asked for from the in-game layer waits for its panel to be back in Tavora. */
const PENDING_DIALOG_MS = 5000;
/** What a game workspace the user adds starts with, side by side in this order (startWorkspace). */
const STARTER_MODULES = ["tavora.notes", "tavora.todos"] as const;

export interface HostOptions {
  userData: string;
  /** Where modules keep pictures unless the user chose another folder; left out, inside userData (module-files.ts). */
  picturesFolder?: string | undefined;
  moduleDirs: string[];
  /** Modules that ship with Tavora, shown as Official. */
  officialModuleDirs: string[];
  /** Themes that ship with Tavora, shown as Official. */
  officialThemeDirs: string[];
  /** Development only: more folders of local themes besides the user's own themes folder. */
  themeDirs?: string[];
  rendererDir: string;
  modulePreload: string;
  hostPreload: string;
  icon: string;
  devTools: boolean;
  /** Whether this run started with grayscale text (see Library.grayscaleText). */
  grayscaleText: boolean;
  /** Quits and starts Tavora again, so settings that apply on start take effect. */
  restart: () => void;
  /** Development and tests only: another Tavora service than api.mytavora.app. */
  apiUrl?: string | undefined;
  /**
   * Development and tests only: another place to ask for Steam icons than
   * Steam's own address, or "off" to look for none (tests never read the
   * launchers or the Steam client on the machine they run on). A packaged app only uses Steam.
   */
  steamIcons?: string | undefined;
  /**
   * Tests only: a pretend Discord app to connect to and a token address to
   * use instead of discord.com. Also accepts Linux's plain-text secret
   * storage, which test machines have. A packaged app never sets this.
   */
  discord?: { ipcPath: string; tokenUrl: string } | undefined;
  /** Settings > Account and the account service (on since 0.16.4; off only in tests that leave it out). */
  accounts?: boolean;
  /** A development run in its own desktop-dev folder: turning the cloud copy on asks first. */
  devData?: boolean;
  /** Development only: where accounts are, when not the same service as the rest. */
  accountUrl?: string | undefined;
  /**
   * Tests only: a pretend Discord sign-in page. The main process then follows it itself instead of
   * opening the user's browser (it redirects straight back to the Discord login's return address).
   */
  discordAuthorizeUrl?: string | undefined;
  /** Tests only: keep the window invisible, so e2e runs don't flash on screen. */
  hidden?: boolean;
  /** Development only: how the window comes back after `pnpm dev` restarts Tavora (background-window.ts). */
  windowStart?: WindowStart | undefined;
  /** Tests only: pretend the system is in this mode, so a test does not depend on the PC it runs on. */
  systemTheme?: "dark" | "light" | undefined;
  /** Development and tests only: what the system's language is taken to be, instead of the real one. */
  systemLocale?: string | undefined;
  /** Tests only: Steam is taken to run this game (game-watch.ts), so a test can see a game running. */
  testSteamAppId?: number | undefined;
  /** Tests only: what a module may keep in its browser storage, in bytes, instead of the usual limit. */
  moduleStorageLimit?: number | undefined;
  /** Tests only: host names network.fetch reaches on a local server, over plain http (network.ts). */
  testNetworkHosts?: TestHosts | undefined;
  /** Tests only: a local server that answers in place of Anthropic's usage address (ai-usage.ts). */
  aiUsageUrl?: string | undefined;
  /**
   * Development only: the Vite dev server that serves the host UI with hot
   * reload, instead of the built files in `rendererDir`.
   */
  devServer?: string | undefined;
}

/** Built on first use; it carries the module font, so it is not small. */
let moduleCss: string | undefined;

/**
 * Writes `data` to the file a save dialog gave, adding `.extension` when the name lacks it. The dialog asked before
 * replacing the file the user chose; a name with the extension added was never asked about, so that one is not replaced.
 */
async function writeWithExtension(picked: string, extension: string, data: Buffer | string, mode?: number): Promise<string> {
  const chosen = path.resolve(picked);
  const file = chosen.toLowerCase().endsWith(`.${extension}`) ? chosen : `${chosen}.${extension}`;
  try {
    await writeFile(file, data, { flag: file === chosen ? "w" : "wx", ...(mode === undefined ? {} : { mode }) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new UserError("error.file.taken", { name: path.basename(file) });
    throw error;
  }
  return file;
}

const ICON_URL = `${HOST_SCHEME}://app/game-icons/`;
/** A saved icon as a 32 px bitmap (blue, green, red, alpha), or null when it cannot be read. */
function loadSmallBitmap(file: string): Uint8Array | null {
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? null : image.resize({ width: 32, height: 32, quality: "good" }).toBitmap();
}

const STEAM_ICON_URL = `${HOST_SCHEME}://app/steam-icons/`;
const PROFILE_URL = `${HOST_SCHEME}://app/profile/`;

/**
 * What Host.create makes before the Host, each from the things before it: the Host is handed them, and nothing in
 * here asks the Host for anything. The order they are made in (host.ts, Host.create) is the order their data needs.
 */
interface Prepared {
  /** The system's key store, built once. */
  encryptor: Encryptor;
  /** The account's saved sign-in, read at start. */
  signIn: SignIn;
  /** The cloud copy; it has run its first step (a newer copy taken) before the library was read. */
  copySync: CopySync;
  installed: Installed;
  safetyLists: SafetyLists;
  grants: GrantStore;
  connection: ConnectionWatcher;
  systemInfo: SystemMonitorThread;
  openTimes: OpenTimes;
  /** Tavora's emblem for the cover's fire, read once. */
  emblem: string | null;
}

export class Host {
  private readonly data: DataRegistry;
  /** Every open panel's native view, place, visibility and clean-up (panel-views.ts). */
  private readonly panels = new PanelViews({
    mount: (adapter) => this.window.contentView.addChildView(adapter.view as WebContentsView),
    unmount: (adapter) => this.window.contentView.removeChildView(adapter.view as WebContentsView),
    windowSize: () => this.window.getContentBounds(),
    windowHidden: () => this.windowHidden,
    asking: (instanceId) => this.askingIn(instanceId),
    releasing: (instanceId, forget) => {
      this.tooltips.close(instanceId);
      this.closeModuleMenu(instanceId);
      // The panel is closing for good: its questions (a leaderboard question, a waiting dialog) end with it, and its live state goes, whether or not it was running.
      if (forget) {
        this.questions.cancel({ panel: instanceId });
        this.gameOverlays?.forgetLive(instanceId);
      }
    },
    // A connector question outlives the panel that asked only while the module still has one.
    moduleGone: (moduleId) => {
      if (this.questions.cancel({ module: moduleId }) === 0) return;
      queueMicrotask(() => {
        if (this.window.isDestroyed()) return;
        this.pushState();
        this.panels.applyBounds();
      });
    },
    shownHere: (instanceId) => !!this.workspaceId && this.records(this.workspaceId).some((record) => record.instanceId === instanceId),
    returned: () => {
      this.pushStateSoon();
      this.openPendingDialog();
    },
    dialogClosed: () => {
      if (!this.window.isDestroyed()) this.window.webContents.send("host:panel-dialog", null);
    },
    openingEnded: (ended) => this.openingEnded(ended),
    placing: () => this.tooltips?.ensureVisible(),
    overlayOpening: () => {
      this.tooltips.close();
      // The dialog has to be seen; the panels' pictures stand in for them, so the cover goes.
      this.cover.cancel();
    },
    frozen: (images) => this.window.webContents.send("host:frozen", images),
    frozenOnScreen: () => this.frozenOnScreen(),
    windowGone: () => this.window.isDestroyed(),
    shownAgain: (views) => this.logDraws(views, "dialog closed"),
    ...(timingLog ? { log: timingLog } : {}),
  });
  /** Every open question to the user: link, navigation, game switch, connector, leaderboard, waiting panel dialog and module menu (pending-questions.ts). */
  private readonly questions = new PendingQuestions();
  /** What every browser session is made safe with; built when the first Browser panel opens. */
  private browserHooks: BrowserSessionHooks | undefined;
  /** The Discord connector: Tavora's Discord sign-in and the connection to the Discord app, for modules granted it. */
  private readonly discord: DiscordConnector;
  /** The AI Usage connector: the AI accounts, read for modules granted it. */
  private readonly aiUsage: AiUsageConnector;
  /** The System info connector: this PC's hardware and usage, read in a worker thread only while a shown panel of a granted module watches. */
  private readonly systemInfo: SystemMonitorThread;
  /** The connection watcher (connection.ts): pings the router and one internet address while System Monitor is in a workspace, and keeps the log of drops. */
  private readonly connection: ConnectionWatcher;
  /** The Media connector: what plays on this PC, read by Tavora's media helper only while a panel of a granted module watches. */
  private readonly media = new MediaConnector(
    mediaDeps(helperPath(app.isPackaged, process.resourcesPath, path.resolve(__dirname, "../../../..")), (message, error) =>
      error === undefined ? console.warn(`[tavora] ${message}`) : console.warn(`[tavora] ${message}`, error),
    ),
  );
  /** The user's Tavora account; the sign-in never leaves the main process. */
  private readonly account: AccountClient;
  /** The user's messages with developers and Tavora (inbox.ts). */
  private readonly inbox: Inbox;
  private inboxSignedIn = false;
  /** The cloud copy: made before the data is read, since a newer copy is taken before anything reads it. */
  private readonly copySync: CopySync;
  /** The publisher keys the account's vault keeps (developer-keys.ts). */
  private readonly developerKeys: DeveloperKeys;
  /** The review screen and Publish for dev modules from project folders (module-publish.ts). */
  private readonly publisher: ModulePublisher;
  private readonly pairing: Pairing;
  /** The developer names users see for publisher keys (publisher-names.ts). */
  private readonly publisherNames: PublisherNames;
  private screen: Screen = "welcome";
  private notice: string | null = null;
  /** Every (owner, module) with saved settings or documents, for Settings > Modules. */
  private moduleData: { owner: string; moduleId: string }[] = [];
  /** What the user granted each module (grants.ts); loaded before any module panel opens. */
  private readonly grants: GrantStore;
  /** The catalog's signed safety lists (revoked keys, blocked zips, successions). */
  private readonly safetyLists: SafetyLists;
  /** Stream overlays and hotkeys for module actions (streaming.ts); made by Host.create once the Host is there, before any module panel opens. */
  private streaming!: Streaming;
  /** Module overlay pages shown over the game in front (game-overlay-service.ts). */
  private gameOverlays!: GameOverlays;
  /** The preview windows of overlays (overlay-previews.ts). */
  private previews!: OverlayPreviews;
  /** The Overlay page and what it shows (overlay-layout.ts). */
  private layout!: OverlayLayout<OverlayCanvas>;
  /** The views over the Overlay page's canvas, while the page is shown: the layout holds the window (overlay-layout.ts). */
  private get canvas(): OverlayCanvas | null {
    return this.layout?.canvas ?? null;
  }
  /** The modules installed now; a reload replaces what is inside (installed-modules.ts). */
  private readonly installed: Installed;
  private get modules(): Map<string, InstalledModule> {
    return this.installed.modules;
  }
  private get moduleInfo(): Map<string, ModuleInfo> {
    return this.installed.info;
  }
  private get moduleProblems(): ModuleProblem[] {
    return this.installed.problems;
  }
  /** Modules in the user's folder whose zip Tavora blocked: not loaded, data kept. */
  private get blockedModules(): Map<string, InstalledModule> {
    return this.installed.blocked;
  }
  /** The modules installed from the catalog, by id, as the installer recorded them. */
  private get catalogModules(): Set<string> {
    return this.installed.catalog;
  }
  private running: string[] = [];
  /** When each workspace was last opened as of startup: the rail keeps this order until the next start. */
  private openedAtStart: Record<string, string> = {};
  private readonly gameWatcher = new GameWatcher({
    entries: () => liveWorkspaces(this.library),
    findInstalled: async () => findInstalledGames({ steamDir: await findSteamDir() }),
    onChange: (running, initial) => this.gamesRunning(running, initial),
    testSteamAppId: () => this.options.testSteamAppId,
    log: (line) => console.warn(`[tavora] ${line}`),
  });
  /** Where modules keep their pictures. */
  private readonly files: ModuleFilesFolder;
  /** True while a dialog backdrop dims the host page, so the window buttons are dimmed too. */
  private dimmed = false;
  /** True once the window has closed. */
  private windowClosed = false;
  /** True while the window is minimized or hidden. */
  private windowHidden = false;
  /** Covers the workspace while it opens, until every panel has drawn (panel-cover.ts). */
  private readonly cover: PanelCover;
  /** How long each workspace took to open here, so the cover knows whether to show the fire from the start. */
  private readonly openTimes: OpenTimes;
  /** Tavora's emblem for the cover's fire, read once. */
  private readonly emblem: string | null;
  /** Counts workspace openings, so the end of one that was left does not end the next. */
  private openings = 0;
  private readonly onlineSearch: OnlineSearch;
  /** Tavora's module catalog (catalog-client.ts). */
  private readonly catalog: CatalogClient;
  /** Every workspace's panels, layout and snapshots (workspace.ts). */
  private readonly workspaces: Workspaces;
  /** Installs, updates and removes modules, and grants or takes back what they ask for (module-lifecycle.ts). */
  private readonly lifecycle: ModuleLifecycle;
  private catalogTimer: ReturnType<typeof setInterval> | undefined;
  /** Looks for new versions; only in an installed (packaged) app. */
  private updates: UpdateManager | null = null;
  /** The active theme as modules get it; rebuilt when the theme changes. */
  private currentTheme: TavoraTheme;
  private windowSaveTimer: ReturnType<typeof setTimeout> | undefined;
  readonly window: BrowserWindow;
  private tooltips:TooltipWindow;

  private constructor(
    private readonly options: HostOptions,
    /** What Host.create made before the Host: they need nothing of it (see `Prepared`). */
    prepared: Prepared,
    private readonly library: Library,
    workspaces: WorkspaceState,
    private readonly profile: Profile,
    windowState: WindowState,
    private themes: Map<string, InstalledTheme>,
    private themeProblems: ThemeProblem[],
    /** Reads and writes library.json and the other data files (saved-data.ts). */
    private readonly savedData: SavedData,
  ) {
    this.installed = prepared.installed;
    this.copySync = prepared.copySync;
    this.safetyLists = prepared.safetyLists;
    this.grants = prepared.grants;
    this.connection = prepared.connection;
    this.systemInfo = prepared.systemInfo;
    this.openTimes = prepared.openTimes;
    this.emblem = prepared.emblem;
    this.currentTheme = moduleTheme(resolveTheme(themes, library.theme, library.followSystem ? Host.systemMode(options) : undefined).variation, library.toasts);
    this.files = new ModuleFilesFolder({
      userData: options.userData,
      defaultFolder: options.picturesFolder ?? defaultFilesRoot(options.userData),
      language: () => this.language,
      chosenFolder: () => this.library.moduleFilesFolder ?? null,
      setChosenFolder: (folder) => {
        this.library.moduleFilesFolder = folder;
        this.saveLibrary();
      },
      pick: (options) => this.pickPath("module-files", options),
      remember: (picked) => this.rememberPicked("module-files", picked),
      notify: (message) => (this.notice = message),
      changed: () => this.pushState(),
    });
    this.data = new DataRegistry(options.userData, () => this.files.root(), () => this.files.moving);
    this.onlineSearch = new OnlineSearch(options.apiUrl === undefined ? {} : { baseUrl: options.apiUrl });
    this.catalog = new CatalogClient(options.apiUrl === undefined ? {} : { baseUrl: options.apiUrl });
    this.workspaces = new Workspaces(workspaces, {
      save: (state) => this.savedData.saveWorkspace(state),
    });
    this.lifecycle = new ModuleLifecycle({
      userData: options.userData,
      tavoraVersion: app.getVersion(),
      modules: () => this.modules,
      blocked: () => this.blockedModules,
      catalogIds: () => this.catalogModules,
      removable: (moduleId) => this.moduleInfo.get(moduleId)?.removable === true,
      installRules: async () => {
        await this.refreshSafetyLists();
        return { userModules: await realUserModulesDir(this.options), safety: this.safetyLists };
      },
      grants: () => this.grants,
      catalog: this.catalog,
      online: () => this.library.onlineSearch,
      autoUpdateModules: () => this.library.autoUpdateModules,
      firstKey: (key) => this.safetyLists.firstKey(key),
      panels: { reload: (moduleId) => this.reloadModuleViews(moduleId), close: (moduleId) => this.removeModulePanels(moduleId) },
      grantsChanged: () => this.syncConnection(),
      removed: (owner, moduleId) => {
        this.gameOverlays.forgetModule(moduleId, owner);
        this.previews.closeModule(moduleId, owner);
      },
      // Test runs keep the window hidden and have no recycle bin to rely on.
      trash: (dir) => (options.hidden ? rm(dir, { recursive: true, force: true }) : shell.trashItem(dir)),
      reload: () => this.reloadModules(),
      introduce: (owner) => this.publisherNames.refresh([owner]),
      log: (line) => console.warn(`[tavora] ${line}`),
    });
    this.discord = Host.discordConnector(options, prepared.encryptor, (view) => {
      if (!this.window.isDestroyed()) this.window.webContents.send("host:discord", view);
    });
    this.aiUsage = Host.aiUsageService(options, (view) => {
      if (!this.window.isDestroyed()) this.window.webContents.send("host:ai-usage", view);
      for (const panel of this.moduleViews()) panel.notifyAiUsageAccounts();
    });
    this.account = Host.accountClient(options, prepared.signIn, prepared.encryptor, () => this.language, { get: () => this.profileData(), apply: (remote) => this.applyProfile(remote) }, (view) => {
      if (!this.window.isDestroyed()) this.window.webContents.send("host:account", view);
      if (this.inbox && this.inboxSignedIn !== (view.account !== null)) {
        this.inboxSignedIn = view.account !== null;
        this.inbox.accountChanged(view.account !== null);
      }
      this.developerKeys?.accountChanged(view.account !== null);
    });
    this.inbox = new Inbox({
      baseUrl: serviceUrl(options.apiUrl),
      fetch: (input, init) => fetch(input, init),
      token: () => (this.library.onlineSearch ? this.account.token() : null),
      language: () => this.language,
      tavoraVersion: app.getVersion(),
      file: path.join(options.userData, "inbox.json"),
      installedVersion: (moduleId) => this.modules.get(moduleId)?.manifest.version,
      isDeveloper: () => this.account.view().developer !== null,
      ownModules: async () => {
        const linked = new Set((this.account.view().publisherKeys ?? []).map((key) => key.fingerprint));
        return ((await this.catalog.index()) ?? []).filter((entry) => linked.has(entry.owner)).map((entry) => ({ id: entry.id, name: entry.name }));
      },
      onChange: (view) => {
        if (!this.window.isDestroyed()) this.window.webContents.send("host:inbox", view);
      },
      openLink: (url) => this.openLinkFromModule(url),
      copy: (text) => clipboard.writeText(text),
    });
    this.publisherNames = new PublisherNames({
      file: path.join(options.userData, "publisher-names.json"),
      baseUrl: serviceUrl(options.apiUrl),
      fetch: (input, init) => fetch(input, init),
      online: () => this.library.onlineSearch,
      onChange: () => this.pushState(),
    });
    this.window = new BrowserWindow({
      ...windowState.bounds,
      minWidth: MIN_SIZE.width,
      minHeight: MIN_SIZE.height,
      title: "Tavora",
      icon: options.icon,
      backgroundColor: this.currentTheme.colors.background,
      titleBarStyle: "hidden",
      titleBarOverlay: this.titleBarOverlay(),
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: options.hostPreload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        devTools: options.devTools,
      },
    });
    this.window.removeMenu();
    const start = options.windowStart ?? "front";
    if (windowState.maximized && (options.hidden || start === "front")) this.window.maximize();
    if (options.hidden) {
      // A truly hidden window never resizes its panels, so tests get one that
      // is shown but transparent, click-through, unfocused and off the taskbar.
      this.window.setOpacity(0);
      this.window.setIgnoreMouseEvents(true);
      this.window.setSkipTaskbar(true);
      this.window.once("ready-to-show", () => this.window.showInactive());
    } else if (start !== "front") {
      this.window.once("ready-to-show", () =>
        showInBackground(this.window, start, windowState.maximized, () => screen.dipToScreenRect(this.window, screen.getDisplayMatching(windowState.bounds).workArea)),
      );
    } else {
      this.window.once("ready-to-show", () => this.window.show());
    }
    this.tooltips=new TooltipWindow({parent:this.window,preload:path.join(path.dirname(options.modulePreload),"tooltip.cjs"),hidden:!!options.hidden,theme:()=>this.currentTheme,language:()=>this.language,
      closed:(owner,id)=>{this.moduleView(owner)?.tooltipClosed(id);},
      source:owner=>{
        const view=this.moduleView(owner),bounds=this.panels.boundsOf(owner);
        if(!view||!bounds||!this.panels.isShowing(owner))return undefined;
        const module=this.modules.get(view.moduleId);if(!module)return undefined;
        return{root:module.root,name:this.shown(module.manifest).name,bounds};
      }});
    this.watchShortcuts(this.window.webContents);
    this.cover = new PanelCover({ parent: this.window.contentView, emblem: () => this.emblem });
    this.developerKeys = new DeveloperKeys({
      accountKey: this.copySync.accountKey,
      account: {
        signedIn: () => this.account.view().account !== null,
        link: (key) => this.account.linkPublisherKey(key),
        publish: (key, zip) => this.account.publishModule(key, zip),
      },
      onChange: (view) => {
        if (!this.window.isDestroyed()) this.window.webContents.send("host:developer-keys", view);
      },
    });
    this.publisher = this.modulePublisher();
    this.pairing = new Pairing({
      copySync: this.copySync,
      account: this.account,
      serviceUrl: accountServiceUrl(options),
      deviceName: os.hostname(),
      keyKept: () => this.developerKeys.refresh(),
      onChange: (view) => {
        if (!this.window.isDestroyed()) this.window.webContents.send("host:pairing", view);
      },
      focus: () => this.bringToFront(),
      log: (line) => console.log(`[tavora] ${line}`),
    });
    // The cloud copy started before there was a window: from here it flushes the saved data and tells the page.
    this.copySync.attach({
      flush: () => this.flush(),
      onChange: (view) => {
        if (!this.window.isDestroyed()) this.window.webContents.send("host:cloud-copy", view);
        this.developerKeys.keyMaybeChanged();
      },
    });
  }

  static async create(options: HostOptions): Promise<Host> {
    const { userData } = options;
    const encryptor = osEncryptor(options.discord !== undefined);
    // The cloud copy comes first, as a newer copy is taken before anything reads the files. It needs only the saved
    // sign-in and the module files folder as saved; once the library is read, the folder is the library's.
    const signIn = Host.signIn(options, encryptor);
    await signIn.load();
    const savedFolder = (await loadLibrary(userData)).moduleFilesFolder ?? null;
    const defaultFolder = options.picturesFolder ?? defaultFilesRoot(userData);
    let loaded: Library | undefined;
    const copySync = Host.cloudCopy(options, encryptor, signIn, { root: () => (loaded ? (loaded.moduleFilesFolder ?? null) : savedFolder) ?? defaultFolder });
    await copySync.beforeLoad();
    const savedData = new SavedData(userData);
    // Before anything reads the files (a cloud copy taken just now included): what was saved under the old names of the
    // Game → Workspace rename gets the new ones. When that fails, Tavora does not start on files it can't read.
    await moveToWorkspaces(userData, (line) => console.warn(`[tavora] ${line}`));
    // A file saved by a newer Tavora is copied aside before this one can overwrite it.
    await savedData.keepNewerFiles();
    const library = await savedData.loadLibrary();
    loaded = library;
    const safetyLists = new SafetyLists({
      file: path.join(userData, "catalog-lists.json"),
      baseUrl: serviceUrl(options.apiUrl),
      publicKey: CATALOGUE_PUBLIC_KEY,
      online: () => library.onlineSearch,
    });
    await safetyLists.load();
    const installed = new Installed(await Host.loadModules(options, library.developmentFolders, safetyLists), (manifest) => translateManifest(manifest, Host.languageOf(library, options)));
    const { modules, problems: moduleProblems } = installed;
    const { themes, problems: themeProblems } = await discoverThemes(Host.themeSources(options));
    // Before any module session or store is opened (S5: data is keyed by owner and id).
    await migrateModuleData(userData, (line) => console.warn(`[tavora] ${line}`), library.moduleFilesFolder ?? defaultFilesRoot(userData)).catch((error: unknown) =>
      console.error("[tavora] moving module data under its owner failed", error),
    );
    // Discord and AI Usage left Tavora for the catalog: what they saved goes with them.
    await moveOfficialModules(userData, (line) => console.warn(`[tavora] ${line}`), library.moduleFilesFolder ?? defaultFilesRoot(userData)).catch((error: unknown) =>
      console.error("[tavora] moving the data of Discord and AI Usage failed", error),
    );
    const expired = purgeExpired(library, new Date());
    const waiting = waitingModules(moduleProblems);
    // A module that left Tavora for the catalog keeps its panels while it is not installed: they offer to install it.
    const workspaces = await savedData.loadWorkspace(Object.keys(library.workspaces), (id) => modules.has(id) || waiting.has(id) || movedModule(id) !== undefined);
    settlePanelTypes(workspaces, panelTypesOf(modules));
    const { profile, saved: profileSaved } = await savedData.loadProfile();
    const windowState = initialBounds(
      await savedData.loadWindow(),
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
    );
    await registerHostProtocol(
      options.rendererDir,
      {
        "game-icons": path.join(userData, "game-icons"),
        "steam-icons": path.join(userData, "steam-icons"),
        profile: path.join(userData, "profile"),
        [PICTURES_FOLDER]: path.join(userData, PICTURES_FOLDER),
      },
      options.devServer,
    );

    const grants = await GrantStore.load(userData);
    const connectionFile = new ConnectionFile(path.join(userData, "connection.json"));
    const connection = new ConnectionWatcher({ probe: connectionProbe(), store: connectionFile, initial: await connectionFile.load(), log: (message, error) => console.warn(`[tavora] ${message}`, error) });
    const systemInfo = new SystemMonitorThread({
      start: () => new Worker(path.join(__dirname, "system-info-worker.cjs")),
      connection,
      trafficStore: new TrafficFile(path.join(userData, "traffic.json")),
      // Electron's CPU figure is already a share of the whole PC; its memory is in kilobytes.
      tavora: () => {
        const metrics = app.getAppMetrics();
        return { cpu: metrics.reduce((sum, item) => sum + item.cpu.percentCPUUsage, 0), memoryBytes: metrics.reduce((sum, item) => sum + item.memory.workingSetSize, 0) * 1024 };
      },
      log: (message, error) => console.warn(`[tavora] ${message}`, error),
    });
    const openTimes = new OpenTimes(path.join(userData, "open-times.json"));
    await openTimes.load();
    const emblem = await Host.readEmblem(options);

    const host = new Host(options, { encryptor, signIn, copySync, installed, safetyLists, grants, connection, systemInfo, openTimes, emblem }, library, workspaces, profile, windowState, themes, themeProblems, savedData);
    host.openedAtStart = openedTimes(library);
    // Before any module opens, so none sees the pictures half moved.
    await host.files.moveFromOldDefault((line) => console.warn(`[tavora] ${line}`));
    host.moduleData = await listModuleData(userData, host.files.root());
    host.syncConnection();
    await host.startOverlays();
    await host.moveAiUsagePanelData();
    await host.moveDiscordPanelData();
    // Native menus, dialogs and scrollbars follow the theme's mode.
    host.syncNativeTheme();
    await host.account.init();
    await host.publisherNames.load();
    void host.refreshPublisherNames();
    void host.refreshSafetyLists();
    setInterval(() => void host.refreshSafetyLists(), SAFETY_REFRESH_MS).unref();
    host.noteModuleVersions();
    // The system's light or dark setting changed (or Tavora's own native theme did, which applyTheme ignores).
    nativeTheme.on("updated", () => {
      if (host.library.followSystem) host.applyTheme();
    });
    // The id is made once and kept, so a new profile is written straight away.
    if (!profileSaved) host.saveProfile().catch(() => undefined); // logged by saveProfile
    // Browser storage of workspaces that are gone, removed before any session opens it.
    for (const dir of await orphanedPartitions(userData, new Set(Object.keys(library.workspaces)))) {
      await rm(dir, { recursive: true, force: true });
    }
    for (const workspace of expired) await host.deleteWorkspaceData(workspace);
    // Version 0.2.0 saved Steam covers here; they were replaced by Steam's own icons.
    await rm(path.join(userData, "steam-art"), { recursive: true, force: true });
    const livePanels = new Set(Object.values(workspaces.workspaces).flatMap((workspace) => workspace.instances.map((i) => i.instanceId)));
    await host.data.panelState.prune(livePanels);
    if (expired.length) host.saveLibrary();

    host.screen = library.startup === "last-workspace" && library.lastWorkspaceId ? "workspace" : "welcome";
    host.registerIpc();
    await host.watchDevelopmentFolders();
    host.registerWindowEvents();
    host.window.once("ready-to-show", () => timings.record("startup", process.uptime() * 1000));
    // The last workspace's pages start loading with the window, and its first look already has the one loading cover.
    if (host.screen === "workspace") host.openCurrentWorkspace();
    await host.window.loadURL(options.devServer ?? `${HOST_SCHEME}://app/index.html`);
    // A first start (or the first with this setting) counts the running version as seen: no news card for it.
    if (library.seenVersion === null) {
      library.seenVersion = app.getVersion();
      host.saveLibrary();
    }
    host.syncGameWatcher();
    host.gameOverlays.start();
    void host.files.check();
    // Icons of games of game workspaces that have none yet are looked for quietly in the background.
    host.fetchIconsSoon();
    host.backupSoon();
    host.checkCatalogSoon();
    if (options.accounts === true) void host.inbox.init();
    host.copySync.start();
    if (options.accounts === true) {
      void host.developerKeys.refresh();
      host.pairing.watch();
    }
    await host.startUpdates();
    return host;
  }

  /**
   * The built-in AI usage panel (before 0.16.10) kept its interval, style and last readings in
   * ai-usage.json. They go to the AI Usage module's settings shared by every workspace, once, without
   * replacing anything the module saved itself; then the file keeps only the accounts.
   */
  private async moveAiUsagePanelData(): Promise<void> {
    try {
      const legacy = await this.aiUsage.legacyPanelData();
      if (!legacy) return;
      const settings = this.data.appSettings(MOVED_MODULES_OWNER, AI_USAGE_MODULE_ID);
      if ((await settings.get("settings")) === null) await settings.set("settings", { refreshMinutes: legacy.refreshMinutes, style: legacy.style });
      if ((await settings.get("readings")) === null) await settings.set("readings", legacy.readings);
      await this.aiUsage.forgetLegacyPanelData();
    } catch (error) {
      console.error("[tavora] moving the AI usage panel's settings failed", error);
    }
  }

  /**
   * The built-in Discord panel (before 0.16.11) kept the channel to rejoin and the server each workspace
   * remembers next to the sign-in in discord.json (under `games`, as it was then). They go to the Discord module once,
   * without replacing anything the module saved itself: the channel to its settings shared by every workspace
   * (`last`), each workspace's server to its settings in that workspace (`server`). The sign-in stays.
   */
  private async moveDiscordPanelData(): Promise<void> {
    try {
      const legacy = await this.discord.legacyPanelData();
      if (!legacy) return;
      const settings = this.data.appSettings(MOVED_MODULES_OWNER, DISCORD_MODULE_ID);
      if (legacy.last && (await settings.get("last")) === null) await settings.set("last", { ...legacy.last });
      for (const [workspaceId, server] of Object.entries(legacy.games)) {
        if (!this.library.workspaces[workspaceId]) continue;
        const store = this.data.get(MOVED_MODULES_OWNER, DISCORD_MODULE_ID, workspaceId).settings;
        if ((await store.get("server")) === null) await store.set("server", { ...server });
      }
      await this.discord.forgetLegacyPanelData();
    } catch (error) {
      console.error("[tavora] moving the Discord panel's settings failed", error);
    }
  }

  /** The daily copy of the user's data, made a little after start so it never slows it. */
  private backupSoon(): void {
    setTimeout(() => {
      backupData({ userData: this.options.userData, moduleFiles: this.files.root(), log: (line) => console.log(`[tavora] ${line}`) }).catch((error: unknown) => console.error("[tavora] backup failed", error));
    }, 30_000).unref();
  }

  /**
   * Starts looking for new versions of Tavora. Only an installed app does this:
   * pnpm dev and other unpackaged runs never check. Updates come from the feed
   * address built into the installer.
   */
  private async startUpdates(): Promise<void> {
    if (!app.isPackaged) return;
    try {
      const { autoUpdater } = await import("electron-updater");
      this.updates = new UpdateManager({
        updater: autoUpdater as unknown as UpdaterLike,
        autoDownload: this.library.autoUpdate,
        onChange: () => this.pushState(),
        onDownloaded: (version) => {
          if (this.library.onlineSearch) void countAppUpdate({ baseUrl: serviceUrl(this.options.apiUrl) }, version);
        },
        log: (line) => this.logUpdate(line),
      });
      this.updates.start();
    } catch (error) {
      this.logUpdate(`updates are not available: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Modules that ship with Tavora, the development folders the user added, any test folders, and the user's own modules folder. */
  private static moduleSources(options: HostOptions, developmentFolders: string[]) {
    return { official: options.officialModuleDirs, development: developmentFolders, local: [...options.moduleDirs, userModulesDir(options)] };
  }

  /** The one step that finds the installed modules, at startup and on every reload. */
  private static loadModules(options: HostOptions, developmentFolders: string[], safety: SafetyLists): Promise<InstalledModules> {
    return loadInstalledModules({ userData: options.userData, userModules: userModulesDir(options), sources: Host.moduleSources(options, developmentFolders), tavoraVersion: app.getVersion(), safety });
  }

  /** Looks for modules again; panels of modules that are gone are closed. */
  private async reloadModules(): Promise<void> {
    this.installed.replace(await Host.loadModules(this.options, this.library.developmentFolders, this.safetyLists));
    const { modules } = this.installed;
    this.moduleData = await listModuleData(this.options.userData, this.files.root());
    this.dropPanelsOfMissingModules();
    this.noteModuleVersions();
    this.workspaces.settlePanelTypes(panelTypesOf(modules));
    this.syncPanelTypes();
    await this.watchDevelopmentFolders();
    void this.refreshPublisherNames();
  }

  /**
   * After modules were looked for again: a panel whose type an update removed stops and its slot says
   * so (the decision log, named panels round 4); one whose type came back starts again.
   */
  private syncPanelTypes(): void {
    const workspace = this.workspace;
    if (!workspace) return;
    for (const record of this.records(workspace.id)) {
      const open = this.panels.has(record.instanceId);
      const missing = this.panelTypeOf(record) === undefined;
      if (open && missing) this.panels.close(record.instanceId);
      else if (!open && !missing) this.createView(record, workspace);
    }
    this.workspaces.save();
  }

  /**
   * The panel type a panel shows, with the module's entry, icon and sizes filled in; null for a module
   * without types, undefined when the module no longer offers the panel's type.
   */
  /** The panel may be shown in the game: its type says `inGame`, or the module without types does. */
  private canShowInGame(record: InstanceRecord): boolean {
    const type = this.panelTypeOf(record);
    if (type) return type.inGame === true;
    const module = this.modules.get(record.moduleId);
    return type === null && module !== undefined && this.shown(module.manifest).inGame === true;
  }

  private panelTypeOf(record: InstanceRecord): ResolvedPanelType | null | undefined {
    const module = this.modules.get(record.moduleId);
    if (!module) return undefined;
    const types = panelTypes(this.shown(module.manifest));
    if (types.length === 0) return null;
    return types.find((type) => type.id === record.panelType);
  }

  // ── Development folders ──────────────────────────────────────────────

  /** The watchers of each development folder, and its pending reload. */
  private readonly developmentWatchers = new Map<string, { watchers: FSWatcher[]; timer: ReturnType<typeof setTimeout> | undefined; rediscover: boolean }>();

  /**
   * Watches each module project in the development folders, whether or not its module loaded. Only
   * the project folder itself and its build folder are watched, never node_modules or .git. A change
   * to the build reloads the module's open panels; a change to the manifest, the build folder
   * appearing or being replaced, or any change while the module did not load looks for modules
   * again, so a project added before its first build or a broken manifest that was fixed loads by
   * itself. A development folder that holds projects is watched too, with each folder directly in
   * it, so a new project made there later is found. Changes come in bursts while a build writes, so
   * it waits for a quiet moment.
   */
  private async watchDevelopmentFolders(): Promise<void> {
    // Read everything first, so two calls at once cannot leave watchers of the older one behind.
    const folders = await Promise.all(
      this.library.developmentFolders.map(async (folder) => {
        const found = await developmentProjects(folder);
        const projects = found === "missing" ? [] : found;
        const holder = !(projects.length === 1 && projects[0] === folder);
        let others: string[] = [];
        if (holder) {
          try {
            others = (await readdir(folder, { withFileTypes: true }))
              .filter((entry) => entry.isDirectory() && mayHoldProject(entry.name))
              .map((entry) => path.join(folder, entry.name))
              .filter((dir) => !projects.includes(dir))
              .slice(0, MAX_DEVELOPMENT_SUBFOLDERS);
          } catch {
            // Gone: Settings says so, and there is nothing to watch.
          }
        }
        return {
          folder,
          holder,
          others,
          projects: await Promise.all(
            projects.map(async (project) => {
              const module = [...this.modules.values()].find((item) => item.developmentProject === project);
              return { project, module, entry: module?.manifest.entry ?? (await projectEntry(project)) };
            }),
          ),
        };
      }),
    );
    for (const { watchers, timer } of this.developmentWatchers.values()) {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    }
    this.developmentWatchers.clear();
    const watched = (key: string) => {
      const state = { watchers: [] as FSWatcher[], timer: undefined as ReturnType<typeof setTimeout> | undefined, rediscover: false };
      const changed = (rediscover: boolean) => {
        state.rediscover ||= rediscover;
        clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          state.timer = undefined;
          const again = state.rediscover;
          state.rediscover = false;
          void this.developmentChanged(key, again).catch((error: unknown) => console.error("[tavora] reloading a development module failed", error));
        }, DEVELOPMENT_RELOAD_MS);
      };
      const watchFolder = (dir: string, recursive: boolean, listener: (name: string | null) => void) => {
        try {
          const watcher = watch(dir, { recursive, persistent: false }, (_event, name) => listener(name?.toString() ?? null));
          watcher.on("error", () => watcher.close());
          state.watchers.push(watcher);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[tavora] cannot watch the development folder ${dir}`, error);
        }
      };
      this.developmentWatchers.set(key, state);
      return { changed, watchFolder };
    };
    for (const { folder, holder, others, projects } of folders) {
      if (holder) {
        // A project appearing in the folder, or a manifest in one of its folders, is a new module.
        const { changed, watchFolder } = watched(folder);
        watchFolder(folder, false, () => changed(true));
        for (const dir of others) {
          watchFolder(dir, false, (name) => {
            if (name === null || name === MANIFEST) changed(true);
          });
        }
      }
      for (const { project, module, entry } of projects) {
        const { changed, watchFolder } = watched(project);
        const root = module?.root ?? project;
        const built = entry === undefined ? undefined : buildFolderName(entry);
        watchFolder(root, false, (name) => {
          if (!module || name === null || name === MANIFEST || name === built) changed(true);
          else if (built === undefined) changed(false);
        });
        // A rebuild that empties the build folder takes the entry away: look again, so the panels wait for the next build.
        if (built !== undefined) watchFolder(path.join(root, built), true, () => changed(!module || !existsSync(path.join(root, entry!))));
      }
    }
  }

  /** A development project's files changed: its module's panels load the new build, after looking for modules again when asked. */
  private async developmentChanged(project: string, rediscover: boolean): Promise<void> {
    if (rediscover) {
      await this.reloadModules();
      this.pushState();
    }
    const moduleId = [...this.modules.values()].find((item) => item.developmentProject === project)?.manifest.id;
    if (moduleId !== undefined) this.reloadModuleViews(moduleId);
  }

  /** The user picks a module project folder, or a folder of them; Tavora loads the modules from it from now on. Answers with the folder, or nothing when cancelled. */
  private async addDevelopmentFolder(): Promise<string | void> {
    const folder = await this.pickPath("development-folder", { title: translate(this.language, "dialog.developmentFolder"), properties: ["openDirectory"] });
    if (!folder) return;
    if (this.library.developmentFolders.length >= MAX_DEVELOPMENT_FOLDERS) throw new LibraryError("error.tooManyDevelopmentFolders");
    this.library.developmentFolders = cleanDevelopmentFolders([...this.library.developmentFolders, folder]);
    this.rememberPicked("development-folder", folder);
    await this.reloadModules();
    return path.resolve(folder);
  }

  /** The development folder the user added that is `folder`, as it is kept in the library. */
  private developmentFolder(folder: string): string | undefined {
    const key = (value: string) => (process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value));
    return this.library.developmentFolders.find((item) => key(item) === key(folder));
  }

  /**
   * Copies an example that ships with Tavora into a new project, named after the module, in a development
   * folder that holds projects or in a folder the user picks (`folder` null). A picked folder outside the
   * development folders gets the new project added as one. Answers with the new project, or nothing when cancelled.
   */
  private async copyExampleModule(moduleId: string, name: string, folder: string | null): Promise<string | void> {
    const example = this.modules.get(moduleId);
    if (!example || !isExampleModule(moduleId)) throw new LibraryError("error.copyNoExample");
    let parent: string | undefined;
    if (folder !== null) {
      parent = this.developmentFolder(folder);
      if (!parent) throw new LibraryError("error.copyNoFolder");
    } else {
      parent = await this.pickPath("development-folder", { title: translate(this.language, "dialog.copyExample"), properties: ["openDirectory", "createDirectory"] });
      if (!parent) return;
      this.rememberPicked("development-folder", parent);
    }
    if (!existsSync(parent)) throw new LibraryError("error.copyNoFolder");
    // A project can't hold another one: Tavora only looks for projects directly inside a folder without a manifest.
    if (existsSync(path.join(parent, MANIFEST))) throw new LibraryError("error.copyIntoProject", { folder: path.basename(parent) });
    const known = this.developmentFolder(parent) !== undefined;
    if (!known && this.library.developmentFolders.length >= MAX_DEVELOPMENT_FOLDERS) throw new LibraryError("error.tooManyDevelopmentFolders");
    const slug = slugOf(name);
    const id = `${this.publisher.ownPrefix() ?? "local"}.${slug}`;
    if (this.modules.has(id)) throw new LibraryError("error.copyIdTaken", { id });
    const project = path.join(path.resolve(parent), slug);
    await copyExample(example.root, project, { id, name: name.trim() });
    if (!known) {
      this.library.developmentFolders = cleanDevelopmentFolders([...this.library.developmentFolders, project]);
      this.saveLibrary();
    }
    await this.reloadModules();
    return project;
  }

  /** Opens a module project of a development folder in the file manager; only those, so the host UI cannot open any path. */
  private async openDevelopmentProject(project: string): Promise<void> {
    const known =
      [...this.modules.values()].some((module) => module.developmentProject === project) ||
      this.moduleProblems.some((problem) => problem.developmentProject === project);
    if (!known || this.options.hidden) return;
    const error = await shell.openPath(project);
    if (error) throw new LibraryError("error.openFolder", { problem: error });
  }

  /** Opens the folder of an example that ships with Tavora, to look at its sources; only an example's. */
  private async openExampleFolder(moduleId: string): Promise<void> {
    const example = this.modules.get(moduleId);
    if (!example || !isExampleModule(moduleId)) return;
    if (this.options.hidden) return;
    const error = await shell.openPath(example.root);
    if (error) throw new LibraryError("error.openFolder", { problem: error });
  }

  /** Opens one of Tavora's pages for module developers in the user's browser. The renderer names the page, never an address. */
  private openDeveloperLink(link: DeveloperLink): void {
    const url = Object.hasOwn(DEVELOPER_LINKS, link) ? DEVELOPER_LINKS[link] : undefined;
    if (url && !this.options.hidden) void shell.openExternal(url).catch((error: unknown) => console.error("[tavora]", error));
  }

  /** Forgets a development folder; its modules' panels close like a removed module's, and their data stays. */
  private async removeDevelopmentFolder(folder: string): Promise<void> {
    const key = (value: string) => (process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value));
    this.library.developmentFolders = this.library.developmentFolders.filter((item) => key(item) !== key(folder));
    setDevelopmentFolderCollapsed(this.library, folder, false);
    this.saveLibrary();
    const projects = [...this.modules.values()].filter((module) => module.developmentProject !== undefined);
    await this.reloadModules();
    // A module of that folder that is gone now takes its game overlays with it, as a removed module does.
    for (const module of projects) {
      if (this.modules.get(module.manifest.id)?.developmentProject !== module.developmentProject) this.gameOverlays.forgetModule(module.manifest.id, module.owner);
    }
  }

  /**
   * Deletes what a module that is not installed left behind: its settings and
   * documents in every workspace now, its browser storage cleared now and its
   * folders removed at the next start. An installed module's data is not deleted here.
   */
  private async deleteLeftoverData(owner: string, moduleId: string): Promise<void> {
    if (this.modules.get(moduleId)?.owner === owner) throw new LibraryError("error.dataInUse");
    this.data.forgetModule(owner, moduleId);
    this.streaming.forgetModule(owner, moduleId);
    this.gameOverlays.forgetModule(moduleId, owner);
    for (const partition of await deleteModuleDataOf(this.options.userData, owner, moduleId, this.files.root())) {
      const ses = session.fromPartition(partition);
      await ses.clearStorageData();
      await ses.clearCache();
    }
    this.moduleData = await listModuleData(this.options.userData, this.files.root());
  }

  /**
   * Hands a module's local data (from an unsigned copy used before) to its
   * signed version: Tavora restarts and moves it before any module opens.
   */
  private async moveLocalData(moduleId: string): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module || !this.localDataWaiting(module)) throw new LibraryError("error.noLocalData");
    await queueLocalDataMove(this.options.userData, moduleId, module.owner);
    this.options.restart();
  }

  /** A signed module whose id has data from an unsigned local copy. */
  private localDataWaiting(module: InstalledModule): boolean {
    return this.publisherOf(module) !== null && this.moduleData.some((entry) => entry.owner === LOCAL_OWNER && entry.moduleId === module.manifest.id);
  }

  /**
   * Asks the service for the newest signed safety lists (only while online features are on). A list
   * that blocks an installed module's zip stops it at once.
   */
  private async refreshSafetyLists(): Promise<void> {
    try {
      if (await this.safetyLists.refresh()) await this.reloadModules();
    } catch (error) {
      console.warn("[tavora] safety lists", error);
    }
  }

  /** Asks for the developer names of the installed modules' keys (each at most once a day). Quietly: offline is fine. */
  private refreshPublisherNames(): Promise<void> {
    const keys = [...this.modules.values()].map((module) => this.publisherOf(module)).filter((key): key is string => key !== null);
    return this.publisherNames.refresh(keys).catch((error: unknown) => console.warn("[tavora] publisher names", error));
  }

  /** The key fingerprint of a module from a signed zip, or null. */
  private publisherOf(module: InstalledModule): string | null {
    return isOwnerId(module.owner) && module.owner !== OFFICIAL_OWNER && module.owner !== LOCAL_OWNER ? module.owner : null;
  }

  /** The key a module's seen patch notes are kept under: who publishes it and its id. */
  private static notesKey(module: InstalledModule): string {
    return `${module.owner}:${module.manifest.id}`;
  }

  /**
   * A module seen for the first time counts as read up to its version, so only the notes of later updates are new.
   * Kept under owner and id, so another publisher's module with the same id starts fresh.
   */
  private noteModuleVersions(): void {
    let changed = false;
    for (const module of this.modules.values()) {
      const key = Host.notesKey(module);
      if (module.builtIn || this.library.moduleNotesSeen[key] !== undefined) continue;
      this.library.moduleNotesSeen[key] = module.manifest.version;
      changed = true;
    }
    if (changed) this.saveLibrary();
  }

  /** What Settings shows of a module's patch notes: the newest version they cover, and whether any are new to the user. */
  private notesView(module: InstalledModule): { latest: string | null; unseen: boolean } {
    const notes = installedNotes(this.moduleInfo.get(module.manifest.id)?.changelog ?? [], module.manifest.version);
    return { latest: notes[0]?.version ?? null, unseen: hasUnseenNotes(notes, module.manifest.version, this.library.moduleNotesSeen[Host.notesKey(module)]) };
  }

  /**
   * Closes and forgets every panel whose module is not installed any more, in every workspace. Module data stays. A module
   * that is there but cannot load right now (being rebuilt, not built, needing a newer Tavora) keeps its panels; they
   * start again once it loads (syncPanelTypes).
   */
  private dropPanelsOfMissingModules(): void {
    const waiting = waitingModules(this.moduleProblems);
    for (const instanceId of this.workspaces.dropMissingModules((moduleId) => this.modules.has(moduleId) || waiting.has(moduleId) || movedModule(moduleId) !== undefined)) this.closeView(instanceId);
  }

  // ── Pictures of modules ──────────────────────────────────────────────

  private async openModulesFolder(): Promise<void> {
    const dir = userModulesDir(this.options);
    await mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new LibraryError("error.openModulesFolder", { problem: error });
  }

  /** Opens a folder Settings lists as not loading; only those, so the host UI cannot open any path. */
  private async openModuleProblemFolder(dir: string): Promise<void> {
    if (!this.moduleProblems.some((problem) => !problem.developmentFolder && problem.path === dir)) return;
    const error = await shell.openPath(dir);
    if (error) throw new LibraryError("error.openFolder", { problem: error });
  }

  /** Starts a module's open panels again, so they load a new version or connect with a new grant. */
  private reloadModuleViews(moduleId: string): void {
    for (const view of this.moduleViews()) if (view.moduleId === moduleId) view.reload();
    // Panels that asked before they could run start now, in the workspace shown (the others start when it opens).
    const workspace = this.workspace;
    if (!workspace) return;
    if (this.needsAnswer(moduleId)) return;
    for (const record of this.records(workspace.id)) {
      if (record.moduleId !== moduleId || !this.panels.stopAwaiting(record.instanceId)) continue;
      this.createView(record, workspace, performance.now());
    }
    // The window already said where these panels are; put the new pages there now, so they load and show.
    this.panels.applyBounds();
    this.pushState();
  }

  /** A module that still misses access it needs: its panels ask before its page may run (questionOf). */
  private needsAnswer(moduleId: string): boolean {
    const module = this.modules.get(moduleId);
    if (!module || module.builtIn) return false;
    const missing = this.grants.missing(module);
    return missing.network.length > 0 || missing.connectors.length > 0;
  }

  /**
   * Permission questions live in the panel that asks (decision of 2026-10-28). Panels added while their module still
   * misses access it needs: the first of them asks, the others wait, and none starts its page until the user allows.
   * A running module that asks for a connector on request: its first panel shows the question over its page, which is
   * hidden meanwhile; its other panels go on. A panel that already runs while its module asks for more (a local update)
   * keeps running with what was granted and offers a review instead. `records` are the panels of the panel's workspace.
   */
  private questionOf(record: InstanceRecord, records: readonly InstanceRecord[]): "ask" | "wait" | null {
    if (this.panels.isAwaiting(record.instanceId)) {
      const asking = records.find((item) => item.moduleId === record.moduleId && this.panels.isAwaiting(item.instanceId));
      return asking?.instanceId === record.instanceId ? "ask" : "wait";
    }
    // The leaderboards' question shows in the panel that asked for it.
    const board = this.questions.peek("leaderboard");
    if (board && "panel" in board.scope && board.scope.panel === record.instanceId) return "ask";
    const first = records.find((item) => item.moduleId === record.moduleId)?.instanceId === record.instanceId;
    return first && this.questions.peek("connector")?.payload.moduleId === record.moduleId ? "ask" : null;
  }

  /** The workspaces, by id in the library, with a panel of this module. */
  private workspacesUsing(moduleId: string): string[] {
    return this.workspaces.workspacesUsing(moduleId).filter((workspaceId) => workspaceId in this.library.workspaces);
  }

  /** Removes a module's panels in every workspace; a slot left with nothing stays as an empty slot. */
  private removeModulePanels(moduleId: string): void {
    for (const instanceId of this.workspaces.vacate(moduleId)) this.closeView(instanceId);
  }

  /** Takes a module out of the current workspace only: its panels close the same way, so the layout stays. Module data stays. */
  private removeModuleFromWorkspace(moduleId: string): void {
    const workspace = this.workspace;
    if (!workspace) return;
    for (const instanceId of this.workspaces.vacate(moduleId, workspace.id)) this.closeView(instanceId);
  }

  /** Installs a module from a zip the user picks. Answers with the module's id, or nothing when the user cancelled. */
  private async installModule(): Promise<string | void> {
    const file = await this.pickPath("install-module", {
      title: translate(this.language, "dialog.installModule"),
      properties: ["openFile"],
      filters: [{ name: translate(this.language, "dialog.moduleZip"), extensions: ["zip"] }],
    });
    if (!file) return;
    const id = await this.lifecycle.installFile(file);
    this.rememberPicked("install-module", file);
    return id;
  }

  /** Where the Browse tab of the module library looks: the current game workspace's game, or a personal workspace. */
  private catalogScope(): CatalogScope | null {
    const id = this.workspaceId;
    const workspace = id ? this.library.workspaces[id] : undefined;
    if (!workspace) return null;
    return workspace.kind === "personal" ? { personal: true } : { game: workspace.catalogId ?? workspace.id };
  }

  /**
   * Reports a module to Tavora (C12). A module installed from the catalog is reported as the zip that
   * is installed, the one the user has seen; any other id as the version the catalog lists now.
   * Only the id, the key and the zip's hash are sent, and only because the user pressed Report.
   */
  private async reportCatalogModule(moduleId: string, why: { reason: string; note: string | null }): Promise<void> {
    if (!this.library.onlineSearch) throw new UserError("error.reportOff");
    const token = this.account.token();
    if (!token) throw new UserError("error.reportSignIn");
    const module = this.catalogModules.has(moduleId) ? (this.modules.get(moduleId) ?? this.blockedModules.get(moduleId)) : undefined;
    const record = module ? (await readOwnerRecords(this.options.userData))[path.basename(module.root)] : undefined;
    if (module && record?.id === moduleId && record.sha256) {
      await this.catalog.report({ id: moduleId, owner: module.owner, sha256: record.sha256 }, token, why);
      return;
    }
    const entry = await this.catalog.module(moduleId);
    await this.catalog.report({ id: entry.id, owner: entry.owner, sha256: entry.zip.sha256 }, token, why);
  }

  /**
   * Opens a catalog module's homepage like a link from a module (C10): only http or https, in the
   * workspace's Browser panel or where the user picks. The address comes from the listing, asked for again here.
   */
  private async openCatalogHomepage(moduleId: string): Promise<void> {
    if (!this.library.onlineSearch) throw new UserError("error.catalogOff");
    const { homepage } = await this.catalog.module(moduleId);
    if (homepage && isWebUrl(homepage)) this.openLinkFromModule(homepage);
  }

  /**
   * Opens a module's support link after a click. The link is read again here, from the installed module's own
   * manifest or the catalog listing, never taken from the page: a web address opens like the homepage, an
   * email address in the user's mail app.
   */
  private async openModuleSupport(moduleId: string, source: "catalog" | "installed"): Promise<void> {
    let link: string | null | undefined;
    if (source === "installed") link = this.modules.get(moduleId)?.manifest.support;
    else {
      if (!this.library.onlineSearch) throw new UserError("error.catalogOff");
      link = (await this.catalog.module(moduleId)).support;
    }
    const target = link ? supportTarget(link) : null;
    if (!target) return;
    if (target.kind === "web") this.openLinkFromModule(target.url);
    else if (!this.options.hidden) void shell.openExternal(target.url).catch((error: unknown) => console.error("[tavora]", error));
  }

  /**
   * Opens a link from a catalog module's readme in a Browser panel. The readme is read again here and
   * the address must be one of its http or https links, so the page can't ask for any other address.
   */
  private async openReadmeLink(moduleId: string, url: string): Promise<void> {
    if (!this.library.onlineSearch) throw new UserError("error.catalogOff");
    const { readme } = await this.catalog.details(moduleId);
    if (!readmeAllowsLink(readme, url)) throw new UserError("error.readmeLink");
    this.openLinkFromModule(url);
  }

  /**
   * A catalog module's page: the listing asked for again, its readme as plain text blocks and its
   * screenshots, each checked on its own (catalog-client.ts); a screenshot that fails is left out.
   */
  private async catalogPage(moduleId: string): Promise<CatalogPageResult> {
    if (!this.library.onlineSearch) return { status: "off" };
    let details;
    try {
      details = await this.catalog.details(moduleId);
    } catch (error) {
      const key = error instanceof UserError ? error.key : "";
      if (key === "error.catalogNotListed") return { status: "gone" };
      if (key === "error.catalogUnavailable") return { status: "unavailable" };
      if (key === "error.catalogBusy") return { status: "busy" };
      return { status: "unreachable" };
    }
    const shots = await Promise.all(details.entry.shots.map((shot) => this.catalog.picture(shot)));
    return {
      status: "ok",
      module: catalogView(details.entry, this.language, this.catalogScope() ?? undefined),
      screenshots: shots.filter((url): url is string => url !== null),
      readme: details.readme === null ? [] : parseReadme(details.readme),
      versions: details.versions,
    };
  }

  /** An installed module's page from its own folder (module-page.ts), so it works offline. */
  private async modulePage(moduleId: string): Promise<ModulePageResult> {
    const module = this.modules.get(moduleId);
    if (!module) return { status: "gone" };
    return { status: "ok", ...(await readModulePage(module.root, module.manifest)) };
  }

  /**
   * A catalog module's ratings and reviews (decided 2026-10-21), with the user's own rating and what
   * they can do. Rating needs a sign-in, not the module installed: someone who removed a bad module can
   * still rate it (decided 2026-10-27). Each reviewer's picture is fetched by its hash and checked like a listed picture.
   */
  private async catalogReviews(moduleId: string): Promise<CatalogReviewsResult> {
    if (!this.library.onlineSearch) return { status: "off" };
    const token = this.account.token();
    let listed;
    let own: { mine: CatalogReviews["mine"]; own: boolean } = { mine: null, own: false };
    try {
      listed = await this.catalog.reviews(moduleId);
      if (token) own = await this.catalog.ownReview(moduleId, token).catch(() => own);
    } catch (error) {
      const key = error instanceof UserError ? error.key : "";
      if (key === "error.catalogNotListed") return { status: "gone" };
      if (key === "error.catalogUnavailable" || key === "error.reviewsUnavailable") return { status: "unavailable" };
      if (key === "error.catalogBusy") return { status: "busy" };
      return { status: "unreachable" };
    }
    const pictures = await Promise.all(listed.reviews.map((review) => (review.author.picture ? this.catalog.reviewerPicture(review.id, review.author.picture) : null)));
    const installedVersion = this.modules.get(moduleId)?.manifest.version ?? null;
    return {
      status: "ok",
      rating: listed.rating,
      reviews: listed.reviews.map((review, index) => ({ ...review, author: { ...review.author, picture: pictures[index] ?? null } })),
      mine: own.mine,
      can: own.own ? "own" : !token ? "sign-in" : "rate",
      installedVersion,
    };
  }

  /**
   * Rates a catalog module on its installed version, which must be one the catalog published, or on its
   * newest published version when it isn't installed.
   */
  private async rateCatalogModule(moduleId: string, stars: number, text: string | null): Promise<void> {
    if (!this.library.onlineSearch) throw new UserError("error.catalogOff");
    const token = this.account.token();
    if (!token) throw new UserError("account.error.signedOut");
    const installed = this.modules.get(moduleId)?.manifest.version;
    const { versions } = await this.catalog.details(moduleId);
    const version = installed ?? versions.map((published) => published.version).sort(compareModuleVersions).at(-1);
    if (!version || !versions.some((published) => published.version === version)) throw new UserError("error.reviewVersion");
    await this.catalog.rate(moduleId, token, { stars, text: text?.trim() || null, version });
  }

  /** A messages action: online features must be on, and the user needs a sign-in. */
  private async inboxAction<T>(run: () => Promise<T>): Promise<T> {
    if (!this.library.onlineSearch) throw new UserError("error.catalogOff");
    if (!this.account.token()) throw new UserError("account.error.signedOut");
    return run();
  }

  private async catalogReviewAction(run: (token: string) => Promise<void>): Promise<void> {
    if (!this.library.onlineSearch) throw new UserError("error.catalogOff");
    const token = this.account.token();
    if (!token) throw new UserError("account.error.signedOut");
    await run(token);
  }

  /**
   * Looks for updates of modules installed from the catalog a little after start and then every few
   * hours, only while online features are on. Test runs check only when asked.
   */
  private checkCatalogSoon(): void {
    if (this.options.hidden) return;
    setTimeout(() => void this.checkCatalogUpdates(), 30_000).unref?.();
    this.catalogTimer = setInterval(() => void this.checkCatalogUpdates(), CHECK_INTERVAL_MS);
    this.catalogTimer.unref?.();
  }

  /**
   * One update check (catalog-updates.ts). Updates that ask for nothing new are installed and their
   * panels reload; the others wait for the user, shown in Settings > Modules and on their panels.
   * Answers with how many modules were updated or are waiting.
   */
  private async checkCatalogUpdates(): Promise<{ updated: number; waiting: number; unreachable?: true; failed?: number }> {
    if (!this.library.onlineSearch) return { updated: 0, waiting: 0 };
    const { updated, waiting, unreachable, failed } = await this.lifecycle.updates.check();
    if (updated.length === 1) {
      const { manifest } = updated[0]!;
      this.notice = translate(this.language, "modules.catalogUpdated", { name: this.shown(manifest).name, version: manifest.version });
    } else if (updated.length > 1) {
      this.notice = translate(this.language, "modules.catalogUpdatedMany", { count: String(updated.length) });
    }
    this.pushState();
    return { updated: updated.length, waiting: waiting.length, ...(unreachable ? { unreachable } : {}), ...(failed ? { failed } : {}) };
  }

  private static themeSources(options: HostOptions) {
    return { official: options.officialThemeDirs, local: [path.join(options.userData, "themes"), ...(options.themeDirs ?? [])] };
  }

  /** The window buttons, in the theme's colours; under a dialog backdrop dimmed like the page around them. */
  private titleBarOverlay() {
    const { background, text } = this.currentTheme.colors;
    const veil = this.dimmed ? DIALOG_BACKDROP_OPACITY : 0;
    return { color: veiled(background, veil), symbolColor: veiled(text, veil), height: TITLE_BAR_HEIGHT };
  }

  private applyTitleBarOverlay(): void {
    if (this.window.isDestroyed()) return;
    try {
      this.window.setTitleBarOverlay(this.titleBarOverlay());
    } catch {
      // Platforms without a window controls overlay have nothing to recolour.
    }
  }

  /** The system's light or dark setting. */
  private static systemMode(options: HostOptions): "dark" | "light" {
    if (options.systemTheme) return options.systemTheme;
    // Only while the native theme follows the system does it say what the system says.
    nativeTheme.themeSource = "system";
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }

  /** The theme and variation in use now: the user's pick, in the mode of the system when following it. */
  private currentChoice() {
    return resolveTheme(this.themes, this.library.theme, this.library.followSystem ? Host.systemMode(this.options) : undefined);
  }

  /** Native menus, dialogs and scrollbars: left to the system while following it, else in the theme's mode. */
  private syncNativeTheme(): void {
    nativeTheme.themeSource = this.library.followSystem && !this.options.systemTheme ? "system" : this.currentTheme.mode;
  }

  /** Shows the theme the library names, in the host window, native controls and every open module. */
  private applyTheme(): void {
    const next = moduleTheme(this.currentChoice().variation, this.library.toasts);
    if (JSON.stringify(next) === JSON.stringify(this.currentTheme)) {
      this.syncNativeTheme();
      return;
    }
    this.currentTheme = next;
    this.syncNativeTheme();
    this.window.setBackgroundColor(next.colors.background);
    this.applyTitleBarOverlay();
    for (const view of this.nativePanels()) view.applyTheme(next);
  }

  private async reloadThemes(): Promise<void> {
    const { themes, problems } = await discoverThemes(Host.themeSources(this.options));
    this.themes = themes;
    this.themeProblems = problems;
    this.applyTheme();
  }

  /** Writes a copy of the Tavora theme into the themes folder, loads it and shows the folder. */
  private async createStarterTheme(): Promise<string> {
    const root = path.join(this.options.userData, "themes");
    await mkdir(root, { recursive: true });
    let suffix = 1;
    const folder = (n: number) => path.join(root, n > 1 ? `my-theme-${n}` : "my-theme");
    const taken = (n: number) => this.themes.has(starterTheme(this.themes, n).id) || existsSync(folder(n));
    while (taken(suffix)) suffix++;
    const theme = starterTheme(this.themes, suffix);
    await mkdir(folder(suffix));
    await writeFileAtomic(path.join(folder(suffix), THEME_MANIFEST), themeManifest(theme));
    await writeFileAtomic(path.join(folder(suffix), "README.txt"), STARTER_README);
    await this.reloadThemes();
    // Test runs keep the window hidden and open no file manager.
    if (!this.options.hidden) void shell.openPath(folder(suffix));
    return theme.id;
  }

  private async openThemesFolder(): Promise<void> {
    const dir = path.join(this.options.userData, "themes");
    await mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new LibraryError("error.openThemesFolder", { problem: error });
  }

  /** The text of Settings > Copy diagnostic info. */
  private async diagnosticReport(): Promise<string> {
    const log = await readFile(path.join(this.options.userData, "updates.log"), "utf8").catch(() => "");
    return buildReport({
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron ?? "?",
      chrome: process.versions.chrome ?? "?",
      locale: app.getLocale(),
      workspaces: Object.keys(this.library.workspaces).length,
      panels: this.panels.size,
      updateLog: log.split("\n").filter(Boolean).slice(-30),
      errors: errorLog.recent(),
      timings: timings.summary(),
      uptimeSeconds: process.uptime(),
      folders: { home: os.homedir(), userData: this.options.userData },
    });
  }

  /** One line per update event in the app's data folder, to see what the updater did. */
  private logUpdate(line: string): void {
    console.log(`[tavora] ${line}`);
    void appendFile(path.join(this.options.userData, "updates.log"), `${new Date().toISOString()} ${line}\n`).catch(() => undefined);
  }

  /** The workspace shown now, by id; null on Home. */
  private get workspaceId(): string | null {
    return this.screen === "workspace" ? this.library.lastWorkspaceId : null;
  }

  /** The workspace shown now, as its panels see it; null on Home. */
  private get workspace(): TavoraWorkspace | null {
    const id = this.workspaceId;
    const entry = id ? this.library.workspaces[id]! : null;
    return entry ? { id: entry.id, displayName: entry.name, kind: entry.kind } : null;
  }

  private records(workspaceId: string): InstanceRecord[] {
    return this.workspaces.panels(workspaceId);
  }


  // ── IPC ──────────────────────────────────────────────────────────────

  private registerIpc(): void {
    // Module side: the only messages a module renderer can send. Identity is
    // looked up from the sending webContents, never taken from the message.
    ipcMain.on("tavora:hello", (event: IpcMainEvent) => {
      const view = this.moduleByContents(event.sender.id);
      if (!view || !event.senderFrame || event.senderFrame.parent !== null) return;
      view.connect();
    });
    ipcMain.on("tavora:gesture", (event: IpcMainEvent) => {
      if (event.senderFrame?.parent !== null) return;
      this.moduleByContents(event.sender.id)?.noteGesture();
    });
    ipcMain.on("tavora:pointer",(event:IpcMainEvent,point:unknown)=>{
      if(event.senderFrame?.parent!==null)return;
      this.moduleByContents(event.sender.id)?.notePointer(point);
    });
    ipcMain.on("tavora:framed", (event: IpcMainEvent, requestId: unknown) => {
      if (event.senderFrame?.parent !== null) return;
      this.moduleByContents(event.sender.id)?.framed(requestId);
    });
    ipcMain.on("tavora:frame-seen", (event: IpcMainEvent, visibility: unknown) => {
      if (event.senderFrame?.parent !== null) return;
      this.moduleByContents(event.sender.id)?.frameSeen(visibility);
    });
    ipcMain.on("tavora:pong", (event: IpcMainEvent) => {
      if (event.senderFrame?.parent !== null) return;
      this.moduleByContents(event.sender.id)?.pong();
    });

    // Host UI side: only the host window's main frame may call these.
    const fromHost = (event: IpcMainInvokeEvent | IpcMainEvent) =>
      event.sender.id === this.window.webContents.id && event.senderFrame?.parent === null;

    // The layer on the Overlay page's canvas reads the host's state (the theme and language), and nothing else.
    const layerPage = (event: IpcMainInvokeEvent | IpcMainEvent) => this.canvas?.kindOf(event.sender.id, event.senderFrame?.parent === null) === "layer";
    ipcMain.handle("host:get-state", (event) => (fromHost(event) || layerPage(event) ? this.viewState() : null));
    const handlers = this.actionHandlers();
    ipcMain.handle("host:action", async (event, raw: unknown): Promise<ActionResult> => {
      if (!fromHost(event)) return { ok: false, error: translate(this.language, "error.notAllowed") };
      const action = parseAction(raw);
      if (!action) return { ok: false, error: translate(this.language, "error.notUnderstood") };
      try {
        return await runAction(handlers, action);
      } catch (error) {
        if (error instanceof UserError) {
          return { ok: false, error: translate(this.language, error.key, error.params) };
        }
        console.error(`[tavora] ${action.type} failed`, error);
        return { ok: false, error: translate(this.language, "error.generic") };
      } finally {
        this.pushState();
      }
    });
    // The Overlay page's two pieces: the page in the main window and the layer on the canvas.
    const layoutSender = (event: IpcMainInvokeEvent | IpcMainEvent) => (this.screen === "overlay" ? this.canvas?.kindOf(event.sender.id, event.senderFrame?.parent === null) : null) ?? null;
    ipcMain.handle("layout:get-state", (event) => (layoutSender(event) ? this.layout.view() : null));
    ipcMain.on("layout:message", (event, raw: unknown) => {
      const kind = layoutSender(event);
      const message = kind ? parseLayoutMessage(raw) : null;
      if (kind && message) this.layout.handle(message, kind === "shell");
    });
    ipcMain.on("layout:stills-shown", (event) => {
      if (layoutSender(event) === "shell") this.canvas?.stillsShown();
    });
    ipcMain.handle("host:get-discord", (event) => (fromHost(event) ? this.discord.view() : null));
    ipcMain.handle("host:get-ai-usage", (event) => (fromHost(event) ? this.aiUsage.view() : null));
    ipcMain.handle("host:get-account", (event) => (fromHost(event) ? this.account.view() : null));
    ipcMain.handle("host:profile-ranks", (event) => (fromHost(event) ? this.profileRanks() : null));
    ipcMain.handle("host:get-cloud-copy", (event) => (fromHost(event) ? this.copySync.view() : null));
    ipcMain.handle("host:get-developer-keys", (event) => (fromHost(event) ? this.developerKeys.view() : null));
    ipcMain.handle("host:get-publish", (event) => (fromHost(event) ? this.publisher.view() : null));
    ipcMain.handle("host:get-inbox", (event) => (fromHost(event) ? this.inbox.view() : null));
    ipcMain.handle("host:conversation", (event, id: unknown) => (fromHost(event) && typeof id === "string" ? this.inbox.conversation(id) : { status: "error", error: translate(this.language, "error.notUnderstood") }));
    ipcMain.handle("host:contact-draft", (event, moduleId: unknown) =>
      fromHost(event) && isModuleId(moduleId) ? this.inbox.contactDraft(moduleId) : { status: "error", error: translate(this.language, "error.notUnderstood") },
    );
    ipcMain.handle("host:get-pairing", (event) => (fromHost(event) ? this.pairing.view() : null));
    ipcMain.handle("host:module-notes", (event, moduleId: unknown) => {
      const module = fromHost(event) && typeof moduleId === "string" ? this.modules.get(moduleId) : undefined;
      return module ? installedNotes(this.moduleInfo.get(module.manifest.id)?.changelog ?? [], module.manifest.version) : [];
    });
    ipcMain.handle("host:search-catalog", (event, query: unknown) =>
      fromHost(event) && typeof query === "string" && query.length <= 100
        ? searchCatalog(this.library, query).map(({ id, name }) => ({ id, name }))
        : [],
    );
    // The first-run welcome's tiles: popular games the user does not have yet (Trash included).
    ipcMain.handle("host:popular-games", (event) =>
      fromHost(event)
        ? popularGames()
            .filter((game) => !this.library.workspaces[game.id])
            .map(({ id, name }) => ({ id, name }))
        : [],
    );
    ipcMain.handle("host:search-online", async (event, query: unknown): Promise<OnlineSearchResult> => {
      if (!fromHost(event) || typeof query !== "string" || query.length > 100) return { status: "ok", games: [] };
      if (!this.library.onlineSearch) return { status: "off", games: [] };
      const result = await this.onlineSearch.search(query);
      // Games the user already has (Trash included) are not offered again.
      return { ...result, games: result.games.filter((game) => !this.library.workspaces[game.id]) };
    });
    ipcMain.handle("host:browse-catalog", async (event): Promise<CatalogListResult> => {
      if (!fromHost(event)) return { status: "unreachable" };
      if (!this.library.onlineSearch) return { status: "off" };
      const scope = this.catalogScope();
      return scope ? this.catalog.list(scope, this.language) : { status: "ok", modules: [] };
    });
    ipcMain.handle("host:catalog-page", async (event, moduleId: unknown): Promise<CatalogPageResult> =>
      fromHost(event) && isModuleId(moduleId) ? this.catalogPage(moduleId) : { status: "gone" },
    );
    ipcMain.handle("host:module-page", async (event, moduleId: unknown): Promise<ModulePageResult> =>
      fromHost(event) && isModuleId(moduleId) ? this.modulePage(moduleId) : { status: "gone" },
    );
    ipcMain.handle("host:catalog-reviews", async (event, moduleId: unknown): Promise<CatalogReviewsResult> =>
      fromHost(event) && isModuleId(moduleId) ? this.catalogReviews(moduleId) : { status: "gone" },
    );
    ipcMain.handle("host:release-statuses", async (event, copies: unknown): Promise<Record<string, ReleaseStatus> | null> => {
      if (!fromHost(event) || !this.library.onlineSearch || !isReleaseCopies(copies)) return null;
      const [index, waiting] = await Promise.all([this.catalog.index(), this.account.waitingVersions()]);
      return releaseStatuses(index, copies, waiting);
    });
    ipcMain.handle("host:catalog-icon", async (event, moduleId: unknown): Promise<string | null> =>
      fromHost(event) && isModuleId(moduleId) && this.library.onlineSearch ? this.catalog.icon(moduleId) : null,
    );
    ipcMain.handle("host:steam-library", async (event, profile: unknown): Promise<SteamLibraryResult> => {
      if (!fromHost(event) || typeof profile !== "string") return { status: "error", error: translate(this.language, "error.notUnderstood") };
      if (!this.library.onlineSearch) return { status: "error", error: translate(this.language, "error.onlineOff") };
      const result = await fetchSteamLibrary({ baseUrl: serviceUrl(this.options.apiUrl), language: this.language }, profile);
      if (result.status !== "ok") return result;
      // Kept for sharing icons without adding the games: only games the service listed can be offered.
      this.steamLookup = result.games;
      this.steamOffers.clear();
      return steamLibraryView(this.library, result.games);
    });
    ipcMain.handle("host:steam-share-icons", async (event, appids: unknown): Promise<SteamShareResult> => {
      if (!fromHost(event) || !Array.isArray(appids) || appids.length > MAX_IMPORT_GAMES || !appids.every(isSteamAppId)) {
        return { status: "error", error: translate(this.language, "error.notUnderstood") };
      }
      return this.steamShareIcons(appids);
    });
    ipcMain.on("host:panel-bounds", (event, bounds: unknown) => {
      if (fromHost(event)) {
        this.panels.place(bounds);
        this.openPendingDialog();
      }
    });
    ipcMain.on("host:workspace-bounds", (event, bounds: unknown) => {
      if (fromHost(event)) this.cover.setBounds(this.windowRect(bounds));
    });
    ipcMain.on("host:overlay", (event, open: unknown) => {
      if (fromHost(event) && typeof open === "boolean") void this.panels.freeze(open);
    });
    ipcMain.on("host:frozen-shown", (event) => {
      if (fromHost(event)) this.frozenShown?.();
    });
    ipcMain.on("host:dimmed", (event, dimmed: unknown) => {
      if (fromHost(event) && typeof dimmed === "boolean" && dimmed !== this.dimmed) {
        this.dimmed = dimmed;
        this.applyTitleBarOverlay();
      }
    });
    ipcMain.on("host:module-menu-answer", (event, answer: unknown) => {
      if (fromHost(event)) this.answerModuleMenu(answer);
    });
    ipcMain.on("host:panel-dialog-bounds", (event, raw: unknown) => {
      if (fromHost(event)) this.panels.placeDialog(raw);
    });
    ipcMain.on("host:panel-dialog-close", (event) => {
      if (fromHost(event)) this.panels.closeDialog();
    });
  }

  private registerWindowEvents(): void {
    this.window.on("resize", () => this.saveWindowSoon());
    this.window.on("move", () => this.saveWindowSoon());
    this.window.on("close", (event) => {
      this.saveWindow();
      // The last changes go to the cloud copy first; the window closes once they are up.
      if (this.copySync.holdClose(() => this.window.close())) event.preventDefault();
    });
    const hidden = (value: boolean) => () => {
      this.windowHidden = value;
      this.panels.applyBounds();
    };
    // The host page crashed or ran out of memory: it loads again once. A second crash within a minute loads
    // the error screen instead (?crashed=, see renderer/main.ts), so a page that keeps crashing isn't a loop.
    let lastCrash = 0;
    this.window.webContents.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit" || this.window.isDestroyed()) return;
      console.error(`[tavora] the host page is gone: ${details.reason} (exit code ${details.exitCode})`);
      const page = new URL(this.options.devServer ?? `${HOST_SCHEME}://app/index.html`);
      if (Date.now() - lastCrash < 60_000) page.searchParams.set("crashed", `${details.reason} (exit code ${details.exitCode})`);
      lastCrash = Date.now();
      void this.window.loadURL(page.href);
    });
    this.window.on("minimize", hidden(true));
    this.window.on("hide", hidden(true));
    this.window.on("restore", hidden(false));
    this.window.on("show", hidden(false));
    this.window.on("closed", () => {
      this.windowClosed = true;
      // The overlay windows (and the keys for arranging) go with the main window; they would keep Tavora running.
      this.closeOverlayWindows();
      void this.gameOverlays.shutdown().catch((error: unknown) => console.error("[tavora]", error));
      this.panels.disposeAll();
      this.cover.dispose();
      this.discord.dispose();
      this.systemInfo.dispose();
      this.connection.dispose();
      this.media.dispose();
      this.gameWatcher.stop();
      this.copySync.dispose();
      this.pairing.dispose();
      clearInterval(this.catalogTimer);
      this.inbox.dispose();
    });
  }

  private modulePublisher(): ModulePublisher {
    const linked = () => (this.account.view().publisherKeys ?? []).map((key) => key.fingerprint);
    return new ModulePublisher({
      key: (prefer) => this.developerKeys.keyFor(linked(), prefer),
      account: {
        prefixes: () => this.account.view().prefixes,
        developerName: () => this.account.view().developer?.name ?? null,
        checkPrefix: (prefix) => this.account.checkPrefix(prefix),
        upload: (key, zip) => this.account.uploadModule(key, zip),
      },
      listed: async (id) => {
        try {
          const { entry } = await this.catalog.details(id);
          return { version: entry.version, owner: entry.owner };
        } catch (error) {
          if (error instanceof UserError && error.key === "error.catalogNotListed") return null;
          throw error;
        }
      },
      // The installer's checks as if nothing were installed: the module itself is loaded from its project.
      check: async (zip) => {
        await checkZipData(zip, { userData: this.options.userData, userModules: path.join(this.options.userData, "publish-check"), modules: new Map(), tavoraVersion: app.getVersion(), safety: this.safetyLists });
      },
      icon: (id) => this.moduleInfo.get(id)?.icon ?? null,
      translate: (error) => translate(this.language, error.key, error.params),
      onChange: (view) => {
        if (!this.window.isDestroyed()) this.window.webContents.send("host:publish", view);
      },
    });
  }

  /** The project folder a dev module was loaded from, for Publish and Save as zip. */
  private projectOf(moduleId: string): string {
    const project = this.modules.get(moduleId)?.developmentProject;
    if (!project) throw new UserError("publish.error.noProject");
    return project;
  }

  /** Packs a dev module signed with a kept key and saves the zip where the developer picks. */
  /**
   * The system's save dialog with the zip's name suggested (numbered when taken), opening where the user last
   * saved a module zip while that folder is still there, else Documents\Tavora.
   */
  private async saveModuleZip(moduleId: string): Promise<string | undefined> {
    const { manifest, zip } = await this.publisher.pack(this.projectOf(moduleId));
    const folder = await this.ownFileFolder("module-zip");
    const german = this.language.startsWith("de");
    const picked = await dialog.showSaveDialog(this.window, {
      title: german ? "Modul als ZIP speichern" : "Save module as zip",
      defaultPath: path.join(folder, freeFileName(`${manifest.id}-${manifest.version}`, (fileName) => existsSync(path.join(folder, fileName)), "zip")),
      filters: [{ name: german ? "ZIP-Dateien" : "Zip files", extensions: ["zip"] }],
      properties: ["showOverwriteConfirmation"],
    });
    if (picked.canceled || !picked.filePath) return undefined;
    const file = await writeWithExtension(picked.filePath, "zip", zip);
    this.rememberPicked("module-zip", file);
    return path.basename(file);
  }

  /** How the window is now, so a restart under `pnpm dev` brings it back the same way. */
  windowLook(): WindowStart {
    return windowLook(this.window);
  }

  /**
   * `pnpm dev` rebuilt a module in the repo (modules/, examples/): its open panels load the new build, the way a
   * development folder's do, instead of Tavora restarting. A module that had not loaded is looked for again.
   */
  async moduleBuilt(dir: string): Promise<void> {
    const real = await realpath(dir).catch(() => dir);
    const same = (root: string) => path.relative(root, real) === "";
    let module = [...this.modules.values()].find((item) => same(item.root));
    if (!module) {
      await this.reloadModules();
      this.pushState();
      module = [...this.modules.values()].find((item) => same(item.root));
    }
    if (module) this.reloadModuleViews(module.manifest.id);
  }

  /** Shows the window in front, for a question that came from outside it (the pack command's sign request). */
  private bringToFront(): void {
    if (this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    if (!this.window.isVisible()) this.window.show();
    this.window.focus();
  }

  // ── Actions ──────────────────────────────────────────────────────────

  /** What each action does; actions that change the library save it after. */
  private actionHandlers(): ActionHandlers {
    const saved =
      <A>(change: (action: A) => unknown) =>
      async (action: A): Promise<void> => {
        await change(action);
        this.saveLibrary();
      };
    const pageSite = (instanceId: string) => {
      const site = siteOfUrl(this.browser(instanceId).state.url);
      if (!site) throw new LibraryError("error.openPageFirst");
      return site;
    };
    return {
      // Answers to questions on screen
      "show-welcome": () => this.showScreen("welcome"),
      "link-choice": (action) => this.chooseLink(action.choice),
      "navigation-choice": (action) => this.chooseNavigation(action.choice),
      "game-switch": (action) => this.chooseGameSwitch(action.choice),

      // App
      "module-files-change": () => this.files.change(),
      "module-files-reset": () => this.files.reset(),
      "module-files-open": () => this.files.open(),
      restart: () => this.options.restart(),
      "download-update": () => this.updates?.download(),
      "check-for-updates": () => {
        if (!this.updates) throw new LibraryError("error.updatesDev");
        return this.updates.check();
      },
      "restart-to-update": () => this.updates?.restartNow(),
      "record-timing": (action) => {
        timings.record(action.name, action.ms);
      },
      "copy-diagnostics": async () => {
        clipboard.writeText(await this.diagnosticReport());
      },
      "open-backups": async () => {
        const dir = backupsDir(this.options.userData);
        await mkdir(dir, { recursive: true });
        const problem = await shell.openPath(dir);
        if (problem) throw new LibraryError("error.openFolder", { problem });
      },

      // Library
      "open-workspace": (action) => this.openWorkspace(action.workspaceId),
      "add-workspace": (action) => {
        const id = addWorkspace(this.library, action, new Date());
        this.workspaces.addWorkspaces([id]);
        this.startWorkspace(id);
        this.saveLibrary();
        this.fetchIconsSoon();
        // The game of a game workspace added just now may have been installed since the last look.
        if (this.gameWatcher.active) void this.gameWatcher.refreshInstalled();
        return id;
      },
      "rename-workspace": saved((action) => renameWorkspace(this.library, action.workspaceId, action.name)),
      "set-workspace-label": saved(async (action) => {
        const previous = setWorkspaceLabel(this.library, action.workspaceId, action.label);
        await this.dropIconFile(previous);
      }),
      "choose-workspace-image": saved((action) => this.chooseWorkspaceImage(action.workspaceId)),
      "use-original-icon": saved(async (action) => {
        const previous = useOriginalWorkspaceIcon(this.library, action.workspaceId);
        await this.dropIconFile(previous);
      }),
      "share-icons": (action) => this.shareIcons(action.workspaceIds),
      "share-steam-icons": (action) => this.shareSteamIcons(action.appids),
      "import-steam-games": (action) => this.importSteam(action.games),
      "trash-workspace": saved((action) => {
        const wasOpen = this.workspaceId === action.workspaceId;
        trashWorkspace(this.library, action.workspaceId, new Date());
        if (wasOpen) this.showScreen("welcome");
      }),
      "restore-workspace": saved((action) => restoreWorkspace(this.library, action.workspaceId)),
      "delete-workspace": saved(async (action) => {
        const workspace = deleteTrashedWorkspace(this.library, action.workspaceId);
        this.saveLibrary();
        await this.deleteWorkspaceData(workspace);
      }),
      // Many at once: workspaces already gone are skipped, so a list the screen showed a moment ago still works.
      "trash-workspaces": saved((action) => {
        const live = action.workspaceIds.filter((id) => isLive(this.library, id));
        for (const id of live) trashWorkspace(this.library, id, new Date());
        if (this.workspaceId !== null && live.includes(this.workspaceId)) this.showScreen("welcome");
      }),
      "restore-workspaces": saved((action) => {
        for (const id of action.workspaceIds) if (this.library.workspaces[id]?.trashedAt) restoreWorkspace(this.library, id);
      }),
      "delete-workspaces": saved(async (action) => {
        const workspaces = action.workspaceIds.filter((id) => this.library.workspaces[id]?.trashedAt).map((id) => deleteTrashedWorkspace(this.library, id));
        this.saveLibrary();
        for (const workspace of workspaces) await this.forgetWorkspaceData(workspace);
        await this.clearOrphanedSessions();
      }),
      favorite: saved((action) => placeFavorite(this.library, action.workspaceId, action.index)),
      unfavorite: saved((action) => removeFavorite(this.library, action.workspaceId)),
      "move-workspace": saved((action) => moveWorkspace(this.library, action.workspaceId, action)),
      "create-folder": (action) => {
        const id = createFolder(this.library, action.name, action.workspaceIds.filter((id) => isLive(this.library, id)));
        this.saveLibrary();
        return id;
      },
      "rename-folder": saved((action) => renameFolder(this.library, action.folderId, action.name)),
      "set-folder-label": saved((action) => setFolderLabel(this.library, action.folderId, action.label)),
      "delete-folder": saved((action) => deleteFolder(this.library, action.folderId)),
      "move-folder": saved((action) => moveFolder(this.library, action.folderId, action.index)),

      // Settings
      "set-sort": saved((action) => {
        this.library.sort = action.sort;
      }),
      "set-startup": saved((action) => {
        this.library.startup = action.startup;
      }),
      "set-game-start": saved((action) => {
        this.library.gameStart = action.gameStart;
        if (action.gameStart !== "ask") this.questions.cancelKind("gameSwitch");
        this.syncGameWatcher();
      }),
      "set-game-end": saved((action) => {
        if (action.workspaceId !== null && !(isLive(this.library, action.workspaceId) && this.library.workspaces[action.workspaceId]!.kind === "personal")) {
          throw new LibraryError("error.workspaceGone");
        }
        this.library.gameEndWorkspaceId = action.workspaceId;
      }),
      "set-grayscale-text": saved((action) => {
        this.library.grayscaleText = action.enabled;
      }),
      "set-online-search": saved((action) => {
        this.library.onlineSearch = action.enabled;
        // Turned on: games without an icon may find one on the service, and the share list can be built.
        if (action.enabled) this.fetchIconsSoon();
        if (action.enabled) void this.refreshSafetyLists();
      }),
      "set-auto-update": saved((action) => {
        this.library.autoUpdate = action.enabled;
        this.updates?.setAutoDownload(action.enabled);
      }),
      "set-auto-update-modules": saved((action) => {
        this.library.autoUpdateModules = action.enabled;
        // Turned on: updates that were only found so far install now.
        if (action.enabled) void this.checkCatalogUpdates();
      }),
      "set-steam-icons": saved((action) => {
        this.library.steamIcons = action.enabled;
        if (action.enabled) this.fetchIconsSoon();
      }),
      "set-module-icons": saved((action) => {
        this.library.moduleIcons = action.enabled;
      }),
      // Every open panel moves its toasts at once: the position goes out with the theme.
      "set-toasts": saved((action) => {
        this.library.toasts = action.position;
        this.applyTheme();
      }),
      "set-stream-overlays": (action) => this.streaming.setOverlays(action.enabled),
      "set-game-overlays": saved((action) => {
        this.library.gameOverlays = action.enabled;
        // Off closes every overlay, the veil and the panels in the layer at once.
        this.gameOverlays.tick();
        this.syncGameWatcher();
      }),
      "set-overlays-stay": saved((action) => {
        this.library.overlaysStay = action.enabled;
        this.gameOverlays.tick();
      }),
      "set-overlay-sidebar": saved((action) => {
        this.library.overlaySidebar = action.side;
      }),
      "leave-overlay-page": () => this.leaveOverlayPage(),
      "open-overlay-page": (action) => this.showOverlayPage(action.setup ?? null),
      "add-game-overlay": (action) => this.addGameSetup(action.workspaceId),
      "remove-game-setup": (action) => this.removeGameSetup(action.workspaceId),
      "set-game-overlays-hidden": (action) => {
        this.gameOverlays.setHidden(action.hidden);
        this.syncGameWatcher();
        this.syncOverlayPanels();
      },
      "preview-overlay": (action) => {
        const { owner, moduleId, workspaceId, key } = action;
        // Only an overlay the user has: a game overlay, or an OBS link.
        const subject = { owner, moduleId, workspaceId, key };
        if (!this.gameOverlays.has(subject) && !this.streaming.overlayStore.peek(subject)) return;
        this.previews.show(subject);
      },
      "set-game-overlay": (action) => {
        const { setup, owner, moduleId, workspaceId, key, mode, opacity, hideFromCapture } = action;
        this.gameOverlays.update({ owner, moduleId, workspaceId, key }, { ...(mode ? { mode } : {}), ...(opacity ? { opacity } : {}), ...(hideFromCapture !== undefined ? { hideFromCapture } : {}) }, setup);
      },
      "set-panel-view": (action) => {
        const { setup, instanceId, mode, opacity, hideFromCapture } = action;
        this.gameOverlays.updatePanelView(instanceId, { ...(mode ? { mode } : {}), ...(opacity ? { opacity } : {}), ...(hideFromCapture !== undefined ? { hideFromCapture } : {}) }, setup);
      },
      "remove-game-overlay": ({ setup, owner, moduleId, workspaceId, key }) => this.gameOverlays.remove({ owner, moduleId, workspaceId, key }, setup),
      "set-overlay-key": (action) => {
        const { workspaceId, owner, moduleId, key } = action;
        const overlay = owner !== undefined && moduleId !== undefined && workspaceId !== undefined && key !== undefined ? { owner, moduleId, workspaceId, key } : null;
        if (overlay && !this.gameOverlays.hasKey(overlay)) return;
        const binding = overlay ? toggleBinding(overlay) : layerBinding();
        const names = this.gameOverlays.dialogNames(binding);
        // The dialog is answered by hotkey-answer; this action only opens it.
        void this.streaming.askOverlayKey(binding, names.label, { module: names.module, action: names.action });
      },
      "set-overlay-port": (action) => this.streaming.setPort(action.port),
      "reset-overlay-links": () => this.streaming.resetLinks(),
      "hotkey-answer": (action) => this.streaming.answer(action.id, action.choice, action.accelerator),
      "remove-hotkey": (action) => this.streaming.removeHotkey(action),
      "connector-answer": (action) => this.answerConnector(action.id, action.allow),
      "leaderboard-answer": (action) => this.answerLeaderboard(action.id, action.allow),
      "set-language": saved((action) => {
        this.library.language = action.language;
        for (const view of this.nativePanels()) view.applyLanguage(this.language);
      }),
      "set-profile-ranks": saved((action) => {
        this.library.profileRanks = { hidden: action.hidden ?? this.library.profileRanks.hidden, period: action.period ?? this.library.profileRanks.period };
      }),
      "set-steam-profile": saved((action) => {
        this.library.steamProfile = action.profile;
      }),
      "set-onboarded": saved((action) => {
        this.library.onboarded = action.done;
      }),
      "set-makes-modules": saved((action) => {
        this.library.makesModules = action.on;
      }),
      // The user saw what's new in this version (Home's card); always the running version, never one the page names.
      "see-version": saved(() => {
        this.library.seenVersion = app.getVersion();
      }),
      "set-rail": saved((action) => setRail(this.library, action)),

      // Appearance
      "set-theme": saved((action) => {
        if (!this.themes.get(action.themeId)?.theme.variations.some((variation) => variation.id === action.variationId)) {
          throw new LibraryError("error.themeGone");
        }
        this.library.theme = { id: action.themeId, variation: action.variationId };
        if (action.fixed) this.library.followSystem = false;
        this.applyTheme();
      }),
      "set-appearance-mode": saved((action) => {
        if (action.mode === "system") {
          this.library.followSystem = true;
        } else {
          const { theme } = resolveTheme(this.themes, this.library.theme);
          const variation = variationForMode(theme, this.library.theme.variation, action.mode);
          if (variation.mode !== action.mode) throw new LibraryError("error.themeNoMode", { mode: translate("en", action.mode === "dark" ? "common.dark" : "common.light") });
          this.library.theme = { id: theme.id, variation: variation.id };
          this.library.followSystem = false;
        }
        this.applyTheme();
      }),
      "reset-theme": saved(() => {
        this.library.theme = { ...DEFAULT_THEME };
        this.library.followSystem = true;
        this.applyTheme();
      }),
      "reload-themes": () => this.reloadThemes(),
      "open-themes-folder": () => this.openThemesFolder(),
      "create-starter-theme": () => this.createStarterTheme(),

      // Profile
      "save-profile": async (action) => {
        this.profile.name = clipName(action.name);
        this.profile.initials = clipInitials(action.initials);
        this.profile.updatedAt = new Date().toISOString();
        // Resolves once it is on disk, so the host UI can say "Saved"; the account gets it after.
        await this.saveProfile();
        void this.account.profileChanged();
      },
      "set-profile-picture": async (action) => this.setProfilePicture(await savePicture(this.profileDir, action.png)),
      "remove-profile-picture": () => this.setProfilePicture(null),

      // Modules
      "open-modules-folder": () => this.openModulesFolder(),
      "open-module-problem-folder": (action) => this.openModuleProblemFolder(action.path),
      "add-development-folder": () => this.addDevelopmentFolder(),
      "remove-development-folder": (action) => this.removeDevelopmentFolder(action.folder),
      "move-development-folder": saved((action) => moveDevelopmentFolder(this.library, action.folder, action.index)),
      "collapse-development-folder": saved((action) => setDevelopmentFolderCollapsed(this.library, action.folder, action.collapsed)),
      "copy-example": (action) => this.copyExampleModule(action.moduleId, action.name, action.folder),
      "open-example-folder": (action) => this.openExampleFolder(action.moduleId),
      "open-development-project": (action) => this.openDevelopmentProject(action.project),
      "open-developer-link": (action) => this.openDeveloperLink(action.link),
      "reload-modules": () => this.reloadModules(),
      "remove-module": (action) => this.lifecycle.remove(action.moduleId),
      "grant-module": (action) => this.lifecycle.grant(action.moduleId, action.network, action.connectors),
      "revoke-module": (action) => this.lifecycle.revoke(action.moduleId),
      "leaderboards-hide": (action) => this.leaveLeaderboards(action.moduleId),
      "install-module": () => this.installModule(),
      "install-catalog-module": (action) => this.lifecycle.installFromCatalog(action.moduleId),
      "check-module-updates": async () => {
        if (!this.library.onlineSearch) throw new UserError("error.catalogOff");
        const { updated, waiting, unreachable, failed } = await this.checkCatalogUpdates();
        // Never "up to date" when the catalog could not be asked or an update would not download.
        if (unreachable) throw new UserError("error.updatesUnreachable");
        if (failed && updated + waiting === 0) throw new UserError("error.updatesFailed");
        return { ok: true, updated, waiting };
      },
      "report-catalog-module": (action) => this.reportCatalogModule(action.moduleId, { reason: action.reason, note: action.note }),
      "inbox-send-request": (action) => this.inboxAction(() => this.inbox.sendRequest(action.moduleId, action.requestType, action.text, action.previousId)),
      "inbox-reply": (action) => this.inboxAction(() => this.inbox.reply(action.id, action.text)),
      "inbox-close": (action) => this.inboxAction(() => this.inbox.close(action.id, action.outcome)),
      "inbox-block": (action) => this.inboxAction(() => this.inbox.block(action.id, action.report)),
      "inbox-report": (action) => this.inboxAction(() => this.inbox.report(action.id, action.report)),
      "inbox-delete": (action) => this.inboxAction(() => this.inbox.delete(action.id)),
      "inbox-email-copies": (action) => this.inboxAction(() => this.inbox.setEmailCopies(action.on)),
      "inbox-contact": (action) => this.inboxAction(() => this.inbox.setContact(action.moduleId, { kind: action.kind, value: action.value })),
      "inbox-contact-default": (action) => this.inboxAction(() => this.inbox.setContactDefault({ kind: action.kind, value: action.value })),
      "open-contact-link": (action) => this.inboxAction(() => this.inbox.openContactLink(action.moduleId)),
      "inbox-note-seen": () => this.inbox.noteSeen(),
      "inbox-developer-note-seen": () => this.inbox.developerNoteSeen(),
      "inbox-refresh": async () => {
        await this.inbox.refresh();
        await this.inbox.loadContacts();
      },
      "open-catalog-homepage": (action) => this.openCatalogHomepage(action.moduleId),
      "open-module-support": (action) => this.openModuleSupport(action.moduleId, action.source),
      "open-readme-link": (action) => this.openReadmeLink(action.moduleId, action.url),
      "rate-catalog-module": (action) => this.rateCatalogModule(action.moduleId, action.stars, action.text),
      "unrate-catalog-module": (action) => this.catalogReviewAction((token) => this.catalog.unrate(action.moduleId, token)),
      "reply-catalog-review": (action) => this.catalogReviewAction((token) => this.catalog.reply(action.reviewId, token, action.text?.trim() || null)),
      "report-catalog-review": (action) => {
        if (!this.library.onlineSearch) throw new UserError("error.reportOff");
        const token = this.account.token();
        if (!token) throw new UserError("error.reportSignIn");
        return this.catalog.reportReview(action.reviewId, token);
      },
      "apply-module-update": (action) => this.lifecycle.applyUpdate(action.moduleId, action.version),
      "delete-module-data": (action) => this.deleteLeftoverData(action.owner, action.moduleId),
      "move-local-data": (action) => this.moveLocalData(action.moduleId),
      "seen-module-notes": (action) => {
        const module = this.modules.get(action.moduleId);
        if (!module || module.builtIn) return;
        this.library.moduleNotesSeen[Host.notesKey(module)] = module.manifest.version;
        this.saveLibrary();
      },

      // Panels and workspace
      "open-module": (action) =>
        this.openModule(action.moduleId, { ...(action.panelType ? { panelType: action.panelType } : {}), ...(action.reuse ? { reuse: true } : {}) }),
      "choose-panel-type": (action) => this.choosePanelType(action.instanceId, action.panelType),
      "close-panel": (action) => this.closePanel(action.instanceId),
      "remove-module-from-workspace": (action) => this.removeModuleFromWorkspace(action.moduleId),
      "reload-panel": (action) => this.nativePanel(action.instanceId)?.reload(),
      "stop-panel": (action) => this.nativePanel(action.instanceId)?.stop(),
      "show-panel-in-game": (action) => this.showPanelInGame(action.instanceId),
      "stop-panel-in-game": (action) => this.gameOverlays.stopPanel(action.instanceId, action.setup),
      "save-layout": (action) => this.workspaces.saveLayout(this.currentWorkspaceId(), action.layout),
      "apply-layout-template": (action) => this.workspaces.applyTemplate(this.currentWorkspaceId(), layoutTemplate(action.templateId)),
      "apply-layout-grid": (action) => this.workspaces.applyTemplate(this.currentWorkspaceId(), gridTemplate(action.columns, action.rows)),
      "save-snapshot": (action) => this.workspaces.saveSnapshot(this.currentWorkspaceId(), action.name),
      "update-snapshot": (action) => this.workspaces.updateSnapshot(this.currentWorkspaceId(), action.snapshotId),
      "apply-snapshot": (action) => this.applySnapshot(action.snapshotId),
      "rename-snapshot": (action) => this.workspaces.renameSnapshot(this.currentWorkspaceId(), action.snapshotId, action.name),
      "delete-snapshot": (action) => this.workspaces.deleteSnapshot(this.currentWorkspaceId(), action.snapshotId),

      // Browser panels
      "browser-new-tab": (action) => this.openBrowserTab(action.instanceId, null, false),
      "browser-navigate": (action) => this.browser(action.instanceId).navigate(action.address),
      "browser-command": (action) => this.browserCommand(this.browser(action.instanceId), action.command),
      "browser-set-shared": saved((action) => {
        setSiteListed(this.library, "sharedSites", pageSite(action.instanceId), action.shared);
        this.browserSitesChanged();
      }),
      "browser-set-adblock": saved((action) => {
        setSiteListed(this.library, "adblockOff", pageSite(action.instanceId), !action.enabled);
        this.browserSitesChanged();
      }),
      "browser-forget-site": saved((action) => {
        setSiteListed(this.library, action.list === "shared" ? "sharedSites" : "adblockOff", action.site, false);
        this.browserSitesChanged();
      }),
      "clear-browser-data": (action) => this.clearBrowserData(action.scope),

      // Discord and AI usage
      "discord-connect": () => this.discord.connectNow(),
      "discord-sign-out": () => this.discord.signOut(),
      "ai-usage-add": (action) => this.aiUsage.add(action.provider, action.label, action.directory),
      "ai-usage-update": (action) => this.aiUsage.update(action.accountId, action.label, action.directory),
      "ai-usage-remove": (action) => this.aiUsage.remove(action.accountId),

      // Account
      "account-send-code": (action) => this.account.sendCode(action.email),
      "account-verify": (action) => this.account.verify(action.code),
      "account-create": (action) => this.account.create(action.ageConfirmed),
      "account-cancel": () => this.account.cancel(),
      "account-refresh": () => this.account.refresh(),
      "account-sign-out": async () => {
        await this.account.signOut();
        return this.copySync.signedOut();
      },
      "account-sign-out-device": (action) => this.account.signOutDevice(action.deviceId),
      "account-rename-device": (action) => this.account.renameDevice(action.deviceId, action.name),
      "account-email-code": (action) => this.account.sendEmailCode(action.email),
      "account-change-email": (action) => this.account.changeEmail(action.code),
      "account-delete-code": () => this.account.sendDeleteCode(),
      "account-delete": async (action) => {
        await this.account.deleteAccount(action.code);
        return this.copySync.signedOut();
      },
      "account-discord-sign-in": () => this.account.discordSignIn(),
      "account-discord-connect-code": () => this.account.sendConnectDiscordCode(),
      "account-discord-connect": (action) => this.account.connectDiscord(action.code),
      "account-discord-disconnect-code": () => this.account.sendDisconnectDiscordCode(),
      "account-discord-disconnect": (action) => this.account.disconnectDiscord(action.code),
      "account-email-remove-code": () => this.account.sendRemoveEmailCode(),
      "account-email-remove": (action) => this.account.removeEmail(action.code),
      "account-delete-discord": async () => {
        await this.account.deleteWithDiscord();
        if (!this.account.view().account) await this.copySync.signedOut();
      },
      "account-profile-choice": (action) => this.account.chooseProfile(action.keep),

      // Developer side of the account
      "account-developer-name": async (action) => {
        await this.account.setDeveloperName(action.name);
        // A first-time developer gets the prefix of the name with it (WellBrained: wellbrained) when it
        // is free; when it isn't, the check stays on screen to pick another.
        const prefix = suggestPrefix(action.name);
        if (prefix && this.account.view().prefixes?.held.length === 0) {
          if ((await this.account.checkPrefix(prefix).catch(() => null)) === "free") await this.account.claimPrefix(prefix).catch(() => undefined);
        }
        // And a publisher key: Tavora makes, keeps and links it, and the recovery key is shown. One with
        // a key already (kept, or a linked key file) gets none.
        const keys = this.developerKeys.view();
        if ((keys.status === "ready" || keys.status === "none") && !keys.keys.length && !this.account.view().publisherKeys?.length) {
          // Another PC keeps the account's key: its recovery key is asked for on screen, then a key is made there.
          await this.developerKeys.create().catch(() => undefined);
        }
      },
      "account-link-code": () => this.account.newLinkCode(),
      "account-copy-link-command": () => {
        const code = this.account.view().linkCode?.code;
        if (!code) throw new UserError("account.error.noCode");
        clipboard.writeText(linkCommand(code));
      },
      "account-unlink-key": (action) => this.account.unlinkKey(action.fingerprint),
      "account-replace-key": async (action) => {
        const linked = (this.account.view().publisherKeys ?? []).map((key) => key.fingerprint);
        if (!linked.includes(action.fingerprint)) throw new UserError("account.error.keyGone");
        const next = await this.developerKeys.replacementFor(action.fingerprint, linked);
        return this.account.replaceKey(action.fingerprint, next, action.leaked);
      },
      "account-publish-token-create": (action) => this.account.createPublishToken(action.name),
      "account-publish-token-copy": () => {
        const token = this.account.newPublishTokenText();
        if (!token) throw new UserError("error.generic");
        clipboard.writeText(token);
      },
      "account-publish-token-saved": () => this.account.publishTokenSaved(),
      "account-publish-token-delete": (action) => this.account.deletePublishToken(action.id),
      "developer-key-create": async () => {
        await this.developerKeys.create();
      },
      "developer-key-add": async () => {
        const german = this.language.startsWith("de");
        const picked = await dialog.showOpenDialog(this.window, {
          title: german ? "Schlüsseldatei öffnen" : "Open key file",
          defaultPath: await this.ownFileFolder("publisher-key"),
          properties: ["openFile"],
          filters: [
            { name: german ? "Schlüsseldateien" : "Key files", extensions: ["pem", "key"] },
            { name: "*", extensions: ["*"] },
          ],
        });
        const file = picked.filePaths[0];
        if (picked.canceled || !file) return;
        const text = await readFile(file, "utf8").catch(() => null);
        if (text === null || text.length > 10_000) throw new UserError("developerKeys.error.notKey");
        await this.developerKeys.add(text);
        this.rememberPicked("publisher-key", file);
      },
      "developer-key-export": async (action) => {
        const pem = this.developerKeys.exportKey(action.fingerprint);
        const folder = await this.ownFileFolder("publisher-key");
        const german = this.language.startsWith("de");
        const picked = await dialog.showSaveDialog(this.window, {
          title: german ? "Schlüsseldatei speichern" : "Save key file",
          defaultPath: path.join(folder, freeFileName(`publisher-key-${action.fingerprint.slice(0, 8)}`, (fileName) => existsSync(path.join(folder, fileName)), "pem")),
          filters: [{ name: german ? "Schlüsseldateien" : "Key files", extensions: ["pem"] }],
          properties: ["showOverwriteConfirmation"],
        });
        if (picked.canceled || !picked.filePath) return;
        const file = await writeWithExtension(picked.filePath, "pem", pem, 0o600);
        this.rememberPicked("publisher-key", file);
      },
      "developer-key-link": (action) => this.developerKeys.link(action.fingerprint),
      "developer-recovery-key": (action) => this.developerKeys.enterKey(action.key),
      "developer-recovery-key-saved": () => this.developerKeys.keySaved(),
      "developer-show-recovery-key": () => this.developerKeys.showKey(),
      "developer-copy-recovery-key": () => {
        const key = this.developerKeys.view().recoveryKey;
        if (key) clipboard.writeText(key);
      },
      "account-prefix-check": async (action) => void (await this.account.checkPrefix(action.prefix)),
      "account-prefix-claim": (action) => this.account.claimPrefix(action.prefix),
      "publish-review": (action) => this.publisher.open(this.projectOf(action.moduleId)),
      "publish-refresh": () => this.publisher.refresh(),
      "publish-write": (action) => this.publisher.writeVersion(action.version, action.notes),
      "publish-set-id": (action) => this.publisher.setId(action.id),
      "publish-upload": () => this.publisher.publish(),
      "publish-close": () => this.publisher.close(),
      "save-module-zip": (action) => this.saveModuleZip(action.moduleId),
      "developer-copy-create-command": () => clipboard.writeText(CREATE_MODULE_COMMAND),
      "pairing-start": () => this.pairing.start(),
      "pairing-cancel": () => this.pairing.cancel(),
      "pairing-decide": (action) => this.pairing.decide(action.id, action.allow),

      // Cloud copy
      "cloud-copy-on": () => this.copySync.turnOn(),
      "cloud-copy-on-folder": async () => {
        const folder = await this.pickPath("cloud-copy", { properties: ["openDirectory", "createDirectory"] });
        if (!folder) return;
        await this.copySync.turnOn(folder);
        this.rememberPicked("cloud-copy", folder);
      },
      "cloud-copy-move": async (action) => {
        if (action.to === "server") return this.copySync.move(null);
        const folder = await this.pickPath("cloud-copy", { properties: ["openDirectory", "createDirectory"] });
        if (!folder) return;
        await this.copySync.move(folder);
        this.rememberPicked("cloud-copy", folder);
      },
      "cloud-copy-key": (action) => this.copySync.enterKey(action.key),
      "cloud-copy-cancel": () => this.copySync.cancelKey(),
      "cloud-copy-new-key": () => this.copySync.startOver(),
      "cloud-copy-show-key": () => this.copySync.showKey(),
      "cloud-copy-copy-key": () => {
        const key = this.copySync.view().recoveryKey;
        if (key) clipboard.writeText(key);
      },
      "cloud-copy-key-saved": () => this.copySync.keySaved(),
      "cloud-copy-upload": () => this.copySync.sync(true),
      "cloud-copy-restore": () => this.copySync.restore(),
      "cloud-copy-keep": (action) => this.copySync.keep(action.side),
      "cloud-copy-restart": () => this.copySync.restart(),
      "cloud-copy-off": () => this.copySync.turnOff(),
      "cloud-copy-delete": () => this.copySync.remove(),
      "cloud-copy-close-anyway": () => this.copySync.closeAnyway(() => this.window.close()),
    };
  }

  private showScreen(next: Screen): void {
    if (this.screen === next && next !== "workspace") return;
    this.notice = null;
    // The workspace being left takes its questions (a link, a navigation) with it.
    if (this.workspaceId !== null) this.questions.cancel({ workspace: this.workspaceId });
    this.closeAllViews();
    // The Overlay page's views leave the window with the page.
    if (this.screen === "overlay") this.closeOverlayPage();
    this.screen = next;
  }

  /** Opens the Overlay page (on a setup, else on the running game's) in place of the workspace. */
  private showOverlayPage(setupId: string | null): void {
    this.showScreen("overlay");
    this.layout.open(setupId);
  }

  /** The Overlay page shows what panels publish, so the panels of its items run, hidden, even from a workspace not opened this run; they stop when the page is left. */
  private runForOverlayPage(panels: { workspaceId: string; moduleId: string; instanceId: string | null }[]): boolean[] {
    return panels.map((panel) => {
      const entry = this.library.workspaces[panel.workspaceId];
      if (!entry || entry.trashedAt) return false;
      const record = this.records(entry.id).find((item) => (panel.instanceId ? item.instanceId === panel.instanceId : item.moduleId === panel.moduleId));
      if (!record) return false;
      if (this.screen === "overlay" && !this.panels.has(record.instanceId) && this.panelTypeOf(record) !== undefined) {
        this.createView(record, { id: entry.id, displayName: entry.name, kind: entry.kind });
      }
      return this.panels.has(record.instanceId);
    });
  }

  /** Started: the panels behind every overlay and panel item run now. Stopped: they are let go of, except those of the workspace shown. */
  private syncOverlayPanels(): void {
    const layout = this.gameOverlays.layout;
    const wanted = new Set<string>();
    if (this.library.gameOverlays && !this.gameOverlays.hidden) {
      for (const setup of layout.setups()) {
        for (const info of layout.items(setup)) {
          const entry = this.library.workspaces[info.keyTarget.workspaceId];
          if (!entry || entry.trashedAt) continue;
          const record = this.records(entry.id).find((item) => (info.ref.kind === "panel" ? item.instanceId === info.ref.instanceId : item.moduleId === info.moduleId));
          if (!record || this.panelTypeOf(record) === undefined || record.moduleId === BROWSER_MODULE_ID) continue;
          wanted.add(record.instanceId);
          this.panels.keepRunning(record.instanceId);
          if (!this.panels.has(record.instanceId)) this.createView(record, { id: entry.id, displayName: entry.name, kind: entry.kind });
        }
      }
    }
    for (const instanceId of this.panels.keptIds()) {
      if (wanted.has(instanceId)) continue;
      this.panels.stopKeeping(instanceId);
      const shownHere = this.workspace && this.records(this.workspace.id).some((record) => record.instanceId === instanceId);
      if (!shownHere && !this.panels.isLent(instanceId)) this.panels.release(instanceId);
    }
  }

  /** Back from the Overlay page to the workspace it was opened from, else Home. */
  private leaveOverlayPage(): void {
    const last = this.library.lastWorkspaceId;
    if (last && isLive(this.library, last)) this.openWorkspace(last);
    else this.showScreen("welcome");
  }

  private closeOverlayPage(): void {
    this.layout.close();
  }

  /** Add overlay on a game workspace in the rail: the game gets a setup of its own. */
  private addGameSetup(workspaceId: string): void {
    const entry = this.library.workspaces[workspaceId];
    if (!entry || entry.kind !== "game" || entry.trashedAt) throw new LibraryError("error.workspaceGone");
    this.gameOverlays.addSetup(workspaceId);
  }

  private removeGameSetup(workspaceId: string): void {
    this.gameOverlays.removeSetup(workspaceId);
  }

  /** Every panel of every workspace, for the Overlay page's Sources. */
  private overlaySources(): SourcePanel[] {
    const sources: SourcePanel[] = [];
    for (const entry of Object.values(this.library.workspaces)) {
      if (entry.trashedAt) continue;
      for (const record of this.records(entry.id)) {
        const module = this.modules.get(record.moduleId);
        const name = this.panelName(record.instanceId);
        if (!module || !name) continue;
        sources.push({
          instanceId: record.instanceId,
          name,
          owner: module.owner,
          moduleId: module.manifest.id,
          workspaceId: entry.id,
          workspaceName: entry.name,
          scope: scopeForKind(entry.kind),
          inGame: this.panelTypeOf(record) !== undefined && this.canShowInGame(record),
        });
      }
    }
    return sources;
  }

  private openWorkspace(workspaceId: string): void {
    if (!isLive(this.library, workspaceId)) throw new LibraryError("error.workspaceGone");
    this.questions.cancel({ workspace: workspaceId }, "gameSwitch");
    if (this.workspaceId === workspaceId) return;
    this.showScreen("workspace");
    markOpened(this.library, workspaceId, new Date());
    this.saveLibrary();
    this.openCurrentWorkspace();
  }

  private async chooseWorkspaceImage(workspaceId: string): Promise<void> {
    if (!isLive(this.library, workspaceId)) throw new LibraryError("error.workspaceGone");
    const source = await this.pickPath("workspace-image", {
      title: translate(this.language, "dialog.chooseIcon"),
      properties: ["openFile"],
      filters: [{ name: translate(this.language, "dialog.images"), extensions: ["png", "jpg", "jpeg"] }],
    });
    if (!source) return;
    const file = await importIcon(this.iconDir, workspaceId, source);
    this.rememberPicked("workspace-image", source);
    const previous = setWorkspaceImage(this.library, workspaceId, file);
    await this.dropIconFile(previous);
  }

  private get profileDir(): string {
    return path.join(this.options.userData, "profile");
  }

  private async setProfilePicture(file: string | null): Promise<void> {
    const previous = this.profile.picture;
    this.profile.picture = file;
    this.profile.updatedAt = new Date().toISOString();
    await this.saveProfile();
    await removePicture(this.profileDir, previous);
    void this.account.profileChanged();
  }

  /** The profile as it goes to the account: the picture as a base64 PNG. */
  private async profileData(): Promise<ProfileData> {
    const picture = this.profile.picture ? await readFile(path.join(this.profileDir, this.profile.picture)).then((bytes) => bytes.toString("base64"), () => null) : null;
    return { name: this.profile.name, initials: this.profile.initials, picture, updatedAt: this.profile.updatedAt };
  }

  /** Puts the account's profile in place of this PC's (checked like a picture the user picked). */
  private async applyProfile(remote: ProfileData & { updatedAt: string }): Promise<void> {
    const previous = this.profile.picture;
    const picture = remote.picture ? await savePicture(this.profileDir, remote.picture) : null;
    this.profile.name = clipName(remote.name);
    this.profile.initials = clipInitials(remote.initials);
    this.profile.picture = picture;
    this.profile.updatedAt = remote.updatedAt;
    await this.saveProfile();
    if (previous !== picture) await removePicture(this.profileDir, previous);
    this.pushState();
  }

  private get iconDir(): string {
    return path.join(this.options.userData, "game-icons");
  }

  private get steamIconDir(): string {
    return path.join(this.options.userData, "steam-icons");
  }

  private iconsRunning = false;
  private iconsAgain = false;

  /** Looks for game icons unless that is already going on, off, or switched off for this run. */
  private fetchIconsSoon(): void {
    if (!this.library.steamIcons || this.options.steamIcons === "off") return;
    if (this.iconsRunning) {
      // A game was added just as the last run was ending: go round once more.
      this.iconsAgain = true;
      return;
    }
    this.iconsRunning = true;
    void this.findIcons().finally(() => {
      this.iconsRunning = false;
      if (this.iconsAgain) {
        this.iconsAgain = false;
        this.fetchIconsSoon();
      }
    });
  }

  /**
   * Finds, one game at a time, the icon of every game that has none yet: from
   * the installed game itself, then from the Steam client on this PC (or Steam's
   * public address), then the icons the Tavora service hosts, then Steam's small
   * public icon. This app does it itself. Quiet on purpose: a failure is tried
   * again at the next start or the next added game, and nothing is shown.
   */
  private async findIcons(): Promise<void> {
    try {
      await syncIcons({
        library: this.library,
        iconDir: this.steamIconDir,
        steamDir: await findSteamDir(),
        baseUrl: this.options.steamIcons,
        serviceUrl: this.options.apiUrl,
        loadHostedList: () => this.loadHostedList(),
        shouldRun: () => !this.window.isDestroyed(),
        onChange: () => {
          this.saveLibrary();
          this.pushState();
        },
      });
      // Games that have their own icon never reached the list: look at it now, to know which ones the service lacks.
      if (this.shareCandidates().length > 0) await this.loadHostedList();
    } catch (error) {
      console.error("[tavora] finding game icons failed", error);
    }
  }

  // ── Offering icons to the Tavora service ─────────────────────────────

  /** The service's list of hosted icons, asked for once per run, or null (off, or it did not answer). */
  private hostedList: HostedList | null = null;
  private hostedListLoading: Promise<HostedList | null> | null = null;

  private loadHostedList(): Promise<HostedList | null> {
    if (!this.library.onlineSearch || this.options.steamIcons === "off") return Promise.resolve(null);
    if (this.hostedList) return Promise.resolve(this.hostedList);
    this.hostedListLoading ??= fetchHostedList({ baseUrl: serviceUrl(this.options.apiUrl) }).then((list) => {
      this.hostedList = list;
      this.hostedListLoading = null;
      if (list) this.pushState();
      return list;
    });
    return this.hostedListLoading;
  }

  /**
   * The icon file of a game that could be offered: the game's own icon found on
   * this PC (never a picture the user chose, a hosted icon or Steam's small one),
   * for a game with an id the service knows, that the service has no icon for and
   * that was not offered before. Null otherwise.
   */
  private shareableFile(game: WorkspaceEntry): string | null {
    return shareableIconFile(game, this.library, this.hostedList);
  }

  /** Games that have an icon of their own and an id the service knows: the ones worth asking the list about. */
  private shareCandidates(): WorkspaceEntry[] {
    const library = this.library;
    if (!library.steamIcons || !library.onlineSearch) return [];
    return Object.values(library.workspaces).filter(isShareCandidate);
  }

  /** Adds the games of a Steam import that are not in the library yet. Answers with how many. */
  private importSteam(games: SteamImportGame[]): ActionResult {
    const added = importSteamGames(this.library, games, new Date());
    this.workspaces.addWorkspaces(added);
    if (added.length > 0) {
      this.saveLibrary();
      this.fetchIconsSoon();
    }
    return { ok: true, added: added.length };
  }

  /** Offers these games' icons to the service, one at a time. Returns how many it took. */
  private shareIcons(workspaceIds: string[]): Promise<ActionResult> {
    const offers = workspaceIds.flatMap((id) => {
      const workspace = this.library.workspaces[id];
      const file = workspace ? this.shareableFile(workspace) : null;
      if (!workspace || !file) return [];
      return [
        {
          id: workspace.id,
          name: workspace.name,
          source: shareSource(file),
          read: async () => largestIcoFrame(new Uint8Array(await readFile(path.join(this.steamIconDir, file)))),
          done: () => markIconShared(this.library, workspace.id, new Date()),
        },
      ];
    });
    return this.sendOffers(offers);
  }

  /** Offers the icons of games from the Steam import that are not in the library, as steamShareIcons found them. */
  private shareSteamIcons(appids: number[]): Promise<ActionResult> {
    const offers = appids.flatMap((appid) => {
      const offer = this.steamOffers.get(appid);
      // Added or offered since the dialog asked: the library flow or nobody offers it now.
      if (!offer || this.library.iconsOffered.includes(offer.id) || this.library.workspaces[offer.id]) return [];
      return [
        {
          id: offer.id,
          name: offer.name,
          source: "steam" as const,
          read: async () => offer.ico,
          done: () => {
            markIconOffered(this.library, offer.id);
            this.steamOffers.delete(appid);
          },
        },
      ];
    });
    return this.sendOffers(offers);
  }

  private async sendOffers(
    offers: { id: string; name: string; source: "installed" | "steam"; read: () => Promise<Uint8Array | null>; done: () => void }[],
  ): Promise<ActionResult> {
    // Only signed-in users can share: the service keeps the account with an offer until it is checked.
    const token = this.account.token();
    if (offers.length > 0 && token === null) return { ok: false, error: translate(this.language, "error.share.signIn") };
    let tried = 0;
    let shared = 0;
    let unreachable = false;
    let limited = false;
    let signedOut = false;
    for (const offer of offers) {
      tried += 1;
      const ico = await offer.read().catch(() => null);
      if (!ico) continue;
      const outcome = await submitIcon({ baseUrl: serviceUrl(this.options.apiUrl), token: token! }, { id: offer.id, name: offer.name, source: offer.source, ico });
      if (outcome === "signed-out") {
        signedOut = true;
        break;
      }
      if (outcome === "failed") {
        unreachable = true;
        break;
      }
      if (outcome === "busy") {
        limited = true;
        break;
      }
      // Sent, or refused for good: either way it is not offered again.
      offer.done();
      if (outcome === "sent") shared += 1;
      this.saveLibrary();
      this.pushState();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (tried === 0) return { ok: false, error: translate(this.language, "error.nothingToShare") };
    if (signedOut) {
      // Signed out on another PC, or the account is gone: the account side finds out and forgets the sign-in.
      void this.account.refresh().catch(() => undefined);
      if (shared === 0) return { ok: false, error: translate(this.language, "error.share.signIn") };
    }
    if (limited && shared === 0) return { ok: false, error: translate(this.language, "error.share.limited") };
    if (unreachable && shared === 0) return { ok: false, error: translate(this.language, "error.unreachable") };
    return limited ? { ok: true, shared, limited: true } : { ok: true, shared };
  }

  /** The games of the last Steam look-up, kept so their icons can be offered without adding them. */
  private steamLookup: SteamImportGame[] = [];
  /** The icons steamShareIcons found on this PC, by Steam appid, ready to be sent as they were shown. */
  private steamOffers = new Map<number, { id: string; name: string; ico: Uint8Array }>();

  /**
   * Of these games from the last Steam look-up, the ones the user does not have whose icon Tavora
   * lacks and the Steam client on this PC keeps (named by its appinfo or the game's Steam shortcut).
   * Only files already on this PC are read; nothing is downloaded and nothing is added to the library.
   */
  private async steamShareIcons(appids: number[]): Promise<SteamShareResult> {
    const say = (key: MessageKey) => ({ status: "error" as const, error: translate(this.language, key) });
    if (!this.library.onlineSearch) return say("error.onlineOff");
    if (!this.library.steamIcons || this.options.steamIcons === "off") return say("error.steam.iconsOff");
    const list = await this.loadHostedList();
    if (!list) return say("error.unreachable");
    const steamDir = await findSteamDir();
    if (steamDir === null) return say("error.steam.notInstalled");
    const wanted = new Set(appids);
    const games = steamShareGames(
      this.steamLookup.filter((game) => wanted.has(game.appid)),
      (game) => steamGameStatus(this.library, game) === "new",
      this.library.iconsOffered,
      list,
    );
    const appInfo = await loadAppInfo(steamDir);
    let clientIcons = new Map<number, string>();
    try {
      if (appInfo) clientIcons = readClientIcons(appInfo, new Set(games.map((game) => game.appid)));
    } catch (error) {
      if (!(error instanceof AppInfoError)) throw error;
    }
    const shortcuts = await readShortcutIcons(shortcutFolders()).catch(() => new Map<number, string[]>());
    const views: SteamShareView[] = [];
    for (const game of games) {
      const hashes = [clientIcons.get(game.appid), ...(shortcuts.get(game.appid) ?? [])].filter((hash): hash is string => hash !== undefined);
      for (const hash of hashes) {
        const ico = await readSteamClientIcon(steamDir, hash);
        const preview = ico && icoFrameNear(ico, 48);
        if (!ico || !preview) continue;
        this.steamOffers.set(game.appid, { id: game.id, name: game.name, ico });
        views.push({ appid: game.appid, name: game.name, icon: `data:image/x-icon;base64,${Buffer.from(preview).toString("base64")}` });
        break;
      }
    }
    return { status: "ok", games: views.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  private async dropIconFile(icon: WorkspaceIcon | null): Promise<void> {
    if (icon?.kind === "image") await removeIcon(this.iconDir, icon.file);
  }

  /** Deletes everything stored for a workspace that left the library for good. */
  private async deleteWorkspaceData(workspace: WorkspaceEntry): Promise<void> {
    await this.forgetWorkspaceData(workspace);
    await this.clearOrphanedSessions();
  }

  /** deleteWorkspaceData without the browser sessions, so many workspaces can be deleted and the sessions cleared once. */
  private async forgetWorkspaceData(workspace: WorkspaceEntry): Promise<void> {
    const records = this.workspaces.forgetWorkspace(workspace.id);
    // A panel of this workspace that was over its game closes with it.
    for (const record of records) this.panels.close(record.instanceId);
    await Promise.all(records.map((record) => this.data.panelState.remove(record.instanceId)));
    this.data.forgetWorkspace(workspace.id);
    this.streaming.forgetWorkspace(workspace.id);
    this.gameOverlays.forgetWorkspace(workspace.id);
    this.layout.forgetWorkspace(workspace.id);
    // A folder the user chose can be gone (an unplugged drive): the workspace still goes, and they are told where its pictures may remain.
    await this.files.noteWorkspaceDeleted(workspace.name, (root) => deleteModuleData(this.options.userData, workspace.id, root));
    await this.dropIconFile(workspace.icon);
    if (workspace.iconFile && !iconFileShared(this.library, workspace.iconFile, workspace.id)) await removeSteamIcon(this.steamIconDir, workspace.iconFile);
  }

  private async clearOrphanedSessions(): Promise<void> {
    // Sessions may already be open in this run, so clear them; their
    // directories are removed at the next start.
    const keep = new Set(Object.keys(this.library.workspaces));
    for (const dir of await orphanedPartitions(this.options.userData, keep)) {
      const ses = session.fromPartition(`persist:${decodeURIComponent(path.basename(dir))}`);
      await ses.clearStorageData();
      await ses.clearCache();
    }
  }

  /**
   * A game workspace the user just added starts with Notes and To-Dos side by side, so the first look shows
   * something to use rather than a layout to choose. Only the starter modules that are installed and work in this
   * workspace are docked; a personal workspace, and workspaces that arrive by other ways (a Steam import, a
   * restored library), start empty as before.
   */
  private startWorkspace(workspaceId: string): void {
    if (this.library.workspaces[workspaceId]?.kind !== "game") return;
    const records = STARTER_MODULES.flatMap((moduleId): InstanceRecord[] => {
      const module = this.modules.get(moduleId);
      if (!module || !this.supportsWorkspace(module, workspaceId)) return [];
      const panelType = continuingPanelType(module.manifest) ?? undefined;
      return [{ instanceId: randomUUID(), moduleId, ...(panelType ? { panelType } : {}) }];
    });
    this.workspaces.start(workspaceId, records);
  }

  /**
   * Opens a new panel; the host UI docks it. Returns its instance id. A module with panel types opens
   * the type asked for, or its continuing type. With `reuse`, a panel of that type already open (the one
   * used last) comes to the front instead.
   */
  private openModule(
    moduleId: string,
    options: { openedFrom?: { instanceId: string; background: boolean }; panelType?: string; launch?: PanelLaunch; reuse?: boolean } = {},
  ): string | void {
    const { openedFrom } = options;
    const workspace = this.workspace;
    const module = this.modules.get(moduleId);
    if (!workspace || !module || !this.supportsWorkspace(module, workspace.id)) return;
    const types = panelTypes(module.manifest);
    const panelType = options.panelType ?? continuingPanelType(module.manifest) ?? undefined;
    if (panelType !== undefined && !types.some((type) => type.id === panelType)) throw new WorkspaceError("error.panelTypeGone");
    const open = options.reuse ? this.panelsOfType(workspace.id, moduleId, panelType)[0] : undefined;
    if (open) {
      this.showPanel(open.record.instanceId);
      return open.record.instanceId;
    }
    const record: InstanceRecord = { instanceId: randomUUID(), moduleId, ...(panelType ? { panelType } : {}) };
    this.workspaces.openPanel(workspace.id, record);
    if (this.needsAnswer(moduleId)) this.panels.setAwaiting(record.instanceId);
    if (openedFrom) this.panels.setOpenedFrom(record.instanceId, openedFrom);
    this.panels.setLaunch(record.instanceId, options.launch ?? { reason: "add" });
    this.createView(record, workspace, performance.now());
    return record.instanceId;
  }

  /** A new Browser tab in the same dock group as the one it was opened from; an empty one gets the address bar's focus. */
  private openBrowserTab(fromInstanceId: string, url: string | null, background: boolean): void {
    this.browser(fromInstanceId);
    const id = this.openModule(BROWSER_MODULE_ID, { openedFrom: { instanceId: fromInstanceId, background } });
    if (!id) return;
    if (url) this.browser(id).restore(url);
    else setTimeout(() => this.window.webContents.send("host:shortcut", `address:${id}`), 100);
  }

  /**
   * A module asked to open a web address (links.open, already checked): a new tab in the workspace's
   * newest Browser panel, or in that panel itself while it is still empty, or in a new Browser panel.
   */
  private openLinkFromModule(url: string, workspaceId?: string): void {
    // Like a page in the Browser panel, a link from a module or a listing can't reach this PC or the local network.
    if (isPrivateUrl(url)) throw new UserError("error.privateLink");
    const workspace = this.workspace;
    // The panel that asked belongs to a workspace that isn't the one shown (it is over its game): its link is not for this one.
    if (workspaceId !== undefined && workspace?.id !== workspaceId) throw new HostError("PERMISSION_DENIED", "links.open works only in the workspace shown now");
    if (!workspace) return;
    try {
      const browserId = this.records(workspace.id)
        .map((record) => record.instanceId)
        .reverse()
        .find((id) => this.panels.get(id) instanceof BrowserPanelView);
      if (browserId) {
        const panel = this.browser(browserId);
        if (panel.blank) panel.restore(url);
        else this.openBrowserTab(browserId, url, false);
      } else {
        // Nothing to open it in yet: the user picks a new Browser panel or the system browser.
        this.questions.ask("link", { workspace: workspace.id }, { url });
      }
    } catch (error) {
      // The workspace is full; the user is told, as for Add module.
      if (error instanceof WorkspaceError) this.notice = error.message;
      else throw error;
    } finally {
      this.pushState();
    }
  }

  /** The user's answer to pendingLink. The address is the one the host kept, never one sent with the answer. */
  private chooseLink(choice: "panel" | "system" | "cancel"): void {
    const pending = this.questions.peek("link");
    if (!pending) return;
    this.questions.answer(pending.id, choice);
    const { url } = pending.payload;
    if (choice === "cancel" || !isWebUrl(url) || isPrivateUrl(url)) return;
    if (choice === "system") {
      void shell.openExternal(url).catch((error: unknown) => console.error("[tavora]", error));
      return;
    }
    const id = this.openModule(BROWSER_MODULE_ID);
    if (id) this.browser(id).restore(url);
  }

  // ── Games starting and closing ───────────────────────────────────────

  /** The running games changed (game-watch.ts). Games already running when the watch began start nothing. */
  private gamesRunning(running: ReadonlySet<string>, initial: boolean): void {
    // The watcher stops when the window closes and reports every game as closed: there is nothing left to switch.
    if (this.windowClosed) return;
    // Game overlays forget the window of a game that stopped, whatever the switch below says.
    this.gameOverlays?.gamesRunning(running);
    // With "When a game starts" off the watcher only serves game overlays, which look at the window in front themselves.
    if (this.library.gameStart === "off") {
      this.running = [];
      this.pushState();
      return;
    }
    const before = this.running;
    const started = [...running].filter((id) => !before.includes(id));
    this.running = [...before.filter((id) => running.has(id)), ...started];
    if (!initial) {
      for (const id of before) if (!running.has(id)) this.gameClosed(id);
      // Several at once is rare; the last one counts.
      if (started.length) this.gameStarted(started.at(-1)!);
    }
    this.pushState();
  }

  /** Switches or asks, as the user chose. "show" only offers it on the rail (runningGameId). */
  private gameStarted(gameId: string): void {
    if (this.workspaceId === gameId) return;
    if (this.library.gameStart === "switch") this.openWorkspaceQuietly(gameId);
    else if (this.library.gameStart === "ask") this.questions.ask("gameSwitch", { workspace: gameId }, { gameId });
  }

  /** Goes back to the chosen personal workspace, but only from the game that closed. */
  private gameClosed(gameId: string): void {
    this.questions.cancel({ workspace: gameId }, "gameSwitch");
    const back = this.library.gameEndWorkspaceId;
    if (back && this.workspaceId === gameId && isLive(this.library, back) && this.library.workspaces[back]!.kind === "personal") this.openWorkspaceQuietly(back);
  }

  /** Opens a workspace without bringing the window to the front, so the game keeps the focus. */
  private openWorkspaceQuietly(workspaceId: string): void {
    try {
      this.openWorkspace(workspaceId);
    } catch (error) {
      console.error("[tavora] switching to a running workspace failed", error);
    }
  }

  /** The user's answer to pendingGameSwitch. */
  private chooseGameSwitch(choice: "switch" | "cancel"): void {
    const pending = this.questions.peek("gameSwitch");
    if (!pending) return;
    this.questions.answer(pending.id, choice);
    const { gameId } = pending.payload;
    if (choice === "switch" && isLive(this.library, gameId)) this.openWorkspace(gameId);
  }

  /** A panel whose type is gone becomes another type of the same module, and starts. */
  private choosePanelType(instanceId: string, panelType: string): void {
    const workspace = this.workspace;
    const record = workspace && this.records(workspace.id).find((item) => item.instanceId === instanceId);
    if (!workspace || !record) throw new WorkspaceError("error.panelClosed");
    if (this.panelTypeOf(record) !== undefined) return;
    const module = this.modules.get(record.moduleId);
    if (!module || !panelTypes(module.manifest).some((type) => type.id === panelType)) throw new WorkspaceError("error.panelTypeGone");
    record.panelType = panelType;
    this.workspaces.save();
    this.createView(record, workspace, performance.now());
  }

  private closePanel(instanceId: string): void {
    const workspace = this.workspace;
    if (!workspace || !this.workspaces.closePanel(workspace.id, instanceId)) return;
    this.closeView(instanceId);
  }

  /** Removes a panel's view and its UI state; module settings and documents stay. */
  private closeView(instanceId: string): void {
    this.panels.close(instanceId);
    void this.data.panelState.remove(instanceId).catch((error: unknown) => console.error("[tavora]", error));
  }

  // ── Browser ──────────────────────────────────────────────────────────

  private browser(instanceId: string): BrowserPanel {
    const view = this.browserPanel(instanceId);
    if (!view) throw new WorkspaceError("error.panelClosed");
    return view;
  }

  private browserCommand(panel: BrowserPanel, command: BrowserCommand): void {
    switch (command) {
      case "back":
        return panel.back();
      case "forward":
        return panel.forward();
      case "reload":
        return panel.reload();
      case "stop":
        return panel.stopLoading();
      case "mute":
      case "unmute":
        return panel.setMuted(command === "mute");
      case "exit-fullscreen":
        return panel.exitFullscreen();
      case "open-external": {
        // Only the page's own http or https address, and only on the user's click.
        const url = panel.externalUrl;
        if (url && !this.options.hidden) void shell.openExternal(url);
        return;
      }
    }
  }

  private isSiteListed(list: "sharedSites" | "adblockOff", url: string): boolean {
    const site = siteOfUrl(url);
    return site !== null && this.library.browser[list].includes(site);
  }

  /** A site moved between lists: open pages of it switch sessions and ad blocking applies from the next request. */
  private browserSitesChanged(): void {
    for (const view of this.browserPanels()) view.siteSettingsChanged();
  }

  /** Built once: every browser session shares the ad blocker and the lookups. */
  private sessionHooks(): BrowserSessionHooks {
    return (this.browserHooks ??= {
      userAgent: browserUserAgent(process.platform, process.versions.chrome ?? "0"),
      ads: Host.adBlocker(),
      topUrlOf: (id) => (id === undefined ? null : (this.browserByContents(id)?.topUrl ?? null)),
      adblockOn: (topUrl) => !this.isSiteListed("adblockOff", topUrl),
      onAdBlocked: (id) => id !== undefined && this.browserByContents(id)?.adBlocked(),
      onDownloadRefused: (contents) => contents && this.browserByContents(contents.id)?.downloadRefused(),
    });
  }

  // ── AI usage ─────────────────────────────────────────────────────────

  private static aiUsageService(options: HostOptions, onChange: (view: AiUsageView) => void): AiUsageConnector {
    const home = os.homedir();
    return new AiUsageConnector({
      file: path.join(options.userData, "ai-usage.json"),
      version: app.getVersion(),
      ...(options.aiUsageUrl ? { usageUrl: options.aiUsageUrl } : {}),
      readClaudeEmail: (directory) => readClaudeEmail(directory),
      fetch: (input, init) => fetch(input, init),
      readText: (file) => readFile(file, "utf8").catch(() => null),
      isDirectory: (directory) => stat(directory).then((info) => info.isDirectory(), () => false),
      writeText: (file, text) => writeFileAtomic(file, text),
      readCodex: (directory, signal) => readCodexUsage(directory, app.getVersion(), signal),
      // Profile folders next to the defaults, such as ~/.claude and ~/.claude-work; only their names are looked at.
      detect: async () => {
        const found: { provider: "claude" | "codex"; directory: string }[] = [];
        for (const entry of await readdir(home, { withFileTypes: true }).catch(() => [])) {
          if (!entry.isDirectory()) continue;
          const directory = path.join(home, entry.name);
          if (/^\.claude(-[\w.-]+)?$/.test(entry.name) && existsSync(path.join(directory, ".credentials.json"))) found.push({ provider: "claude", directory });
          if (/^\.codex(-[\w.-]+)?$/.test(entry.name) && existsSync(path.join(directory, "auth.json"))) found.push({ provider: "codex", directory });
        }
        return found;
      },
      now: () => Date.now(),
      onChange,
    });
  }

  // ── Account ──────────────────────────────────────────────────────────

  private static accountClient(options: HostOptions, signIn: SignIn, encryptor: Encryptor, language: () => Language, profile: AccountClientOptions["profile"], onChange: (view: AccountView) => void): AccountClient {
    return new AccountClient({
      enabled: options.accounts === true,
      baseUrl: serviceUrl(options.accountUrl ?? options.apiUrl),
      fetch: (input, init) => fetch(input, init),
      os: deviceOs(process.platform),
      deviceName: os.hostname(),
      language,
      canKeepSignIn: () => encryptor.isAvailable(),
      signIn,
      profile,
      onChange,
      discordLogin: () =>
        discordLogin({
          language,
          ...(options.discordAuthorizeUrl ? { authorizeUrl: options.discordAuthorizeUrl } : {}),
          // The user's own browser; a test follows the pretend page itself.
          open: options.discordAuthorizeUrl ? async (url) => void (await fetch(url)) : (url) => shell.openExternal(url),
        }),
    });
  }

  /** The saved sign-in, read at start for whoever needs the token before the account client exists. */
  private static signIn(options: HostOptions, encryptor: Encryptor): SignIn {
    const file = path.join(options.userData, "account.json");
    return new SignIn({ enabled: options.accounts === true, load: () => loadAccount(file, encryptor), save: (account) => saveAccount(file, encryptor, account) });
  }

  /**
   * The cloud copy, run before the data is read: a copy waiting from the last run, or a newer one from another PC, is
   * taken first. It holds the account's sign-in and the module files folder, which are the saved ones until the
   * library is read (`moduleFilesFolder`) and the live ones after.
   */
  private static cloudCopy(options: HostOptions, encryptor: Encryptor, signIn: SignIn, files: { root(): string }): CopySync {
    return new CopySync({
      userData: options.userData,
      enabled: options.accounts === true,
      devData: options.devData === true,
      files,
      account: signIn,
      serviceUrl: accountServiceUrl(options),
      encryptor,
      restart: () => options.restart(),
      log: (line) => console.log(`[tavora] ${line}`),
    });
  }

  // ── Discord ──────────────────────────────────────────────────────────

  private static discordConnector(options: HostOptions, encryptor: Encryptor, onChange: (view: ReturnType<DiscordConnector["view"]>) => void): DiscordConnector {
    const file = path.join(options.userData, "discord.json");
    const test = options.discord;
    return new DiscordConnector({
      clientId: DISCORD_CLIENT_ID,
      connect: (events) => RpcClient.connect(DISCORD_CLIENT_ID, events, test ? [test.ipcPath] : undefined),
      ...(test ? { tokenUrl: test.tokenUrl } : {}),
      fetch: (input, init) => fetch(input, init),
      load: () => loadDiscordSecrets(file, encryptor),
      save: (secrets) => saveDiscordSecrets(file, encryptor, secrets),
      get canSaveSignIn() {
        return encryptor.isAvailable();
      },
      onChange,
    });
  }

  /** The filter engine compiled at build time (scripts/filters.mjs). */
  private static adBlocker(): AdBlocker | null {
    return loadAdBlocker(path.join(__dirname, "../filters/engine.bin"));
  }

  private browserSessionFor(kind: BrowserKind, workspaceId: string) {
    return browserSession(browserPartition(kind, workspaceId), this.sessionHooks());
  }

  /** Deletes the Browser's cookies, logins, storage and caches: the current workspace's, or the ones shared by all workspaces. */
  private async clearBrowserData(scope: "workspace" | "shared"): Promise<void> {
    const workspace = this.workspace;
    if (scope === "workspace" && !workspace) throw new LibraryError("error.openWorkspaceFirst");
    const ses = this.browserSessionFor(scope, workspace?.id ?? "");
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    for (const view of this.browserPanels()) view.reload();
  }

  // ── Layouts and snapshots ────────────────────────────────────────────

  /** The workspace shown now, whose layout the user is changing. */
  private currentWorkspaceId(): string {
    const workspace = this.workspace;
    if (!workspace) throw new WorkspaceError("error.openWorkspaceFirst");
    return workspace.id;
  }

  /** Replaces the open panels with the snapshot's; views start for the new panels and stop for the rest. */
  private applySnapshot(snapshotId: string): void {
    const { opened, closed } = this.workspaces.applySnapshot(this.currentWorkspaceId(), snapshotId);
    for (const record of closed) this.closeView(record.instanceId);
    for (const record of opened) {
      this.panels.setLaunch(record.instanceId, { reason: "add" });
      this.createView(record, this.workspace!);
    }
  }

  // ── Views ────────────────────────────────────────────────────────────

  private openCurrentWorkspace(): void {
    const workspace = this.workspace;
    if (!workspace) return;
    for (const record of this.records(workspace.id)) this.createView(record, workspace);
    this.workspaces.relayout();
    // Only this workspace's own module pages are waited for: a panel in the in-game layer runs on from another workspace.
    if (this.records(workspace.id).some((record) => this.moduleView(record.instanceId) && !this.panels.isLent(record.instanceId))) {
      const layout = layoutKey(workspace.id, this.records(workspace.id));
      this.panels.startOpening(OPENING_CAP_MS, layout);
      this.cover.start(this.currentTheme, translate(this.language, "panel.loading", { name: workspace.displayName }), this.openTimes.estimate(layout));
      // The host UI covers the panels from now on, not each panel with its own loader.
      this.pushStateSoon();
    }
  }

  /** The wait for a workspace's panels ended; `show`: they are placed now, and the host UI takes its loading cover away. */
  private openingEnded({ show, startedAt, tag: layout }: { show: boolean; startedAt: number; tag: string }): void {
    const took = performance.now() - startedAt;
    const opening = ++this.openings;
    if (!show) return this.cover.cancel();
    timings.record("workspace-open", took);
    this.pushState();
    // The panels are shown now, under the cover; it goes once every one has drawn.
    const shown = this.panels.inSlots();
    this.logDraws(shown, "workspace open");
    void Promise.all(shown.map((view) => view.drawn)).then(() => {
      if (opening !== this.openings || !this.cover.covering) return;
      const total = performance.now() - startedAt;
      timings.record("workspace-drawn", total);
      timingLog?.(`workspace open: data ${Math.round(took)} ms, every panel drawn ${Math.round(total)} ms, cover fire ${this.cover.fireShown ? "shown" : "not shown"}`);
      void this.openTimes.record(layout, total);
      this.cover.finish();
    });
  }

  /** openedAt is when the user asked for the panel; its time to a loaded page is measured from there. */
  private createView(record: InstanceRecord, workspace: TavoraWorkspace, openedAt?: number): void {
    // Its panel is in the in-game layer and kept running there while another workspace was shown: it comes back when the layer closes.
    if (this.panels.has(record.instanceId)) return;
    if (record.moduleId === BROWSER_MODULE_ID) return this.createBrowser(record, workspace);
    // It was added while its module still asks (questionOf); the page starts once the user allows (reloadModuleViews).
    if (this.panels.isAwaiting(record.instanceId)) return;
    const panelType = this.panelTypeOf(record);
    // Its type is gone: the slot says so and offers another type; nothing runs.
    if (panelType === undefined) return;
    let measured = openedAt === undefined;
    const module = this.modules.get(record.moduleId)!;
    const view = new ModuleView({
      instanceId: record.instanceId,
      module,
      panelType,
      workspace,
      data: this.data.get(module.owner, module.manifest.id, workspace.id),
      panelState: this.data.panelState,
      hostVersion: app.getVersion(),
      preload: this.options.modulePreload,
      devTools: this.options.devTools,
      getTheme: () => this.currentTheme,
      getLanguage: () => this.language,
      baseCss: (moduleCss ??= moduleBaseCss(MODULE_FONTS)),
      ...(this.options.moduleStorageLimit === undefined ? {} : { storageLimit: this.options.moduleStorageLimit }),
      onStorageOver: () => void this.purgeModuleStorage(module.manifest.id, workspace.id),
      onReveal: () => {
        this.panels.applyBounds();
        this.pushStateSoon();
      },
      onDrawn: () => this.pushStateSoon(),
      onOpenLink: (url) => this.openLinkFromModule(url, workspace.id),
      onNeedsTavora: () => {
        this.notice = translate(this.language, "overlays.bringBackFirst");
        this.pushState();
      },
      showMenu: (menu) => this.showModuleMenu(record.instanceId, menu),
      savePicture: (png, name) => this.savePictureAs(png, name),
      saveJson: (data, name) => this.saveJsonAs(module, data, name),
      openJson: () => this.openJsonFrom(module),
      pickReadOnlyFile: async extensions => {
        const defaultPath=await saveDialogDirectory(new ReadOnlyFiles(app.getPath('userData'),module.owner,module.manifest.id,workspace.id),this.library.workspaces[workspace.id]?.catalogId ?? workspace.id);
        const picked = await dialog.showOpenDialog(this.window, {...(defaultPath?{defaultPath}:{}),title:this.language.startsWith('de')?'Datei mit '+this.shown(module.manifest).name+' verknüpfen':'Link a file to '+this.shown(module.manifest).name,buttonLabel:this.language.startsWith('de')?'Datei verknüpfen':'Link file',properties:['openFile'],filters:[{name:this.language.startsWith('de')?'Datei auswählen':'Choose a file',extensions}]});
        return picked.canceled ? null : picked.filePaths[0] ?? null;
      },
      tooltip:{show:request=>this.tooltips.show(record.instanceId,request),move:anchor=>this.tooltips.move(record.instanceId,anchor.id,anchor.at),close:(id,hoverOnly)=>this.tooltips.close(record.instanceId,id,hoverOnly)},
      launch: () => this.launchOf(record),
      setContent: (content) => this.setPanelContent(record, content),
      openPanel: (type, content) => this.openRelatedPanel(record, type, content),
      setLive: (state) => this.gameOverlays.setLive(record.instanceId, module.owner, state),
      setMaximized: (maximized) => this.window.webContents.send("host:shortcut", `${maximized ? "maximize" : "restore"}:${record.instanceId}`),
      setDialog: (open, size) => (open ? this.openPanelDialog(record.instanceId, module, size) : this.panels.closeDialog(record.instanceId)),
      networkHosts: () => this.networkHostsOf(record.moduleId),
      connectors: () => this.connectorsOf(record.moduleId),
      appSettings: this.data.appSettings(module.owner, module.manifest.id),
      leaderboards: this.leaderboardsOf(module, (question) => this.askLeaderboard(record.instanceId, record.moduleId, question)),
      aiUsage: { accounts: () => this.aiUsage.accountInfos(), read: (accountId) => this.aiUsage.read(accountId) },
      discord: this.discord,
      systemInfo: this.systemInfo,
      connection: this.connection,
      media: this.media,
      overlay: {
        ...this.streaming.overlayFor(module, workspace.id),
        showOverGame: (key) => this.gameOverlays.show(module, workspace.id, key),
        hideOverGame: (key) => this.gameOverlays.hide(module, workspace.id, key),
        overGame: () => this.gameOverlays.keysOf(module, workspace.id),
        preview: async (key) => this.previews.show({ owner: module.owner, moduleId: module.manifest.id, workspaceId: workspace.id, key }),
      },
      hotkeys: this.streaming.hotkeysFor(module, workspace.id),
      ...(this.options.testNetworkHosts ? { testHosts: this.options.testNetworkHosts } : {}),
      onStatus: (status) => {
        if (!measured && status === "ready") {
          measured = true;
          timings.record("panel-open", performance.now() - openedAt!);
        }
        this.pushStateSoon();
      },
    });
    const adapter = new ModulePanelView(view);
    this.panels.open(record, () => ({
      adapter,
      start: () => {
        const contentsId = view.webContentsId;
        this.panels.bindContents(adapter, contentsId);
        view.view.webContents.once("destroyed", () => this.panels.unbindContents(adapter, contentsId));
        this.watchShortcuts(view.view.webContents);
        this.window.contentView.addChildView(view.view);
      },
    }));
  }

  /**
   * Why a panel's page is loading (panel.getLaunch): added just now, opened by another panel, or open before with
   * what it last showed. A new panel keeps its reason until its page first asks.
   */
  private launchOf(record: InstanceRecord): PanelLaunch {
    const launch = this.panels.takeLaunch(record.instanceId);
    if (launch) return launch;
    return { reason: "restore", content: record.content ? { ...record.content } : null };
  }

  /**
   * panels.open from a panel, after its click was taken (the decision log, named panels rounds 2, 3, 5 and 6): one
   * of the module's own panel types, in the workspace shown now. A panel of that type already showing the content comes
   * to the front; else the one used last is asked to switch, saving first; else a new panel opens. A switch that
   * fails leaves that panel as it was, and the user is asked whether to open the content in a new panel.
   */
  private async openRelatedPanel(from: InstanceRecord, type: string, content: PanelContent | null): Promise<PanelOpenResult> {
    const workspace = this.workspace;
    const module = this.modules.get(from.moduleId);
    if (!workspace || !module || !this.records(workspace.id).includes(from)) throw new HostError("PERMISSION_DENIED", "panels.open works only in the workspace shown now");
    const target = panelTypes(this.shown(module.manifest)).find((item) => item.id === type);
    if (!target) throw new HostError("INVALID_PARAMS", `this module has no panel type "${type}"`);
    const others = this.panelsOfType(workspace.id, from.moduleId, type).filter(
      (item): item is { record: InstanceRecord; order: number; view: ModuleView } => item.record !== from && item.view instanceof ModuleView,
    );
    const showing = content ? others.find((item) => item.record.content?.id === content.id) : others[0];
    if (showing) {
      this.showPanel(showing.record.instanceId);
      return "shown";
    }
    const last = others[0];
    if (last && content) {
      const outcome = await last.view.navigate(content);
      // The user may have left the workspace while the panel saved.
      if (this.workspace?.id !== workspace.id || !this.records(workspace.id).includes(last.record)) return "failed";
      if (outcome === "switched") {
        this.showPanel(last.record.instanceId);
        return "switched";
      }
      if (outcome === "failed") {
        this.questions.ask("navigation", { workspace: workspace.id }, { workspaceId: workspace.id, moduleId: from.moduleId, panelType: type, panelName: target.name, content });
        this.pushState();
        return "failed";
      }
      // The page takes no navigation: a new panel shows the content instead.
    }
    return this.openPanelOn(from.moduleId, type, content) ? "opened" : "failed";
  }

  /** A workspace's panels of one of a module's panel types (undefined: a module without types); the one used last first, of panels nobody used the newest. */
  private panelsOfType(workspaceId: string, moduleId: string, type: string | undefined) {
    const usedAt = (view: unknown) => (view instanceof ModuleView ? view.usedAt : 0);
    return this.records(workspaceId)
      .map((record, order) => ({ record, order, view: this.nativePanel(record.instanceId) }))
      .filter((item) => item.record.moduleId === moduleId && item.record.panelType === type)
      .sort((a, b) => usedAt(b.view) - usedAt(a.view) || b.order - a.order);
  }

  /** A new panel of a module's panel type, told it was opened on `content`; false when the workspace is full. */
  private openPanelOn(moduleId: string, panelType: string, content: PanelContent | null): boolean {
    try {
      return this.openModule(moduleId, { panelType, launch: { reason: "open", content } }) !== undefined;
    } catch (error) {
      // The workspace is full; the user is told, as for Add module.
      if (error instanceof WorkspaceError) this.notice = error.message;
      else throw error;
      return false;
    } finally {
      this.pushState();
    }
  }

  /** The user's answer to pendingNavigation. */
  private chooseNavigation(choice: "new-panel" | "cancel"): void {
    const pending = this.questions.peek("navigation");
    if (pending) this.questions.answer(pending.id, choice);
    const open = pending?.payload;
    if (open && choice === "new-panel" && this.workspace?.id === open.workspaceId) this.openPanelOn(open.moduleId, open.panelType, open.content);
    else this.pushState();
  }

  /** Brings a panel to the front of its dock group; it counts as used. */
  private showPanel(instanceId: string): void {
    const view = this.moduleView(instanceId);
    if (view) view.usedAt = Date.now();
    this.window.webContents.send("host:shortcut", `panel:${instanceId}`);
  }

  /** What a panel shows now (panel.setContent, checked by the bridge); its tab's hover text says it. */
  private setPanelContent(record: InstanceRecord, content: PanelContent | null): void {
    if (content?.id === record.content?.id && content?.title === record.content?.title) return;
    if (content) record.content = content;
    else delete record.content;
    this.workspaces.save();
    this.pushState();
  }

  /** Connectors a module may use now: its grant, as far as the module installed now still asks for them. */
  private connectorsOf(moduleId: string): ReadonlySet<string> {
    const module = this.modules.get(moduleId);
    return new Set(module ? this.grants.allowed(module).connectors : []);
  }

  /** Hosts a module may reach now: its grant, as far as the module installed now still asks for them. */
  private networkHostsOf(moduleId: string): ReadonlySet<string> {
    const module = this.modules.get(moduleId);
    return new Set(module ? this.grants.allowed(module).network : []);
  }

  private createBrowser(record: InstanceRecord, workspace: TavoraWorkspace): void {
    const { instanceId } = record;
    const panel: BrowserPanel = new BrowserPanel({
      instanceId,
      devTools: this.options.devTools,
      background: () => this.currentTheme.tokens.background,
      sessionFor: (kind) => this.browserSessionFor(kind, workspace.id),
      isSharedSite: (url) => this.isSiteListed("sharedSites", url),
      adblockOn: (url) => !this.isSiteListed("adblockOff", url),
      swap: (previous, next) => {
        if (previous) {
          this.panels.unbindContents(adapter, previous.webContents.id);
          this.window.contentView.removeChildView(previous);
        }
        const id = next.webContents.id;
        this.panels.bindContents(adapter, id);
        next.webContents.once("destroyed", () => this.panels.unbindContents(adapter, id));
        this.watchShortcuts(next.webContents);
        this.window.contentView.addChildView(next);
        if (previous) this.panels.applyBounds();
      },
      onAddress: (url) => {
        if (this.panels.get(instanceId) !== adapter) return;
        void this.data.panelState.set(instanceId, { url }).catch((error: unknown) => console.error("[tavora]", error));
      },
      onOpenTab: (url, background) => {
        try {
          this.openBrowserTab(instanceId, url, background);
        } catch (error) {
          // The workspace is full; the user is told the same as for Add module.
          if (error instanceof WorkspaceError) this.notice = error.message;
        } finally {
          this.pushState();
        }
      },
      onCloseTab: () => {
        this.closePanel(instanceId);
        this.pushState();
      },
      onFocusAddress: () => {
        this.window.webContents.focus();
        this.window.webContents.send("host:shortcut", `address:${instanceId}`);
      },
      onChange: () => this.pushState(),
    });
    const adapter = new BrowserPanelView(panel);
    this.panels.open(record, () => ({ adapter, start: () => panel.attach() }));
    // The page the panel showed last time opens again.
    void this.data.panelState.get(instanceId).then(
      (saved) => this.panels.get(instanceId) === adapter && panel.restore((saved as { url?: unknown } | null)?.url),
      () => undefined,
    );
  }

  /** Sends Tavora's own shortcuts to the host UI, from the host page and from module panels. */
  private watchShortcuts(contents: WebContents): void {
    contents.on("before-input-event", (event, input) => {
      if(input.key==="Escape"&&this.tooltips?.state.current){event.preventDefault();this.tooltips.close();return;}
      // Typing in a panel over the game is the panel's: Tavora's shortcuts don't pull the keyboard away to the main window.
      if (this.panels.isLentContents(contents.id)) return;
      const shortcut = shortcutFor(input);
      if (!shortcut) return;
      event.preventDefault();
      if (contents !== this.window.webContents) this.window.webContents.focus();
      this.window.webContents.send("host:shortcut", shortcut);
    });
  }

  /** Modules being cleared right now, so several panels of one module do it once. */
  private readonly purging = new Set<string>();

  /**
   * A module's browser storage grew past the limit (storage-guard.ts): stop its
   * panels, clear the storage and start the panels again, and say so.
   */
  private async purgeModuleStorage(moduleId: string, workspaceId: string): Promise<void> {
    const key = `${moduleId}@${workspaceId}`;
    if (this.purging.has(key)) return;
    this.purging.add(key);
    try {
      const views = this.moduleViews().filter((view) => view.moduleId === moduleId);
      const ses = views[0]?.view.webContents.session;
      // The renderers must be gone first: one still writing would fill the storage
      // again, and a crash reported after the reload would leave the panel crashed.
      await Promise.all(views.map((view) => view.stop()));
      // Said before the clearing, which can take a few seconds; the panels already show they stopped.
      const installed = this.modules.get(moduleId);
      const name = installed ? this.shown(installed.manifest).name : moduleId;
      this.notice = translate(this.language, "modules.storageCleared", { name });
      this.pushState();
      await ses?.clearStorageData();
      for (const view of views) view.reload();
    } catch (error) {
      console.error("[tavora] clearing a module's storage failed", error);
    } finally {
      this.purging.delete(key);
      this.pushState();
    }
  }

  private closeAllViews(): void {
    this.cover.cancel();
    // A panel in the layer goes on running there, also while another workspace or Home is shown.
    this.panels.closeAll();
  }

  /** Whether the panel shows a question in its place now (questionOf): its page waits, hidden, until it is answered. */
  private askingIn(instanceId: string): boolean {
    const shown = this.workspaceId ? this.records(this.workspaceId) : [];
    const record = shown.find((item) => item.instanceId === instanceId);
    return !!record && this.questionOf(record, shown) === "ask";
  }

  /** A panel's module view; undefined for a Browser panel or when it has none. */
  private moduleView(instanceId: string): ModuleView | undefined {
    const view = this.panels.get(instanceId);
    return view instanceof ModulePanelView ? view.panel : undefined;
  }

  private moduleViews(): ModuleView[] {
    return this.panels.adapters().flatMap((view) => (view instanceof ModulePanelView ? [view.panel] : []));
  }

  /** The module view whose page has these contents (what a page's own requests are judged by). */
  private moduleByContents(contentsId: number): ModuleView | undefined {
    const view = this.panels.byWebContents(contentsId);
    return view instanceof ModulePanelView ? view.panel : undefined;
  }

  private browserPanel(instanceId: string): BrowserPanel | undefined {
    const view = this.panels.get(instanceId);
    return view instanceof BrowserPanelView ? view.panel : undefined;
  }

  private browserPanels(): BrowserPanel[] {
    return this.panels.adapters().flatMap((view) => (view instanceof BrowserPanelView ? [view.panel] : []));
  }

  /** The Browser panel whose page has these contents (what the page's requests are judged by). */
  private browserByContents(contentsId: number): BrowserPanel | undefined {
    const view = this.panels.byWebContents(contentsId);
    return view instanceof BrowserPanelView ? view.panel : undefined;
  }

  private nativePanel(instanceId: string): ModuleView | BrowserPanel | undefined {
    const view = this.panels.get(instanceId);
    return view instanceof ModulePanelView || view instanceof BrowserPanelView ? view.panel : undefined;
  }

  private nativePanels(): (ModuleView | BrowserPanel)[] {
    return this.panels.adapters().flatMap((view) => (view instanceof ModulePanelView || view instanceof BrowserPanelView ? [view.panel] : []));
  }

  /**
   * Panel menu > Show in game. The click is the user's consent; the panel must be one of the workspace shown now, and of a
   * type the module marked `inGame`. It is over the game only while the user holds the in-game layer open.
   */
  private showPanelInGame(instanceId: string): void {
    const workspace = this.workspace;
    const record = workspace && this.records(workspace.id).find((item) => item.instanceId === instanceId);
    const module = record && this.modules.get(record.moduleId);
    if (!workspace || !record || !module || !this.moduleView(instanceId)) throw new WorkspaceError("error.panelClosed");
    if (!this.canShowInGame(record)) throw new WorkspaceError("error.panelNotInGame");
    const viewport = this.panelTypeOf(record)?.viewport ?? this.shown(module.manifest).viewport;
    const result = this.gameOverlays.showPanel(
      { owner: module.owner, moduleId: module.manifest.id, workspaceId: workspace.id, instanceId },
      { width: viewport.preferredWidth, height: viewport.preferredHeight },
    );
    if (result === "full") this.notice = translate(this.language, "overlays.full");
  }

  /** The name a panel's tab shows, for Settings > Overlays; null once the panel is gone. */
  private panelName(instanceId: string): string | null {
    const view = this.moduleView(instanceId);
    if (view) {
      const module = this.modules.get(view.moduleId);
      return view.typeName ?? (module ? this.shown(module.manifest).name : null);
    }
    // Its workspace is not the one shown: named from its record.
    const record = this.recordOf(instanceId);
    const module = record && this.modules.get(record.moduleId);
    if (!record || !module) return null;
    return this.panelTypeOf(record)?.name ?? this.shown(module.manifest).name;
  }

  /** A panel's record, in whichever workspace it is. */
  private recordOf(instanceId: string, workspaceId?: string): InstanceRecord | undefined {
    for (const id of workspaceId ? [workspaceId] : Object.keys(this.library.workspaces)) {
      const record = this.records(id).find((item) => item.instanceId === instanceId);
      if (record) return record;
    }
    return undefined;
  }

  /** What the in-game layer knows of a panel: its tab's name, whether its type allows the game, when it was used, the size it prefers. */
  private panelInfo(instanceId: string, workspaceId?: string): PanelInfo | null {
    const record = this.recordOf(instanceId, workspaceId);
    const module = record && this.modules.get(record.moduleId);
    if (!record) return null;
    // Unknown (module not loaded yet) counts as allowed: a panel is dropped only when its type is known to say no. A module without panel types says it at the top (`inGame`), as To-Dos does.
    const allowed = this.panelTypeOf(record) === undefined || this.canShowInGame(record);
    const viewport = module && (this.panelTypeOf(record)?.viewport ?? this.shown(module.manifest).viewport);
    return {
      name: this.panelName(instanceId),
      allowed,
      usedAt: this.moduleView(instanceId)?.usedAt ?? 0,
      preferred: viewport ? { width: viewport.preferredWidth, height: viewport.preferredHeight } : null,
    };
  }

  /** Lends a panel's view to the in-game layer: its own when its workspace is shown, else one made for the layer. */
  private lendPanel(instanceId: string, workspaceId: string, revoked: () => void): PanelLoan | null {
    if (this.window.isDestroyed()) return null;
    const existing = this.panels.get(instanceId);
    if (existing && !(existing instanceof ModulePanelView)) return null;
    if (!existing) {
      const record = this.recordOf(instanceId, workspaceId);
      const entry = this.library.workspaces[workspaceId];
      if (!record || !entry || record.moduleId === BROWSER_MODULE_ID) return null;
      this.createView(record, { id: entry.id, displayName: entry.name, kind: entry.kind });
    }
    const view = this.moduleView(instanceId);
    if (!view || view.view.webContents.isDestroyed()) return null;
    this.tooltips.close(instanceId);
    this.closeModuleMenu(instanceId);
    const lease = this.panels.lend(instanceId, revoked);
    return lease ? { panel: view, return: () => lease.return() } : null;
  }

  /** The window for an overlay's page, or (with `panel`) for a panel over its game: the panel's own view goes into it, and no copy is made. */
  private overlayWindow(request: OverlayWindowRequest, panel?: OverlayPanel): GameOverlayWindow {
    return new GameOverlayWindow({
      preload: path.join(path.dirname(this.options.modulePreload), "game-overlay.cjs"),
      hidden: !!this.options.hidden,
      id: request.id,
      source: { page: request.page, state: request.state, watch: request.watch },
      gameBounds: request.gameBounds,
      moved: request.moved,
      closeRequested: request.closeRequested,
      layoutRequested: request.layoutRequested,
      ended: request.ended,
      frameText: request.frameText,
      ...(panel ? { panel } : {}),
    });
  }

  private frozenShown: (() => void) | null = null;

  /** Resolves once the host UI says the panels' still images are on screen, or after FROZEN_SHOWN_CAP_MS. */
  private frozenOnScreen(): Promise<void> {
    this.frozenShown?.();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (this.frozenShown === done) this.frozenShown = null;
        resolve();
      };
      const timer = setTimeout(done, FROZEN_SHOWN_CAP_MS);
      this.frozenShown = done;
    });
  }

  /** With TAVORA_TIMINGS, says how long each panel took to draw once shown: without being covered, it showed empty that long. */
  private logDraws(views: PanelViewAdapter[], what: string): void {
    if (!timingLog) return;
    const shownAt = performance.now();
    for (const { panel: view } of views.filter((item): item is ModulePanelView => item instanceof ModulePanelView)) {
      void view.drawn.then(() => timingLog?.(`${what}: ${view.moduleId}${view.typeName ? ` (${view.typeName})` : ""} drew ${Math.round(performance.now() - shownAt)} ms after it was shown`));
    }
  }

  /** A place on the window from the host UI, or null when it is none. */
  private windowRect(raw: unknown) {
    return clampRect(raw, this.window.getContentBounds());
  }

  /** Tavora's emblem as a data: URL for the cover's fire, from the built host UI (or its dev server); null when it cannot be read. */
  private static async readEmblem(options: HostOptions): Promise<string | null> {
    const name = "brand/emblem-transparent-512.png";
    try {
      const bytes = options.devServer
        ? Buffer.from(await (await fetch(new URL(name, options.devServer), { signal: AbortSignal.timeout(2_000) })).arrayBuffer())
        : await readFile(path.join(options.rendererDir, name));
      return `data:image/png;base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  }

  // ── Module menus ─────────────────────────────────────────────────────

  /**
   * Draws a module's menu in the host UI, over its panel and every other one. Only one at a time: a
   * new one closes the last. Nothing is shown for a panel that is hidden or under a host menu or dialog.
   */
  private showModuleMenu(instanceId: string, menu: CheckedMenu): Promise<string | null> {
    if (!this.panels.has(instanceId) || !this.panels.isPlaced(instanceId) || this.panels.isLent(instanceId) || this.panels.overlay || this.window.isDestroyed()) return Promise.resolve(null);
    this.closeModuleMenu();
    const { id: requestId, answer } = this.questions.ask("menu", { panel: instanceId }, { choices: menu.choices });
    // The menu is drawn by the host page, so the keyboard goes there while it is open.
    this.window.webContents.focus();
    const shown: ModuleMenu = { requestId, instanceId, ...menu.request };
    this.window.webContents.send("host:module-menu", shown);
    return answer;
  }

  /** The user chose an item or closed the menu. Only an item the module offered (and did not disable) counts. */
  private answerModuleMenu(raw: unknown): void {
    const answer = (typeof raw === "object" && raw !== null ? raw : {}) as { requestId?: unknown; id?: unknown };
    const open = this.questions.peek("menu");
    if (!open || answer.requestId !== open.id) return;
    this.questions.answer(open.id, typeof answer.id === "string" && open.payload.choices.has(answer.id) ? answer.id : null);
    // The keyboard goes back to the panel, so an action such as Rename can take it.
    const view = "panel" in open.scope ? this.moduleView(open.scope.panel) : undefined;
    if (view && !view.view.webContents.isDestroyed()) view.view.webContents.focus();
  }

  /**
   * Shows a panel big in a dialog centred on the app: the host UI draws the frame (the module's name and a close button)
   * over the dimmed app and says where the page goes; the panel's own view moves there, so it keeps everything it had.
   * Only a panel in sight in the workspace, one at a time; a new one closes the last.
   */
  private openPanelDialog(instanceId: string, module: InstalledModule, size: PanelDialogSize): void {
    if (this.panels.isLent(instanceId)) return this.openPanelDialogFromGame(instanceId, module, size);
    if (this.window.isDestroyed() || !this.panels.openDialog(instanceId, size)) return;
    this.closeModuleMenu();
    this.tooltips.close(instanceId);
    const shown: PanelDialog = { instanceId, title: this.shown(module.manifest).name, icon: this.moduleInfo.get(module.manifest.id)?.icon ?? null, ...size };
    this.window.webContents.send("host:panel-dialog", shown);
  }

  /**
   * A panel over the game opens its dialog: the layer closes, Tavora comes to the front on the panel's workspace, and the
   * dialog opens as soon as the panel is back in its slot.
   */
  private openPanelDialogFromGame(instanceId: string, module: InstalledModule, size: PanelDialogSize): void {
    const workspaceId = this.gameOverlays.panelWorkspace(instanceId);
    if (!workspaceId || this.window.isDestroyed() || !isLive(this.library, workspaceId)) return;
    // It opens once the panel is back in its slot, if that happens soon.
    void this.questions.ask("dialog", { panel: instanceId }, { module, size, until: Date.now() + PENDING_DIALOG_MS });
    // From Home or the Overlay page too: no workspace counts as shown there.
    if (this.workspaceId !== workspaceId) this.openWorkspace(workspaceId);
    this.gameOverlays.endLayer();
    this.bringToFront();
    this.openPendingDialog();
  }

  /** Opens the dialog a panel asked for from the layer once the panel is back in its slot; a panel that took too long misses it. */
  private openPendingDialog(): void {
    const pending = this.questions.peek("dialog");
    if (!pending || !("panel" in pending.scope)) return;
    const instanceId = pending.scope.panel;
    if (Date.now() > pending.payload.until) {
      this.questions.cancel(pending.id);
      return;
    }
    if (this.panels.isLent(instanceId) || !this.panels.isPlaced(instanceId)) return;
    this.questions.answer(pending.id, true);
    this.openPanelDialog(instanceId, pending.payload.module, pending.payload.size);
  }

  /** Closes the module menu shown now (only if it belongs to `instanceId`, when given), as if nothing was chosen. */
  private closeModuleMenu(instanceId?: string): void {
    const ended = instanceId === undefined ? this.questions.cancelKind("menu") : this.questions.cancel({ panel: instanceId }, "menu");
    if (ended && !this.window.isDestroyed()) this.window.webContents.send("host:module-menu", null);
  }

  // ── State ────────────────────────────────────────────────────────────

  private supportsWorkspace(module: InstalledModule, workspaceId: string): boolean {
    const { games } = module.manifest;
    const entry = this.library.workspaces[workspaceId];
    // A personal workspace belongs to no game: only modules for any game that did not opt out go there.
    if (entry?.kind === "personal") return allowsPersonalWorkspaces(module.manifest);
    // A game workspace's id is its game's.
    const catalogId = entry?.catalogId;
    return games.length === 0 || games.includes(workspaceId) || (catalogId != null && games.includes(catalogId));
  }

  /** A game workspace's own icon (its game's) as an address, with the version of its file so a replaced file shows at once, and how it sits in its tile. */
  private ownIcon(workspace: WorkspaceEntry): { steamIcon: string | null; steamIconTone: IconTone | null } {
    if (!(this.library.steamIcons && workspace.useOriginalIcon && workspace.iconFile)) return { steamIcon: null, steamIconTone: null };
    const dir = this.steamIconDir;
    return {
      steamIcon: `${STEAM_ICON_URL}${workspace.iconFile}?v=${iconVersion(dir, workspace.iconFile)}`,
      steamIconTone: (this.toneReader ??= createToneReader(dir, loadSmallBitmap))(workspace.iconFile),
    };
  }

  private toneReader: ((file: string) => IconTone) | undefined;

  private workspaceView(workspace: WorkspaceEntry): WorkspaceView {
    return {
      id: workspace.id,
      kind: workspace.kind,
      name: workspace.name,
      icon: workspace.icon.kind === "image" ? { kind: "image", url: ICON_URL + workspace.icon.file } : workspace.icon,
      ...this.ownIcon(workspace),
      iconChoice: workspace.icon.kind === "image" ? "image" : workspace.useOriginalIcon ? "original" : "letters",
      shareIcon: ((file) => (file ? STEAM_ICON_URL + file : null))(this.shareableFile(workspace)),
      builtIn: workspace.catalogId !== null,
      addedAt: workspace.addedAt,
      lastOpenedAt: workspace.lastOpenedAt,
    };
  }

  /** What the host UI shows. */
  private viewState(): HostViewState {
    const library = this.library;
    const current = this.workspace;
    const workspace = current ? this.workspaces.workspace(current.id) : emptyWorkspace();
    const workspaces: Record<string, WorkspaceView> = {};
    for (const entry of Object.values(library.workspaces)) {
      if (entry.trashedAt === null) workspaces[entry.id] = this.workspaceView(entry);
    }
    const pending = this.questions.snapshot();
    return {
      screen: this.screen,
      currentWorkspaceId: current?.id ?? null,
      library: {
        workspaces,
        folders: structuredClone(library.folders),
        root: sortedRoot(library, this.openedAtStart),
        favorites: [...library.favorites],
        recent: recentWorkspaces(library, 8).map((entry) => entry.id),
        trash: trashedWorkspaces(library).map((entry) => ({
          workspace: this.workspaceView(entry),
          trashedAt: entry.trashedAt!,
          purgeAt: purgeDate(entry).toISOString(),
        })),
        sort: library.sort,
        startup: library.startup,
        gameStart: library.gameStart,
        gameEndWorkspaceId: library.gameEndWorkspaceId && isLive(library, library.gameEndWorkspaceId) ? library.gameEndWorkspaceId : null,
        grayscaleText: library.grayscaleText,
        onlineSearch: library.onlineSearch,
        autoUpdate: library.autoUpdate,
        autoUpdateModules: library.autoUpdateModules,
        steamIcons: library.steamIcons,
        moduleIcons: library.moduleIcons,
        toasts: library.toasts,
        steamProfile: library.steamProfile,
        onboarded: library.onboarded,
        makesModules: library.makesModules,
        seenVersion: library.seenVersion,
        rail: { ...library.rail },
        browser: { sharedSites: [...library.browser.sharedSites], adblockOff: [...library.browser.adblockOff] },
      },
      modules: [...this.modules.values()].map((module) => ({
        id: module.manifest.id,
        name: this.shown(module.manifest).name,
        description: this.shown(module.manifest).description ?? null,
        available: current !== null && this.supportsWorkspace(module, current.id),
        minWidth: module.manifest.viewport.minWidth,
        minHeight: module.manifest.viewport.minHeight,
        ...(module.manifest.viewport.wide ? { wide: { ...module.manifest.viewport.wide } } : {}),
        panels: panelTypes(this.shown(module.manifest)).map((type) => ({
          id: type.id,
          name: type.name,
          icon: this.moduleInfo.get(module.manifest.id)?.panelIcons[type.id] ?? null,
          minWidth: type.viewport.minWidth,
          minHeight: type.viewport.minHeight,
          ...(type.viewport.wide ? { wide: { ...type.viewport.wide } } : {}),
        })),
        provenance: module.provenance,
        development: isExampleModule(module.manifest.id) || module.developmentFolder !== undefined,
        project: module.developmentProject !== undefined,
        version: module.manifest.version,
        origin: this.moduleInfo.get(module.manifest.id)?.origin ?? { kind: "dev" as const, folder: "" },
        removable: this.moduleInfo.get(module.manifest.id)?.removable ?? false,
        fromCatalog: this.catalogModules.has(module.manifest.id),
        support: module.manifest.support ?? null,
        publisher: this.publisherOf(module),
        publisherName: ((key) => (key ? this.publisherNames.name(key) : null))(this.publisherOf(module)),
        localDataWaiting: this.localDataWaiting(module),
        icon: this.moduleInfo.get(module.manifest.id)?.icon ?? null,
        permissions: {
          asks: { network: [...module.manifest.permissions.network], connectors: [...(module.manifest.permissions.connectors ?? [])] },
          granted: this.grants.allowed(module),
          missing: this.grants.missing(module),
        },
        usedIn: this.workspacesUsing(module.manifest.id),
        notes: this.notesView(module),
        update: ((pending) => (pending ? { version: pending.version, asks: { network: [...pending.asks.network], connectors: [...pending.asks.connectors] }, notes: pending.notes } : null))(
          this.lifecycle.updates.pending(module.manifest.id),
        ),
      })),
      moduleProblems: this.moduleProblems.filter((problem) => !problem.developmentFolder && !problem.official).map(({ folder, path: full, message, kind, values }) => ({ folder, path: full, message, ...(kind ? { kind } : {}), ...(values ? { values } : {}) })),
      developmentFolders: this.library.developmentFolders.map((folder) => {
        const own = this.moduleProblems.find((item) => item.developmentFolder === folder && !item.developmentProject);
        const projects = new Map<string, HostViewState["developmentFolders"][number]["projects"][number]>();
        for (const module of this.modules.values()) {
          if (module.developmentFolder === folder && module.developmentProject) {
            projects.set(module.developmentProject, { project: module.developmentProject, moduleId: module.manifest.id, problem: null, kind: null, name: null, version: null });
          }
        }
        for (const item of this.moduleProblems) {
          if (item.developmentFolder !== folder || !item.developmentProject || projects.has(item.developmentProject)) continue;
          projects.set(item.developmentProject, {
            project: item.developmentProject,
            moduleId: null,
            problem: item.message,
            kind: item.kind ?? null,
            ...(item.values ? { values: item.values } : {}),
            name: item.about?.name ?? null,
            version: item.about?.version ?? null,
          });
        }
        return {
          folder,
          collapsed: this.library.collapsedDevelopmentFolders.includes(folder),
          problem: own?.message ?? null,
          kind: own?.kind ?? null,
          ...(own?.values ? { values: own.values } : {}),
          projects: [...projects.values()].sort((a, b) => a.project.localeCompare(b.project)),
        };
      }),
      leftoverModuleData: this.moduleData
        .filter((entry) => this.modules.get(entry.moduleId)?.owner !== entry.owner)
        .map((entry) => ({ ...entry, publisher: entry.owner === LOCAL_OWNER || entry.owner === OFFICIAL_OWNER ? null : entry.owner })),
      panels: workspace.instances.map((record) => {
        const view = this.nativePanel(record.instanceId);
        const type = this.panelTypeOf(record);
        const module = this.modules.get(record.moduleId);
        // A development module that cannot load right now is named from its manifest until it loads.
        const name = type?.name ?? (module ? this.shown(module.manifest).name : (waitingModules(this.moduleProblems).get(record.moduleId) ?? movedModule(record.moduleId)?.name ?? record.moduleId));
        const panelType = record.panelType ?? null;
        const openedFrom = this.panels.openedFrom(record.instanceId);
        if (type === undefined) {
          // A module that left Tavora for the catalog and is not installed yet: its panel offers to install it.
          const moved = !module && movedModule(record.moduleId) !== undefined;
          return { instanceId: record.instanceId, moduleId: record.moduleId, panelType, name: moved ? name : (record.panelType ?? name), status: "unavailable" as const, waiting: false, content: null, ...(moved ? { moved } : {}) };
        }
        const content = record.content?.title ?? null;
        if (!(view instanceof BrowserPanel)) {
          const status = view?.status ?? "loading";
          // Hidden until its page has its data.
          const overGame = this.panels.isLent(record.instanceId);
          // A new page is also waiting until it has drawn once: its loader stays under the see-through view until then.
          const question = this.questionOf(record, workspace.instances);
          const waiting = !question && !overGame && (status === "loading" || status === "ready") && (!view?.revealed || !view.firstDrawn);
          const inGame = this.gameOverlays.hasPanel(record.instanceId);
          const live = this.gameOverlays.liveFor(record.instanceId, this.modules.get(record.moduleId)?.owner ?? "", record.moduleId, current?.id ?? "");
          return {
            instanceId: record.instanceId,
            moduleId: record.moduleId,
            panelType,
            name,
            status,
            waiting,
            content,
            ...(question ? { question } : {}),
            ...(overGame ? { overGame } : {}),
            ...(this.canShowInGame(record) ? { canInGame: true } : {}),
            ...(inGame ? { inGame } : {}),
            ...(live ? { live } : {}),
          };
        }
        const browser = view.state;
        // A Browser tab is named after its page, like a browser tab.
        const title = (browser.title || browser.host).trim().slice(0, 80);
        return { instanceId: record.instanceId, moduleId: record.moduleId, panelType, name: title || name, status: view.status, waiting: false, content: null, browser, ...(openedFrom ? { openedFrom } : {}) };
      }),
      layout: workspace.layout,
      layoutEpoch: this.workspaces.epoch,
      opening: this.panels.opening,
      ...pending,
      runningGameId: this.running.filter((id) => id !== this.workspaceId && isLive(this.library, id)).at(-1) ?? null,
      workspaceRunning: this.workspaceId !== null && this.running.includes(this.workspaceId),
      pendingGameSwitch: pending.pendingGameSwitch && isLive(this.library, pending.pendingGameSwitch) ? pending.pendingGameSwitch : null,
      streaming: this.streaming.view(),
      gameOverlays: this.gameOverlays.view(),
      hotkeyRequest: this.streaming.request(),
      moduleFiles: { folder: this.files.root(), custom: this.files.custom, available: this.files.available, moving: this.files.moving },
      snapshots: workspace.snapshots.map(({ id, name, savedAt }) => ({ id, name, savedAt })),
      notice: this.notice,
      profile: {
        name: this.profile.name,
        initials: this.profile.initials,
        pictureUrl: this.profile.picture ? PROFILE_URL + this.profile.picture : null,
        ranks: { ...library.profileRanks },
      },
      restartPending: library.grayscaleText !== this.options.grayscaleText,
      appearance: this.appearanceView(),
      language: { setting: library.language, resolved: this.language },
      appVersion: app.getVersion(),
      update: this.updates?.state ?? { status: "idle", checkedAt: null, failed: false },
    };
  }

  /** The language of Tavora's texts now. */
  get language(): Language {
    return Host.languageOf(this.library, this.options);
  }

  private static languageOf(library: Pick<Library, "language">, options: Pick<HostOptions, "systemLocale">): Language {
    return resolveLanguage(library.language, options.systemLocale ?? app.getLocale());
  }

  /** A module's manifest with its name, description, panel and action names in Tavora's language now. */
  shown(manifest: ModuleManifest): ModuleManifest {
    return translateManifest(manifest, this.language);
  }

  private appearanceView(): AppearanceView {
    const { theme, variation } = this.currentChoice();
    // Official themes first, the default leading, then the user's own by name.
    const order = (entry: InstalledTheme) => (entry.theme.id === DEFAULT_THEME.id ? 0 : entry.provenance === "official" ? 1 : 2);
    const themes = [...this.themes.values()].sort((a, b) => order(a) - order(b) || a.theme.name.localeCompare(b.theme.name));
    return {
      themeId: theme.id,
      variationId: variation.id,
      isDefault: theme.id === DEFAULT_THEME.id && this.library.followSystem,
      followSystem: this.library.followSystem,
      themes: themes.map(({ theme: item, provenance }) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        author: item.author,
        provenance,
        variations: item.variations.map(({ id, name, mode, radius, colors }) => ({ id, name, mode, radius, colors: { ...colors } })),
      })),
      problems: this.themeProblems.map((problem) => ({ ...problem })),
    };
  }

  private pushState(): void {
    clearImmediate(this.statePush);
    this.statePush = undefined;
    // Hotkeys follow the workspace shown now and its panels, which most changes that push the state can move.
    this.streaming?.sync();
    this.syncConnection();
    if (!this.window.isDestroyed()) this.window.webContents.send("host:state", this.viewState());
    if (this.canvas) {
      this.canvas.sendHostState(this.viewState());
      this.layout.refresh();
    }
  }

  private statePush: ReturnType<typeof setImmediate> | undefined;

  /**
   * The connection watcher runs while the System Monitor module is in any workspace and the user has granted
   * it System info, whether or not a panel is shown, so drops are logged. Asked after every change of panels or grants.
   */
  private syncConnection(): void {
    if (!this.connection) return;
    const present = this.workspaces.workspacesUsing(SYSTEM_MONITOR_ID).length > 0;
    this.connection.setActive(process.platform === "win32" && present && this.connectorsOf(SYSTEM_MONITOR_ID).has("system-info"));
  }

  /** Pushes the state once for a burst of changes, such as every panel of a workspace that just opened loading at once. */
  private pushStateSoon(): void {
    this.statePush ??= setImmediate(() => this.pushState());
  }

  /**
   * The system's open dialog, opening in the folder the user last picked from in this `place` while
   * that folder is still there. Answers with what was picked, or nothing when cancelled; the caller
   * remembers it (rememberPicked) only once it worked, so a zip that failed to install is not where it opens next.
   */
  private async pickPath(place: DialogPlace, options: OpenDialogOptions, parent: BrowserWindow = this.window): Promise<string | undefined> {
    const folder = this.library.dialogFolders[place];
    const picked = await dialog.showOpenDialog(parent, { ...options, ...(folder && existsSync(folder) ? { defaultPath: folder } : {}) });
    const file = picked.filePaths[0];
    return picked.canceled || !file ? undefined : file;
  }

  /**
   * pictures.save: the system's save dialog with the module's name suggested (numbered when taken), opening in the
   * folder the user last saved a picture to while it is still there, else Pictures\Tavora. Answers with the name
   * the file was saved under, or null when the user closed the dialog.
   */
  private async savePictureAs(png: Buffer, name: string): Promise<string | null> {
    const last = this.library.dialogFolders["save-picture"];
    const folder = last && existsSync(last) ? last : picturesFolder();
    await mkdir(folder, { recursive: true });
    const german = this.language.startsWith("de");
    const picked = await dialog.showSaveDialog(this.window, {
      title: german ? "Bild speichern" : "Save picture",
      defaultPath: path.join(folder, freeFileName(name, (fileName) => existsSync(path.join(folder, fileName)))),
      filters: [{ name: german ? "PNG-Bild" : "PNG picture", extensions: ["png"] }],
      properties: ["showOverwriteConfirmation"],
    });
    if (picked.canceled || !picked.filePath) return null;
    const chosen = path.resolve(picked.filePath);
    const file = /\.png$/i.test(chosen) ? chosen : `${chosen}.png`;
    // The dialog asked before replacing the file the user chose; with .png added, it was never asked about.
    try {
      await writeFile(file, png, { flag: file === chosen ? "w" : "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new HostError("CONFLICT", `${path.basename(file)} already exists`);
      throw error;
    }
    this.rememberPicked("save-picture", file);
    return path.basename(file);
  }

  /** The folder a module's file dialogs open in: where the user last saved or opened a file for it while that is still there, else Documents\Tavora (made when needed). */
  private async fileFolderOf(module: InstalledModule): Promise<string> {
    const last = this.library.moduleFolders[Host.notesKey(module)];
    const folder = last && existsSync(last) ? last : documentsFolder();
    await mkdir(folder, { recursive: true });
    return folder;
  }

  private rememberFileFolder(module: InstalledModule, picked: string): void {
    this.library.moduleFolders[Host.notesKey(module)] = path.dirname(path.resolve(picked));
    this.saveLibrary();
  }

  /**
   * files.saveJson: the system's save dialog with the module's name suggested (numbered when taken), opening in the
   * module's remembered folder, else Documents\Tavora. Answers with the name the file was saved under, or null when
   * the user closed the dialog.
   */
  private async saveJsonAs(module: InstalledModule, data: Buffer, name: string): Promise<string | null> {
    const folder = await this.fileFolderOf(module);
    const german = this.language.startsWith("de");
    const picked = await dialog.showSaveDialog(this.window, {
      title: german ? "Datei speichern" : "Save file",
      defaultPath: path.join(folder, freeFileName(name, (fileName) => existsSync(path.join(folder, fileName)), "json")),
      filters: [{ name: german ? "JSON-Dateien" : "JSON files", extensions: ["json"] }],
      properties: ["showOverwriteConfirmation"],
    });
    if (picked.canceled || !picked.filePath) return null;
    const chosen = path.resolve(picked.filePath);
    const file = /\.json$/i.test(chosen) ? chosen : `${chosen}.json`;
    // The dialog asked before replacing the file the user chose; with .json added, it was never asked about.
    try {
      await writeFile(file, data, { flag: file === chosen ? "w" : "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new HostError("CONFLICT", `${path.basename(file)} already exists`);
      throw error;
    }
    this.rememberFileFolder(module, file);
    return path.basename(file);
  }

  /**
   * files.openJson: the system's open dialog in the module's remembered folder, else Documents\Tavora. Answers with
   * the chosen file's name and text (at most 8 MiB), or null when the user closed the dialog. The folder is
   * remembered once the file was read.
   */
  private async openJsonFrom(module: InstalledModule): Promise<{ fileName: string; text: string } | null> {
    const folder = await this.fileFolderOf(module);
    const german = this.language.startsWith("de");
    const picked = await dialog.showOpenDialog(this.window, {
      title: german ? "Datei öffnen" : "Open file",
      defaultPath: folder,
      filters: [{ name: german ? "JSON-Dateien" : "JSON files", extensions: ["json"] }],
      properties: ["openFile"],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    const text = await readJsonText(file);
    this.rememberFileFolder(module, file);
    return { fileName: path.basename(file), text };
  }

  /** Where the dialog for one of Tavora's own files (a module zip, a key file) opens: the folder last used for `place` while it is still there, else Documents\Tavora. */
  private async ownFileFolder(place: DialogPlace): Promise<string> {
    const last = this.library.dialogFolders[place];
    const folder = last && existsSync(last) ? last : documentsFolder();
    await mkdir(folder, { recursive: true });
    return folder;
  }

  /** The dialog for `place` opens next time in the folder `picked` is in (for a picked folder, its parent), and the library is saved. */
  private rememberPicked(place: DialogPlace, picked: string): void {
    this.library.dialogFolders[place] = path.dirname(path.resolve(picked));
    this.saveLibrary();
  }

  private saveLibrary(): void {
    this.savedData.saveLibrary(this.library);
  }

  /** Also tells the caller whether the write landed. */
  private saveProfile(): Promise<void> {
    return this.savedData.saveProfile(this.profile);
  }

  private saveWindowSoon(): void {
    clearTimeout(this.windowSaveTimer);
    this.windowSaveTimer = setTimeout(() => this.saveWindow(), 1000);
  }

  private saveWindow(): void {
    clearTimeout(this.windowSaveTimer);
    if (this.window.isDestroyed()) return;
    const state: WindowState = { bounds: this.window.getNormalBounds(), maximized: this.window.isMaximized() };
    this.savedData.saveWindow(state);
  }

  /**
   * Shows Tavora's consent dialog for one connector a module asks for on request, after a click in its panel; resolves
   * with whether the user allowed it. A newer request closes an older one as not allowed, and so does closing the module's last panel.
   */
  private askConnector(moduleId: string, connector: Connector): Promise<boolean> {
    const { answer } = this.questions.ask("connector", { module: moduleId }, { moduleId, connector });
    this.pushState();
    this.panels.applyBounds();
    return answer;
  }

  /** The user's answer; allowing grants that connector alone, and the module's panels go on running with it. */
  private async answerConnector(id: number, allow: boolean): Promise<void> {
    const pending = this.questions.peek("connector");
    if (!pending || pending.id !== id) return;
    const { moduleId, connector } = pending.payload;
    const module = this.modules.get(moduleId);
    const grant = async (): Promise<boolean> => {
      const granted = allow && module !== undefined && (module.manifest.permissions.onRequest ?? []).includes(connector);
      if (granted) await this.grants.grant(module, { network: [], connectors: [connector] });
      return granted;
    };
    // The question is gone now; the module hears the answer once the grant is stored.
    const result = grant();
    this.questions.answer(id, result);
    await result;
    this.pushState();
    this.panels.applyBounds();
  }

  /** A module's leaderboards (leaderboards.ts); `ask` shows Tavora's question in the panel that asks. */
  private leaderboardsOf(module: InstalledModule, ask: (question: LeaderboardQuestion) => Promise<boolean>): ModuleLeaderboards {
    return new ModuleLeaderboards({
      moduleId: boardsModuleId(module.manifest.id, module.owner === OFFICIAL_OWNER || this.catalogModules.has(module.manifest.id)),
      boards: translateManifest(module.manifest, this.language).leaderboards?.boards ?? [],
      account: this.account,
      pseudonym: (label) => (label ? translate(this.language, "leaderboards.pseudonym", { label }) : translate(this.language, "leaderboards.someone")),
      ask,
    });
  }

  /** The profile card's ranks: the catalog modules with boards the user agreed to be shown on (profile-ranks.ts). */
  private async profileRanks(): Promise<ProfileRanksView> {
    const sources: ProfileRankSource[] = [...this.modules.values()]
      .filter((module) => (module.owner === OFFICIAL_OWNER || this.catalogModules.has(module.manifest.id)) && (module.manifest.leaderboards?.boards.length ?? 0) > 0)
      .map((module) => ({
        id: module.manifest.id,
        name: translateManifest(module.manifest, this.language).name,
        boards: module.manifest.leaderboards?.boards ?? [],
        leaderboards: this.leaderboardsOf(module, async () => false),
      }));
    return profileRanks(this.account, sources);
  }

  /** Settings > Integrations > Leaderboards: takes the user off a module's boards, whatever the module offers. */
  private async leaveLeaderboards(moduleId: string): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module) return;
    try {
      await this.leaderboardsOf(module, async () => false).hide();
    } catch {
      throw new UserError("account.error.unreachable");
    }
  }

  /**
   * Shows Tavora's question about a module's leaderboards in the panel that asked (leaderboards.show, after a click
   * there); resolves with the user's answer. A newer question closes an older one as no.
   */
  private askLeaderboard(instanceId: string, moduleId: string, question: LeaderboardQuestion): Promise<boolean> {
    const { answer } = this.questions.ask("leaderboard", { panel: instanceId }, { moduleId, question });
    this.pushState();
    this.panels.applyBounds();
    return answer;
  }

  /** The user's answer; the panel's page comes back either way. */
  private answerLeaderboard(id: number, yes: boolean): void {
    if (this.questions.peek("leaderboard")?.id !== id) return;
    this.questions.answer(id, yes);
    this.pushState();
    this.panels.applyBounds();
  }

  /** Resolves once pending writes are on disk; keys go back to the system and the overlay server stops. */
  async flush(): Promise<void> {
    await this.gameOverlays?.shutdown();
    await this.streaming?.shutdown();
    return this.savedData.flush();
  }

  /** Looks at the running programs while "When a game starts" or game overlays need it. */
  private syncGameWatcher(): void {
    if (this.library.gameStart !== "off" || this.gameOverlays?.needsWatcher()) this.gameWatcher.start();
    else this.gameWatcher.stop();
  }

  /** Closes every window Tavora drew over a game and every preview, at once (quitting, a signal, the process exiting). */
  closeOverlayWindows(): void {
    this.gameOverlays?.closeNow();
    this.previews?.closeAll();
    this.layout?.close();
  }

  /** Stream overlays, game overlays, overlay previews and the Overlay page, wired from the objects that own what they read (overlay-wiring.ts). */
  private async startOverlays(): Promise<void> {
    const { options } = this;
    const services = await createOverlayServices({
      options: { userData: options.userData, hidden: !!options.hidden, devServer: options.devServer, devTools: options.devTools, hostPreload: options.hostPreload, modulePreload: options.modulePreload },
      window: this.window,
      library: this.library,
      workspaces: new LibraryWorkspaces(this.library),
      installed: this.installed,
      grants: this.grants,
      panels: this.panels,
      watcher: this.gameWatcher,
      ports: {
        shell: {
          openSetting: (setting) => {
            this.bringToFront();
            this.window.webContents.send("host:shortcut", `setting:${setting}`);
          },
          notify: (message) => {
            this.notice = message;
            if (!options.hidden && Notification.isSupported()) new Notification({ title: "Tavora", body: message, silent: true }).show();
            this.pushStateSoon();
          },
          focus: () => {
            this.bringToFront();
            this.window.webContents.focus();
          },
        },
        language: () => this.language,
        changed: () => this.pushStateSoon(),
        overlaysChanged: () => {
          this.syncGameWatcher();
          this.pushStateSoon();
        },
        saveLibrary: () => this.saveLibrary(),
        workspaceId: () => this.workspaceId,
        askConnector: (moduleId, connector) => this.askConnector(moduleId, connector),
        panelsInGame: {
          info: (instanceId, workspaceId) => this.panelInfo(instanceId, workspaceId),
          lend: (instanceId, workspaceId, revoked) => this.lendPanel(instanceId, workspaceId, revoked),
        },
        page: {
          sources: () => this.overlaySources(),
          keepRunning: (panels) => this.runForOverlayPage(panels),
          leave: () => this.leaveOverlayPage(),
          choosePicture: () =>
            this.pickPath(
              "layout-picture",
              {
                title: translate(this.language, "overlays.layout.chooseTitle"),
                properties: ["openFile"],
                filters: [{ name: translate(this.language, "dialog.images"), extensions: ["png", "jpg", "jpeg", "webp"] }],
              },
              this.window,
            ),
          rememberPicture: (file) => this.rememberPicked("layout-picture", file),
        },
      },
    });
    this.streaming = services.streaming;
    this.gameOverlays = services.gameOverlays;
    this.previews = services.previews;
    this.layout = services.layout;
  }
}

/**
 * Serves the trusted host UI, plus game icons and the profile picture the user picked, and blocks
 * all network for the host renderer. With a dev server, the host UI comes
 * from there instead, and only that server is reachable.
 */
async function registerHostProtocol(rendererDir: string, imageDirs: Record<string, string>, devServer?: string): Promise<void> {
  const root = devServer ? null : await realpath(rendererDir);
  // Pictures the user picked, each folder under its own URL prefix.
  const images = new Map<string, string>();
  for (const [prefix, dir] of Object.entries(imageDirs)) {
    await mkdir(dir, { recursive: true });
    images.set(`/${prefix}/`, await realpath(dir));
  }
  const origin = `${HOST_SCHEME}://app`;
  protocol.handle(HOST_SCHEME, async (request) => {
    // URL.origin is "null" for custom schemes in Node, so compare the host.
    const url = new URL(request.url);
    let file: string | null = null;
    if (url.host === "app") {
      const prefix = [...images.keys()].find((start) => url.pathname.startsWith(start));
      if (prefix) file = await resolveAsset(images.get(prefix)!, url.pathname.slice(prefix.length - 1));
      else if (root) file = await resolveAsset(root, url.pathname);
    }
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(await readFile(file), {
      headers: {
        "Content-Type": contentTypeFor(file),
        "Content-Security-Policy": HOST_CSP,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  const allowed = [`${origin}/`, "devtools://"];
  if (devServer) {
    const server = new URL(devServer);
    allowed.push(`${server.origin}/`, `ws://${server.host}/`);
    // Vite injects styles while it hot-reloads, so its pages get a looser
    // policy; still no remote content.
    session.defaultSession.webRequest.onHeadersReceived({ urls: [`${server.origin}/*`] }, (details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [devCsp(server)] } });
    });
  }
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowed.some((prefix) => details.url.startsWith(prefix)) });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function devCsp(server: URL): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${HOST_SCHEME}://app`,
    "font-src 'self'",
    `connect-src 'self' ws://${server.host}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** What settlePanelTypes needs to know about the installed modules. */
function panelTypesOf(modules: ReadonlyMap<string, InstalledModule>) {
  return (moduleId: string) => {
    const module = modules.get(moduleId);
    if (!module) return undefined;
    return { ids: panelTypes(module.manifest).map((type) => type.id), continuing: continuingPanelType(module.manifest) };
  };
}
