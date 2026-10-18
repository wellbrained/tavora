import { randomUUID } from "node:crypto";
import { existsSync, watch, type FSWatcher } from "node:fs";
import os from "node:os";
import { appendFile, mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { continuingPanelType, isOwnerId, LOCAL_OWNER, OFFICIAL_OWNER, panelTypes, type Connector, type ResolvedPanelType } from "@tavora/module-schema";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import type { TavoraGame, TavoraTheme } from "@tavora/sdk/protocol";
import type { IconTone } from "../shared/icon-tone";
import type { AccountView, ActionResult, AiUsageView, AppearanceView, BrowserCommand, CatalogListResult, DeveloperLink, GameView, HostAction, HostViewState, ModuleMenu, OnlineSearchResult, Screen, SteamImportGame, SteamLibraryResult } from "../shared/host-api";
import { resolveLanguage, translate, type Language } from "../shared/i18n";
import { PlayerError } from "./messages";
import { buildReport, errorLog, timings } from "./diagnostics";
import { INSTANCE_ID } from "./ids";
import { LAYOUT_LIMITS, layoutPanels, pruneLayout, templateLayout, vacateLayout, type SavedLayout } from "./layout";
import { gridTemplate, layoutTemplate, type LayoutTemplate } from "../shared/layout-templates";
import { parseAction } from "./actions";
import { contentTypeFor, HOST_CSP, HOST_SCHEME, resolveAsset } from "./assets";
import { deleteModuleData, deleteModuleDataOf, listModuleData, migrateModuleData, orphanedPartitions, queueLocalDataMove } from "./gamedata";
import { applyOwners, forgetOwner, installZip, installZipData, readOwnerRecords, type Installed } from "./installer";
import { hasUnseenNotes, installedNotes } from "./module-notes";
import { GrantStore } from "./grants";
import type { TestHosts } from "./network";
import { shortcutFor } from "./shortcuts";
import { IconError, importIcon, removeIcon } from "./icons";
import { readJsonOrSetAside } from "./json";
import { clipInitials, clipName, type Profile, removePicture, sanitizeProfile, savePicture } from "./profile";
import {
  addGame,
  createFolder,
  deleteFolder,
  iconFileShared,
  deleteTrashedGame,
  cleanDevelopmentFolders,
  isLive,
  LibraryError,
  MAX_DEVELOPMENT_FOLDERS,
  markPlayed,
  moveFolder,
  moveGame,
  placeFavorite,
  purgeDate,
  purgeExpired,
  recentGames,
  removeFavorite,
  setSiteListed,
  renameFolder,
  renameGame,
  restoreGame,
  sanitizeLibrary,
  searchCatalog,
  setFolderLabel,
  setGameImage,
  markIconShared,
  setGameLabel,
  setRail,
  sortedRoot,
  trashedGames,
  trashGame,
  useOriginalGameIcon,
  type GameEntry,
  type GameIcon,
  type Library,
} from "./library";
import { MODULE_FONTS } from "./module-fonts";
import { moduleBaseCss } from "./module-style";
import { backupData, backupsDir, keepNewerFile, SUPPORTED_VERSIONS } from "./backup";
import { CatalogClient, type CatalogScope } from "./catalog-client";
import { DEFAULT_API_URL, OnlineSearch } from "./online";
import { PublisherNames } from "./publisher-names";
import { UpdateManager, type UpdaterLike } from "./updates";
import { fetchHostedList, type HostedList } from "./hosted-icons";
import { CATALOGUE_PUBLIC_KEY, SAFETY_REFRESH_MS, SafetyLists, stopBlocked } from "./safety-lists";
import { createToneReader, iconVersion } from "./icon-tone";
import { syncIcons } from "./icon-sync";
import { fetchSteamLibrary, importSteamGames, steamLibraryView } from "./steam-import";
import { isShareCandidate, largestIcoFrame, shareableIconFile, shareSource, submitIcon } from "./share-icons";
import { findSteamDir, removeSteamIcon } from "./steam-icons";
import { ModuleView, REVEAL_CAP_MS } from "./module-view";
import { HostError } from "./errors";
import { loadAdBlocker, type AdBlocker } from "./browser-filter";
import { isWebUrl, siteOfUrl } from "./browser-url";
import { defaultFilesRoot } from "./module-files";
import { ModuleFilesFolder } from "./module-files-folder";
import { BrowserPanel, browserPartition, browserSession, browserUserAgent, type BrowserKind, type BrowserSessionHooks } from "./browser-view";
import { AI_USAGE_MODULE_ID, BROWSER_MODULE_ID, browserModule, DISCORD_MODULE_ID, describeModules, developmentProjects, discoverModules, isDevelopmentModule, buildFolderName, MANIFEST, mayHoldProject, projectEntry, type InstalledModule, type ModuleInfo, type ModuleProblem } from "./registry";
import { DataRegistry } from "./storage";
import type { CheckedMenu } from "./module-menu";
import { AiUsageConnector } from "./ai-usage";
import { readClaudeEmail } from "./ai-usage-claude";
import { readCodexUsage } from "./ai-usage-codex";
import { DiscordConnector, DISCORD_CLIENT_ID } from "./discord";
import { RpcClient } from "./discord-rpc";
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
  type InstalledTheme,
  type ThemeProblem,
} from "./themes";
import { writeFileAtomic } from "./fsutil";
import {
  emptyGameWorkspace,
  loadWorkspace,
  MAX_SNAPSHOTS,
  planSnapshot,
  saveWorkspace,
  settlePanelTypes,
  WorkspaceError,
  type GameWorkspace,
  type InstanceRecord,
  type Snapshot,
  type WorkspaceState,
} from "./workspace";
import type { PanelContent, PanelLaunch } from "./panel-content";
import type { PanelOpenResult } from "@tavora/sdk/protocol";
import { initialBounds, MIN_SIZE, type WindowState } from "./window-state";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How long a game's panels may keep each other waiting when it opens; past it, every panel shows (each one gives up after REVEAL_CAP_MS). */
const OPENING_CAP_MS = REVEAL_CAP_MS + 250;
/** How long to wait for a still image of a panel before hiding it anyway. */
const FREEZE_TIMEOUT_MS = 250;
/** How long a development folder's build must be quiet before its panels reload. */
const DEVELOPMENT_RELOAD_MS = 300;
/** The pages Settings > Development links to. */
const DEVELOPER_LINKS: Record<DeveloperLink, string> = {
  docs: "https://docs.mytavora.app/guide/getting-started",
  discussions: "https://github.com/wellbrained/tavora/discussions",
  issue: "https://github.com/wellbrained/tavora/issues/new?template=module-developer.yml",
};
/** Folders watched in one development folder for a new project, at most. */
const MAX_DEVELOPMENT_SUBFOLDERS = 100;

/** The player's own modules, next to the themes folder in their data folder. */
function userModulesDir(options: HostOptions): string {
  return path.join(options.userData, "modules");
}

/** The modules folder as module roots name it (they are real paths). */
async function realUserModulesDir(options: HostOptions): Promise<string> {
  return realpath(userModulesDir(options)).catch(() => path.resolve(userModulesDir(options)));
}

/** Leaves the workspace header's bottom border visible below the window controls. */
const TITLE_BAR_HEIGHT = 47;

export interface HostOptions {
  userData: string;
  moduleDirs: string[];
  /** Modules that ship with Tavora, shown as Official. */
  officialModuleDirs: string[];
  /** Themes that ship with Tavora, shown as Official. */
  officialThemeDirs: string[];
  /** Development only: more folders of local themes besides the player's own themes folder. */
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
  /** Development only: where accounts are, when not the same service as the rest. */
  accountUrl?: string | undefined;
  /**
   * Tests only: a pretend Discord sign-in page. The main process then follows it itself instead of
   * opening the player's browser (it redirects straight back to the Discord login's return address).
   */
  discordAuthorizeUrl?: string | undefined;
  /** Tests only: keep the window invisible, so e2e runs don't flash on screen. */
  hidden?: boolean;
  /** Tests only: pretend the system is in this mode, so a test does not depend on the PC it runs on. */
  systemTheme?: "dark" | "light" | undefined;
  /** Development and tests only: what the system's language is taken to be, instead of the real one. */
  systemLocale?: string | undefined;
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

const ICON_URL = `${HOST_SCHEME}://app/game-icons/`;
/** A saved icon as a 32 px bitmap (blue, green, red, alpha), or null when it cannot be read. */
function loadSmallBitmap(file: string): Uint8Array | null {
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? null : image.resize({ width: 32, height: 32, quality: "good" }).toBitmap();
}

const STEAM_ICON_URL = `${HOST_SCHEME}://app/steam-icons/`;
const PROFILE_URL = `${HOST_SCHEME}://app/profile/`;

export class Host {
  private readonly data: DataRegistry;
  private readonly views = new Map<string, ModuleView | BrowserPanel>();
  private readonly viewsByContents = new Map<number, ModuleView>();
  /** Browser panels by the contents of their page, for requests the page makes. */
  private readonly browsersByContents = new Map<number, BrowserPanel>();
  /** Browser tabs opened from another tab, so the host UI docks them beside it. Only used when a panel is first placed. */
  private readonly openedFrom = new Map<string, { instanceId: string; background: boolean }>();
  /** Panels just added, or opened by another panel, whose page has not asked why it opened yet (panel.getLaunch). */
  private readonly launches = new Map<string, PanelLaunch>();
  /**
   * A panel that panels.open asked to switch could not (it kept its content): the host UI offers to open the
   * content in a new panel instead (navigation-choice). What opens is kept here, never taken from the answer.
   */
  private pendingNavigation: { gameId: string; moduleId: string; panelType: string; panelName: string; content: PanelContent } | null = null;
  /** What every browser session is made safe with; built when the first Browser panel opens. */
  private browserHooks: BrowserSessionHooks | undefined;
  /** The Discord connector: Tavora's Discord sign-in and the connection to the Discord app, for modules granted it. */
  private readonly discord: DiscordConnector;
  /** The AI Usage connector: the AI accounts, read for modules granted it. */
  private readonly aiUsage: AiUsageConnector;
  /** The player's Tavora account; the sign-in never leaves the main process. */
  private readonly account: AccountClient;
  /** The developer names players see for publisher keys (publisher-names.ts). */
  private readonly publisherNames: PublisherNames;
  private screen: Screen = "welcome";
  private notice: string | null = null;
  /** Every (owner, module) with saved settings or documents, for Settings > Modules. */
  private moduleData: { owner: string; moduleId: string }[] = [];
  /** What the player granted each module (grants.ts); loaded before any module panel opens. */
  private grants!: GrantStore;
  /** The catalog's signed safety lists (revoked keys, blocked zips, successions). */
  private safetyLists!: SafetyLists;
  /** Modules in the player's folder whose zip Tavora blocked: not loaded, data kept. */
  private blockedModules = new Map<string, InstalledModule>();
  /** A link a module asked to open when no Browser panel exists; waits for the player's answer. */
  private pendingLink: string | null = null;
  /** Where modules keep their pictures. */
  private readonly files: ModuleFilesFolder;
  /** Where the host UI shows each visible panel, in window content coordinates. */
  private panelBounds = new Map<string, Rect>();
  /** True while the host UI shows a menu, dialog or drag that module views would cover. */
  private overlay = false;
  /** Counts overlay changes, so a slow freeze does not hide panels after the overlay closed. */
  private overlayChanges = 0;
  /** True while the window is minimized or hidden. */
  private windowHidden = false;
  /** Bumped whenever the main process replaces the current layout. */
  private layoutEpoch = 0;
  /**
   * Set while a game just opened and its panels load: none is shown until every visible one has its data, so
   * the workspace appears at once rather than panel by panel.
   */
  private opening: { startedAt: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly onlineSearch: OnlineSearch;
  /** Tavora's module catalog (catalog-client.ts). */
  private readonly catalog: CatalogClient;
  /** Looks for new versions; only in an installed (packaged) app. */
  private updates: UpdateManager | null = null;
  private saving: Promise<void> = Promise.resolve();
  /** The active theme as modules get it; rebuilt when the theme changes. */
  private currentTheme: TavoraTheme;
  private windowSaveTimer: ReturnType<typeof setTimeout> | undefined;
  readonly window: BrowserWindow;

  private constructor(
    private readonly options: HostOptions,
    private modules: Map<string, InstalledModule>,
    private moduleInfo: Map<string, ModuleInfo>,
    private moduleProblems: ModuleProblem[],
    private readonly library: Library,
    private readonly workspace: WorkspaceState,
    private readonly profile: Profile,
    windowState: WindowState,
    private themes: Map<string, InstalledTheme>,
    private themeProblems: ThemeProblem[],
  ) {
    this.currentTheme = moduleTheme(resolveTheme(themes, library.theme, library.followSystem ? Host.systemMode(options) : undefined).variation);
    this.files = new ModuleFilesFolder({
      userData: options.userData,
      window: () => this.window,
      language: () => this.language,
      chosenFolder: () => this.library.moduleFilesFolder ?? null,
      setChosenFolder: (folder) => {
        this.library.moduleFilesFolder = folder;
        this.saveLibrary();
      },
      notify: (message) => (this.notice = message),
      changed: () => this.pushState(),
    });
    this.data = new DataRegistry(options.userData, () => this.files.root(), () => this.files.moving);
    this.onlineSearch = new OnlineSearch(options.apiUrl === undefined ? {} : { baseUrl: options.apiUrl });
    this.catalog = new CatalogClient(options.apiUrl === undefined ? {} : { baseUrl: options.apiUrl });
    this.discord = Host.discordConnector(options, (view) => {
      if (!this.window.isDestroyed()) this.window.webContents.send("host:discord", view);
    });
    this.aiUsage = Host.aiUsageService(options, (view) => {
      if (!this.window.isDestroyed()) this.window.webContents.send("host:ai-usage", view);
      for (const panel of this.views.values()) if (panel instanceof ModuleView) panel.notifyAiUsageAccounts();
    });
    this.account = Host.accountClient(options, () => this.language, { get: () => this.profileData(), apply: (remote) => this.applyProfile(remote) }, (view) => {
      if (!this.window.isDestroyed()) this.window.webContents.send("host:account", view);
    });
    this.publisherNames = new PublisherNames({
      file: path.join(options.userData, "publisher-names.json"),
      baseUrl: options.apiUrl ?? DEFAULT_API_URL,
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
    if (windowState.maximized) this.window.maximize();
    if (options.hidden) {
      // A truly hidden window never resizes its panels, so tests get one that
      // is shown but transparent, click-through, unfocused and off the taskbar.
      this.window.setOpacity(0);
      this.window.setIgnoreMouseEvents(true);
      this.window.setSkipTaskbar(true);
      this.window.once("ready-to-show", () => this.window.showInactive());
    } else {
      this.window.once("ready-to-show", () => this.window.show());
    }
    this.watchShortcuts(this.window.webContents);
  }

  static async create(options: HostOptions): Promise<Host> {
    const { userData } = options;
    // A file saved by a newer Tavora is copied aside before this one can overwrite it.
    for (const [name, version] of Object.entries(SUPPORTED_VERSIONS)) {
      await keepNewerFile(path.join(userData, name), version).catch(() => null);
    }
    const library = sanitizeLibrary(await readJsonOrSetAside(path.join(userData, "library.json")));
    const moduleProblems: ModuleProblem[] = [];
    const modules = await discoverModules({ ...Host.moduleSources(options, library.developmentFolders), tavoraVersion: app.getVersion() }, moduleProblems);
    const ownerRecords = await readOwnerRecords(userData);
    applyOwners(modules, await realUserModulesDir(options), ownerRecords);
    const safetyLists = new SafetyLists({
      file: path.join(userData, "catalog-lists.json"),
      baseUrl: options.apiUrl ?? DEFAULT_API_URL,
      publicKey: CATALOGUE_PUBLIC_KEY,
      online: () => library.onlineSearch,
    });
    await safetyLists.load();
    const blockedModules = stopBlocked(modules, await realUserModulesDir(options), ownerRecords, safetyLists, moduleProblems);
    modules.set(BROWSER_MODULE_ID, browserModule(app.getVersion()));
    const moduleInfo = await describeModules(userModulesDir(options), modules);
    const { themes, problems: themeProblems } = await discoverThemes(Host.themeSources(options));
    // Before any module session or store is opened (S5: data is keyed by owner and id).
    await migrateModuleData(userData, (line) => console.warn(`[tavora] ${line}`), library.moduleFilesFolder ?? defaultFilesRoot(userData)).catch((error: unknown) =>
      console.error("[tavora] moving module data under its owner failed", error),
    );
    const expired = purgeExpired(library, new Date());
    const workspace = await loadWorkspace(
      path.join(userData, "workspace.json"),
      Object.keys(library.games),
      (id) => modules.has(id),
    );
    settlePanelTypes(workspace, panelTypesOf(modules));
    const savedProfile = await readJsonOrSetAside(path.join(userData, "profile.json"));
    const profile = sanitizeProfile(savedProfile);
    const savedWindow = await readJsonOrSetAside<WindowState>(path.join(userData, "window.json"));
    const windowState = initialBounds(
      savedWindow,
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
    );
    await registerHostProtocol(
      options.rendererDir,
      {
        "game-icons": path.join(userData, "game-icons"),
        "steam-icons": path.join(userData, "steam-icons"),
        profile: path.join(userData, "profile"),
      },
      options.devServer,
    );

    const host = new Host(options, modules, moduleInfo, moduleProblems, library, workspace, profile, windowState, themes, themeProblems);
    host.moduleData = await listModuleData(userData, host.files.root());
    host.grants = await GrantStore.load(userData);
    host.safetyLists = safetyLists;
    host.blockedModules = blockedModules;
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
    if (savedProfile === null) host.saveProfile().catch(() => undefined); // logged by saveProfile
    // Browser storage of games that are gone, removed before any session opens it.
    for (const dir of await orphanedPartitions(userData, new Set(Object.keys(library.games)))) {
      await rm(dir, { recursive: true, force: true });
    }
    for (const game of expired) await host.deleteGameData(game);
    // Version 0.2.0 saved Steam covers here; they were replaced by Steam's own icons.
    await rm(path.join(userData, "steam-art"), { recursive: true, force: true });
    const livePanels = new Set(Object.values(workspace.games).flatMap((game) => game.instances.map((i) => i.instanceId)));
    await host.data.panelState.prune(livePanels);
    if (expired.length) host.saveLibrary();

    host.screen = library.startup === "last-game" && library.lastGameId ? "game" : "welcome";
    host.registerIpc();
    await host.watchDevelopmentFolders();
    host.registerWindowEvents();
    host.window.once("ready-to-show", () => timings.record("startup", process.uptime() * 1000));
    await host.window.loadURL(options.devServer ?? `${HOST_SCHEME}://app/index.html`);
    if (host.screen === "game") host.openCurrentGame();
    void host.files.check();
    // Icons of games that have none yet are looked for quietly in the background.
    host.fetchIconsSoon();
    host.backupSoon();
    await host.startUpdates();
    return host;
  }

  /**
   * The built-in AI usage panel (before 0.16.10) kept its interval, style and last readings in
   * ai-usage.json. They go to the AI Usage module's settings shared by every game, once, without
   * replacing anything the module saved itself; then the file keeps only the accounts.
   */
  private async moveAiUsagePanelData(): Promise<void> {
    try {
      const legacy = await this.aiUsage.legacyPanelData();
      if (!legacy) return;
      const settings = this.data.appSettings(OFFICIAL_OWNER, AI_USAGE_MODULE_ID);
      if ((await settings.get("settings")) === null) await settings.set("settings", { refreshMinutes: legacy.refreshMinutes, style: legacy.style });
      if ((await settings.get("readings")) === null) await settings.set("readings", legacy.readings);
      await this.aiUsage.forgetLegacyPanelData();
    } catch (error) {
      console.error("[tavora] moving the AI usage panel's settings failed", error);
    }
  }

  /**
   * The built-in Discord panel (before 0.16.11) kept the channel to rejoin and the server each game
   * remembers next to the sign-in in discord.json. They go to the Discord module once, without
   * replacing anything the module saved itself: the channel to its settings shared by every game
   * (`last`), each game's server to its settings in that game (`server`). The sign-in stays.
   */
  private async moveDiscordPanelData(): Promise<void> {
    try {
      const legacy = await this.discord.legacyPanelData();
      if (!legacy) return;
      const settings = this.data.appSettings(OFFICIAL_OWNER, DISCORD_MODULE_ID);
      if (legacy.last && (await settings.get("last")) === null) await settings.set("last", { ...legacy.last });
      for (const [gameId, game] of Object.entries(legacy.games)) {
        if (!this.library.games[gameId]) continue;
        const store = this.data.get(OFFICIAL_OWNER, DISCORD_MODULE_ID, gameId).settings;
        if ((await store.get("server")) === null) await store.set("server", { ...game });
      }
      await this.discord.forgetLegacyPanelData();
    } catch (error) {
      console.error("[tavora] moving the Discord panel's settings failed", error);
    }
  }

  /** The daily copy of the player's data, made a little after start so it never slows it. */
  private backupSoon(): void {
    setTimeout(() => {
      backupData({ userData: this.options.userData, log: (line) => console.log(`[tavora] ${line}`) }).catch((error: unknown) => console.error("[tavora] backup failed", error));
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
        log: (line) => this.logUpdate(line),
      });
      this.updates.start();
    } catch (error) {
      this.logUpdate(`updates are not available: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Modules that ship with Tavora, the development folders the player added, any test folders, and the player's own modules folder. */
  private static moduleSources(options: HostOptions, developmentFolders: string[]) {
    return { official: options.officialModuleDirs, development: developmentFolders, local: [...options.moduleDirs, userModulesDir(options)] };
  }

  /** Looks for modules again; panels of modules that are gone are closed. */
  private async reloadModules(): Promise<void> {
    const problems: ModuleProblem[] = [];
    const modules = await discoverModules({ ...Host.moduleSources(this.options, this.library.developmentFolders), tavoraVersion: app.getVersion() }, problems);
    const records = await readOwnerRecords(this.options.userData);
    applyOwners(modules, await realUserModulesDir(this.options), records);
    this.blockedModules = stopBlocked(modules, await realUserModulesDir(this.options), records, this.safetyLists, problems);
    modules.set(BROWSER_MODULE_ID, browserModule(app.getVersion()));
    this.moduleInfo = await describeModules(userModulesDir(this.options), modules);
    this.moduleProblems = problems;
    this.modules = modules;
    this.moduleData = await listModuleData(this.options.userData, this.files.root());
    this.dropPanelsOfMissingModules();
    this.noteModuleVersions();
    settlePanelTypes(this.workspace, panelTypesOf(modules));
    this.syncPanelTypes();
    await this.watchDevelopmentFolders();
    void this.refreshPublisherNames();
  }

  /**
   * After modules were looked for again: a panel whose type an update removed stops and its slot says
   * so (the decision log, named panels round 4); one whose type came back starts again.
   */
  private syncPanelTypes(): void {
    const game = this.game;
    if (!game) return;
    for (const record of this.records(game.id)) {
      const open = this.views.has(record.instanceId);
      const missing = this.panelTypeOf(record) === undefined;
      if (open && missing) this.destroyView(record.instanceId);
      else if (!open && !missing) this.createView(record, game);
    }
    this.saveWorkspace();
  }

  /**
   * The panel type a panel shows, with the module's entry, icon and sizes filled in; null for a module
   * without types, undefined when the module no longer offers the panel's type.
   */
  private panelTypeOf(record: InstanceRecord): ResolvedPanelType | null | undefined {
    const module = this.modules.get(record.moduleId);
    if (!module) return undefined;
    const types = panelTypes(module.manifest);
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
        if (built !== undefined) watchFolder(path.join(root, built), true, () => changed(!module));
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
    if (moduleId === undefined) return;
    for (const view of this.views.values()) if (view instanceof ModuleView && view.moduleId === moduleId) view.reload();
  }

  /** The player picks a module project folder, or a folder of them; Tavora loads the modules from it from now on. Answers with the folder, or nothing when cancelled. */
  private async addDevelopmentFolder(): Promise<string | void> {
    const picked = await dialog.showOpenDialog(this.window, { title: translate(this.language, "dialog.developmentFolder"), properties: ["openDirectory"] });
    const folder = picked.filePaths[0];
    if (picked.canceled || !folder) return;
    if (this.library.developmentFolders.length >= MAX_DEVELOPMENT_FOLDERS) throw new LibraryError("error.tooManyDevelopmentFolders");
    this.library.developmentFolders = cleanDevelopmentFolders([...this.library.developmentFolders, folder]);
    this.saveLibrary();
    await this.reloadModules();
    return path.resolve(folder);
  }

  /** Opens one of Tavora's pages for module developers in the player's browser. The renderer names the page, never an address. */
  private openDeveloperLink(link: DeveloperLink): void {
    const url = Object.hasOwn(DEVELOPER_LINKS, link) ? DEVELOPER_LINKS[link] : undefined;
    if (url && !this.options.hidden) void shell.openExternal(url).catch((error: unknown) => console.error("[tavora]", error));
  }

  /** Forgets a development folder; its modules' panels close like a removed module's, and their data stays. */
  private async removeDevelopmentFolder(folder: string): Promise<void> {
    const key = (value: string) => (process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value));
    this.library.developmentFolders = this.library.developmentFolders.filter((item) => key(item) !== key(folder));
    this.saveLibrary();
    await this.reloadModules();
  }

  /**
   * Deletes what a module that is not installed left behind: its settings and
   * documents in every game now, its browser storage cleared now and its
   * folders removed at the next start. An installed module's data is not deleted here.
   */
  private async deleteLeftoverData(owner: string, moduleId: string): Promise<void> {
    if (this.modules.get(moduleId)?.owner === owner) throw new LibraryError("error.dataInUse");
    this.data.forgetModule(owner, moduleId);
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

  /** What Settings shows of a module's patch notes: the newest version they cover, and whether any are new to the player. */
  private notesView(module: InstalledModule): { latest: string | null; unseen: boolean } {
    const notes = installedNotes(this.moduleInfo.get(module.manifest.id)?.changelog ?? [], module.manifest.version);
    return { latest: notes[0]?.version ?? null, unseen: hasUnseenNotes(notes, module.manifest.version, this.library.moduleNotesSeen[Host.notesKey(module)]) };
  }

  /** Closes and forgets every panel whose module is not installed any more, in every game. Module data stays. */
  private dropPanelsOfMissingModules(): void {
    let changed = false;
    for (const workspace of Object.values(this.workspace.games)) {
      const gone = new Set(workspace.instances.filter((record) => !this.modules.has(record.moduleId)).map((record) => record.instanceId));
      if (gone.size === 0) continue;
      changed = true;
      workspace.instances = workspace.instances.filter((record) => !gone.has(record.instanceId));
      workspace.layout = pruneLayout(workspace.layout, (id) => !gone.has(id));
      for (const instanceId of gone) this.closeView(instanceId);
    }
    if (changed) {
      this.layoutEpoch++;
      this.saveWorkspace();
    }
  }

  // ── Pictures of modules ──────────────────────────────────────────────

  private async openModulesFolder(): Promise<void> {
    const dir = userModulesDir(this.options);
    await mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new LibraryError("error.openModulesFolder", { problem: error });
  }

  /** Moves a module out of the player's modules folder (to the recycle bin) and forgets it. */
  private async removeModule(moduleId: string): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module || !this.moduleInfo.get(moduleId)?.removable) {
      throw new LibraryError("error.removeOnlyOwn");
    }
    try {
      // Test runs keep the window hidden and have no recycle bin to rely on.
      if (this.options.hidden) await rm(module.root, { recursive: true, force: true });
      else await shell.trashItem(module.root);
    } catch {
      throw new LibraryError("error.removeFailed");
    }
    this.removeModulePanels(moduleId);
    // Its data stays under its owner, so the same publisher's module finds it again. Its grants go:
    // whatever is installed next under this id is asked again.
    await forgetOwner(this.options.userData, path.basename(module.root));
    await this.grants.revoke(module.owner, moduleId);
    await this.reloadModules();
  }

  /**
   * The player allowed what the consent dialog showed. Only hosts the module asks for are granted
   * (grants.ts), so a module updated while the dialog was open gets nothing it did not show. Open
   * panels of the module start again, so they connect with the new grant.
   */
  private async grantModule(moduleId: string, network: string[], connectors: Connector[]): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module || module.builtIn) throw new LibraryError("error.moduleMissing");
    await this.grants.grant(module, { network, connectors });
    for (const view of this.views.values()) if (view instanceof ModuleView && view.moduleId === moduleId) view.reload();
  }

  /** Takes back everything granted to a module, after its panels are removed in every game. Its data stays. */
  private async revokeModule(moduleId: string): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module) throw new LibraryError("error.moduleMissing");
    this.removeModulePanels(moduleId);
    await this.grants.revoke(module.owner, moduleId);
  }

  /** The games, by id in the library, with a panel of this module. */
  private gamesUsing(moduleId: string): string[] {
    return Object.entries(this.workspace.games)
      .filter(([gameId, workspace]) => gameId in this.library.games && workspace.instances.some((record) => record.moduleId === moduleId))
      .map(([gameId]) => gameId);
  }

  /** Removes a module's panels in every game; a slot left with nothing stays as an empty slot. */
  private removeModulePanels(moduleId: string): void {
    let changed = false;
    for (const workspace of Object.values(this.workspace.games)) {
      const gone = new Set(workspace.instances.filter((record) => record.moduleId === moduleId).map((record) => record.instanceId));
      if (gone.size === 0) continue;
      changed = true;
      workspace.instances = workspace.instances.filter((record) => !gone.has(record.instanceId));
      workspace.layout = vacateLayout(workspace.layout, (id) => gone.has(id));
      for (const instanceId of gone) this.closeView(instanceId);
    }
    if (changed) {
      this.layoutEpoch++;
      this.saveWorkspace();
    }
  }

  /**
   * Installs a module from a zip the player picks (installer.ts). An update
   * from the same publisher replaces the folder and reloads its open panels.
   * Answers with the module's id, or nothing when the player cancelled.
   */
  private async installModule(): Promise<string | void> {
    const picked = await dialog.showOpenDialog(this.window, {
      title: translate(this.language, "dialog.installModule"),
      properties: ["openFile"],
      filters: [{ name: translate(this.language, "dialog.moduleZip"), extensions: ["zip"] }],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return;
    return this.finishInstall(await installZip(file, await this.installOptions()));
  }

  /**
   * What every install goes by. The newest revocations and blocks count (C6, C14; offline, the ones
   * held do), and a module stopped by a block still counts as installed, so a fixed zip is its update.
   */
  private async installOptions() {
    await this.refreshSafetyLists();
    return {
      userData: this.options.userData,
      userModules: await realUserModulesDir(this.options),
      modules: new Map([...this.blockedModules, ...this.modules]),
      tavoraVersion: app.getVersion(),
      safety: this.safetyLists,
    };
  }

  /** Where the Browse tab of the module library looks: the current game, or the personal workspace. */
  private catalogScope(): CatalogScope | null {
    const id = this.gameId;
    const game = id ? this.library.games[id] : undefined;
    if (!game) return null;
    return game.kind === "workspace" ? { workspace: true } : { game: game.catalogId ?? game.id };
  }

  /**
   * Installs a module from the catalog: its listing is asked for again here, never taken from the
   * host UI, and its zip must match the listed hash and be signed by the listed key (C1) before the
   * installer writes anything.
   */
  private async installCatalogModule(moduleId: string): Promise<string> {
    if (!this.library.onlineSearch) throw new PlayerError("error.catalogOff");
    const entry = await this.catalog.module(moduleId);
    const zip = await this.catalog.download(entry.zip);
    return this.finishInstall(await installZipData(zip, { ...(await this.installOptions()), expect: { id: entry.id, owner: entry.owner } }));
  }

  private async finishInstall(installed: Installed): Promise<string> {
    // The developer name comes with the install, so it is said at once (it waits for the service at most a few seconds).
    if (installed.owner !== LOCAL_OWNER) await this.publisherNames.refresh([installed.owner]).catch(() => undefined);
    await this.reloadModules();
    if (installed.updated) {
      for (const view of this.views.values()) if (view instanceof ModuleView && view.moduleId === installed.manifest.id) view.reload();
    }
    return installed.manifest.id;
  }

  private static themeSources(options: HostOptions) {
    return { official: options.officialThemeDirs, local: [path.join(options.userData, "themes"), ...(options.themeDirs ?? [])] };
  }

  private titleBarOverlay() {
    return { color: this.currentTheme.colors.background, symbolColor: this.currentTheme.colors.text, height: TITLE_BAR_HEIGHT };
  }

  /** The system's light or dark setting. */
  private static systemMode(options: HostOptions): "dark" | "light" {
    if (options.systemTheme) return options.systemTheme;
    // Only while the native theme follows the system does it say what the system says.
    nativeTheme.themeSource = "system";
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }

  /** The theme and variation in use now: the player's pick, in the mode of the system when following it. */
  private currentChoice() {
    return resolveTheme(this.themes, this.library.theme, this.library.followSystem ? Host.systemMode(this.options) : undefined);
  }

  /** Native menus, dialogs and scrollbars: left to the system while following it, else in the theme's mode. */
  private syncNativeTheme(): void {
    nativeTheme.themeSource = this.library.followSystem && !this.options.systemTheme ? "system" : this.currentTheme.mode;
  }

  /** Shows the theme the library names, in the host window, native controls and every open module. */
  private applyTheme(): void {
    const next = moduleTheme(this.currentChoice().variation);
    if (JSON.stringify(next) === JSON.stringify(this.currentTheme)) {
      this.syncNativeTheme();
      return;
    }
    this.currentTheme = next;
    this.syncNativeTheme();
    this.window.setBackgroundColor(next.colors.background);
    try {
      this.window.setTitleBarOverlay(this.titleBarOverlay());
    } catch {
      // Platforms without a window controls overlay have nothing to recolour.
    }
    for (const view of this.views.values()) view.applyTheme(next);
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
      games: Object.keys(this.library.games).length,
      panels: this.views.size,
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

  private get gameId(): string | null {
    return this.screen === "game" ? this.library.lastGameId : null;
  }

  private get game(): TavoraGame | null {
    const id = this.gameId;
    const entry = id ? this.library.games[id]! : null;
    return entry ? { id: entry.id, displayName: entry.name, kind: entry.kind } : null;
  }

  private gameWorkspace(gameId: string): GameWorkspace {
    return (this.workspace.games[gameId] ??= emptyGameWorkspace());
  }

  private records(gameId: string): InstanceRecord[] {
    return this.gameWorkspace(gameId).instances;
  }


  // ── IPC ──────────────────────────────────────────────────────────────

  private registerIpc(): void {
    // Module side: the only messages a module renderer can send. Identity is
    // looked up from the sending webContents, never taken from the message.
    ipcMain.on("tavora:hello", (event: IpcMainEvent) => {
      const view = this.viewsByContents.get(event.sender.id);
      if (!view || !event.senderFrame || event.senderFrame.parent !== null) return;
      view.connect();
    });
    ipcMain.on("tavora:gesture", (event: IpcMainEvent) => {
      if (event.senderFrame?.parent !== null) return;
      this.viewsByContents.get(event.sender.id)?.noteGesture();
    });
    ipcMain.on("tavora:pong", (event: IpcMainEvent) => {
      if (event.senderFrame?.parent !== null) return;
      this.viewsByContents.get(event.sender.id)?.pong();
    });

    // Host UI side: only the host window's main frame may call these.
    const fromHost = (event: IpcMainInvokeEvent | IpcMainEvent) =>
      event.sender.id === this.window.webContents.id && event.senderFrame?.parent === null;

    ipcMain.handle("host:get-state", (event) => (fromHost(event) ? this.viewState() : null));
    ipcMain.handle("host:action", async (event, raw: unknown): Promise<ActionResult> => {
      if (!fromHost(event)) return { ok: false, error: translate(this.language, "error.notAllowed") };
      const action = parseAction(raw);
      if (!action) return { ok: false, error: translate(this.language, "error.notUnderstood") };
      try {
        if (action.type === "share-icons") return await this.shareIcons(action.gameIds);
        if (action.type === "import-steam-games") return this.importSteam(action.games);
        const id = await this.perform(action);
        return id === undefined ? { ok: true } : { ok: true, id };
      } catch (error) {
        if (error instanceof PlayerError) {
          return { ok: false, error: translate(this.language, error.key, error.params) };
        }
        console.error(`[tavora] ${action.type} failed`, error);
        return { ok: false, error: translate(this.language, "error.generic") };
      } finally {
        this.pushState();
      }
    });
    ipcMain.handle("host:get-discord", (event) => (fromHost(event) ? this.discord.view() : null));
    ipcMain.handle("host:get-ai-usage", (event) => (fromHost(event) ? this.aiUsage.view() : null));
    ipcMain.handle("host:get-account", (event) => (fromHost(event) ? this.account.view() : null));
    ipcMain.handle("host:module-notes", (event, moduleId: unknown) => {
      const module = fromHost(event) && typeof moduleId === "string" ? this.modules.get(moduleId) : undefined;
      return module ? installedNotes(this.moduleInfo.get(module.manifest.id)?.changelog ?? [], module.manifest.version) : [];
    });
    ipcMain.handle("host:search-catalog", (event, query: unknown) =>
      fromHost(event) && typeof query === "string" && query.length <= 100
        ? searchCatalog(this.library, query).map(({ id, name }) => ({ id, name }))
        : [],
    );
    ipcMain.handle("host:search-online", async (event, query: unknown): Promise<OnlineSearchResult> => {
      if (!fromHost(event) || typeof query !== "string" || query.length > 100) return { status: "ok", games: [] };
      if (!this.library.onlineSearch) return { status: "off", games: [] };
      const result = await this.onlineSearch.search(query);
      // Games the player already has (Trash included) are not offered again.
      return { ...result, games: result.games.filter((game) => !this.library.games[game.id]) };
    });
    ipcMain.handle("host:browse-catalog", async (event): Promise<CatalogListResult> => {
      if (!fromHost(event)) return { status: "unreachable" };
      if (!this.library.onlineSearch) return { status: "off" };
      const scope = this.catalogScope();
      return scope ? this.catalog.list(scope) : { status: "ok", modules: [] };
    });
    ipcMain.handle("host:steam-library", async (event, profile: unknown): Promise<SteamLibraryResult> => {
      if (!fromHost(event) || typeof profile !== "string") return { status: "error", error: translate(this.language, "error.notUnderstood") };
      if (!this.library.onlineSearch) return { status: "error", error: translate(this.language, "error.onlineOff") };
      const result = await fetchSteamLibrary({ baseUrl: this.options.apiUrl ?? DEFAULT_API_URL, language: this.language }, profile);
      return result.status === "ok" ? steamLibraryView(this.library, result.games) : result;
    });
    ipcMain.on("host:panel-bounds", (event, bounds: unknown) => {
      if (fromHost(event)) this.setPanelBounds(bounds);
    });
    ipcMain.on("host:overlay", (event, open: unknown) => {
      if (fromHost(event) && typeof open === "boolean") void this.setOverlay(open);
    });
    ipcMain.on("host:module-menu-answer", (event, answer: unknown) => {
      if (fromHost(event)) this.answerModuleMenu(answer);
    });
  }

  private registerWindowEvents(): void {
    this.window.on("resize", () => this.saveWindowSoon());
    this.window.on("move", () => this.saveWindowSoon());
    this.window.on("close", () => this.saveWindow());
    const hidden = (value: boolean) => () => {
      this.windowHidden = value;
      this.applyBounds();
    };
    this.window.on("minimize", hidden(true));
    this.window.on("hide", hidden(true));
    this.window.on("restore", hidden(false));
    this.window.on("show", hidden(false));
    this.window.on("closed", () => {
      for (const view of this.views.values()) view.dispose();
      this.views.clear();
      this.viewsByContents.clear();
      this.browsersByContents.clear();
      this.discord.dispose();
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────

  private async perform(action: HostAction): Promise<string | void> {
    const library = this.library;
    switch (action.type) {
      case "link-choice":
        return this.chooseLink(action.choice);
      case "navigation-choice":
        return this.chooseNavigation(action.choice);
      case "module-files-change":
        return this.files.change();
      case "module-files-reset":
        return this.files.reset();
      case "module-files-open":
        return this.files.open();
      case "show-welcome":
        return this.showScreen("welcome");
      case "restart":
        return this.options.restart();
      case "open-game":
        return this.openGame(action.gameId);
      case "add-game": {
        const id = addGame(library, action, new Date());
        this.workspace.games[id] = emptyGameWorkspace();
        this.saveLibrary();
        this.saveWorkspace();
        this.fetchIconsSoon();
        return id;
      }
      case "rename-game":
        renameGame(library, action.gameId, action.name);
        break;
      case "set-game-label": {
        const previous = setGameLabel(library, action.gameId, action.label);
        await this.dropIconFile(previous);
        break;
      }
      case "choose-game-image":
        await this.chooseGameImage(action.gameId);
        break;
      case "use-original-icon": {
        const previous = useOriginalGameIcon(library, action.gameId);
        await this.dropIconFile(previous);
        break;
      }
      case "share-icons":
        // Answered with a count, so the IPC handler runs it itself.
        throw new Error("share-icons is not run through perform");
      case "trash-game": {
        const wasOpen = this.gameId === action.gameId;
        trashGame(library, action.gameId, new Date());
        if (wasOpen) this.showScreen("welcome");
        break;
      }
      case "restore-game":
        restoreGame(library, action.gameId);
        break;
      case "delete-game": {
        const game = deleteTrashedGame(library, action.gameId);
        this.saveLibrary();
        await this.deleteGameData(game);
        break;
      }
      case "favorite":
        placeFavorite(library, action.gameId, action.index);
        break;
      case "unfavorite":
        removeFavorite(library, action.gameId);
        break;
      case "move-game":
        moveGame(library, action.gameId, action);
        break;
      case "create-folder": {
        const id = createFolder(library, action.name, action.gameIds.filter((game) => isLive(library, game)));
        this.saveLibrary();
        return id;
      }
      case "rename-folder":
        renameFolder(library, action.folderId, action.name);
        break;
      case "set-folder-label":
        setFolderLabel(library, action.folderId, action.label);
        break;
      case "delete-folder":
        deleteFolder(library, action.folderId);
        break;
      case "move-folder":
        moveFolder(library, action.folderId, action.index);
        break;
      case "set-sort":
        library.sort = action.sort;
        break;
      case "set-startup":
        library.startup = action.startup;
        break;
      case "set-grayscale-text":
        library.grayscaleText = action.enabled;
        break;
      case "set-auto-update":
        library.autoUpdate = action.enabled;
        this.updates?.setAutoDownload(action.enabled);
        break;
      case "record-timing":
        timings.record(action.name, action.ms);
        return;
      case "copy-diagnostics":
        clipboard.writeText(await this.diagnosticReport());
        return;
      case "open-backups": {
        const dir = backupsDir(this.options.userData);
        await mkdir(dir, { recursive: true });
        const problem = await shell.openPath(dir);
        if (problem) throw new LibraryError("error.openFolder", { problem });
        return;
      }
      case "download-update":
        return this.updates?.download();
      case "check-for-updates":
        if (!this.updates) throw new LibraryError("error.updatesDev");
        return this.updates.check();
      case "restart-to-update":
        return this.updates?.restartNow();
      case "set-online-search":
        library.onlineSearch = action.enabled;
        // Turned on: games without an icon may find one on the service, and the share list can be built.
        if (action.enabled) this.fetchIconsSoon();
        if (action.enabled) void this.refreshSafetyLists();
        break;
      case "set-language":
        library.language = action.language;
        for (const view of this.views.values()) view.applyLanguage(this.language);
        break;
      case "set-steam-profile":
        library.steamProfile = action.profile;
        break;
      case "set-module-icons":
        library.moduleIcons = action.enabled;
        break;
      case "set-steam-icons":
        library.steamIcons = action.enabled;
        if (action.enabled) this.fetchIconsSoon();
        break;
      case "set-theme":
        if (!this.themes.get(action.themeId)?.theme.variations.some((variation) => variation.id === action.variationId)) {
          throw new LibraryError("error.themeGone");
        }
        library.theme = { id: action.themeId, variation: action.variationId };
        if (action.fixed) library.followSystem = false;
        this.applyTheme();
        break;
      case "set-appearance-mode": {
        if (action.mode === "system") {
          library.followSystem = true;
        } else {
          const { theme } = resolveTheme(this.themes, library.theme);
          const variation = variationForMode(theme, library.theme.variation, action.mode);
          if (variation.mode !== action.mode) throw new LibraryError("error.themeNoMode", { mode: translate("en", action.mode === "dark" ? "common.dark" : "common.light") });
          library.theme = { id: theme.id, variation: variation.id };
          library.followSystem = false;
        }
        this.applyTheme();
        break;
      }
      case "reset-theme":
        library.theme = { ...DEFAULT_THEME };
        library.followSystem = true;
        this.applyTheme();
        break;
      case "reload-modules":
        return this.reloadModules();
      case "add-development-folder":
        return this.addDevelopmentFolder();
      case "remove-development-folder":
        return this.removeDevelopmentFolder(action.folder);
      case "open-developer-link":
        return this.openDeveloperLink(action.link);
      case "open-modules-folder":
        return this.openModulesFolder();
      case "remove-module":
        return this.removeModule(action.moduleId);
      case "grant-module":
        return this.grantModule(action.moduleId, action.network, action.connectors);
      case "revoke-module":
        return this.revokeModule(action.moduleId);
      case "install-module":
        return this.installModule();
      case "install-catalog-module":
        return this.installCatalogModule(action.moduleId);
      case "delete-module-data":
        return this.deleteLeftoverData(action.owner, action.moduleId);
      case "seen-module-notes": {
        const module = this.modules.get(action.moduleId);
        if (!module || module.builtIn) return;
        this.library.moduleNotesSeen[Host.notesKey(module)] = module.manifest.version;
        this.saveLibrary();
        return;
      }
      case "move-local-data":
        return this.moveLocalData(action.moduleId);
      case "reload-themes":
        return this.reloadThemes();
      case "open-themes-folder":
        return this.openThemesFolder();
      case "create-starter-theme":
        return this.createStarterTheme();
      case "set-onboarded":
        library.onboarded = action.done;
        break;
      case "save-profile":
        this.profile.name = clipName(action.name);
        this.profile.initials = clipInitials(action.initials);
        this.profile.updatedAt = new Date().toISOString();
        // Resolves once it is on disk, so the host UI can say "Saved"; the account gets it after.
        await this.saveProfile();
        void this.account.profileChanged();
        return;
      case "set-profile-picture":
        return this.setProfilePicture(await savePicture(this.profileDir, action.png));
      case "remove-profile-picture":
        return this.setProfilePicture(null);
      case "set-rail":
        setRail(library, action);
        break;
      case "open-module":
        return this.openModule(action.moduleId, { ...(action.panelType ? { panelType: action.panelType } : {}) });
      case "choose-panel-type":
        return this.choosePanelType(action.instanceId, action.panelType);
      case "close-panel":
        return this.closePanel(action.instanceId);
      case "reload-panel":
        return this.views.get(action.instanceId)?.reload();
      case "stop-panel":
        return this.views.get(action.instanceId)?.stop();
      case "browser-new-tab":
        return this.openBrowserTab(action.instanceId, null, false);
      case "browser-navigate":
        return this.browser(action.instanceId).navigate(action.address);
      case "browser-command":
        return this.browserCommand(this.browser(action.instanceId), action.command);
      case "browser-set-shared":
      case "browser-set-adblock": {
        const site = siteOfUrl(this.browser(action.instanceId).state.url);
        if (!site) throw new LibraryError("error.openPageFirst");
        if (action.type === "browser-set-shared") setSiteListed(library, "sharedSites", site, action.shared);
        else setSiteListed(library, "adblockOff", site, !action.enabled);
        this.browserSitesChanged();
        break;
      }
      case "browser-forget-site":
        setSiteListed(library, action.list === "shared" ? "sharedSites" : "adblockOff", action.site, false);
        this.browserSitesChanged();
        break;
      case "clear-browser-data":
        return this.clearBrowserData(action.scope);
      case "account-send-code":
        return this.account.sendCode(action.email);
      case "account-verify":
        return this.account.verify(action.code);
      case "account-create":
        return this.account.create(action.ageConfirmed);
      case "account-cancel":
        return this.account.cancel();
      case "account-refresh":
        return this.account.refresh();
      case "account-sign-out":
        return this.account.signOut();
      case "account-sign-out-device":
        return this.account.signOutDevice(action.deviceId);
      case "account-email-code":
        return this.account.sendEmailCode(action.email);
      case "account-change-email":
        return this.account.changeEmail(action.code);
      case "account-delete-code":
        return this.account.sendDeleteCode();
      case "account-delete":
        return this.account.deleteAccount(action.code);
      case "account-discord-sign-in":
        return this.account.discordSignIn();
      case "account-discord-connect-code":
        return this.account.sendConnectDiscordCode();
      case "account-discord-connect":
        return this.account.connectDiscord(action.code);
      case "account-discord-disconnect-code":
        return this.account.sendDisconnectDiscordCode();
      case "account-discord-disconnect":
        return this.account.disconnectDiscord(action.code);
      case "account-email-remove-code":
        return this.account.sendRemoveEmailCode();
      case "account-email-remove":
        return this.account.removeEmail(action.code);
      case "account-delete-discord":
        return this.account.deleteWithDiscord();
      case "account-profile-choice":
        return this.account.chooseProfile(action.keep);
      case "account-developer-name":
        return this.account.setDeveloperName(action.name);
      case "account-link-code":
        return this.account.newLinkCode();
      case "account-copy-link-command": {
        const code = this.account.view().linkCode?.code;
        if (!code) throw new PlayerError("account.error.noCode");
        clipboard.writeText(linkCommand(code));
        return;
      }
      case "account-unlink-key":
        return this.account.unlinkKey(action.fingerprint);
      case "ai-usage-add":
        return this.aiUsage.add(action.provider, action.label, action.directory);
      case "ai-usage-update":
        return this.aiUsage.update(action.accountId, action.label, action.directory);
      case "ai-usage-remove":
        return this.aiUsage.remove(action.accountId);
      case "discord-connect":
        return this.discord.connectNow();
      case "discord-sign-out":
        return this.discord.signOut();
      case "save-layout":
        return this.saveLayout(action.layout);
      case "apply-layout-template":
        return this.applyLayoutTemplate(layoutTemplate(action.templateId));
      case "apply-layout-grid":
        return this.applyLayoutTemplate(gridTemplate(action.columns, action.rows));
      case "save-snapshot":
        return this.saveSnapshot(action.name);
      case "update-snapshot":
        return this.updateSnapshot(action.snapshotId);
      case "apply-snapshot":
        return this.applySnapshot(action.snapshotId);
      case "rename-snapshot":
        return this.renameSnapshot(action.snapshotId, action.name);
      case "delete-snapshot":
        return this.deleteSnapshot(action.snapshotId);
    }
    this.saveLibrary();
  }

  private showScreen(next: Screen): void {
    if (this.screen === next && next !== "game") return;
    this.notice = null;
    this.pendingLink = null;
    this.pendingNavigation = null;
    this.closeAllViews();
    this.screen = next;
  }

  private openGame(gameId: string): void {
    if (!isLive(this.library, gameId)) throw new LibraryError("error.gameGone");
    if (this.gameId === gameId) return;
    this.showScreen("game");
    markPlayed(this.library, gameId, new Date());
    this.saveLibrary();
    this.openCurrentGame();
  }

  private async chooseGameImage(gameId: string): Promise<void> {
    if (!isLive(this.library, gameId)) throw new LibraryError("error.gameGone");
    const picked = await dialog.showOpenDialog(this.window, {
      title: translate(this.language, "dialog.chooseIcon"),
      properties: ["openFile"],
      filters: [{ name: translate(this.language, "dialog.images"), extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    const source = picked.filePaths[0];
    if (picked.canceled || !source) return;
    const file = await importIcon(this.iconDir, gameId, source);
    const previous = setGameImage(this.library, gameId, file);
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

  /** Puts the account's profile in place of this PC's (checked like a picture the player picked). */
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
    this.hostedListLoading ??= fetchHostedList({ baseUrl: this.options.apiUrl ?? DEFAULT_API_URL }).then((list) => {
      this.hostedList = list;
      this.hostedListLoading = null;
      if (list) this.pushState();
      return list;
    });
    return this.hostedListLoading;
  }

  /**
   * The icon file of a game that could be offered: the game's own icon found on
   * this PC (never a picture the player chose, a hosted icon or Steam's small one),
   * for a game with an id the service knows, that the service has no icon for and
   * that was not offered before. Null otherwise.
   */
  private shareableFile(game: GameEntry): string | null {
    return shareableIconFile(game, this.library, this.hostedList);
  }

  /** Games that have an icon of their own and an id the service knows: the ones worth asking the list about. */
  private shareCandidates(): GameEntry[] {
    const library = this.library;
    if (!library.steamIcons || !library.onlineSearch) return [];
    return Object.values(library.games).filter(isShareCandidate);
  }

  /** Adds the games of a Steam import that are not in the library yet. Answers with how many. */
  private importSteam(games: SteamImportGame[]): ActionResult {
    const added = importSteamGames(this.library, games, new Date());
    for (const id of added) this.workspace.games[id] = emptyGameWorkspace();
    if (added.length > 0) {
      this.saveLibrary();
      this.saveWorkspace();
      this.fetchIconsSoon();
    }
    return { ok: true, added: added.length };
  }

  /** Offers these games' icons to the service, one at a time. Returns how many it took. */
  private async shareIcons(gameIds: string[]): Promise<ActionResult> {
    let tried = 0;
    let shared = 0;
    let unreachable = false;
    for (const id of gameIds) {
      const game = this.library.games[id];
      const file = game ? this.shareableFile(game) : null;
      if (!game || !file) continue;
      tried += 1;
      let ico: Uint8Array | null = null;
      try {
        ico = largestIcoFrame(new Uint8Array(await readFile(path.join(this.steamIconDir, file))));
      } catch {
        ico = null;
      }
      if (!ico) continue;
      const outcome = await submitIcon({ baseUrl: this.options.apiUrl ?? DEFAULT_API_URL }, { id: game.id, name: game.name, source: shareSource(file), ico });
      if (outcome === "failed") {
        unreachable = true;
        break;
      }
      // Sent, or refused for good: either way it is not offered again.
      markIconShared(this.library, game.id, new Date());
      if (outcome === "sent") shared += 1;
      this.saveLibrary();
      this.pushState();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (tried === 0) return { ok: false, error: translate(this.language, "error.nothingToShare") };
    if (unreachable && shared === 0) return { ok: false, error: translate(this.language, "error.unreachable") };
    return { ok: true, shared };
  }

  private async dropIconFile(icon: GameIcon | null): Promise<void> {
    if (icon?.kind === "image") await removeIcon(this.iconDir, icon.file);
  }

  /** Deletes everything stored for a game that left the library for good. */
  private async deleteGameData(game: GameEntry): Promise<void> {
    const records = this.workspace.games[game.id]?.instances ?? [];
    delete this.workspace.games[game.id];
    this.saveWorkspace();
    await Promise.all(records.map((record) => this.data.panelState.remove(record.instanceId)));
    this.data.forgetGame(game.id);
    // A folder the player chose can be gone (an unplugged drive): the game still goes, and they are told where its pictures may remain.
    await this.files.noteGameDeleted(game.name, (root) => deleteModuleData(this.options.userData, game.id, root));
    await this.dropIconFile(game.icon);
    if (game.iconFile && !iconFileShared(this.library, game.iconFile, game.id)) await removeSteamIcon(this.steamIconDir, game.iconFile);
    // Sessions may already be open in this run, so clear them; their
    // directories are removed at the next start.
    const keep = new Set(Object.keys(this.library.games));
    for (const dir of await orphanedPartitions(this.options.userData, keep)) {
      const ses = session.fromPartition(`persist:${decodeURIComponent(path.basename(dir))}`);
      await ses.clearStorageData();
      await ses.clearCache();
    }
  }

  /**
   * Opens a new panel; the host UI docks it. Returns its instance id. A module with panel types opens
   * the type asked for, or its continuing type.
   */
  private openModule(
    moduleId: string,
    options: { openedFrom?: { instanceId: string; background: boolean }; panelType?: string; launch?: PanelLaunch } = {},
  ): string | void {
    const { openedFrom } = options;
    const game = this.game;
    const module = this.modules.get(moduleId);
    if (!game || !module || !this.supportsGame(module, game.id)) return;
    const types = panelTypes(module.manifest);
    const panelType = options.panelType ?? continuingPanelType(module.manifest) ?? undefined;
    if (panelType !== undefined && !types.some((type) => type.id === panelType)) throw new WorkspaceError("error.panelTypeGone");
    const records = this.records(game.id);
    if (records.length >= LAYOUT_LIMITS.panels) {
      throw new WorkspaceError("error.panelLimit", { max: LAYOUT_LIMITS.panels });
    }
    const record: InstanceRecord = { instanceId: randomUUID(), moduleId, ...(panelType ? { panelType } : {}) };
    records.push(record);
    if (openedFrom) this.openedFrom.set(record.instanceId, openedFrom);
    this.launches.set(record.instanceId, options.launch ?? { reason: "add" });
    this.saveWorkspace();
    this.createView(record, game, performance.now());
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
   * A module asked to open a web address (links.open, already checked): a new tab in the game's
   * newest Browser panel, or in that panel itself while it is still empty, or in a new Browser panel.
   */
  private openLinkFromModule(url: string): void {
    const game = this.game;
    if (!game) return;
    try {
      const browserId = this.records(game.id)
        .map((record) => record.instanceId)
        .reverse()
        .find((id) => this.views.get(id) instanceof BrowserPanel);
      if (browserId) {
        const panel = this.browser(browserId);
        if (panel.blank) panel.restore(url);
        else this.openBrowserTab(browserId, url, false);
      } else {
        // Nothing to open it in yet: the player picks a new Browser panel or the system browser.
        this.pendingLink = url;
      }
    } catch (error) {
      // The workspace is full; the player is told, as for Add module.
      if (error instanceof WorkspaceError) this.notice = error.message;
      else throw error;
    } finally {
      this.pushState();
    }
  }

  /** The player's answer to pendingLink. The address is the one the host kept, never one sent with the answer. */
  private chooseLink(choice: "panel" | "system" | "cancel"): void {
    const url = this.pendingLink;
    this.pendingLink = null;
    if (!url || choice === "cancel" || !isWebUrl(url)) return;
    if (choice === "system") {
      void shell.openExternal(url).catch((error: unknown) => console.error("[tavora]", error));
      return;
    }
    const id = this.openModule(BROWSER_MODULE_ID);
    if (id) this.browser(id).restore(url);
  }

  /** A panel whose type is gone becomes another type of the same module, and starts. */
  private choosePanelType(instanceId: string, panelType: string): void {
    const game = this.game;
    const record = game && this.records(game.id).find((item) => item.instanceId === instanceId);
    if (!game || !record) throw new WorkspaceError("error.panelClosed");
    if (this.panelTypeOf(record) !== undefined) return;
    const module = this.modules.get(record.moduleId);
    if (!module || !panelTypes(module.manifest).some((type) => type.id === panelType)) throw new WorkspaceError("error.panelTypeGone");
    record.panelType = panelType;
    this.saveWorkspace();
    this.createView(record, game, performance.now());
  }

  private closePanel(instanceId: string): void {
    const game = this.game;
    if (!game) return;
    const workspace = this.gameWorkspace(game.id);
    const index = workspace.instances.findIndex((record) => record.instanceId === instanceId);
    if (index < 0) return;
    workspace.instances.splice(index, 1);
    workspace.layout = pruneLayout(workspace.layout, (id) => id !== instanceId);
    this.saveWorkspace();
    this.closeView(instanceId);
  }

  /** Removes a panel's view and its UI state; module settings and documents stay. */
  private closeView(instanceId: string): void {
    this.openedFrom.delete(instanceId);
    this.launches.delete(instanceId);
    this.destroyView(instanceId);
    this.panelBounds.delete(instanceId);
    void this.data.panelState.remove(instanceId).catch((error: unknown) => console.error("[tavora]", error));
  }

  // ── Browser ──────────────────────────────────────────────────────────

  private browser(instanceId: string): BrowserPanel {
    const view = this.views.get(instanceId);
    if (!(view instanceof BrowserPanel)) throw new WorkspaceError("error.panelClosed");
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
        // Only the page's own http or https address, and only on the player's click.
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
    for (const view of this.views.values()) if (view instanceof BrowserPanel) view.siteSettingsChanged();
  }

  /** Built once: every browser session shares the ad blocker and the lookups. */
  private sessionHooks(): BrowserSessionHooks {
    return (this.browserHooks ??= {
      userAgent: browserUserAgent(process.platform, process.versions.chrome ?? "0"),
      ads: Host.adBlocker(),
      topUrlOf: (id) => (id === undefined ? null : (this.browsersByContents.get(id)?.topUrl ?? null)),
      adblockOn: (topUrl) => !this.isSiteListed("adblockOff", topUrl),
      onAdBlocked: (id) => id !== undefined && this.browsersByContents.get(id)?.adBlocked(),
      onDownloadRefused: (contents) => contents && this.browsersByContents.get(contents.id)?.downloadRefused(),
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

  /** The operating system's key store, for the sign-ins Tavora keeps (Discord, the Tavora account). */
  private static encryptor(options: HostOptions): Encryptor {
    const test = options.discord;
    // Test machines have no keyring; Linux's plain-text fallback stands in there (and only there).
    if (test && process.platform === "linux") safeStorage.setUsePlainTextEncryption(true);
    return {
      // Linux without a keyring falls back to a fixed key, which protects nothing; Tavora then saves no sign-in.
      isAvailable: () =>
        safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || test !== undefined || safeStorage.getSelectedStorageBackend() !== "basic_text"),
      encrypt: (text) => safeStorage.encryptString(text),
      decrypt: (data) => safeStorage.decryptString(data),
    };
  }

  // ── Account ──────────────────────────────────────────────────────────

  private static accountClient(options: HostOptions, language: () => Language, profile: AccountClientOptions["profile"], onChange: (view: AccountView) => void): AccountClient {
    const file = path.join(options.userData, "account.json");
    const encryptor = Host.encryptor(options);
    return new AccountClient({
      enabled: options.accounts === true,
      baseUrl: options.accountUrl ?? options.apiUrl ?? DEFAULT_API_URL,
      fetch: (input, init) => fetch(input, init),
      os: deviceOs(process.platform),
      language,
      canKeepSignIn: () => encryptor.isAvailable(),
      load: () => loadAccount(file, encryptor),
      save: (account) => saveAccount(file, encryptor, account),
      profile,
      onChange,
      discordLogin: () =>
        discordLogin({
          language,
          ...(options.discordAuthorizeUrl ? { authorizeUrl: options.discordAuthorizeUrl } : {}),
          // The player's own browser; a test follows the pretend page itself.
          open: options.discordAuthorizeUrl ? async (url) => void (await fetch(url)) : (url) => shell.openExternal(url),
        }),
    });
  }

  // ── Discord ──────────────────────────────────────────────────────────

  private static discordConnector(options: HostOptions, onChange: (view: ReturnType<DiscordConnector["view"]>) => void): DiscordConnector {
    const file = path.join(options.userData, "discord.json");
    const test = options.discord;
    const encryptor = Host.encryptor(options);
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

  private browserSessionFor(kind: BrowserKind, gameId: string) {
    return browserSession(browserPartition(kind, gameId), this.sessionHooks());
  }

  /** Deletes the Browser's cookies, logins, storage and caches: the current game's, or the ones shared by all games. */
  private async clearBrowserData(scope: "game" | "shared"): Promise<void> {
    const game = this.game;
    if (scope === "game" && !game) throw new LibraryError("error.openGameFirst");
    const ses = this.browserSessionFor(scope, game?.id ?? "");
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    for (const view of this.views.values()) if (view instanceof BrowserPanel) view.reload();
  }

  // ── Layouts and snapshots ────────────────────────────────────────────

  private currentWorkspace(): GameWorkspace {
    const game = this.game;
    if (!game) throw new WorkspaceError("error.openGameFirst");
    return this.gameWorkspace(game.id);
  }

  private saveLayout(layout: SavedLayout | null): void {
    const workspace = this.currentWorkspace();
    const open = new Set(workspace.instances.map((record) => record.instanceId));
    workspace.layout = pruneLayout(layout, (id) => open.has(id));
    this.saveWorkspace();
  }

  /** Rearranges the open panels into a template's slots, in the order they are laid out now. */
  private applyLayoutTemplate(template: LayoutTemplate | undefined): void {
    if (!template) throw new WorkspaceError("error.templateGone");
    const workspace = this.currentWorkspace();
    const laidOut = layoutPanels(workspace.layout);
    const rest = workspace.instances.map((record) => record.instanceId).filter((id) => !laidOut.includes(id));
    workspace.layout = templateLayout(template, [...laidOut, ...rest]);
    this.layoutEpoch++;
    this.saveWorkspace();
  }

  private snapshot(snapshotId: string): Snapshot {
    const found = this.currentWorkspace().snapshots.find((snapshot) => snapshot.id === snapshotId);
    if (!found) throw new WorkspaceError("error.layoutGone");
    return found;
  }

  private snapshotName(name: string, except?: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new WorkspaceError("error.layoutNeedsName");
    const taken = this.currentWorkspace().snapshots.some(
      (snapshot) => snapshot.id !== except && snapshot.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
    );
    if (taken) throw new WorkspaceError("error.layoutTaken", { name: trimmed });
    return trimmed;
  }

  /** The current layout as a snapshot body: placeholders named after the panels they came from. */
  private captureLayout(): Pick<Snapshot, "layout" | "modules" | "panelTypes" | "savedAt"> {
    const workspace = this.currentWorkspace();
    const layout = workspace.layout;
    const panels = layoutPanels(layout);
    if (!layout || panels.length === 0) throw new WorkspaceError("error.layoutNeedsModule");
    const recordOf = new Map(workspace.instances.map((record) => [record.instanceId, record]));
    const panelTypes = Object.fromEntries(panels.flatMap((id) => (recordOf.get(id)!.panelType ? [[id, recordOf.get(id)!.panelType!]] : [])));
    return {
      layout: structuredClone(layout),
      modules: Object.fromEntries(panels.map((id) => [id, recordOf.get(id)!.moduleId])),
      panelTypes,
      savedAt: new Date().toISOString(),
    };
  }

  private saveSnapshot(name: string): string {
    const workspace = this.currentWorkspace();
    if (workspace.snapshots.length >= MAX_SNAPSHOTS) {
      throw new WorkspaceError("error.layoutLimit", { max: MAX_SNAPSHOTS });
    }
    const snapshot: Snapshot = { id: randomUUID(), name: this.snapshotName(name), ...this.captureLayout() };
    workspace.snapshots.push(snapshot);
    this.saveWorkspace();
    return snapshot.id;
  }

  private updateSnapshot(snapshotId: string): void {
    Object.assign(this.snapshot(snapshotId), this.captureLayout());
    this.saveWorkspace();
  }

  private renameSnapshot(snapshotId: string, name: string): void {
    this.snapshot(snapshotId).name = this.snapshotName(name, snapshotId);
    this.saveWorkspace();
  }

  private deleteSnapshot(snapshotId: string): void {
    const workspace = this.currentWorkspace();
    workspace.snapshots = workspace.snapshots.filter((snapshot) => snapshot.id !== this.snapshot(snapshotId).id);
    this.saveWorkspace();
  }

  /**
   * Replaces the open panels with the snapshot's. Panels of the same module
   * are reused, the rest are closed; module data is never touched.
   */
  private applySnapshot(snapshotId: string): void {
    const game = this.game!;
    const snapshot = this.snapshot(snapshotId);
    const workspace = this.gameWorkspace(game.id);
    const plan = planSnapshot(snapshot, workspace.instances, randomUUID);
    for (const record of plan.close) this.closeView(record.instanceId);
    const existing = new Set(workspace.instances.map((record) => record.instanceId));
    workspace.instances = plan.instances;
    workspace.layout = plan.layout;
    this.layoutEpoch++;
    this.saveWorkspace();
    for (const record of plan.instances) {
      if (existing.has(record.instanceId)) continue;
      this.launches.set(record.instanceId, { reason: "add" });
      this.createView(record, game);
    }
  }

  // ── Views ────────────────────────────────────────────────────────────

  private openCurrentGame(): void {
    const game = this.game;
    if (!game) return;
    for (const record of this.records(game.id)) this.createView(record, game);
    this.layoutEpoch++;
    if ([...this.views.values()].some((view) => view instanceof ModuleView)) {
      this.endOpening();
      this.opening = { startedAt: performance.now(), timer: setTimeout(() => this.endOpening(true), OPENING_CAP_MS) };
    }
  }

  /** The game has opened once the host UI placed its panels and every visible module page has its data. */
  private openingDone(): boolean {
    if (this.panelBounds.size === 0) return false;
    for (const instanceId of this.panelBounds.keys()) {
      const view = this.views.get(instanceId);
      if (view instanceof ModuleView && !view.revealed) return false;
    }
    return true;
  }

  /** Ends the wait for a game's panels; `show` places them and tells the host UI, which takes its loading cover away. */
  private endOpening(show = false): void {
    if (!this.opening) return;
    clearTimeout(this.opening.timer);
    const took = performance.now() - this.opening.startedAt;
    this.opening = null;
    if (!show) return;
    timings.record("game-open", took);
    this.applyBounds();
    this.pushState();
  }

  /** openedAt is when the player asked for the panel; its time to a loaded page is measured from there. */
  private createView(record: InstanceRecord, game: TavoraGame, openedAt?: number): void {
    if (record.moduleId === BROWSER_MODULE_ID) return this.createBrowser(record, game);
    const panelType = this.panelTypeOf(record);
    // Its type is gone: the slot says so and offers another type; nothing runs.
    if (panelType === undefined) return;
    let measured = openedAt === undefined;
    const module = this.modules.get(record.moduleId)!;
    const view = new ModuleView({
      instanceId: record.instanceId,
      module,
      panelType,
      game,
      data: this.data.get(module.owner, module.manifest.id, game.id),
      panelState: this.data.panelState,
      hostVersion: app.getVersion(),
      preload: this.options.modulePreload,
      devTools: this.options.devTools,
      getTheme: () => this.currentTheme,
      getLanguage: () => this.language,
      baseCss: (moduleCss ??= moduleBaseCss(MODULE_FONTS)),
      ...(this.options.moduleStorageLimit === undefined ? {} : { storageLimit: this.options.moduleStorageLimit }),
      onStorageOver: () => void this.purgeModuleStorage(module.manifest.id, game.id),
      onReveal: () => this.applyBounds(),
      onOpenLink: (url) => this.openLinkFromModule(url),
      showMenu: (menu) => this.showModuleMenu(record.instanceId, menu),
      launch: () => this.launchOf(record),
      setContent: (content) => this.setPanelContent(record, content),
      openPanel: (type, content) => this.openRelatedPanel(record, type, content),
      networkHosts: () => this.networkHostsOf(record.moduleId),
      connectors: () => this.connectorsOf(record.moduleId),
      appSettings: this.data.appSettings(module.owner, module.manifest.id),
      aiUsage: { accounts: () => this.aiUsage.accountInfos(), read: (accountId) => this.aiUsage.read(accountId) },
      discord: this.discord,
      ...(this.options.testNetworkHosts ? { testHosts: this.options.testNetworkHosts } : {}),
      onStatus: (status) => {
        if (!measured && status === "ready") {
          measured = true;
          timings.record("panel-open", performance.now() - openedAt!);
        }
        this.pushStateSoon();
      },
    });
    const contentsId = view.webContentsId;
    this.views.set(record.instanceId, view);
    this.viewsByContents.set(contentsId, view);
    view.view.webContents.once("destroyed", () => this.viewsByContents.delete(contentsId));
    this.watchShortcuts(view.view.webContents);
    // Hidden and paused until the host UI says where the panel goes.
    view.view.setVisible(false);
    view.suspend();
    this.window.contentView.addChildView(view.view);
  }

  /**
   * Why a panel's page is loading (panel.getLaunch): added just now, opened by another panel, or open before with
   * what it last showed. A new panel keeps its reason until its page first asks.
   */
  private launchOf(record: InstanceRecord): PanelLaunch {
    const launch = this.launches.get(record.instanceId);
    if (launch) {
      this.launches.delete(record.instanceId);
      return launch;
    }
    return { reason: "restore", content: record.content ? { ...record.content } : null };
  }

  /**
   * panels.open from a panel, after its click was taken (the decision log, named panels rounds 2, 3, 5 and 6): one
   * of the module's own panel types, in the game shown now. A panel of that type already showing the content comes
   * to the front; else the one used last is asked to switch, saving first; else a new panel opens. A switch that
   * fails leaves that panel as it was, and the player is asked whether to open the content in a new panel.
   */
  private async openRelatedPanel(from: InstanceRecord, type: string, content: PanelContent | null): Promise<PanelOpenResult> {
    const game = this.game;
    const module = this.modules.get(from.moduleId);
    if (!game || !module || !this.records(game.id).includes(from)) throw new HostError("PERMISSION_DENIED", "panels.open works only in the game shown now");
    const target = panelTypes(module.manifest).find((item) => item.id === type);
    if (!target) throw new HostError("INVALID_PARAMS", `this module has no panel type "${type}"`);
    const others = this.records(game.id)
      .map((record, order) => ({ record, order, view: this.views.get(record.instanceId) }))
      .filter(
        (item): item is { record: InstanceRecord; order: number; view: ModuleView } =>
          item.record !== from && item.record.moduleId === from.moduleId && item.record.panelType === type && item.view instanceof ModuleView,
      )
      // The one used last first; of panels nobody used, the newest.
      .sort((a, b) => b.view.usedAt - a.view.usedAt || b.order - a.order);
    const showing = content ? others.find((item) => item.record.content?.id === content.id) : others[0];
    if (showing) {
      this.showPanel(showing.record.instanceId);
      return "shown";
    }
    const last = others[0];
    if (last && content) {
      const outcome = await last.view.navigate(content);
      // The player may have left the game while the panel saved.
      if (this.game?.id !== game.id || !this.records(game.id).includes(last.record)) return "failed";
      if (outcome === "switched") {
        this.showPanel(last.record.instanceId);
        return "switched";
      }
      if (outcome === "failed") {
        this.pendingNavigation = { gameId: game.id, moduleId: from.moduleId, panelType: type, panelName: target.name, content };
        this.pushState();
        return "failed";
      }
      // The page takes no navigation: a new panel shows the content instead.
    }
    return this.openPanelOn(from.moduleId, type, content) ? "opened" : "failed";
  }

  /** A new panel of a module's panel type, told it was opened on `content`; false when the workspace is full. */
  private openPanelOn(moduleId: string, panelType: string, content: PanelContent | null): boolean {
    try {
      return this.openModule(moduleId, { panelType, launch: { reason: "open", content } }) !== undefined;
    } catch (error) {
      // The workspace is full; the player is told, as for Add module.
      if (error instanceof WorkspaceError) this.notice = error.message;
      else throw error;
      return false;
    } finally {
      this.pushState();
    }
  }

  /** The player's answer to pendingNavigation. */
  private chooseNavigation(choice: "new-panel" | "cancel"): void {
    const pending = this.pendingNavigation;
    this.pendingNavigation = null;
    if (pending && choice === "new-panel" && this.game?.id === pending.gameId) this.openPanelOn(pending.moduleId, pending.panelType, pending.content);
    else this.pushState();
  }

  /** Brings a panel to the front of its dock group; it counts as used. */
  private showPanel(instanceId: string): void {
    const view = this.views.get(instanceId);
    if (view instanceof ModuleView) view.usedAt = Date.now();
    this.window.webContents.send("host:shortcut", `panel:${instanceId}`);
  }

  /** What a panel shows now (panel.setContent, checked by the bridge); its tab's hover text says it. */
  private setPanelContent(record: InstanceRecord, content: PanelContent | null): void {
    if (content?.id === record.content?.id && content?.title === record.content?.title) return;
    if (content) record.content = content;
    else delete record.content;
    this.saveWorkspace();
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

  private createBrowser(record: InstanceRecord, game: TavoraGame): void {
    const { instanceId } = record;
    const panel: BrowserPanel = new BrowserPanel({
      instanceId,
      devTools: this.options.devTools,
      background: () => this.currentTheme.tokens.background,
      sessionFor: (kind) => this.browserSessionFor(kind, game.id),
      isSharedSite: (url) => this.isSiteListed("sharedSites", url),
      adblockOn: (url) => !this.isSiteListed("adblockOff", url),
      swap: (previous, next) => {
        if (previous) {
          this.browsersByContents.delete(previous.webContents.id);
          this.window.contentView.removeChildView(previous);
        }
        const id = next.webContents.id;
        this.browsersByContents.set(id, panel);
        next.webContents.once("destroyed", () => this.browsersByContents.get(id) === panel && this.browsersByContents.delete(id));
        this.watchShortcuts(next.webContents);
        this.window.contentView.addChildView(next);
        if (previous) this.applyBounds();
      },
      onAddress: (url) => {
        if (this.views.get(instanceId) !== panel) return;
        void this.data.panelState.set(instanceId, { url }).catch((error: unknown) => console.error("[tavora]", error));
      },
      onOpenTab: (url, background) => {
        try {
          this.openBrowserTab(instanceId, url, background);
        } catch (error) {
          // The workspace is full; the player is told the same as for Add module.
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
    this.views.set(instanceId, panel);
    panel.attach();
    // The page the panel showed last time opens again.
    void this.data.panelState.get(instanceId).then(
      (saved) => this.views.get(instanceId) === panel && panel.restore((saved as { url?: unknown } | null)?.url),
      () => undefined,
    );
  }

  /** Sends Tavora's own shortcuts to the host UI, from the host page and from module panels. */
  private watchShortcuts(contents: WebContents): void {
    contents.on("before-input-event", (event, input) => {
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
  private async purgeModuleStorage(moduleId: string, gameId: string): Promise<void> {
    const key = `${moduleId}@${gameId}`;
    if (this.purging.has(key)) return;
    this.purging.add(key);
    try {
      const views = [...this.views.values()].filter((view): view is ModuleView => view instanceof ModuleView && view.moduleId === moduleId);
      const ses = views[0]?.view.webContents.session;
      // The renderers must be gone first: one still writing would fill the storage
      // again, and a crash reported after the reload would leave the panel crashed.
      await Promise.all(views.map((view) => view.stop()));
      // Said before the clearing, which can take a few seconds; the panels already show they stopped.
      const name = this.modules.get(moduleId)?.manifest.name ?? moduleId;
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

  private destroyView(instanceId: string): void {
    this.closeModuleMenu(instanceId);
    const view = this.views.get(instanceId);
    if (!view) return;
    this.views.delete(instanceId);
    this.viewsByContents.delete(view.webContentsId);
    this.browsersByContents.delete(view.webContentsId);
    this.window.contentView.removeChildView(view.view);
    view.dispose();
  }

  private closeAllViews(): void {
    this.endOpening();
    for (const instanceId of [...this.views.keys()]) this.destroyView(instanceId);
    this.panelBounds.clear();
  }

  private forEachView(fn: (view: ModuleView | BrowserPanel) => void): void {
    for (const view of this.views.values()) fn(view);
  }

  /** Takes the visible panels' positions from the host UI. Panels it leaves out are hidden. */
  private setPanelBounds(raw: unknown): void {
    if (!Array.isArray(raw) || raw.length > LAYOUT_LIMITS.panels) return;
    const { width, height } = this.window.getContentBounds();
    const bounds = new Map<string, Rect>();
    for (const item of raw as Partial<Rect & { instanceId: unknown }>[]) {
      const id = item?.instanceId;
      if (typeof id !== "string" || !INSTANCE_ID.test(id) || !this.views.has(id)) continue;
      const numbers = [item.x, item.y, item.width, item.height];
      if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) continue;
      const x = Math.min(Math.round(item.x!), width);
      const y = Math.min(Math.round(item.y!), height);
      const rect = { x, y, width: Math.min(Math.round(item.width!), width - x), height: Math.min(Math.round(item.height!), height - y) };
      if (rect.width > 0 && rect.height > 0) bounds.set(id, rect);
    }
    this.panelBounds = bounds;
    this.applyBounds();
  }

  /**
   * Places every view where the host UI showed it. Panels in a background
   * tab are hidden and paused, as are all panels while the window is.
   */
  private applyBounds(): void {
    if (this.opening && this.openingDone()) return this.endOpening(true);
    for (const [instanceId, view] of this.views) {
      const rect = this.panelBounds.get(instanceId);
      if (rect) view.setBounds(rect);
      // A module page stays hidden until it has its data, so switching games does not show it building itself;
      // while a game opens, every panel waits for the others.
      view.setVisible(rect !== undefined && !this.overlay && !this.opening && (!(view instanceof ModuleView) || view.revealed));
      if (rect && !this.windowHidden) view.resume();
      else view.suspend();
    }
  }

  /**
   * While a menu, dialog or drag is over the workspace, module views (which
   * are drawn above the host page) are hidden. The host UI first gets a still
   * image of each, so the workspace looks the same underneath.
   */
  private async setOverlay(open: boolean): Promise<void> {
    if (open === this.overlay) return;
    this.overlay = open;
    const change = ++this.overlayChanges;
    if (!open) return this.applyBounds();
    const images: Record<string, string> = {};
    await Promise.all(
      [...this.views].map(async ([instanceId, view]) => {
        if (!this.panelBounds.has(instanceId) || view.status !== "ready" || (view instanceof ModuleView && !view.revealed)) return;
        if (view instanceof BrowserPanel && !view.capturable) return;
        const image = await Promise.race([
          view.view.webContents.capturePage().catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), FREEZE_TIMEOUT_MS)),
        ]);
        if (image && !image.isEmpty()) images[instanceId] = `data:image/jpeg;base64,${image.toJPEG(85).toString("base64")}`;
      }),
    );
    if (change !== this.overlayChanges || this.window.isDestroyed()) return;
    this.window.webContents.send("host:frozen", images);
    this.forEachView((view) => view.setVisible(false));
  }

  // ── Module menus ─────────────────────────────────────────────────────

  /** The module menu the host UI shows now (ui.showMenu), and how to answer the module. */
  private moduleMenu: { requestId: number; instanceId: string; choices: ReadonlySet<string>; resolve(id: string | null): void } | undefined;
  private moduleMenuRequests = 0;

  /**
   * Draws a module's menu in the host UI, over its panel and every other one. Only one at a time: a
   * new one closes the last. Nothing is shown for a panel that is hidden or under a host menu or dialog.
   */
  private showModuleMenu(instanceId: string, menu: CheckedMenu): Promise<string | null> {
    if (!this.views.has(instanceId) || !this.panelBounds.has(instanceId) || this.overlay || this.window.isDestroyed()) return Promise.resolve(null);
    this.closeModuleMenu();
    const requestId = ++this.moduleMenuRequests;
    return new Promise((resolve) => {
      this.moduleMenu = { requestId, instanceId, choices: menu.choices, resolve };
      // The menu is drawn by the host page, so the keyboard goes there while it is open.
      this.window.webContents.focus();
      const shown: ModuleMenu = { requestId, instanceId, ...menu.request };
      this.window.webContents.send("host:module-menu", shown);
    });
  }

  /** The player chose an item or closed the menu. Only an item the module offered (and did not disable) counts. */
  private answerModuleMenu(raw: unknown): void {
    const answer = (typeof raw === "object" && raw !== null ? raw : {}) as { requestId?: unknown; id?: unknown };
    const open = this.moduleMenu;
    if (!open || answer.requestId !== open.requestId) return;
    this.moduleMenu = undefined;
    open.resolve(typeof answer.id === "string" && open.choices.has(answer.id) ? answer.id : null);
    // The keyboard goes back to the panel, so an action such as Rename can take it.
    const view = this.views.get(open.instanceId);
    if (view instanceof ModuleView && !view.view.webContents.isDestroyed()) view.view.webContents.focus();
  }

  /** Closes the module menu shown now (only if it belongs to `instanceId`, when given), as if nothing was chosen. */
  private closeModuleMenu(instanceId?: string): void {
    const open = this.moduleMenu;
    if (!open || (instanceId !== undefined && open.instanceId !== instanceId)) return;
    this.moduleMenu = undefined;
    open.resolve(null);
    if (!this.window.isDestroyed()) this.window.webContents.send("host:module-menu", null);
  }

  // ── State ────────────────────────────────────────────────────────────

  private supportsGame(module: InstalledModule, gameId: string): boolean {
    const { games, workspaces } = module.manifest;
    const entry = this.library.games[gameId];
    // A workspace belongs to no game: only modules for any game that did not opt out go there.
    if (entry?.kind === "workspace") return games.length === 0 && workspaces !== false;
    const catalogId = entry?.catalogId;
    return games.length === 0 || games.includes(gameId) || (catalogId != null && games.includes(catalogId));
  }

  /** The game's own icon as an address, with the version of its file so a replaced file shows at once, and how it sits in its tile. */
  private ownIcon(game: GameEntry): { steamIcon: string | null; steamIconTone: IconTone | null } {
    if (!(this.library.steamIcons && game.useOriginalIcon && game.iconFile)) return { steamIcon: null, steamIconTone: null };
    const dir = this.steamIconDir;
    return {
      steamIcon: `${STEAM_ICON_URL}${game.iconFile}?v=${iconVersion(dir, game.iconFile)}`,
      steamIconTone: (this.toneReader ??= createToneReader(dir, loadSmallBitmap))(game.iconFile),
    };
  }

  private toneReader: ((file: string) => IconTone) | undefined;

  private gameView(game: GameEntry): GameView {
    return {
      id: game.id,
      kind: game.kind,
      name: game.name,
      icon: game.icon.kind === "image" ? { kind: "image", url: ICON_URL + game.icon.file } : game.icon,
      ...this.ownIcon(game),
      iconChoice: game.icon.kind === "image" ? "image" : game.useOriginalIcon ? "original" : "letters",
      shareIcon: ((file) => (file ? STEAM_ICON_URL + file : null))(this.shareableFile(game)),
      builtIn: game.catalogId !== null,
      addedAt: game.addedAt,
      lastPlayedAt: game.lastPlayedAt,
    };
  }

  private viewState(): HostViewState {
    const library = this.library;
    const game = this.game;
    const workspace = game ? this.gameWorkspace(game.id) : emptyGameWorkspace();
    const games: Record<string, GameView> = {};
    for (const entry of Object.values(library.games)) {
      if (entry.trashedAt === null) games[entry.id] = this.gameView(entry);
    }
    return {
      screen: this.screen,
      currentGameId: game?.id ?? null,
      library: {
        games,
        folders: structuredClone(library.folders),
        root: sortedRoot(library),
        favorites: [...library.favorites],
        recent: recentGames(library, 8).map((entry) => entry.id),
        trash: trashedGames(library).map((entry) => ({
          game: this.gameView(entry),
          trashedAt: entry.trashedAt!,
          purgeAt: purgeDate(entry).toISOString(),
        })),
        sort: library.sort,
        startup: library.startup,
        grayscaleText: library.grayscaleText,
        onlineSearch: library.onlineSearch,
        autoUpdate: library.autoUpdate,
        steamIcons: library.steamIcons,
        moduleIcons: library.moduleIcons,
        steamProfile: library.steamProfile,
        onboarded: library.onboarded,
        rail: { ...library.rail },
        browser: { sharedSites: [...library.browser.sharedSites], adblockOff: [...library.browser.adblockOff] },
      },
      modules: [...this.modules.values()].map((module) => ({
        id: module.manifest.id,
        name: module.manifest.name,
        description: module.manifest.description ?? null,
        available: game !== null && this.supportsGame(module, game.id),
        minWidth: module.manifest.viewport.minWidth,
        minHeight: module.manifest.viewport.minHeight,
        panels: panelTypes(module.manifest).map((type) => ({
          id: type.id,
          name: type.name,
          icon: this.moduleInfo.get(module.manifest.id)?.panelIcons[type.id] ?? null,
          minWidth: type.viewport.minWidth,
          minHeight: type.viewport.minHeight,
        })),
        provenance: module.provenance,
        development: isDevelopmentModule(module.manifest.id) || module.developmentFolder !== undefined,
        version: module.manifest.version,
        origin: this.moduleInfo.get(module.manifest.id)?.origin ?? { kind: "dev" as const, folder: "" },
        removable: this.moduleInfo.get(module.manifest.id)?.removable ?? false,
        publisher: this.publisherOf(module),
        publisherName: ((key) => (key ? this.publisherNames.name(key) : null))(this.publisherOf(module)),
        localDataWaiting: this.localDataWaiting(module),
        icon: this.moduleInfo.get(module.manifest.id)?.icon ?? null,
        permissions: {
          asks: { network: [...module.manifest.permissions.network], connectors: [...(module.manifest.permissions.connectors ?? [])] },
          granted: this.grants.allowed(module),
          missing: this.grants.missing(module),
        },
        usedIn: this.gamesUsing(module.manifest.id),
        notes: this.notesView(module),
      })),
      moduleProblems: this.moduleProblems.filter((problem) => !problem.developmentFolder).map(({ folder, message }) => ({ folder, message })),
      developmentFolders: this.library.developmentFolders.map((folder) => {
        const own = this.moduleProblems.find((item) => item.developmentFolder === folder && !item.developmentProject);
        const projects = new Map<string, { project: string; moduleId: string | null; problem: string | null; kind: NonNullable<ModuleProblem["kind"]> | null }>();
        for (const module of this.modules.values()) {
          if (module.developmentFolder === folder && module.developmentProject) {
            projects.set(module.developmentProject, { project: module.developmentProject, moduleId: module.manifest.id, problem: null, kind: null });
          }
        }
        for (const item of this.moduleProblems) {
          if (item.developmentFolder !== folder || !item.developmentProject || projects.has(item.developmentProject)) continue;
          projects.set(item.developmentProject, { project: item.developmentProject, moduleId: null, problem: item.message, kind: item.kind ?? null });
        }
        return {
          folder,
          problem: own?.message ?? null,
          kind: own?.kind ?? null,
          projects: [...projects.values()].sort((a, b) => a.project.localeCompare(b.project)),
        };
      }),
      leftoverModuleData: this.moduleData
        .filter((entry) => this.modules.get(entry.moduleId)?.owner !== entry.owner)
        .map((entry) => ({ ...entry, publisher: entry.owner === LOCAL_OWNER || entry.owner === OFFICIAL_OWNER ? null : entry.owner })),
      panels: workspace.instances.map((record) => {
        const view = this.views.get(record.instanceId);
        const type = this.panelTypeOf(record);
        const name = type?.name ?? this.modules.get(record.moduleId)!.manifest.name;
        const panelType = record.panelType ?? null;
        const openedFrom = this.openedFrom.get(record.instanceId);
        if (type === undefined) return { instanceId: record.instanceId, moduleId: record.moduleId, panelType, name: record.panelType ?? name, status: "unavailable" as const, content: null };
        const content = record.content?.title ?? null;
        if (!(view instanceof BrowserPanel)) return { instanceId: record.instanceId, moduleId: record.moduleId, panelType, name, status: view?.status ?? "loading", content };
        const browser = view.state;
        // A Browser tab is named after its page, like a browser tab.
        const title = (browser.title || browser.host).trim().slice(0, 80);
        return { instanceId: record.instanceId, moduleId: record.moduleId, panelType, name: title || name, status: view.status, content: null, browser, ...(openedFrom ? { openedFrom } : {}) };
      }),
      layout: workspace.layout,
      layoutEpoch: this.layoutEpoch,
      opening: this.opening !== null,
      pendingLink: this.pendingLink,
      pendingNavigation: this.pendingNavigation && { panel: this.pendingNavigation.panelName, content: this.pendingNavigation.content.title },
      moduleFiles: { folder: this.files.root(), custom: this.files.custom, available: this.files.available, moving: this.files.moving },
      snapshots: workspace.snapshots.map(({ id, name, savedAt }) => ({ id, name, savedAt })),
      notice: this.notice,
      profile: {
        name: this.profile.name,
        initials: this.profile.initials,
        pictureUrl: this.profile.picture ? PROFILE_URL + this.profile.picture : null,
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
    return resolveLanguage(this.library.language, this.options.systemLocale ?? app.getLocale());
  }

  private appearanceView(): AppearanceView {
    const { theme, variation } = this.currentChoice();
    // Official themes first, the default leading, then the player's own by name.
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
    if (!this.window.isDestroyed()) this.window.webContents.send("host:state", this.viewState());
  }

  private statePush: ReturnType<typeof setImmediate> | undefined;

  /** Pushes the state once for a burst of changes, such as every panel of a game that just opened loading at once. */
  private pushStateSoon(): void {
    this.statePush ??= setImmediate(() => this.pushState());
  }

  private enqueue(write: () => Promise<void>, what: string): void {
    this.saving = this.saving.then(write).catch((error: unknown) => console.error(`[tavora] could not save ${what}`, error));
  }

  private saveLibrary(): void {
    const body = JSON.stringify(this.library, null, 2);
    this.enqueue(() => writeFileAtomic(path.join(this.options.userData, "library.json"), body), "library");
  }

  /** Queues the write like the others, and also tells the caller whether it landed. */
  private saveProfile(): Promise<void> {
    const body = JSON.stringify(this.profile, null, 2);
    const write = this.saving.then(() => writeFileAtomic(path.join(this.options.userData, "profile.json"), body));
    this.saving = write.catch((error: unknown) => console.error("[tavora] could not save profile", error));
    return write;
  }

  private saveWorkspace(): void {
    const snapshot = structuredClone(this.workspace);
    this.enqueue(() => saveWorkspace(path.join(this.options.userData, "workspace.json"), snapshot), "workspace");
  }

  private saveWindowSoon(): void {
    clearTimeout(this.windowSaveTimer);
    this.windowSaveTimer = setTimeout(() => this.saveWindow(), 1000);
  }

  private saveWindow(): void {
    clearTimeout(this.windowSaveTimer);
    if (this.window.isDestroyed()) return;
    const state: WindowState = { bounds: this.window.getNormalBounds(), maximized: this.window.isMaximized() };
    this.enqueue(() => writeFileAtomic(path.join(this.options.userData, "window.json"), JSON.stringify(state)), "window");
  }

  /** Resolves once pending writes are on disk. */
  flush(): Promise<void> {
    return this.saving;
  }
}

/**
 * Serves the trusted host UI, plus game icons and the profile picture the player picked, and blocks
 * all network for the host renderer. With a dev server, the host UI comes
 * from there instead, and only that server is reachable.
 */
async function registerHostProtocol(rendererDir: string, imageDirs: Record<string, string>, devServer?: string): Promise<void> {
  const root = devServer ? null : await realpath(rendererDir);
  // Pictures the player picked, each folder under its own URL prefix.
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
