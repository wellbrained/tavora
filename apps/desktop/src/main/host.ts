import { ReadOnlyFiles } from './read-only-files';
import { ChosenFolders, folderHost, type FolderHost, type FolderPlaces } from './folder-access';
import { showInBackground, windowLook, type WindowStart } from "./background-window";
import { saveDialogDirectory } from './save-dialog-folder';
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import { appendFile, mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { allowsPersonalWorkspaces, continuingPanelType, folderKey, isModuleId, OFFICIAL_PINS, officialOn, panelTypes, translateManifest, withGamePanelType, type ModuleManifest } from "@tavora/module-schema";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  nativeImage,
  nativeTheme,
  powerMonitor,
  protocol,
  screen,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Referrer,
  type WebContents,
  type WebContentsView,
} from "electron";
import type { TavoraWorkspace } from "@tavora/sdk/protocol";
import type { AccountView, ActionResult, AiUsageView, BrowserCommand, CatalogListResult, CatalogPageResult, CatalogReviewsResult, DeveloperLink, InstalledGameView, LegalPage, LicenceList, ModulePageResult, WorkspaceView, HostViewState, OnlineSearchResult, PanelPlacement, ReleaseStatus, Screen, SteamLibraryResult, SteamShareResult, UnlistedGame } from "../shared/host-api";
import { MAX_PICKER_COVERS } from "../shared/host-api";
import { isForWorkspaceGame } from "./workspace-game";
import { resolveLanguage, translate, type Language } from "../shared/i18n";
import { ownKeys } from "./own-keys";
import { suggestPrefix } from "../shared/id-prefix";
import { isVoicePaused } from "../shared/discord-voice";
import { UserError } from "./messages";
import { UndoGoneError, UndoShelf } from "./undo-shelf";
import { WorkspaceLibrary } from "./workspace-library";
import { PanelDialogs } from "./panel-dialogs";
import { PanelQuestions } from "./panel-questions";
import { UserProfile } from "./user-profile";
import { ModuleBoards } from "./module-boards";
import { buildReport, errorLog, timings } from "./diagnostics";
import { popularGames } from "./catalog";
import { readLicences } from "./licences";
import { legalPageUrl } from "../shared/legal-links";
import { gridTemplate, layoutTemplate } from "../shared/layout-templates";
import { parseAction, runAction, type ActionHandlers } from "./actions";
import { contentTypeFor, HOST_CSP, HOST_SCHEME, resolveAsset } from "./assets";
import { migrateModuleData, holdLeftovers, orphanedPartitions, partitionWorkspace } from "./module-data";
import { AI_USAGE_MODULE_ID, DISCORD_MODULE_ID, movedModule, MOVED_MODULES_OWNER, moveOfficialModules } from "./moved-modules";
import { checkZipData, recoverInstalls } from "./installer";
import { Installed, loadInstalledModules, type InstalledModules } from "./installed-modules";
import { sameOwner, settlePanelOwner } from "./module-owner";
import { PendingQuestions } from "./pending-questions";
import { createOverlayServices } from "./overlay-wiring";
import { installedNotes } from "./module-notes";
import { ModuleNotesSeen } from "./module-notes-seen";
import { GrantStore } from "./grants";
import { ModuleLeftovers } from "./module-leftovers";
import { ModuleLifecycle } from "./module-lifecycle";
import { ModulePanels, panelTypesOf } from "./module-panels";
import { ModulesFolder } from "./modules-folder";
import { DevelopmentFolders } from "./development-folders";
import { ModuleCatalog } from "./module-catalog";
import type { TestHosts } from "./network";
import { holdOwnPort } from "./own-ports";
import { shortcutFor } from "./shortcuts";
import { INSTANCE_ID } from "./ids";
import { panelOverflow, type PanelOverflow } from "./panel-overflow";
import { recordCrash } from "./crash-log";
import { LAYOUT_LIMITS } from "./layout";
import type { Profile } from "./profile";
import {
  createFolder,
  deleteFolder,
  undeleteFolder,
  isLive,
  LibraryError,
  liveWorkspaces,
  markOpened,
  openedTimes,
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
  searchCatalog,
  setFolderLabel,
  setRail,
  sortedRoot,
  trashedWorkspaces,
  type WorkspaceEntry,
  type Library,
} from "./library";
import { fontStylesheet } from "./module-fonts";
import { setOverlayFont } from "./overlay-font";
import { moduleBaseCss } from "./module-style";
import { backupData, backupsDir } from "./backup";
import { hasLibrary, loadLibrary, SavedData, WORKSPACE_FILE } from "./saved-data";
import { CatalogClient } from "./catalog-client";
import { OnlineSearch } from "./online";
import { countAppUpdate } from "./usage-counts";
import { askedName, sendModuleRequest } from "./module-request";
import { PublisherNames, publisherOf } from "./publisher-names";
import { PreviewUpdater, previewCheck, UpdateManager, type UpdaterLike } from "./updates";
import { PINNED_UPDATE_KEYS } from "./update-keys";
import { checkDownloadedUpdate } from "./update-signature";
import { OfficialPublisher } from "./official-publish";
import { OfficialPublishing } from "./official-publishing";
import { OfficialKeyStore } from "./official-key-store";
import { isHostSender } from "./host-sender";
import { removeRefusedInstaller } from "./refused-update";
import { OfficialUpdates, resolveOfficialPins } from "./official-updates";
import { CATALOGUE_PUBLIC_KEY, SAFETY_REFRESH_MS, SafetyLists } from "./safety-lists";
import { fetchSteamLibrary, MAX_IMPORT_GAMES, steamLibraryView } from "./steam-import";
import { readSteamKinds } from "./steam-appinfo";
import { GameOverlays, layerBinding, toggleBinding, type PanelInfo } from "./game-overlay-service";
import { scopeForKind } from "./game-overlays";
import { OverlayLayout, type SourcePanel } from "./overlay-layout";
import { OverlayCanvas } from "./overlay-canvas";
import { PICTURES_FOLDER } from "./layout-pictures";
import { parseLayoutMessage } from "../shared/layout-view";
import { OverlayPreviews } from "./overlay-previews";
import { GameWatcher, unlistedToOffer } from "./game-watch";
import { moveToWorkspaces } from "./workspace-move";
import { Streaming } from "./streaming";
import { unpackedPath } from "./unpacked";
import { findInstalledGames, type InstalledGame } from "./launcher-games";
import { GamesSeen } from "./games-seen";
import { gameKey } from "./installed-list";
import { findSteamDir, isSteamAppId, loadAppInfo } from "./steam-icons";
import { CLOSE_CAP_MS, documentsFolder, exportsFolder, ModuleView, picturesFolder, REVEAL_CAP_MS } from "./module-view";
import { HostError } from "./errors";
import { Appearance } from "./appearance";
import { FileDialogs } from "./file-dialogs";
import { GameIcons } from "./game-icons";
import { loadAdBlocker, type AdBlocker } from "./browser-filter";
import { isPrivateUrl, isWebUrl, siteOfUrl } from "./browser-url";
import { defaultFilesRoot } from "./module-files";
import { ModuleFilesFolder } from "./module-files-folder";
import { BrowserPanel, browserPartition, browserSession, browserUserAgent, type BrowserKind, type BrowserSessionHooks } from "./browser-view";
import { BROWSER_MODULE_ID, isExampleModule, panelsWait, waitingModules, type InstalledModule, type ModuleInfo, type ModuleProblem } from "./registry";
import { DataRegistry, PanelStateStore } from "./storage";
import {TooltipWindow} from "./tooltip-window";
import { ToastView } from "./toast-view";
import { AI_USAGE_VERSION, AiUsageConnector } from "./ai-usage";
import { checkSavedFile, onUnreadableFileKept, unreadableFilesKept } from "./json";
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


import { CopySync, type CopySyncOptions } from "./cloud-copy-sync";
import { Inbox } from "./inbox";
import { thisDeviceName } from "./device-name";
import { AccountClient, deviceOs, linkCommand, loadAccount, saveAccount, type AccountClientOptions } from "./account";
import { discordLogin } from "./discord-login";
import { loadDiscordSecrets, saveDiscordSecrets, type Encryptor } from "./discord-store";
import { PurgeCount, viewsInSession } from "./storage-purge";
import {
  discoverThemes,
  type InstalledTheme,
  type ThemeHint,
  type ThemeProblem,
} from "./themes";
import { discoverStyles } from "./styles";
import { sweepWriteLeftovers, writeFileAtomic } from "./fsutil";
import {
  emptyWorkspace,
  Workspaces,
  noteOwners,
  settlePanelTypes,
  WorkspaceError,
  type InstanceRecord,
  type WorkspaceState,
} from "./workspace";
import type { PanelContent, PanelLaunch } from "./panel-content";
import type { PanelOpenManyResult, PanelOpenResult } from "@tavora/sdk/protocol";
import { openManySlots } from "../shared/panel-layout";
import { initialBounds, MIN_SIZE, type WindowState } from "./window-state";
import { WindowFrame } from "./window-frame";
import { layoutKey, OpenTimes, PanelCover } from "./panel-cover";
import { clampRect, PanelViews, type PanelViewAdapter } from "./panel-views";
import { withGameInstanceId, WithGamePanels, type WithGameModule } from "./with-game";

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
/** How long closing or quitting waits for the host page to send what it has not saved yet (Host.pageSaved). */
const PAGE_SAVE_CAP_MS = 1000;
/** How long after the last move of the window's edge the panels come back, when the system never says the resize ended. */
const WINDOW_RESIZE_END_MS = 1000;
/** The pages Settings > Development links to. */
const DEVELOPER_LINKS: Record<DeveloperLink, string> = {
  docs: "https://docs.mytavora.app/guide/getting-started",
  discussions: "https://github.com/wellbrained/tavora/discussions",
  issue: "https://github.com/wellbrained/tavora/issues/new?template=module-developer.yml",
};

/** The command that starts a module project, which the developer onboarding copies. */
const CREATE_MODULE_COMMAND = "npm create @tavora/module";

/** The user's own modules, next to the themes folder in their data folder. */
function userModulesDir(options: HostOptions): string {
  return path.join(options.userData, "modules");
}

/** The modules folder as module roots name it (they are real paths). */
async function realUserModulesDir(options: HostOptions): Promise<string> {
  return realpath(userModulesDir(options)).catch(() => path.resolve(userModulesDir(options)));
}


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
  /** Styles that ship with Tavora (styles/ in the repo). Left out, only Classic, as written in code. */
  officialStyleDirs?: string[];
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
  /** Tests only: the games installed on this PC for the Add a game list, instead of looking at the launchers. */
  testInstalled?: InstalledGame[] | undefined;
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

/** The same for every module page; the font and the colours come in stylesheets of their own. */
const MODULE_CSS = moduleBaseCss();

/** A saved icon as a 32 px bitmap (blue, green, red, alpha), or null when it cannot be read. */
function loadSmallBitmap(file: string): Uint8Array | null {
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? null : image.resize({ width: 32, height: 32, quality: "good" }).toBitmap();
}

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
  official: OfficialUpdates;
  grants: GrantStore;
  connection: ConnectionWatcher;
  systemInfo: SystemMonitorThread;
  openTimes: OpenTimes;
  /** Tavora's emblem for the cover's fire, read once. */
  emblem: string | null;
  /** The design styles found at start (styles.ts). */
  styles: Awaited<ReturnType<typeof discoverStyles>>;
}

export class Host {
  private readonly data: DataRegistry;
  /** Every open panel's native view, place, visibility and clean-up (panel-views.ts). */
  private readonly panels = new PanelViews({
    mount: (adapter) => this.window.contentView.addChildView(adapter.view as WebContentsView),
    unmount: (adapter) => this.window.contentView.removeChildView(adapter.view as WebContentsView),
    windowSize: () => this.window.getContentBounds(),
    windowHidden: () => this.windowHidden,
    asking: (instanceId) => this.panelQuestions.asking(instanceId),
    releasing: (instanceId, forget) => {
      this.tooltips.close(instanceId);
      this.panelDialogs.closeMenu(instanceId);
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
    // The in-game layer shows a panel of a workspace that isn't shown in a view made for it (no Browser panel goes there).
    openForGame: (instanceId, workspaceId) => {
      const record = this.recordOf(instanceId, workspaceId);
      const entry = this.library.workspaces[workspaceId];
      if (record && entry && record.moduleId !== BROWSER_MODULE_ID) this.createView(record, { id: entry.id, displayName: entry.name, kind: entry.kind });
    },
    lending: (instanceId) => {
      this.tooltips.close(instanceId);
      this.panelDialogs.closeMenu(instanceId);
    },
    returned: () => {
      this.pushStateSoon();
      this.panelDialogs.openPending();
    },
    dialogClosed: (instanceId) => this.panelDialogs.closed(instanceId),
    dialogDrawn: (instanceId) => this.panelDialogs.drawn(instanceId),
    openingEnded: (ended) => this.openingEnded(ended),
    placing: () => this.tooltips?.ensureVisible(),
    overlayOpening: () => {
      this.tooltips.close();
      // The dialog has to be seen; the panels' pictures stand in for them, so the cover goes.
      this.cover.cancel();
    },
    frozen: (changes, awaited) => this.window.webContents.send("host:frozen", changes, awaited),
    frozenOnScreen: () => this.frozenOnScreen(),
    overlayReady: (seq) => this.window.webContents.send("host:overlay-ready", seq),
    windowGone: () => this.window.isDestroyed(),
    shownAgain: (views) => this.logDraws(views, "dialog closed"),
    ...(timingLog ? { log: timingLog } : {}),
  });
  /** Every open question to the user: link, navigation, game switch, connector, leaderboard, waiting panel dialog and module menu (pending-questions.ts). */
  private readonly questions = new PendingQuestions();
  /** A module's menus and a panel shown big in its dialog, drawn by the host page over the panels (panel-dialogs.ts). */
  private readonly panelDialogs = new PanelDialogs({
    questions: this.questions,
    panels: this.panels,
    page: {
      send: (channel, payload) => this.window.webContents.send(channel, payload),
      focus: () => this.window.webContents.focus(),
      focused: () => this.window.isFocused(),
      gone: () => this.window.isDestroyed(),
    },
    describe: (module) => ({ title: this.shown(module.manifest).name, icon: this.moduleInfo.get(module.manifest.id)?.icon ?? null }),
    closeTooltips: (instanceId) => this.tooltips?.close(instanceId),
    focusPanel: (instanceId) => {
      const view = this.moduleView(instanceId);
      if (view && !view.view.webContents.isDestroyed()) view.view.webContents.focus();
    },
    inShownWorkspace: (instanceId) => !!this.workspaceId && this.records(this.workspaceId).some((record) => record.instanceId === instanceId),
    fromGame: {
      workspaceOf: (instanceId) => ((workspaceId) => (workspaceId && isLive(this.library, workspaceId) ? workspaceId : null))(this.gameOverlays.panelWorkspace(instanceId)),
      bringBack: (workspaceId) => {
        // From Home or the Overlay page too: no workspace counts as shown there.
        if (this.workspaceId !== workspaceId) this.openWorkspace(workspaceId);
        this.gameOverlays.endLayer();
        this.bringToFront();
      },
    },
  });
  /** How to put back what the user deleted a moment ago (a layout, a folder, a workspace), while its toast offers Undo. */
  private readonly undos = new UndoShelf();
  /** What every browser session is made safe with; built when the first Browser panel opens. */
  private browserHooks: BrowserSessionHooks | undefined;
  /** The third-party licences, read the first time Settings asks (licences()). */
  private licenceList: LicenceList | null | undefined;
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
  /** The data modules keep, by owner: what uninstalled ones left, an unsigned copy's for its signed version (module-leftovers.ts). */
  private readonly moduleLeftovers: ModuleLeftovers;
  /** Which installed modules' patch notes the user has read (module-notes-seen.ts). */
  private readonly notesSeen: ModuleNotesSeen;
  /** Settings > Modules' folder: installing a zip, opening the folder or one that doesn't load (modules-folder.ts). */
  private readonly modulesFolder: ModulesFolder;
  /** What the user granted each module (grants.ts); loaded before any module panel opens. */
  private readonly grants: GrantStore;
  /** The catalog's signed safety lists (revoked keys, blocked zips, successions). */
  private readonly safetyLists: SafetyLists;
  /** Tavora's own modules downloaded from the catalogue (official-updates.ts); off while the pins are empty. */
  private readonly official: OfficialUpdates;
  /** Publishing built-in modules from a dev build (official-publishing.ts). */
  private readonly officialPublishing: OfficialPublishing;
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
  /** The panels running with their game (with-game.ts): they follow the games running, whatever "When a game starts" says. */
  private readonly withGame = new WithGamePanels({
    ready: () => this.panelPages.step === "running" && !this.windowClosed,
    isGameWorkspace: (id) => isLive(this.library, id) && this.library.workspaces[id]!.kind === "game",
    modules: () => this.withGameModules(),
    fits: (module, workspaceId) => {
      const installed = this.modules.get(module.moduleId);
      return installed !== undefined && this.supportsWorkspace(installed, workspaceId);
    },
    records: (workspaceId) => this.records(workspaceId),
    shownWorkspaceId: () => this.workspace?.id ?? null,
    panels: () => this.panels,
    createView: (record, workspaceId) => {
      const entry = this.library.workspaces[workspaceId];
      if (entry && !entry.trashedAt) this.createView(record, { id: entry.id, displayName: entry.name, kind: entry.kind });
    },
    held: (moduleId, workspaceId) => this.purging.has(`${moduleId}@${workspaceId}`),
    moduleName: (moduleId) => {
      const module = this.modules.get(moduleId);
      return module ? this.shown(module.manifest).name : null;
    },
    changed: () => this.pushStateSoon(),
  });
  /** The running games not in the library, the one started last at the end (game-watch.ts). */
  private unlistedRunning: readonly UnlistedGame[] = [];
  /** When each workspace was last opened as of startup: the rail keeps this order until the next start. */
  private openedAtStart: Record<string, string> = {};
  private readonly gameWatcher = new GameWatcher({
    entries: () => liveWorkspaces(this.library),
    findInstalled: async () => findInstalledGames({ steamDir: await findSteamDir() }),
    steamKinds: async (appIds) => {
      const steamDir = await findSteamDir();
      const appInfo = steamDir ? await loadAppInfo(steamDir) : null;
      return appInfo ? readSteamKinds(appInfo, appIds) : new Map();
    },
    keyOf: gameKey,
    onSeen: (keys) => void this.gamesSeen.running(keys),
    onChange: (running, initial) => this.gamesRunning(running, initial),
    onUnlisted: (games) => {
      this.unlistedRunning = games;
      if (!this.windowClosed) this.pushStateSoon();
    },
    testSteamAppId: () => this.options.testSteamAppId,
    log: (line) => console.warn(`[tavora] ${line}`),
  });
  /** Where modules keep their pictures. */
  private readonly files: ModuleFilesFolder;
  /** The system's file dialogs, opening where the user last picked from (file-dialogs.ts). */
  private readonly fileDialogs: FileDialogs;
  /** The library's game icons, the Add a game list's icons and covers, and offering icons (game-icons.ts). */
  private readonly gameIcons: GameIcons;
  /** The user's name, initials and picture, and what goes to the account (user-profile.ts). */
  private readonly userProfile: UserProfile;
  /** The leaderboards of installed modules, and the profile card's ranks (module-boards.ts). */
  private readonly moduleBoards: ModuleBoards;
  /** The questions shown in a panel's place: access, a connector on request, leaderboards (panel-questions.ts). */
  private readonly panelQuestions: PanelQuestions;
  /** Adding, trashing, restoring and deleting workspaces with what they keep, and snapshots that change open panels (workspace-library.ts). */
  private readonly workspaceLibrary: WorkspaceLibrary;
  /** The window buttons in the theme's colours, dimmed with the page, and the window's place saved (window-frame.ts). */
  private readonly frame = new WindowFrame({
    window: () => this.window,
    colors: () => this.appearance.host.colors,
    save: (state) => this.savedData.saveWindow(state),
  });
  /** True once the window has closed. */
  private windowClosed = false;
  /** Saves the host page was asked for and has not answered yet, by number (pageSaved). */
  private readonly pageSaves = new Map<number, () => void>();
  private pageSaveSeq = 0;
  /**
   * The panels' pages as the window closes or Tavora quits: `running`; `closing` while they save what was typed just
   * before (at most CLOSE_CAP_MS); `closed`. No page starts after `running`.
   */
  private panelPages: { step: "running" } | { step: "closing" | "closed"; done: Promise<void> } = { step: "running" };
  /** True while the window is minimized or hidden. */
  private windowHidden = false;
  /** Tavora's window is behind another program (the game): it lost the focus. */
  private windowBehind = false;
  /** Covers the workspace while it opens, until every panel has drawn (panel-cover.ts). */
  private readonly cover: PanelCover;
  /** How long each workspace took to open here, so the cover knows whether to show the fire from the start. */
  private readonly openTimes: OpenTimes;
  /** Tavora's emblem for the cover's fire, read once. */
  private readonly emblem: string | null;
  /** Counts workspace openings, so the end of one that was left does not end the next. */
  private openings = 0;
  private readonly onlineSearch: OnlineSearch;
  /** Looks up the game being added (add-workspace), apart from the search box, so neither cancels the other. */
  private readonly gameLookup: OnlineSearch;
  /** When each installed game was last seen running; local only, it orders the Add a game list. */
  private readonly gamesSeen: GamesSeen;
  /** Tavora's module catalog (catalog-client.ts). */
  private readonly catalog: CatalogClient;
  /** Every workspace's panels, layout and snapshots (workspace.ts). */
  private readonly workspaces: Workspaces;
  /** Installs, updates and removes modules, and grants or takes back what they ask for (module-lifecycle.ts). */
  private readonly lifecycle: ModuleLifecycle;
  /** The panel types panels show, the panels that must ask first, and what a new look at the modules does to open panels (module-panels.ts). */
  private readonly modulePanels: ModulePanels;
  /** Settings > Development's folders, watched for new builds, and the examples copied into projects (development-folders.ts). */
  private readonly developmentFolders: DevelopmentFolders;
  /** The catalog's pages, reviews, reports and the update checks of modules installed from it (module-catalog.ts). */
  private readonly moduleCatalog: ModuleCatalog;
  /** Looks for new versions; only in an installed (packaged) app. */
  private updates: UpdateManager | null = null;
  /** The themes and styles, the user's pick and the themes the host and the panels get from it (appearance.ts). */
  private readonly appearance: Appearance;
  readonly window: BrowserWindow;
  private tooltips:TooltipWindow;
  /** Tavora's own toasts, drawn above the panels (toast-view.ts). */
  private readonly toastView: ToastView;
  /** The toast page is down for good: the host page draws the toasts itself. */
  private toastsFallback = false;

  private constructor(
    private readonly options: HostOptions,
    /** What Host.create made before the Host: they need nothing of it (see `Prepared`). */
    prepared: Prepared,
    private readonly library: Library,
    workspaces: WorkspaceState,
    private readonly profile: Profile,
    windowState: WindowState,
    themes: Map<string, InstalledTheme>,
    themeProblems: ThemeProblem[],
    themeHints: ThemeHint[],
    /** Reads and writes library.json and the other data files (saved-data.ts). */
    private readonly savedData: SavedData,
  ) {
    this.installed = prepared.installed;
    // A file of the user's set aside from now on (unreadable) reaches the host UI, which says so (keptAside).
    onUnreadableFileKept(() => this.pushStateSoon());
    this.copySync = prepared.copySync;
    this.safetyLists = prepared.safetyLists;
    this.official = prepared.official;
    this.grants = prepared.grants;
    // A version that dropped running with its game (installed while Tavora was closed, say) forgets the answer.
    void this.forgetDroppedWithGame();
    this.connection = prepared.connection;
    this.systemInfo = prepared.systemInfo;
    this.openTimes = prepared.openTimes;
    this.emblem = prepared.emblem;
    this.appearance = new Appearance({
      library,
      userData: options.userData,
      sources: { themes: Host.themeSources(options), styles: Host.styleSources(options) },
      appVersion: app.getVersion(),
      installed: { themes, themeProblems, themeHints, styles: prepared.styles.styles, styleProblems: prepared.styles.problems, styleHints: prepared.styles.hints },
      systemMode: () => Host.systemMode(options),
      openPath: (folder) => shell.openPath(folder),
      // Test runs keep the window hidden and open no file manager.
      hidden: options.hidden === true,
      applied: (changed) => this.showTheme(changed),
    });
    setOverlayFont(this.appearance.host.font);
    this.fileDialogs = new FileDialogs({
      dialogs: {
        open: (dialogOptions) => dialog.showOpenDialog(this.window, dialogOptions),
        save: (dialogOptions) => dialog.showSaveDialog(this.window, dialogOptions),
      },
      library,
      saveLibrary: () => this.saveLibrary(),
      language: () => this.language,
      documents: documentsFolder,
      pictures: picturesFolder,
    });
    this.files = new ModuleFilesFolder({
      userData: options.userData,
      defaultFolder: options.picturesFolder ?? defaultFilesRoot(options.userData),
      language: () => this.language,
      chosenFolder: () => this.library.moduleFilesFolder ?? null,
      setChosenFolder: (folder) => {
        this.library.moduleFilesFolder = folder;
        this.saveLibrary();
      },
      pick: (options) => this.fileDialogs.pick("module-files", options),
      remember: (picked) => this.fileDialogs.remember("module-files", picked),
      notify: (message) => (this.notice = message),
      changed: () => this.pushState(),
      writesDone: (timeoutMs) => this.data.blobWrites.idle(timeoutMs),
    });
    this.data = new DataRegistry(options.userData, () => this.files.root(), () => this.files.moving);
    this.onlineSearch = new OnlineSearch(options.apiUrl === undefined ? {} : { baseUrl: options.apiUrl });
    this.gameLookup = new OnlineSearch(options.apiUrl === undefined ? {} : { baseUrl: options.apiUrl });
    this.gamesSeen = new GamesSeen(path.join(options.userData, "games-seen.json"));
    this.catalog = new CatalogClient({ ...(options.apiUrl === undefined ? {} : { baseUrl: options.apiUrl }), onGames: (games) => this.moduleCatalog.learn(games) });
    this.workspaces = new Workspaces(workspaces, {
      save: (state) => this.savedData.saveWorkspace(state),
      // A workspace added back gets the panels it had, as a start would read them.
      isInstalled: (moduleId) => this.modulePanels.keepsPanels(moduleId),
    });
    this.modulePanels = new ModulePanels({
      installed: this.installed,
      load: async () => {
        const found = await Host.loadModules(this.options, this.library.developmentFolders, this.safetyLists, this.official);
        if (this.copySync.dataHeld) found.problems.push(Host.heldProblem(this.options));
        await this.moduleLeftovers.refresh();
        return found;
      },
      grants: this.grants,
      workspaces: this.workspaces,
      panels: this.panels,
      views: () => this.moduleViews(),
      panelState: this.data.panelState,
      shownWorkspace: () => this.workspace,
      start: (record, workspace, openedAt) => this.createView(record, workspace, openedAt),
      close: (instanceId) => this.closeView(instanceId),
      forgetTooltips: (moduleId) => this.tooltips?.forgetModule(moduleId),
      modulesChanged: async (restarted) => {
        // A module removed, blocked, replaced by another publisher's or updated without the connector ends its open OBS pages now.
        this.streaming?.recheckStreams();
        this.notesSeen.noteNew();
        // Panels restarted as another owner's that run behind an overlay start again now.
        if (restarted) this.syncOverlayPanels();
        // A module that came, went or changed may run with its game (or no longer): the watcher and those panels follow. A
        // version that dropped it forgets the answer first, so bringing it back asks again however it was installed.
        await this.forgetDroppedWithGame();
        this.syncGameWatcher();
        this.syncWithGame();
      },
      looked: async () => {
        await this.developmentFolders.watch();
        void this.refreshPublisherNames();
      },
      pushState: () => this.pushState(),
    });
    this.developmentFolders = new DevelopmentFolders({
      library,
      saveLibrary: () => this.saveLibrary(),
      installed: this.installed,
      dialogs: this.fileDialogs,
      language: () => this.language,
      ownPrefix: () => this.publisher.ownPrefix(),
      reload: () => this.modulePanels.reload(),
      reloadViews: (moduleId) => this.modulePanels.reloadViews(moduleId),
      changed: () => this.pushState(),
      gone: (module) => this.gameOverlays.forgetModule(module.manifest.id, module.owner),
      // Test runs keep the window hidden and open no file manager.
      openPath: options.hidden ? null : (folder) => shell.openPath(folder),
    });
    this.moduleLeftovers = new ModuleLeftovers({
      userData: options.userData,
      filesRoot: () => this.files.root(),
      installed: this.installed,
      forget: (owner, moduleId) => {
        this.data.forgetModule(owner, moduleId);
        this.streaming.forgetModule(owner, moduleId);
        this.gameOverlays.forgetModule(moduleId, owner);
      },
      clearSession: (partition) => clearSession(session.fromPartition(partition)),
      restart: () => this.options.restart(),
    });
    this.notesSeen = new ModuleNotesSeen({ library, saveLibrary: () => this.saveLibrary(), installed: this.installed });
    this.modulesFolder = new ModulesFolder({
      dir: userModulesDir(options),
      dialogs: this.fileDialogs,
      language: () => this.language,
      installFile: (file) => this.lifecycle.installFile(file),
      openPath: (dir) => shell.openPath(dir),
      problems: () => this.moduleProblems,
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
      official: this.official,
      panels: { reload: (moduleId) => this.modulePanels.reloadViews(moduleId), close: (moduleId) => this.removeModulePanels(moduleId) },
      grantsChanged: () => {
        this.syncConnection();
        // A panel allowed to run with its game starts (or stops) now, and the game watcher runs while one may.
        this.syncGameWatcher();
        this.syncWithGame();
        // An OBS page of a module that just lost the stream-overlay connector stops now, not at its next ping.
        this.streaming?.recheckStreams();
      },
      installProgress: (moduleId, percent) => {
        if (!this.window.isDestroyed()) this.window.webContents.send("host:install-progress", { moduleId, percent });
      },
      removed: (owner, moduleId) => {
        this.gameOverlays.forgetModule(moduleId, owner);
        this.previews.closeModule(moduleId, owner);
        this.tooltips?.forgetModule(moduleId);
      },
      // Test runs keep the window hidden and have no recycle bin to rely on.
      trash: (dir) => (options.hidden ? rm(dir, { recursive: true, force: true }) : shell.trashItem(dir)),
      reload: () => this.modulePanels.reload(),
      introduce: (owner) => this.publisherNames.refresh([owner]),
      log: (line) => console.warn(`[tavora] ${line}`),
    });
    this.moduleCatalog = new ModuleCatalog({
      library,
      saveLibrary: () => this.saveLibrary(),
      installed: this.installed,
      catalog: this.catalog,
      userData: options.userData,
      token: () => this.account.token(),
      waitingVersions: () => this.account.waitingVersions(),
      updates: this.lifecycle.updates,
      language: () => this.language,
      shownWorkspace: () => this.workspaceId,
      openLink: (url) => this.openLinkFromModule(url),
      // Test runs keep the window hidden and open no mail app.
      openExternal: options.hidden ? null : (url) => void shell.openExternal(url).catch((error: unknown) => console.error("[tavora]", error)),
      sendRequest: (game, installId) => sendModuleRequest({ baseUrl: serviceUrl(options.apiUrl) }, game, installId),
      notify: (message) => (this.notice = message),
      changed: () => this.pushState(),
      changedSoon: () => this.pushStateSoon(),
      checks: !options.hidden,
    });
    this.officialPublishing = new OfficialPublishing({
      packaged: app.isPackaged,
      pinsOn: officialOn(OFFICIAL_PINS),
      trust: () => new OfficialUpdates({ userData: this.options.userData, pins: { ...OFFICIAL_PINS }, safety: this.safetyLists }),
      publisher: (trust) =>
        new OfficialPublisher({
          repo: path.resolve(__dirname, "../../../.."),
          userData: this.options.userData,
          listed: async (id) => {
            try {
              return { version: (await this.catalog.details(id)).entry.version };
            } catch (error) {
              if (error instanceof UserError && error.key === "error.catalogNotListed") return null;
              throw error;
            }
          },
          trusted: (fingerprint, sha256) => trust.signerTrusted(fingerprint, sha256),
          upload: (key, zip) => this.account.uploadModule(key, zip),
          // A run that ends while the app quits (its cancel there) has no window left to tell.
          onChange: () => {
            if (!this.window.isDestroyed()) this.pushState();
          },
        }),
      keys: new OfficialKeyStore(options.userData, prepared.encryptor),
      pickKeyFile: async () => {
        const picked = await dialog.showOpenDialog(this.window, { title: translate(this.language, "dialog.tavoraKey"), properties: ["openFile"] });
        const keyFile = picked.filePaths[0];
        return picked.canceled || !keyFile ? undefined : keyFile;
      },
      language: () => this.language,
      changed: () => this.pushState(),
    });
    this.panelQuestions = new PanelQuestions({
      questions: this.questions,
      installed: this.installed,
      grants: this.grants,
      panels: this.panels,
      shownPanels: () => (this.workspaceId ? this.records(this.workspaceId) : []),
      pushState: () => this.pushState(),
    });
    this.userProfile = new UserProfile({
      profile,
      dir: path.join(options.userData, "profile"),
      pictureUrl: PROFILE_URL,
      library,
      save: () => this.saveProfile(),
      changed: () => void this.account.profileChanged(),
      pushState: () => this.pushState(),
    });
    this.discord = Host.discordConnector(options, prepared.encryptor, (view) => {
      if (!this.window.isDestroyed()) this.window.webContents.send("host:discord", view);
    });
    this.aiUsage = Host.aiUsageService(options, (view) => {
      if (!this.window.isDestroyed()) this.window.webContents.send("host:ai-usage", view);
      for (const panel of this.moduleViews()) panel.notifyAiUsageAccounts();
    });
    this.account = Host.accountClient(options, prepared.signIn, prepared.encryptor, () => this.language, { get: () => this.userProfile.data(), apply: (remote) => this.userProfile.apply(remote) }, (view) => {
      if (!this.window.isDestroyed()) this.window.webContents.send("host:account", view);
      if (this.inbox && this.inboxSignedIn !== (view.account !== null)) {
        this.inboxSignedIn = view.account !== null;
        this.inbox.accountChanged(view.account !== null);
      }
      // Which account, not only whether one: what was read for one is never shown to another.
      const accountId = view.account !== null ? prepared.signIn.id() : null;
      this.developerKeys?.accountChanged(accountId);
      this.copySync.accountChanged(accountId);
    });
    this.moduleBoards = new ModuleBoards({ installed: this.installed, account: this.account, language: () => this.language });
    this.gameIcons = new GameIcons({
      userData: options.userData,
      library,
      saveLibrary: () => this.saveLibrary(),
      pushState: () => this.pushState(),
      language: () => this.language,
      steamIcons: options.steamIcons,
      apiUrl: options.apiUrl,
      testInstalled: options.testInstalled,
      token: () => this.account.token(),
      signedOut: () => void this.account.refresh().catch(() => undefined),
      seen: () => this.gamesSeen.all(),
      shouldRun: () => !this.window.isDestroyed(),
      desktop: () => {
        try {
          return app.getPath("desktop");
        } catch {
          // Windows can't say: the usual places are still looked at.
          return undefined;
        }
      },
      smallBitmap: loadSmallBitmap,
    });
    this.workspaceLibrary = new WorkspaceLibrary({
      library,
      saveLibrary: () => this.saveLibrary(),
      workspaces: this.workspaces,
      installed: this.installed,
      fits: (module, workspaceId) => this.supportsWorkspace(module, workspaceId),
      undos: this.undos,
      userData: options.userData,
      language: () => this.language,
      lookUp: (query) => this.gameLookup.search(query),
      icons: this.gameIcons,
      dialogs: this.fileDialogs,
      gameListed: (workspaceId) => {
        if (this.gameWatcher.active) void this.gameWatcher.libraryChanged(workspaceId);
      },
      screen: {
        shown: () => this.workspaceId,
        onHome: () => this.screen === "welcome" && this.workspaceId === null,
        goHome: () => this.showScreen("welcome"),
        open: (workspaceId) => this.openWorkspace(workspaceId),
      },
      views: {
        start: (record, welcome) => {
          this.panels.setLaunch(record.instanceId, { reason: "add" });
          if (!welcome) this.panels.withholdWelcome(record.instanceId);
          this.createView(record, this.workspace!);
        },
        close: (instanceId) => this.closeView(instanceId),
        // Its data goes, so its pages don't get the moment to save that a closed panel gets.
        drop: (instanceId) => this.panels.close(instanceId, true),
      },
      panelState: this.data.panelState,
      files: this.files,
      forgotten: (workspaceId) => {
        this.data.forgetWorkspace(workspaceId);
        this.streaming.forgetWorkspace(workspaceId);
        this.gameOverlays.forgetWorkspace(workspaceId);
        this.layout.forgetWorkspace(workspaceId);
      },
      clearSession: (partition) => clearSession(session.fromPartition(partition)),
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
        // A paused key is still the account's: its modules stay its own.
        const linked = new Set(ownKeys(this.account.view()));
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
      backgroundColor: this.appearance.host.colors.background,
      titleBarStyle: "hidden",
      titleBarOverlay: this.frame.titleBar(),
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
    this.tooltips=new TooltipWindow({parent:this.window,preload:path.join(path.dirname(options.modulePreload),"tooltip.cjs"),hidden:!!options.hidden,theme:()=>this.appearance.host,language:()=>this.language,
      closed:(owner,id)=>{this.moduleView(owner)?.tooltipClosed(id);},
      source:owner=>{
        const view=this.moduleView(owner),bounds=this.panels.placeOf(owner);
        if(!view||!bounds||!this.panels.isShowing(owner))return undefined;
        const module=this.modules.get(view.moduleId);if(!module)return undefined;
        return{root:module.root,module:view.moduleId,name:this.shown(module.manifest).name,bounds};
      }});
    this.watchShortcuts(this.window.webContents);
    this.cover = new PanelCover({ parent: this.window.contentView, emblem: () => this.emblem, fontCss: (theme) => fontStylesheet(theme.font), radius: () => this.appearance.corners().cover });
    // Whatever is added to the window later (panels, the opening cover, the Overlay page) goes below the toasts.
    this.toastView = new ToastView({
      window: this.window,
      preload: path.join(path.dirname(options.hostPreload), "toasts.cjs"),
      address: options.devServer ? new URL("toasts.html", options.devServer).href : `${HOST_SCHEME}://app/toasts.html`,
      devTools: options.devTools,
      theme: () => this.appearance.host,
      language: () => this.language,
      event: (event) => {
        if (!this.window.isDestroyed()) this.window.webContents.send("host:toast-event", event);
      },
      fallback: (on) => {
        this.toastsFallback = on;
        if (!this.window.isDestroyed()) this.window.webContents.send("host:toasts-fallback", on);
      },
    });
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
      deviceName: thisDeviceName().name,
      keyKept: () => this.developerKeys.refresh(),
      onChange: (view) => {
        if (!this.window.isDestroyed()) this.window.webContents.send("host:pairing", view);
      },
      focus: () => this.bringToFront(),
      answersFile: path.join(this.options.userData, "pairing-answers.json"),
      log: (line) => console.log(`[tavora] ${line}`),
    });
    // The cloud copy started before there was a window: from here it flushes the saved data and tells the page.
    this.copySync.attach({
      // Only writes what is pending: flush() is for quitting and would close game overlays, hotkeys and the OBS server.
      flush: () => this.saveAll(),
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
    const copySync = Host.cloudCopy(options, encryptor, signIn, { root: () => (loaded ? (loaded.moduleFilesFolder ?? null) : savedFolder) ?? defaultFolder, defaultRoot: () => defaultFolder });
    await copySync.beforeLoad();
    // Temps of writes a crash or a forced quit cut off; in the background, as nothing reads them.
    void sweepWriteLeftovers(userData)
      .then((removed) => removed.length && console.warn(`[tavora] removed ${removed.length} temp file(s) left by an interrupted save`))
      .catch((error: unknown) => console.error("[tavora] removing leftover temp files failed", error));
    const savedData = new SavedData(userData);
    // A file saved by a newer Tavora (a cloud copy taken just now included) is copied aside before this one, or a move
    // below, can overwrite it.
    await savedData.keepNewerFiles();
    // Before anything reads the files (a cloud copy taken just now included): what was saved under the old names of the
    // Game → Workspace rename gets the new ones. When that fails, Tavora does not start on files it can't read.
    await moveToWorkspaces(userData, (line) => console.warn(`[tavora] ${line}`));
    const library = await savedData.loadLibrary();
    loaded = library;
    // Missing or set aside (unreadable): workspaces it doesn't list may well be the user's, so the sweep below waits.
    const libraryRead = await hasLibrary(userData);
    const safetyLists = new SafetyLists({
      file: path.join(userData, "catalog-lists.json"),
      baseUrl: serviceUrl(options.apiUrl),
      publicKey: CATALOGUE_PUBLIC_KEY,
      online: () => library.onlineSearch,
    });
    await safetyLists.load();
    const official = new OfficialUpdates({ userData, pins: resolveOfficialPins(app.isPackaged), safety: safetyLists });
    // A module update cut off between its steps is put right before any module is looked for.
    await recoverInstalls({ userData, userModules: userModulesDir(options), officialDir: official.dir, log: (line) => console.warn(`[tavora] ${line}`) }).catch((error: unknown) =>
      console.error("[tavora] recovering a module update failed", error),
    );
    const installed = new Installed(await Host.loadModules(options, library.developmentFolders, safetyLists, official), (manifest) => translateManifest(manifest, Host.languageOf(library, options)));
    const { modules, problems: moduleProblems } = installed;
    if (copySync.dataHeld) moduleProblems.push(Host.heldProblem(options));
    const { themes, problems: themeProblems, hints: themeHints } = await discoverThemes(Host.themeSources(options), app.getVersion());
    const styles = await discoverStyles(Host.styleSources(options));
    // Before any module session or store is opened (S5: data is keyed by owner and id).
    await migrateModuleData(userData, (line) => console.warn(`[tavora] ${line}`), library.moduleFilesFolder ?? defaultFilesRoot(userData), (owner, moduleId) => modules.get(moduleId)?.owner === owner).catch((error: unknown) =>
      console.error("[tavora] moving module data under its owner failed", error),
    );
    // Discord and AI Usage left Tavora for the catalog: what they saved goes with them.
    await moveOfficialModules(userData, (line) => console.warn(`[tavora] ${line}`), library.moduleFilesFolder ?? defaultFilesRoot(userData)).catch((error: unknown) =>
      console.error("[tavora] moving the data of Discord and AI Usage failed", error),
    );
    // Half of a cloud copy may be in place: the Trash is emptied once the data can be trusted again.
    const expired = copySync.dataHeld ? [] : purgeExpired(library, new Date());
    const waits = panelsWait(moduleProblems);
    // A module that left Tavora for the catalog keeps its panels while it is not installed: they offer to install it.
    const workspaces = await savedData.loadWorkspace(Object.keys(library.workspaces), (id) => modules.has(id) || waits(id) || movedModule(id) !== undefined);
    // Missing or set aside (unreadable): panels it doesn't list may well be the user's, so the sweep below waits.
    const workspaceRead = existsSync(path.join(userData, WORKSPACE_FILE));
    settlePanelTypes(workspaces, panelTypesOf(modules));
    // Panels from before their owner was noted: the owner their panel state names, else their module's now (settleOwner).
    const stamps = new Map<string, string>();
    const panelStates = new PanelStateStore(path.join(userData, "panel-state"));
    for (const workspace of Object.values(workspaces.workspaces)) {
      for (const record of workspace.instances) {
        if (record.owner !== undefined) continue;
        const stamp = await panelStates.ownerOf(record.instanceId).catch(() => null);
        if (stamp) stamps.set(record.instanceId, stamp);
      }
    }
    const ownersNoted = noteOwners(workspaces, (moduleId) => modules.get(moduleId)?.owner, (instanceId) => stamps.get(instanceId));
    const { profile, saved: profileSaved } = await savedData.loadProfile();
    // Every data file is read, nothing has written one yet: one that was lost must not go up as empty.
    await copySync.checkDataFiles();
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
      // Unpacked next to app.asar in the packaged app, like koffi which it loads (package.json's asarUnpack).
      start: () => new Worker(unpackedPath(path.join(__dirname, "system-info-worker.cjs"))),
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

    const host = new Host(options, { encryptor, signIn, copySync, installed, safetyLists, official, grants, connection, systemInfo, openTimes, emblem, styles }, library, workspaces, profile, windowState, themes, themeProblems, themeHints, savedData);
    if (ownersNoted) host.workspaces.saveSoon();
    // What the user did while a cloud copy waited is safe in a backup, or this PC's data from before an older Tavora took
    // the copy up again: they hear where.
    if (copySync.changesKeptIn) host.notice = translate(host.language, "cloudCopy.notice.keptAside", { folder: copySync.changesKeptIn });
    else if (copySync.dataKeptIn) host.notice = translate(host.language, "cloudCopy.notice.dataKeptAside", { folder: copySync.dataKeptIn });
    host.openedAtStart = openedTimes(library);
    // Before any module opens, so none sees the pictures half moved.
    await host.files.moveFromOldDefault((line) => console.warn(`[tavora] ${line}`));
    await host.moduleLeftovers.refresh();
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
    host.notesSeen.noteNew();
    // The system's light or dark setting changed (or Tavora's own native theme did, which applyTheme ignores).
    nativeTheme.on("updated", () => {
      if (host.library.followSystem) host.applyTheme();
    });
    // The id is made once and kept, so a new profile is written straight away.
    if (!profileSaved) host.saveProfile().catch(() => undefined); // logged by saveProfile
    // Browser storage of workspaces that are gone, removed before any session opens it, and the saved state of panels
    // that are gone. What a lost library or workspace file may have listed is kept (holdLeftovers).
    const orphaned = await orphanedPartitions(userData, new Set(Object.keys(library.workspaces)));
    const livePanels = new Set(Object.values(workspaces.workspaces).flatMap((workspace) => workspace.instances.map((i) => i.instanceId)));
    // The hidden panels that run with their game keep what they saved, for every game workspace and module that has one.
    for (const module of host.modules.values()) {
      if (!withGamePanelType(module.manifest)) continue;
      // Trashed game workspaces too: restoring one brings its panels back with what they saved.
      for (const entry of Object.values(library.workspaces)) if (entry.kind === "game") livePanels.add(withGameInstanceId(entry.id, module.manifest.id, module.owner));
    }
    const stalePanels = (await readdir(path.join(userData, "panel-state")).catch(() => [] as string[])).filter((name) => name.endsWith(".json") && !livePanels.has(name.slice(0, -".json".length))).map((name) => name.slice(0, -".json".length));
    const leftovers = { workspaces: new Set(orphaned.map((dir) => partitionWorkspace(dir)!)), panels: new Set(stalePanels) };
    const held = await holdLeftovers(userData, libraryRead && workspaceRead && !copySync.dataHeld, leftovers).catch(() => leftovers);
    for (const dir of orphaned) if (!held.workspaces.has(partitionWorkspace(dir)!)) await rm(dir, { recursive: true, force: true });
    await host.data.panelState.prune(new Set([...livePanels, ...held.panels]));
    for (const workspace of expired) await host.workspaceLibrary.deleteData(workspace);
    // Version 0.2.0 saved Steam covers here; they were replaced by Steam's own icons.
    await rm(path.join(userData, "steam-art"), { recursive: true, force: true });
    if (expired.length) host.saveLibrary();

    host.screen = library.startup === "last-workspace" && library.lastWorkspaceId ? "workspace" : "welcome";
    host.registerIpc();
    await host.developmentFolders.watch();
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
    host.gameIcons.lookSoon();
    host.backupSoon();
    host.moduleCatalog.startChecks();
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
      // A daily copy of data that can't be trusted yet would push a good one out.
      if (this.copySync.dataHeld) return;
      backupData({ userData: this.options.userData, moduleFiles: this.files.root(), log: (line) => console.log(`[tavora] ${line}`) }).catch((error: unknown) => console.error("[tavora] backup failed", error));
    }, 30_000).unref();
  }

  /**
   * Starts looking for new versions of Tavora: right at start, every 5 minutes, and when the computer
   * wakes up. Only an installed app does this; updates come from the feed address built into the
   * installer. pnpm dev and other unpackaged runs never look on their own: there "Check now" in
   * Settings runs a made-up update (PreviewUpdater), so the marker and its steps can be tried.
   *
   * A downloaded version installs only when Tavora's signature checks out against the keys pinned in
   * update-keys.ts (update-signature.ts); a refused installer is deleted, and Tavora goes on with its version.
   */
  private async startUpdates(): Promise<void> {
    try {
      const updater: UpdaterLike = app.isPackaged
        ? ((await import("electron-updater")).autoUpdater as unknown as UpdaterLike)
        : new PreviewUpdater(app.getVersion(), { fail: process.env.TAVORA_FAKE_UPDATE_FAIL === "1" });
      this.updates = new UpdateManager({
        updater,
        verify: app.isPackaged
          ? (info) => checkDownloadedUpdate(info, PINNED_UPDATE_KEYS, app.getVersion())
          : previewCheck(process.env.TAVORA_FAKE_UPDATE_UNSIGNED === "1"),
        // The refused installer goes, with its blockmaps (refused-update.ts).
        onRefused: (info) => removeRefusedInstaller(info, app.isPackaged),
        autoDownload: this.library.autoUpdate,
        onChange: () => this.pushState(),
        onDownloaded: (version) => {
          if (app.isPackaged && this.library.onlineSearch) void countAppUpdate({ baseUrl: serviceUrl(this.options.apiUrl) }, version);
        },
        log: (line) => this.logUpdate(line),
      });
      if (!app.isPackaged) return;
      // What electron-updater's own quit handler did (it is off): a checked version installs when Tavora quits.
      app.once("quit", (_event, exitCode) => this.updates?.installOnQuit(exitCode));
      this.updates.start();
      powerMonitor.on("resume", () => void this.updates?.check());
    } catch (error) {
      this.logUpdate(`updates are not available: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Modules that ship with Tavora, the development folders the user added, any test folders, and the user's own modules folder. */
  private static moduleSources(options: HostOptions, developmentFolders: string[]) {
    return { official: options.officialModuleDirs, development: developmentFolders, local: [...options.moduleDirs, userModulesDir(options)] };
  }

  /** The one step that finds the installed modules, at startup and on every reload. */
  private static loadModules(options: HostOptions, developmentFolders: string[], safety: SafetyLists, official: OfficialUpdates): Promise<InstalledModules> {
    return loadInstalledModules({ userData: options.userData, userModules: userModulesDir(options), sources: Host.moduleSources(options, developmentFolders), tavoraVersion: app.getVersion(), safety, official });
  }

  /** While the data can't be trusted (cloud-copy-sync.ts dataHeld), a module may only look gone: every panel waits. */
  private static heldProblem(options: HostOptions): ModuleProblem {
    return { folder: path.basename(userModulesDir(options)), path: userModulesDir(options), message: "a cloud copy is still being put in place", kind: "missing", official: true };
  }

  /** The panel may be shown in the game: its type says `inGame`, or the module without types does. */
  private canShowInGame(record: InstanceRecord): boolean {
    const type = this.modulePanels.typeOf(record);
    if (type) return type.inGame === true;
    const module = this.modules.get(record.moduleId);
    return type === null && module !== undefined && this.shown(module.manifest).inGame === true;
  }

  /** Opens one of Tavora's pages for module developers in the user's browser. The renderer names the page, never an address. */
  private openDeveloperLink(link: DeveloperLink): void {
    const url = Object.hasOwn(DEVELOPER_LINKS, link) ? DEVELOPER_LINKS[link] : undefined;
    if (url && !this.options.hidden) void shell.openExternal(url).catch((error: unknown) => console.error("[tavora]", error));
  }

  /** Opens one of Tavora's legal pages in the user's browser. The renderer names the page, never an address. */
  private openLegalPage(page: LegalPage): void {
    if (!this.options.hidden) void shell.openExternal(legalPageUrl(page, this.language)).catch((error: unknown) => console.error("[tavora]", error));
  }

  /** The third-party licences that ship with the app (scripts/licences.mjs writes them next to the main bundle at build time); null when missing. */
  private licences(): LicenceList | null {
    return (this.licenceList ??= readLicences(path.join(__dirname, "../licences/licences.json")));
  }

  /**
   * Asks the service for the newest signed safety lists (only while online features are on). A list
   * that blocks an installed module's zip stops it at once.
   */
  private async refreshSafetyLists(): Promise<void> {
    try {
      if (await this.safetyLists.refresh()) await this.modulePanels.reload();
    } catch (error) {
      console.warn("[tavora] safety lists", error);
    }
  }

  /** Asks for the developer names of the installed modules' keys (each at most once a day). Quietly: offline is fine. */
  private refreshPublisherNames(): Promise<void> {
    const keys = [...this.modules.values()].map((module) => publisherOf(module)).filter((key): key is string => key !== null);
    return this.publisherNames.refresh(keys).catch((error: unknown) => console.warn("[tavora] publisher names", error));
  }

  /** The workspaces, by id in the library, with a panel of this module. */
  private workspacesUsing(moduleId: string): string[] {
    return this.workspaces.workspacesUsing(moduleId).filter((workspaceId) => workspaceId in this.library.workspaces);
  }

  /** Removes a module's panels in every workspace; a slot left with nothing stays as an empty slot. */
  private removeModulePanels(moduleId: string): void {
    this.tooltips?.forgetModule(moduleId);
    for (const instanceId of this.workspaces.vacate(moduleId)) this.closeView(instanceId);
  }

  /** Takes a module out of the current workspace only: its panels close the same way, so the layout stays. Module data stays. */
  private removeModuleFromWorkspace(moduleId: string): void {
    const workspace = this.workspace;
    if (!workspace) return;
    for (const instanceId of this.workspaces.vacate(moduleId, workspace.id)) this.closeView(instanceId);
  }

  /** A messages action: online features must be on, and the user needs a sign-in. */
  private async inboxAction<T>(run: () => Promise<T>): Promise<T> {
    if (!this.library.onlineSearch) throw new UserError("error.catalogOff");
    if (!this.account.token()) throw new UserError("account.error.signedOut");
    return run();
  }

  private static themeSources(options: HostOptions) {
    return { official: options.officialThemeDirs, local: [path.join(options.userData, "themes"), ...(options.themeDirs ?? [])] };
  }

  /** Tavora's own styles, then the user's own from the styles folder of their data folder, like themes. */
  private static styleSources(options: HostOptions) {
    return { official: options.officialStyleDirs ?? [], local: [path.join(options.userData, "styles")] };
  }

  /** The system's light or dark setting. */
  private static systemMode(options: HostOptions): "dark" | "light" {
    if (options.systemTheme) return options.systemTheme;
    // Only while the native theme follows the system does it say what the system says.
    nativeTheme.themeSource = "system";
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }

  /** Native menus, dialogs and scrollbars: left to the system while following it, else in the theme's mode. */
  private syncNativeTheme(): void {
    nativeTheme.themeSource = this.library.followSystem && !this.options.systemTheme ? "system" : this.appearance.host.mode;
  }

  /** Shows the theme the library names, in the host window, native controls and every open module. */
  private applyTheme(): void {
    this.appearance.refresh();
  }

  /** The appearance was worked out again (Appearance `applied`): a new theme goes to the window, its native views and every open panel. */
  private showTheme(changed: boolean): void {
    this.syncNativeTheme();
    if (!changed) return;
    const { host: next, panel } = this.appearance;
    this.window.setBackgroundColor(next.colors.background);
    this.frame.recolour();
    this.toastView.refresh();
    for (const view of this.nativePanels()) view.applyTheme(view instanceof ModuleView ? panel : next);
    this.applyCorners();
    this.panels.forgetStandIns();
    // Each keeps its font when it is the same (InsertedCss), so only a new font costs a swap; overlay pages hear a new one.
    setOverlayFont(next.font);
    this.gameOverlays?.refreshFonts();
    this.previews?.refreshFonts();
  }

  /** Rounds every open panel's view, and the cover, to the corners of the style now. */
  private applyCorners(): void {
    const corners = this.appearance.corners();
    for (const view of this.nativePanels()) view.setCorners(corners);
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
      isHostSender(event, this.window.webContents.id);

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
    // The host page has saved what it still held (pageSaved).
    ipcMain.on("host:saved", (event, seq: unknown) => {
      if (!fromHost(event) || typeof seq !== "number") return;
      this.pageSaves.get(seq)?.();
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
    ipcMain.handle("host:profile-ranks", (event) => (fromHost(event) ? this.moduleBoards.ranks() : null));
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
    ipcMain.handle("host:installed-games", async (event): Promise<InstalledGameView[]> => (fromHost(event) ? this.gameIcons.installedGames().catch(() => []) : []));
    ipcMain.handle("host:game-covers", async (event, appids: unknown): Promise<Record<number, string | null>> =>
      fromHost(event) && Array.isArray(appids) && appids.length <= MAX_PICKER_COVERS && appids.every(isSteamAppId) ? this.gameIcons.covers(appids).catch(() => ({})) : {},
    );
    ipcMain.handle("host:licences", (event): LicenceList | null => (fromHost(event) ? this.licences() : null));
    // The first-run welcome's tiles: popular games the user does not have yet (one in Trash comes back when added).
    ipcMain.handle("host:popular-games", (event) =>
      fromHost(event)
        ? popularGames()
            .filter((game) => !isLive(this.library, game.id))
            .map(({ id, name }) => ({ id, name }))
        : [],
    );
    ipcMain.handle("host:search-online", async (event, query: unknown): Promise<OnlineSearchResult> => {
      if (!fromHost(event) || typeof query !== "string" || query.length > 100) return { status: "ok", games: [] };
      if (!this.library.onlineSearch) return { status: "off", games: [] };
      const result = await this.onlineSearch.search(query);
      // Games the user already has are not offered again; one in Trash is, and adding it brings that copy back.
      return { ...result, games: result.games.filter((game) => !isLive(this.library, game.id)) };
    });
    ipcMain.handle("host:browse-catalog", async (event, target?: unknown): Promise<CatalogListResult> => (fromHost(event) ? this.moduleCatalog.browse(target) : { status: "unreachable" }));
    ipcMain.handle("host:catalog-for-games", async (event): Promise<CatalogListResult> => (fromHost(event) ? this.moduleCatalog.forGames() : { status: "unreachable" }));
    ipcMain.handle("host:catalog-page", async (event, moduleId: unknown): Promise<CatalogPageResult> =>
      fromHost(event) && isModuleId(moduleId) ? this.moduleCatalog.page(moduleId) : { status: "gone" },
    );
    ipcMain.handle("host:module-page", async (event, moduleId: unknown): Promise<ModulePageResult> =>
      fromHost(event) && isModuleId(moduleId) ? this.moduleCatalog.installedPage(moduleId) : { status: "gone" },
    );
    ipcMain.handle("host:catalog-reviews", async (event, moduleId: unknown): Promise<CatalogReviewsResult> =>
      fromHost(event) && isModuleId(moduleId) ? this.moduleCatalog.reviews(moduleId) : { status: "gone" },
    );
    ipcMain.handle("host:release-statuses", async (event, copies: unknown): Promise<Record<string, ReleaseStatus> | null> => (fromHost(event) ? this.moduleCatalog.releaseStatuses(copies) : null));
    ipcMain.handle("host:catalog-icon", async (event, moduleId: unknown): Promise<string | null> => (fromHost(event) && isModuleId(moduleId) ? this.moduleCatalog.icon(moduleId) : null));
    ipcMain.handle("host:steam-library", async (event, profile: unknown): Promise<SteamLibraryResult> => {
      if (!fromHost(event) || typeof profile !== "string") return { status: "error", error: translate(this.language, "error.notUnderstood") };
      if (!this.library.onlineSearch) return { status: "error", error: translate(this.language, "error.onlineOff") };
      const result = await fetchSteamLibrary({ baseUrl: serviceUrl(this.options.apiUrl), language: this.language }, profile);
      if (result.status !== "ok") return result;
      // Kept for sharing icons without adding the games: only games the service listed can be offered.
      this.gameIcons.steamLookedUp(result.games);
      return steamLibraryView(this.library, result.games);
    });
    ipcMain.handle("host:steam-share-icons", async (event, appids: unknown): Promise<SteamShareResult> => {
      if (!fromHost(event) || !Array.isArray(appids) || appids.length > MAX_IMPORT_GAMES || !appids.every(isSteamAppId)) {
        return { status: "error", error: translate(this.language, "error.notUnderstood") };
      }
      return this.gameIcons.steamShareIcons(appids);
    });
    ipcMain.on("host:panel-bounds", (event, bounds: unknown) => {
      if (fromHost(event)) {
        this.panels.place(bounds);
        this.panelDialogs.openPending();
      }
    });
    ipcMain.on("host:workspace-bounds", (event, bounds: unknown) => {
      if (fromHost(event)) this.cover.setBounds(this.windowRect(bounds));
    });
    ipcMain.handle("host:panel-overflow", async (event, ids: unknown, since: unknown): Promise<Record<string, PanelOverflow>> => {
      if (!fromHost(event) || !Array.isArray(ids) || ids.length > LAYOUT_LIMITS.panels || !ids.every((id) => typeof id === "string" && INSTANCE_ID.test(id))) return {};
      // A panel that is not on screen has nothing to fit; a page that did not answer is left out.
      const entries = await Promise.all(
        (ids as string[]).map(async (id) => {
          const adapter = this.panels.get(id);
          return [id, adapter && this.panels.isPlaced(id) ? await panelOverflow(adapter.webContentsId, since === true ? "since" : "now") : { x: 0, y: 0 }] as const;
        }),
      );
      return Object.fromEntries(entries.filter((entry): entry is readonly [string, PanelOverflow] => entry[1] !== null));
    });
    ipcMain.on("host:toasts", (event, items: unknown) => {
      if (!fromHost(event)) return;
      this.toastView.sync(items);
      // A host page that was loaded again learns here that it still has to show the toasts itself.
      if (this.toastsFallback) event.sender.send("host:toasts-fallback", true);
    });
    ipcMain.on("host:overlay", (event, open: unknown, only: unknown, seq: unknown) => {
      if (!fromHost(event) || typeof open !== "boolean") return;
      // Only these panels step aside (a menu or hint lies over them); none named: every panel.
      const ids = Array.isArray(only) && only.length <= LAYOUT_LIMITS.panels && only.every((id) => typeof id === "string" && INSTANCE_ID.test(id)) ? (only as string[]) : undefined;
      void this.panels.freeze(open, ids, typeof seq === "number" && Number.isSafeInteger(seq) ? seq : 0);
    });
    ipcMain.on("host:overlay-prepare", (event, near: unknown) => {
      if (!fromHost(event)) return;
      // Where the menu or hint will open, to picture only the panels it could reach; none given (or not a place): every panel.
      this.panels.prepareFreeze(this.windowRect(near) ?? undefined);
    });
    ipcMain.on("host:frozen-shown", (event) => {
      if (fromHost(event)) this.frozenShown?.();
    });
    ipcMain.on("host:dialog-covered", (event, covered: unknown) => {
      if (fromHost(event) && typeof covered === "boolean") this.panels.coverDialog(covered);
    });
    ipcMain.on("host:dimmed", (event, dimmed: unknown) => {
      if (fromHost(event) && typeof dimmed === "boolean") this.frame.dim(dimmed);
    });
    ipcMain.on("host:buttons-background", (event, color: unknown) => {
      if (fromHost(event)) this.frame.setButtonsBackground(color);
    });
    ipcMain.on("host:module-menu-answer", (event, answer: unknown) => {
      if (fromHost(event)) this.panelDialogs.answerMenu(answer);
    });
    ipcMain.on("host:panel-dialog-bounds", (event, raw: unknown) => {
      if (fromHost(event)) this.panels.placeDialog(raw);
    });
    ipcMain.on("host:panel-dialog-shown", (event, instanceId: unknown) => {
      if (fromHost(event) && typeof instanceId === "string") this.panels.showDialog(instanceId);
    });
    ipcMain.on("host:panel-dialog-close", (event) => {
      if (fromHost(event)) this.panels.closeDialog();
    });
  }

  /** Tells the host page and every module panel (those not over the game) whether the window is behind another program now. */
  private setWindowBehind(behind: boolean): void {
    if (this.window.isDestroyed() || behind === this.windowBehind) return;
    this.windowBehind = behind;
    this.window.webContents.send("host:window-behind", behind);
    this.toastView.setBehind(behind);
    for (const view of this.moduleViews()) view.setWindowBehind(behind);
  }

  private registerWindowEvents(): void {
    this.window.on("resize", () => this.frame.saveSoon());
    this.window.on("move", () => this.frame.saveSoon());
    this.window.on("close", (event) => {
      this.frame.save();
      // The panels write what was typed just before first (Alt+F4 right after typing); the window closes once their pages have.
      if (this.panelPages.step !== "closed") {
        event.preventDefault();
        if (this.panelPages.step === "running") void Promise.all([this.pageSaved(), this.closePanelPages()]).then(() => !this.window.isDestroyed() && this.window.close());
        return;
      }
      // The last changes go to the cloud copy first; the window closes once they are up.
      if (this.copySync.holdClose(() => this.window.close())) event.preventDefault();
    });
    const hidden = (value: boolean) => () => {
      this.windowHidden = value;
      this.toastView.setHidden(value);
      this.panels.applyBounds();
    };
    // The host page crashed or ran out of memory: it loads again once. A second crash within a minute loads
    // the error screen instead (?crashed=, see renderer/main.ts), so a page that keeps crashing isn't a loop.
    let lastCrash = 0;
    this.window.webContents.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit" || this.window.isDestroyed()) return;
      recordCrash({ type: "host page", reason: details.reason, exitCode: details.exitCode });
      const page = new URL(this.options.devServer ?? `${HOST_SCHEME}://app/index.html`);
      if (Date.now() - lastCrash < 60_000) page.searchParams.set("crashed", `${details.reason} (exit code ${details.exitCode})`);
      lastCrash = Date.now();
      void this.window.loadURL(page.href);
    });
    // Behind the game, the window is not hidden and its panels keep running; but nobody sees a toast counting down.
    this.window.on("blur", () => this.setWindowBehind(true));
    this.window.on("focus", () => this.setWindowBehind(false));
    this.window.webContents.on("did-finish-load", () => {
      if (this.windowBehind) this.window.webContents.send("host:window-behind", true);
    });
    // Dragging the window's edge: the views can't keep up with the page's layout, so the host UI has them step aside
    // meanwhile, as for a split being dragged. Windows and macOS say when it ends; the timer is for a drag they never end.
    let resizing = false;
    let resizeEnd: ReturnType<typeof setTimeout> | undefined;
    const setResizing = (on: boolean) => {
      clearTimeout(resizeEnd);
      resizeEnd = on ? setTimeout(() => setResizing(false), WINDOW_RESIZE_END_MS) : undefined;
      // The host UI hears only a change, not every move.
      if (on === resizing) return;
      resizing = on;
      if (!this.window.isDestroyed()) this.window.webContents.send("host:window-resizing", on);
    };
    this.window.on("will-resize", () => setResizing(true));
    this.window.on("resized", () => setResizing(false));
    this.window.on("minimize", hidden(true));
    this.window.on("hide", hidden(true));
    this.window.on("restore", hidden(false));
    this.window.on("show", hidden(false));
    this.window.on("closed", () => {
      this.windowClosed = true;
      // The overlay windows (and the keys for arranging) go with the main window; they would keep Tavora running.
      this.closeOverlayWindows();
      void this.gameOverlays.shutdown().catch((error: unknown) => console.error("[tavora]", error));
      void this.closePanelPages();
      // Their pages are closing with the rest (closePanelPages waits for them); nothing runs with a game any more.
      this.withGame.clear();
      onUnreadableFileKept(null);
      this.cover.dispose();
      this.toastView.dispose();
      this.discord.dispose();
      this.systemInfo.dispose();
      this.connection.dispose();
      this.media.dispose();
      this.gameWatcher.stop();
      this.copySync.dispose();
      this.pairing.dispose();
      this.moduleCatalog.stopChecks();
      this.inbox.dispose();
      this.officialPublishing.quit();
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

  /** Packs a dev module signed with a kept key and saves the zip where the developer picks, its name suggested. */
  private async saveModuleZip(moduleId: string): Promise<string | undefined> {
    const { manifest, zip } = await this.publisher.pack(this.projectOf(moduleId));
    return this.fileDialogs.saveOwn("module-zip", { kind: "zip", name: `${manifest.id}-${manifest.version}`, data: zip });
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
    await this.developmentFolders.built(dir);
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
      const panel = this.browser(instanceId);
      // While the panel asks, the address it shows is the one asked about, not a page of the panel's.
      if (panel.asking) throw new LibraryError("error.browserAsking");
      const site = siteOfUrl(panel.state.url);
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
      // Answers with the new workspace's id, or says it was there already or came back from Trash.
      "add-workspace": (action) => this.workspaceLibrary.add(action),
      "rename-workspace": saved((action) => renameWorkspace(this.library, action.workspaceId, action.name)),
      "set-workspace-label": saved((action) => this.gameIcons.choose(action.workspaceId, { kind: "label", label: action.label })),
      "choose-workspace-image": saved((action) => this.workspaceLibrary.chooseImage(action.workspaceId)),
      "use-original-icon": saved((action) => this.gameIcons.choose(action.workspaceId, { kind: "original" })),
      "share-icons": (action) => this.gameIcons.share(action.workspaceIds),
      "share-steam-icons": (action) => this.gameIcons.shareSteam(action.appids),
      "import-steam-games": (action) => this.workspaceLibrary.importSteam(action.games),
      // Answers with the token that puts it back (undo-delete).
      "trash-workspace": (action) => this.workspaceLibrary.trash([action.workspaceId], true),
      "restore-workspace": saved((action) => this.workspaceLibrary.restore([action.workspaceId], true)),
      "delete-workspace": saved((action) => this.workspaceLibrary.delete([action.workspaceId], true)),
      // Many at once: workspaces already gone are skipped, so a list the screen showed a moment ago still works.
      "trash-workspaces": (action) => this.workspaceLibrary.trash(action.workspaceIds, false),
      "restore-workspaces": saved((action) => this.workspaceLibrary.restore(action.workspaceIds, false)),
      "delete-workspaces": saved((action) => this.workspaceLibrary.delete(action.workspaceIds, false)),
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
      "delete-folder": (action) => {
        const removed = deleteFolder(this.library, action.folderId);
        this.saveLibrary();
        return this.undos.keep(() => {
          if (!undeleteFolder(this.library, removed)) throw new UndoGoneError();
          this.saveLibrary();
        });
      },
      // Undo of a delete above (or of a layout's): the token it answered with. Forget: the toast went, the delete stays.
      "undo-delete": (action) => this.undos.undo(action.token),
      "undo-forget": (action) => this.undos.forget(action.token),
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
        // Game overlays may have kept the watcher looking while this was off: take the games running now as already running.
        if (this.gameWatcher.active) this.gamesRunning(this.gameWatcher.runningNow, true);
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
        if (action.enabled) this.gameIcons.lookSoon();
        if (action.enabled) void this.refreshSafetyLists();
      }),
      "set-auto-update": saved((action) => {
        this.library.autoUpdate = action.enabled;
        this.updates?.setAutoDownload(action.enabled);
      }),
      "set-auto-update-modules": saved((action) => {
        this.library.autoUpdateModules = action.enabled;
        // Turned on: updates that were only found so far install now.
        if (action.enabled) void this.moduleCatalog.checkUpdates();
      }),
      "set-steam-icons": saved((action) => {
        this.library.steamIcons = action.enabled;
        if (action.enabled) this.gameIcons.lookSoon();
      }),
      "set-module-icons": saved((action) => {
        this.library.moduleIcons = action.enabled;
      }),
      // The kit's TabStrip in every open panel follows it: the setting goes out with the theme.
      "set-tab-overflow": saved((action) => {
        this.library.tabOverflow = action.mode;
        this.applyTheme();
      }),
      "set-panel-style": saved((action) => {
        this.library.panelStyle = action.style;
        this.applyCorners();
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
      "connector-answer": (action) => this.panelQuestions.answerConnector(action.id, action.allow),
      "leaderboard-answer": (action) => this.panelQuestions.answerLeaderboard(action.id, action.allow),
      "set-language": saved((action) => {
        this.library.language = action.language;
        this.toastView.refresh();
        for (const view of this.nativePanels()) view.applyLanguage(this.language);
      }),
      "set-profile-ranks": saved((action) => {
        this.library.profileRanks = { hidden: action.hidden ?? this.library.profileRanks.hidden, period: action.period ?? this.library.profileRanks.period };
      }),
      "set-profile-banner": saved((action) => {
        this.library.profileBanner = action.banner;
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
      "set-theme": saved((action) => this.appearance.choose(action)),
      "set-appearance-mode": saved((action) => this.appearance.choose(action)),
      "set-radius": saved((action) => this.appearance.choose(action)),
      "set-font": saved((action) => this.appearance.choose(action)),
      "set-style": saved((action) => this.appearance.choose(action)),
      "reset-theme": saved((action) => this.appearance.choose(action)),
      "reload-themes": () => this.appearance.reload(),
      "open-themes-folder": () => this.appearance.openFolder("theme"),
      "create-starter-theme": () => this.appearance.createStarter("theme"),
      // Themes and styles load together, so one Reload finds both.
      "reload-styles": () => this.appearance.reload(),
      "open-styles-folder": () => this.appearance.openFolder("style"),
      "create-starter-style": () => this.appearance.createStarter("style"),

      // Profile
      // Resolves once it is on disk, so the host UI can say "Saved"; the account gets it after.
      "save-profile": (action) => this.userProfile.rename(action.name, action.initials),
      "set-profile-picture": (action) => this.userProfile.setPicture(action.png),
      "remove-profile-picture": () => this.userProfile.setPicture(null),

      // Modules
      "open-modules-folder": () => this.modulesFolder.open(),
      "open-module-problem-folder": (action) => this.modulesFolder.openProblem(action.path),
      "add-development-folder": () => this.developmentFolders.add(),
      "remove-development-folder": (action) => this.developmentFolders.remove(action.folder),
      "move-development-folder": (action) => this.developmentFolders.move(action.folder, action.index),
      "collapse-development-folder": (action) => this.developmentFolders.collapse(action.folder, action.collapsed),
      "copy-example": (action) => this.developmentFolders.copyExample(action.moduleId, action.name, action.folder),
      "open-example-folder": (action) => this.developmentFolders.openExample(action.moduleId),
      "official-publish-check": () => this.officialPublishing.check(),
      "publish-official-module": (action) => this.officialPublishing.prepare(action.moduleId),
      "official-publish-confirm": (action) => this.officialPublishing.confirm(action.remember),
      "official-publish-cancel": () => this.officialPublishing.cancel(),
      "official-publish-forget-key": () => this.officialPublishing.forgetKey(),
      "open-development-project": (action) => this.developmentFolders.openProject(action.project),
      "open-developer-link": (action) => this.openDeveloperLink(action.link),
      "open-legal-page": (action) => this.openLegalPage(action.page),
      "reload-modules": async () => void (await this.modulePanels.reload()),
      "remove-module": (action) => this.lifecycle.remove(action.moduleId),
      "grant-module": (action) => this.lifecycle.grant(action.moduleId, action.network, action.connectors, action.folders ?? [], action.withGame === true),
      "set-module-with-game": (action) => this.lifecycle.setWithGame(action.moduleId, action.on),
      "choose-module-folder": async (action) => {
        const module = this.modules.get(action.moduleId);
        if (!module) throw new LibraryError("error.moduleMissing");
        // The module's pages start again, so they find the folder where the user said.
        if (await this.folderHostOf(module).choose(action.folder)) this.modulePanels.reloadViews(action.moduleId);
      },
      "revoke-module": (action) => this.lifecycle.revoke(action.moduleId),
      "leaderboards-hide": (action) => this.moduleBoards.leave(action.moduleId),
      "install-module": () => this.modulesFolder.installZip(),
      "install-catalog-module": (action) => this.lifecycle.installFromCatalog(action.moduleId),
      "check-module-updates": () => this.moduleCatalog.checkUpdatesNow(),
      "ask-module": (action) => this.moduleCatalog.ask({ name: askedName(action.name), steamAppId: action.steamAppId, gameId: action.gameId }),
      "report-catalog-module": (action) => this.moduleCatalog.report(action.moduleId, { reason: action.reason, note: action.note }),
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
      "open-catalog-homepage": (action) => this.moduleCatalog.openHomepage(action.moduleId),
      "open-module-support": (action) => this.moduleCatalog.openSupport(action.moduleId, action.source),
      "open-readme-link": (action) => this.moduleCatalog.openReadmeLink(action.moduleId, action.url),
      "rate-catalog-module": (action) => this.moduleCatalog.rate(action.moduleId, action.stars, action.text),
      "unrate-catalog-module": (action) => this.moduleCatalog.unrate(action.moduleId),
      "reply-catalog-review": (action) => this.moduleCatalog.reply(action.reviewId, action.text),
      "report-catalog-review": (action) => this.moduleCatalog.reportReview(action.reviewId),
      "apply-module-update": (action) => this.lifecycle.applyUpdate(action.moduleId, action.version),
      "delete-module-data": (action) => this.moduleLeftovers.delete(action.owner, action.moduleId),
      "move-local-data": (action) => this.moduleLeftovers.moveLocal(action.moduleId),
      "seen-module-notes": (action) => this.notesSeen.seen(action.moduleId),

      // Panels and workspace
      "open-module": (action) =>
        this.openModule(action.moduleId, { ...(action.panelType ? { panelType: action.panelType } : {}), ...(action.reuse ? { reuse: true } : {}), ...(action.moreFollow ? { moreFollow: true } : {}) }),
      "choose-panel-type": (action) => this.choosePanelType(action.instanceId, action.panelType),
      "close-panel": (action) => this.closePanel(action.instanceId),
      "remove-module-from-workspace": (action) => this.removeModuleFromWorkspace(action.moduleId),
      "reload-panel": (action) => this.nativePanel(action.instanceId)?.reload(),
      "stop-panel": (action) => this.nativePanel(action.instanceId)?.stop(),
      "show-panel-in-game": (action) => this.showPanelInGame(action.instanceId),
      "stop-panel-in-game": (action) => this.gameOverlays.stopPanel(action.instanceId, action.setup),
      "save-layout": (action) => this.workspaces.saveLayout(action.workspaceId ?? this.currentWorkspaceId(), action.layout),
      "apply-layout-template": (action) => this.workspaces.applyTemplate(this.currentWorkspaceId(), layoutTemplate(action.templateId)),
      "apply-layout-grid": (action) => this.workspaces.applyTemplate(this.currentWorkspaceId(), gridTemplate(action.columns, action.rows)),
      "save-snapshot": (action) => this.workspaces.saveSnapshot(this.currentWorkspaceId(), action.name),
      "update-snapshot": (action) => this.workspaces.updateSnapshot(this.currentWorkspaceId(), action.snapshotId),
      "apply-snapshot": (action) => this.workspaceLibrary.applySnapshot(this.currentWorkspaceId(), action.snapshotId),
      "rename-snapshot": (action) => this.workspaces.renameSnapshot(this.currentWorkspaceId(), action.snapshotId, action.name),
      // Undo puts it back into the workspace it came from, whichever one is open by then.
      "delete-snapshot": (action) => this.workspaceLibrary.deleteSnapshot(this.currentWorkspaceId(), action.snapshotId),

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
        // Which account signed out, read before its sign-in goes: only its key goes with it.
        const who = this.account.accountId();
        await this.account.signOut();
        return this.copySync.signedOut(who);
      },
      "account-sign-out-device": (action) => this.account.signOutDevice(action.deviceId),
      "account-rename-device": (action) => this.account.renameDevice(action.deviceId, action.name),
      "account-email-code": (action) => this.account.sendEmailCode(action.email),
      "account-change-email": (action) => this.account.changeEmail(action.code, action.currentCode),
      "account-delete-code": () => this.account.sendDeleteCode(),
      "account-delete": async (action) => {
        const who = this.account.accountId();
        await this.account.deleteAccount(action.code);
        return this.copySync.signedOut(who);
      },
      "account-discord-sign-in": () => this.account.discordSignIn(),
      "account-discord-connect-code": () => this.account.sendConnectDiscordCode(),
      "account-discord-connect": (action) => this.account.connectDiscord(action.code),
      "account-discord-disconnect-code": () => this.account.sendDisconnectDiscordCode(),
      "account-discord-disconnect": (action) => this.account.disconnectDiscord(action.code),
      "account-email-remove-code": () => this.account.sendRemoveEmailCode(),
      "account-email-remove": (action) => this.account.removeEmail(action.code),
      "account-delete-discord": async () => {
        const who = this.account.accountId();
        await this.account.deleteWithDiscord();
        if (!this.account.view().account) await this.copySync.signedOut(who);
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
        // Paused keys count as keys: they are linked again, never replaced by a new one.
        if ((keys.status === "ready" || keys.status === "none") && !keys.keys.length && ownKeys(this.account.view()).length === 0) {
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
        // The old key may be a paused one whose file is lost (audit 2026-11-22); the new one is a key linked and working,
        // or one made for it.
        if (!ownKeys(this.account.view()).includes(action.fingerprint)) throw new UserError("account.error.keyGone");
        const linked = (this.account.view().publisherKeys ?? []).map((key) => key.fingerprint);
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
      "developer-key-add": () =>
        this.fileDialogs.openKeyFile(async (file) => {
          const text = await readFile(file, "utf8").catch(() => null);
          if (text === null || text.length > 10_000) throw new UserError("developerKeys.error.notKey");
          await this.developerKeys.add(text);
        }),
      "developer-key-export": async (action) => {
        const pem = this.developerKeys.exportKey(action.fingerprint);
        await this.fileDialogs.saveOwn("publisher-key", { kind: "pem", name: `publisher-key-${action.fingerprint.slice(0, 8)}`, data: pem });
      },
      "developer-key-link": (action) => this.developerKeys.link(action.fingerprint),
      "developer-recovery-key": (action) => this.developerKeys.enterKey(action.key),
      "developer-recovery-key-saved": () => this.developerKeys.keySaved(),
      "developer-show-recovery-key": () => this.developerKeys.showKey(),
      "developer-vault-rebuild": () => this.developerKeys.rebuildVault(),
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
      "pairing-confirm": () => this.pairing.confirm(),
      "pairing-decide": (action) => this.pairing.decide(action.id, action.allow),

      // Cloud copy
      "cloud-copy-on": () => this.copySync.turnOn(),
      "cloud-copy-on-folder": async () => {
        const folder = await this.fileDialogs.pick("cloud-copy", { properties: ["openDirectory", "createDirectory"] });
        if (!folder) return;
        await this.copySync.turnOn(folder);
        this.fileDialogs.remember("cloud-copy", folder);
      },
      "cloud-copy-move": async (action) => {
        if (action.to === "server") return this.copySync.move(null);
        const folder = await this.fileDialogs.pick("cloud-copy", { properties: ["openDirectory", "createDirectory"] });
        if (!folder) return;
        await this.copySync.move(folder);
        this.fileDialogs.remember("cloud-copy", folder);
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
      if (this.screen === "overlay" && !this.panels.has(record.instanceId) && this.modulePanels.typeOf(record) !== undefined) {
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
          if (!record || this.modulePanels.typeOf(record) === undefined || record.moduleId === BROWSER_MODULE_ID) continue;
          wanted.add(record.instanceId);
          this.panels.keepRunning(record.instanceId);
          if (!this.panels.has(record.instanceId)) this.createView(record, { id: entry.id, displayName: entry.name, kind: entry.kind });
        }
      }
    }
    // One still running with its game, shown in its workspace or over the game stays.
    for (const instanceId of this.panels.keptIds()) if (!wanted.has(instanceId)) this.panels.letGo(instanceId);
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

  /** Delete overlay (the rail, the Overlay page): answers with the token that puts the setup back (undo-delete); none when the game has no setup. */
  private removeGameSetup(workspaceId: string): string | undefined {
    const restore = this.gameOverlays.takeSetup(workspaceId);
    if (!restore) return undefined;
    return this.undos.keep(() => {
      if (!restore()) throw new UndoGoneError();
    });
  }

  /** Every panel of every workspace, for the Overlay page's Sources. */
  private overlaySources(): SourcePanel[] {
    const sources: SourcePanel[] = [];
    for (const entry of Object.values(this.library.workspaces)) {
      if (entry.trashedAt) continue;
      for (const record of this.records(entry.id)) {
        const module = this.modules.get(record.moduleId);
        const name = this.panelName(record.instanceId);
        // A paused Discord panel doesn't run (shared/discord-voice.ts), so it has nothing to show over a game.
        if (!module || !name || isVoicePaused(record.moduleId)) continue;
        sources.push({
          instanceId: record.instanceId,
          name,
          owner: module.owner,
          moduleId: module.manifest.id,
          workspaceId: entry.id,
          workspaceName: entry.name,
          scope: scopeForKind(entry.kind),
          inGame: this.modulePanels.typeOf(record) !== undefined && this.canShowInGame(record),
          sources: this.gameOverlays.sourcesOf(record.instanceId, module.owner),
        });
      }
    }
    return sources;
  }

  /** The module's panels in the workspace hear which of its game overlays are shown now (the user added or removed one on the Overlay page). */
  private tellOverGameChanged(changed: { owner: string; moduleId: string; workspaceId: string }): void {
    const module = this.modules.get(changed.moduleId);
    if (!module || module.owner !== changed.owner) return;
    const keys = this.gameOverlays.keysOf(module, changed.workspaceId);
    for (const record of this.records(changed.workspaceId)) if (record.moduleId === changed.moduleId) this.moduleView(record.instanceId)?.overGameChanged(keys);
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

  /**
   * Opens a new panel; the host UI docks it. Returns its instance id. A module with panel types opens
   * the type asked for, or its continuing type. With `reuse`, a panel of that type already open (the one
   * used last) comes to the front instead.
   */
  private openModule(
    moduleId: string,
    options: { openedFrom?: { instanceId: string; background: boolean }; panelType?: string; launch?: PanelLaunch; reuse?: boolean; instanceId?: string; placement?: PanelPlacement; moreFollow?: boolean } = {},
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
    const record: InstanceRecord = { instanceId: options.instanceId ?? randomUUID(), moduleId, ...(panelType ? { panelType } : {}) };
    this.workspaces.openPanel(workspace.id, record);
    if (this.modulePanels.needsAnswer(moduleId)) this.panels.setAwaiting(record.instanceId);
    if (openedFrom) this.panels.setOpenedFrom(record.instanceId, openedFrom);
    if (options.placement) this.panels.setPlacement(record.instanceId, options.placement);
    this.panels.setLaunch(record.instanceId, options.launch ?? { reason: "add" });
    if (options.moreFollow) this.panels.withholdWelcome(record.instanceId);
    this.createView(record, workspace, performance.now());
    return record.instanceId;
  }

  /** A new Browser tab in the same dock group as the one it was opened from; an empty one gets the address bar's focus. */
  private openBrowserTab(fromInstanceId: string, url: string | null, background: boolean, referrer?: Referrer): void {
    this.browser(fromInstanceId);
    const id = this.openModule(BROWSER_MODULE_ID, { openedFrom: { instanceId: fromInstanceId, background } });
    if (!id) return;
    if (url) this.browser(id).restore(url, referrer);
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
        .find((id) => this.panels.get(id) instanceof BrowserPanel);
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
    // Panels that run with their game start and stop with it, whatever the switch below says.
    this.withGame.gamesRunning(running);
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

  // ── Panels running with their game ───────────────────────────────────

  /** The modules allowed to run their `withGame` panel type while their game runs; none that still misses access it needs. */
  private withGameModules(): WithGameModule[] {
    const modules: WithGameModule[] = [];
    for (const module of this.modules.values()) {
      const panelType = withGamePanelType(module.manifest);
      if (!panelType || isVoicePaused(module.manifest.id) || !this.grants.allowed(module).withGame || this.modulePanels.needsAnswer(module.manifest.id)) continue;
      modules.push({ moduleId: module.manifest.id, owner: module.owner, panelType });
    }
    return modules;
  }

  /** Whether some module may run with its game, so the game watcher has to look even with game start and overlays off. */
  private withGameWanted(): boolean {
    return this.withGame.wanted();
  }

  /**
   * Starts and stops the panels that run with their game (with-game.ts): in the workspace of each library game running
   * now, the `withGame` panel of each module allowed to, for that game. Called when the running games, the grants or
   * the modules change, and with every state push (a layout changed: a panel of that type added or closed there).
   */
  private syncWithGame(): void {
    this.withGame.sync();
  }

  /**
   * Installed modules whose version no longer asks to run with their game forget the answer (grants.ts forgetWithGame),
   * at every start and module reload. Nothing shown changes: a module that doesn't ask has nothing to answer.
   */
  private async forgetDroppedWithGame(): Promise<void> {
    for (const module of this.modules.values()) {
      if (module.builtIn) continue;
      await this.grants.forgetWithGame(module).catch((error: unknown) => console.error("[tavora] forgetting a grant failed", error));
    }
  }

  /** For a module running with its game, made for one game: that game's name in the library (the one opened last), for the consent dialog. */
  private withGameName(module: InstalledModule): string | null {
    const { games } = module.manifest;
    if (games.length !== 1 || !withGamePanelType(module.manifest)) return null;
    const entries = liveWorkspaces(this.library).filter((entry) => entry.kind === "game" && isForWorkspaceGame(games, entry));
    return entries.sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""))[0]?.name ?? null;
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
    if (this.modulePanels.typeOf(record) !== undefined || isVoicePaused(record.moduleId)) return;
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

  /**
   * Removes a panel's view and its UI state; module settings and documents stay. The state goes once the page has closed:
   * until then it may still save its last state, which would bring the file back.
   */
  private closeView(instanceId: string): void {
    void this.panels
      .closeForGood(instanceId, () => this.data.panelState.remove(instanceId))
      .catch((error: unknown) => console.error("[tavora]", error));
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
      case "open-asked":
        return panel.openAsked();
      case "stay":
        return panel.stay();
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
      readText: (file) => readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : Promise.reject(error))),
      check: (file, text) => checkSavedFile(file, text, { version: AI_USAGE_VERSION }),
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
      deviceName: thisDeviceName().name,
      rawDeviceName: thisDeviceName().raw,
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
  private static cloudCopy(options: HostOptions, encryptor: Encryptor, signIn: SignIn, files: CopySyncOptions["files"]): CopySync {
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
      this.cover.start(this.appearance.host, translate(this.language, "panel.loading", { name: workspace.displayName }), this.openTimes.estimate(layout));
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
    // The window is closing or Tavora quits: no page starts any more.
    if (this.panelPages.step !== "running") return;
    // Its panel is in the in-game layer and kept running there while another workspace was shown: it comes back when the layer closes.
    if (this.panels.has(record.instanceId)) return;
    if (record.moduleId === BROWSER_MODULE_ID) return this.createBrowser(record, workspace);
    // It was added while its module still asks (PanelQuestions.of); the page starts once the user allows (reloadModuleViews).
    if (this.panels.isAwaiting(record.instanceId)) return;
    const panelType = this.modulePanels.typeOf(record);
    // Its type is gone: the slot says so and offers another type; nothing runs.
    if (panelType === undefined) return;
    let measured = openedAt === undefined;
    const module = this.modules.get(record.moduleId)!;
    this.settleOwner(record, module.owner);
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
      getTheme: () => this.appearance.panel,
      cornerRadius: () => this.appearance.corners().module,
      getLanguage: () => this.language,
      baseCss: MODULE_CSS,
      fontCss: (theme) => fontStylesheet(theme.font),
      ...(this.options.moduleStorageLimit === undefined ? {} : { storageLimit: this.options.moduleStorageLimit }),
      onStorageOver: () => {
        // A page closed while it was measured needs no clearing.
        const contents = view.view.webContents as WebContents | undefined;
        if (contents && !contents.isDestroyed()) void this.purgeModuleStorage(module.manifest.id, workspace.id, contents.session);
      },
      onReveal: () => {
        this.panels.applyBounds();
        this.pushStateSoon();
      },
      onDrawn: () => this.pushStateSoon(),
      onFocus: () => {
        // A panel panels.openMany opened takes the keyboard while its page loads; the panel that asked keeps it.
        const placement = this.panels.placement(record.instanceId);
        const anchor = placement && !this.moduleView(record.instanceId)?.revealed ? this.moduleView(placement.anchor) : undefined;
        if (anchor && !anchor.view.webContents.isDestroyed()) return anchor.view.webContents.focus();
        // Only a panel in sight can be clicked into. A page behind another tab (or still loading as its workspace
        // opens) that focuses a field or a map by itself stays where it is, or it would push the tab the user picked
        // back and the layout would save that.
        if (!this.panels.isPlaced(record.instanceId) || this.panels.opening) return;
        this.window.webContents.send("host:shortcut", `panel:${record.instanceId}`);
      },
      onOpenLink: (url) => this.openLinkFromModule(url, workspace.id),
      onNeedsTavora: () => {
        this.notice = translate(this.language, "overlays.bringBackFirst");
        this.pushState();
      },
      showMenu: (menu) => this.panelDialogs.showMenu(record.instanceId, menu),
      // Remembered by who publishes the module and its id, as its patch notes are.
      ...this.fileDialogs.forModule(`${module.owner}:${module.manifest.id}`),
      pickReadOnlyFile: async (extensions, multiple, near) => {
        const files=new ReadOnlyFiles(app.getPath('userData'),module.owner,module.manifest.id,workspace.id);
        const defaultPath=(near ? await files.directoryNear(near.file,near.up ?? 0) : undefined) ?? await saveDialogDirectory(files,this.library.workspaces[workspace.id]?.catalogId ?? workspace.id);
        const picked = await dialog.showOpenDialog(this.window, {...(defaultPath?{defaultPath}:{}),title:this.language.startsWith('de')?'Datei mit '+this.shown(module.manifest).name+' verknüpfen':'Link a file to '+this.shown(module.manifest).name,buttonLabel:this.language.startsWith('de')?'Datei verknüpfen':'Link file',properties:multiple?['openFile','multiSelections']:['openFile'],filters:[{name:this.language.startsWith('de')?'Datei auswählen':'Choose a file',extensions}]});
        return picked.canceled ? [] : multiple ? picked.filePaths : picked.filePaths.slice(0,1);
      },
      tooltip:{show:request=>this.tooltips.show(record.instanceId,request),move:anchor=>this.tooltips.move(record.instanceId,anchor.id,anchor.at,anchor.box),close:(id,hoverOnly,linger)=>this.tooltips.close(record.instanceId,id,hoverOnly,linger),defineSkin:(name,skin)=>this.tooltips.defineSkin(record.moduleId,module.root,name,skin)},
      launch: () => this.launchOf(record),
      mayWelcome: () => this.panels.takeWelcome(record.instanceId),
      // The hidden panel running with its game has no tab to name.
      setContent: (content) => (this.withGame.isHidden(record.instanceId) ? undefined : this.setPanelContent(record, content)),
      openPanel: (type, content) => this.openRelatedPanel(record, type, content),
      openPanels: async (types) => this.openPanels(record, types),
      setLive: (state) => this.gameOverlays.setLive(record.instanceId, module.owner, state),
      setMaximized: (maximized) => this.window.webContents.send("host:shortcut", `${maximized ? "maximize" : "restore"}:${record.instanceId}`),
      setDialog: (open, size, how) => (open ? this.panelDialogs.open(record.instanceId, module, size, how?.byClick ?? true) : this.panelDialogs.close(record.instanceId)),
      setDialogTitle: (title) => this.panelDialogs.setTitle(record.instanceId, title),
      // The grants of the owner this page runs as: a copy of another owner installed under the same id later has its own.
      networkHosts: () => this.networkHostsOf(module),
      connectors: () => this.connectorsOf(module),
      folders: this.folderHostOf(module),
      appSettings: this.data.appSettings(module.owner, module.manifest.id),
      appBlobs: this.data.appBlobs(module.owner, module.manifest.id),
      leaderboards: this.moduleBoards.of(module, (question) => this.panelQuestions.askLeaderboard(record.instanceId, record.moduleId, question)),
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
        setSources: (sources) => this.gameOverlays.setSources(record.instanceId, module.owner, sources, { moduleId: module.manifest.id, workspaceId: workspace.id }),
        preview: async (key) => this.previews.show({ owner: module.owner, moduleId: module.manifest.id, workspaceId: workspace.id, key }),
        openPage: () => {
          this.panelDialogs.close(record.instanceId);
          this.showOverlayPage(null);
        },
      },
      hotkeys: this.streaming.hotkeysFor(module, workspace.id),
      ...(this.options.testNetworkHosts ? { testHosts: this.options.testNetworkHosts } : {}),
      onStatus: (status) => {
        if (!measured && status === "ready") {
          measured = true;
          timings.record("panel-open", performance.now() - openedAt!);
        }
        // Out of sight with its game, a page that crashed or hangs starts again once (with-game.ts); nobody is told.
        this.withGame.status(record.instanceId, workspace.id, record.moduleId, view, status);
        this.pushStateSoon();
      },
      runsOnlyWithGame: () => this.withGame.runsOnlyWithGame(record.instanceId, workspace.id),
    });
    view.setWindowBehind(this.windowBehind);
    this.panels.open(record, () => ({
      adapter: view,
      start: () => {
        const contentsId = view.webContentsId;
        this.panels.bindContents(view, contentsId);
        view.view.webContents.once("destroyed", () => this.panels.unbindContents(view, contentsId));
        this.watchShortcuts(view.view.webContents);
        this.window.contentView.addChildView(view.view);
      },
    }));
  }

  /**
   * A panel whose module id loads for another owner than the one its page last ran as (changed while the panel was
   * closed, in a workspace not shown, or while Tavora was closed): what that owner left stays its own, as ModulePanels.reload
   * does for open panels. The content its tab named goes, and its panel state is kept apart (a file from before owners
   * were noted counts as the old owner's).
   */
  private settleOwner(record: InstanceRecord, owner: string): void {
    const { changed, from } = settlePanelOwner(record, owner);
    if (from !== null) void this.data.panelState.handOver(record.instanceId, from, owner).catch((error: unknown) => console.error("[tavora]", error));
    if (changed) this.workspaces.saveSoon();
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

  /**
   * panels.openMany from a panel, after its click was taken (the decision log, 2026-10-31 "Several panels from one click"):
   * several of the module's own panel types, each once, in the workspace shown now. A type open there already (the asking
   * panel's own, too) comes to the front where it is; the others open new, docked around the panel that asked as the
   * manifest's panelLayout says (the host UI fits it into that panel's group), else each where panels.open puts a panel.
   * The panel that asked keeps the focus; if it was in its dialog, the dialog closes first.
   */
  private openPanels(from: InstanceRecord, types: string[]): Record<string, PanelOpenManyResult> {
    const workspace = this.workspace;
    const module = this.modules.get(from.moduleId);
    if (!workspace || !module || !this.records(workspace.id).includes(from)) throw new HostError("PERMISSION_DENIED", "panels.openMany works only in the workspace shown now");
    const manifest = this.shown(module.manifest);
    const known = new Set(panelTypes(manifest).map((type) => type.id));
    const unknown = types.find((type) => !known.has(type));
    if (unknown !== undefined) throw new HostError("INVALID_PARAMS", `this module has no panel type "${unknown}"`);
    // Called from its dialog (a welcome's last step), the panel goes back in its slot first, so the layout is laid out around it.
    this.panelDialogs.close(from.instanceId);
    const result: Record<string, PanelOpenManyResult> = {};
    const shown: string[] = [];
    // The new panels' ids come first, so the layout can name them before they open.
    const fresh = new Map<string, string>();
    for (const type of types) {
      const open = type === from.panelType ? from : this.panelsOfType(workspace.id, from.moduleId, type)[0]?.record;
      if (!open) fresh.set(type, randomUUID());
      else {
        result[type] = "shown";
        if (open !== from) shown.push(open.instanceId);
      }
    }
    const placement: PanelPlacement = { id: randomUUID(), anchor: from.instanceId, slots: openManySlots(manifest.panelLayout, from.panelType, from.instanceId, fresh) };
    let full = false;
    for (const [type, instanceId] of fresh) {
      if (full) {
        result[type] = "failed";
        continue;
      }
      try {
        const opened = this.openModule(from.moduleId, { panelType: type, launch: { reason: "open", content: null }, instanceId, placement });
        result[type] = opened === undefined ? "failed" : "opened";
      } catch (error) {
        if (!(error instanceof WorkspaceError)) throw error;
        // The workspace is full; the user is told once, as for Add module.
        this.notice = error.message;
        full = true;
        result[type] = "failed";
      }
    }
    for (const instanceId of shown) {
      const view = this.moduleView(instanceId);
      if (view) view.usedAt = Date.now();
    }
    this.pushState();
    // After the state, so the host UI has docked the new panels when it gives the focus back.
    this.window.webContents.send("host:shortcut", `panels:${from.instanceId}:${shown.join(",")}`);
    return Object.fromEntries(types.map((type) => [type, result[type]!]));
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
    // A page may call this as fast as it likes: the workspace is saved and the host UI told once per burst.
    this.workspaces.saveSoon();
    this.pushStateSoon();
  }

  /**
   * Connectors a module may use now: its grant, as far as the module installed now still asks for them. None while its
   * id is installed for another owner (a development folder over a catalog copy): that copy's grants are not its own.
   */
  private connectorsOf(module: Pick<InstalledModule, "owner" | "manifest">): ReadonlySet<string> {
    const current = sameOwner(module, this.modules);
    return new Set(current ? this.grants.allowed(current).connectors : []);
  }

  /**
   * The folders of permissions.folders a module may read now (folder-access.ts): the grant is asked again on every call,
   * for the module installed now, so a revoke or an update that changed the folder takes effect at once.
   */
  private folderHostOf(module: InstalledModule): FolderHost & { granted(): boolean } {
    const current = () => sameOwner(module, this.modules);
    const allowed = (): ReadonlySet<string> => ((found) => new Set(found ? this.grants.allowed(found).folders : []))(current());
    const host = folderHost({
      folders: () => current()?.manifest.permissions.folders,
      allowed,
      chosen: new ChosenFolders(app.getPath("userData"), module.owner, module.manifest.id),
      places: () => this.folderPlaces(),
      pick: async (start, entry) => {
        const picked = await dialog.showOpenDialog(this.window, {
          ...(start ? { defaultPath: start } : {}),
          title: translate(this.language, "dialog.chooseFolder", { name: this.shown(module.manifest).name, folder: entry.path.split("/").join(path.sep) }),
          properties: ["openDirectory"],
        });
        return picked.canceled ? undefined : picked.filePaths[0];
      },
      refused: () => {
        this.notice = translate(this.language, "folders.refused");
        this.pushState();
      },
      scope: `${module.owner}/${module.manifest.id}`,
    });
    return { ...host, granted: () => allowed().size > 0 };
  }

  /**
   * Where Documents, Saved Games and AppData\LocalLow are on this PC, and the folders no module may read from
   * (folder-access.ts). Looked up when a folder call needs them, so a PC whose known folders the system can't say still
   * opens every panel.
   */
  private folderPlaces(): FolderPlaces {
    const at = (name: Parameters<typeof app.getPath>[0]): string | null => {
      try {
        return app.getPath(name);
      } catch {
        return null;
      }
    };
    const home = at("home") ?? os.homedir();
    const documents = !app.isPackaged && process.env.TAVORA_DOCUMENTS_DIR ? path.resolve(process.env.TAVORA_DOCUMENTS_DIR) : (at("documents") ?? path.join(home, "Documents"));
    const env = (name: string) => process.env[name] || null;
    const known = [at("desktop"), at("downloads"), at("pictures"), at("music"), at("videos"), env("OneDrive"), env("OneDriveConsumer"), env("OneDriveCommercial")];
    // A test run that points Documents into the temp folder (under Local AppData) keeps Local AppData open, only there.
    const testDocuments = !app.isPackaged && Boolean(process.env.TAVORA_DOCUMENTS_DIR);
    const closed = [at("appData"), testDocuments ? null : env("LOCALAPPDATA"), env("APPDATA"), env("ProgramData"), env("SystemRoot"), env("windir")];
    // Where Tavora saves for the user and for every module (key files, zips, every module's saved files and pictures,
    // the cloud copy): never a module's to read.
    const tavora = (find: () => string): string | null => {
      try {
        return find();
      } catch {
        return null;
      }
    };
    const own = [tavora(documentsFolder), tavora(picturesFolder), tavora(exportsFolder), this.files.root(), this.copySync.view().folder];
    return {
      // LocalLow has no getPath: it is the known folder LocalAppDataLow, which Windows keeps in the user's AppData.
      roots: { Documents: documents, "Saved Games": path.join(home, "Saved Games"), "AppData/LocalLow": path.join(home, "AppData", "LocalLow") },
      home,
      userData: app.getPath("userData"),
      known: known.filter((place): place is string => place !== null),
      closed: closed.filter((place): place is string => place !== null),
      own: own.filter((place): place is string => place !== null),
    };
  }

  /** Hosts a module may reach now: its grant, as far as the module installed now, of the same owner, still asks for them. */
  private networkHostsOf(module: Pick<InstalledModule, "owner" | "manifest">): ReadonlySet<string> {
    const current = sameOwner(module, this.modules);
    return new Set(current ? this.grants.allowed(current).network : []);
  }

  private createBrowser(record: InstanceRecord, workspace: TavoraWorkspace): void {
    const { instanceId } = record;
    const panel: BrowserPanel = new BrowserPanel({
      instanceId,
      devTools: this.options.devTools,
      background: () => this.appearance.host.tokens.background,
      cornerRadius: () => this.appearance.corners().page,
      sessionFor: (kind) => this.browserSessionFor(kind, workspace.id),
      isSharedSite: (url) => this.isSiteListed("sharedSites", url),
      adblockOn: (url) => !this.isSiteListed("adblockOff", url),
      swap: (previous, next) => {
        if (previous) {
          this.panels.unbindContents(panel, previous.webContents.id);
          this.window.contentView.removeChildView(previous);
        }
        const id = next.webContents.id;
        this.panels.bindContents(panel, id);
        next.webContents.once("destroyed", () => this.panels.unbindContents(panel, id));
        this.watchShortcuts(next.webContents);
        this.window.contentView.addChildView(next);
        if (previous) this.panels.applyBounds();
      },
      onAddress: (url) => {
        if (this.panels.get(instanceId) !== panel) return;
        void this.data.panelState.set(instanceId, { url }).catch((error: unknown) => console.error("[tavora]", error));
      },
      onOpenTab: (url, background, referrer) => {
        try {
          this.openBrowserTab(instanceId, url, background, referrer);
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
    this.panels.open(record, () => ({ adapter: panel, start: () => panel.attach() }));
    // The page the panel showed last time opens again.
    void this.data.panelState.get(instanceId).then(
      (saved) => this.panels.get(instanceId) === panel && panel.reopen((saved as { url?: unknown } | null)?.url),
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
  /** How often each module's storage was cleared lately, per workspace (a second time soon after leaves its panels stopped). */
  private readonly purges = new PurgeCount();

  /**
   * A module's browser storage grew past the limit (storage-guard.ts): stop its panels, clear the storage and start
   * the panels again, and say so. Cleared a second time within PURGE_WINDOW_MS, the panels stay stopped until the user
   * reloads them, so a module can't keep the disk full in a loop.
   */
  private async purgeModuleStorage(moduleId: string, workspaceId: string, ses: Electron.Session): Promise<void> {
    const key = `${moduleId}@${workspaceId}`;
    if (this.purging.has(key)) return;
    this.purging.add(key);
    try {
      // Only the panels of the session that is over: one of the module kept or lent from another workspace has its own.
      const views = viewsInSession(this.moduleViews(), moduleId, ses);
      // The renderers must be gone first: one still writing would fill the storage
      // again, and a crash reported after the reload would leave the panel crashed.
      await Promise.all(views.map((view) => view.stop()));
      // Said before the clearing, which can take a few seconds; the panels already show they stopped.
      const installed = this.modules.get(moduleId);
      const name = installed ? this.shown(installed.manifest).name : moduleId;
      const restart = this.purges.note(key);
      this.notice = translate(this.language, restart ? "modules.storageCleared" : "modules.storageStopped", { name });
      this.pushState();
      await ses.clearStorageData();
      if (restart) for (const view of views) view.reload();
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

  /** A panel's module view; undefined for a Browser panel or when it has none. */
  private moduleView(instanceId: string): ModuleView | undefined {
    const view = this.panels.get(instanceId);
    return view instanceof ModuleView ? view : undefined;
  }

  private moduleViews(): ModuleView[] {
    return this.panels.adapters().flatMap((view) => (view instanceof ModuleView ? [view] : []));
  }

  /** The module view whose page has these contents (what a page's own requests are judged by). */
  private moduleByContents(contentsId: number): ModuleView | undefined {
    const view = this.panels.byWebContents(contentsId);
    return view instanceof ModuleView ? view : undefined;
  }

  private browserPanel(instanceId: string): BrowserPanel | undefined {
    const view = this.panels.get(instanceId);
    return view instanceof BrowserPanel ? view : undefined;
  }

  private browserPanels(): BrowserPanel[] {
    return this.panels.adapters().flatMap((view) => (view instanceof BrowserPanel ? [view] : []));
  }

  /** The Browser panel whose page has these contents (what the page's requests are judged by). */
  private browserByContents(contentsId: number): BrowserPanel | undefined {
    const view = this.panels.byWebContents(contentsId);
    return view instanceof BrowserPanel ? view : undefined;
  }

  private nativePanel(instanceId: string): ModuleView | BrowserPanel | undefined {
    const view = this.panels.get(instanceId);
    return view instanceof ModuleView || view instanceof BrowserPanel ? view : undefined;
  }

  /** The GPU process went and Chromium started a new one: every page is asked to draw again and the panels are placed again, so none stays blank. */
  redrawAfterGpuLoss(): void {
    if (this.window.isDestroyed()) return;
    this.window.webContents.invalidate();
    for (const panel of this.nativePanels()) if (!panel.view.webContents.isDestroyed()) panel.view.webContents.invalidate();
    this.panels.applyBounds();
  }

  private nativePanels(): (ModuleView | BrowserPanel)[] {
    return this.panels.adapters().flatMap((view) => (view instanceof ModuleView || view instanceof BrowserPanel ? [view] : []));
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
    const viewport = this.modulePanels.typeOf(record)?.viewport ?? this.shown(module.manifest).viewport;
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
    return this.modulePanels.typeOf(record)?.name ?? this.shown(module.manifest).name;
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
    // A Browser panel can never be lent to the layer, so it doesn't stay in a setup.
    const allowed = record.moduleId !== BROWSER_MODULE_ID && (this.modulePanels.typeOf(record) === undefined || this.canShowInGame(record));
    const viewport = module && (this.modulePanels.typeOf(record)?.viewport ?? this.shown(module.manifest).viewport);
    return {
      name: this.panelName(instanceId),
      allowed,
      usedAt: this.moduleView(instanceId)?.usedAt ?? 0,
      preferred: viewport ? { width: viewport.preferredWidth, height: viewport.preferredHeight } : null,
    };
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
    for (const view of views.filter((item): item is ModuleView => item instanceof ModuleView)) {
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

  // ── Settings over the Overlay page ───────────────────────────────────

  /**
   * The Overlay page's Settings button: the panel behind the item comes up in its dialog over the page, which stays where it is
   * (the panel runs in the background while the page is open; one that does not is started quietly), and hears which thing
   * the user means (panel.onOpenSettings). A page without a handler shows the panel as it is. Closing the dialog leaves the
   * user on the Overlay page. An overlay names no panel, so the first panel of its module in that workspace is used.
   */
  private openSettingsOverOverlayPage(item: { workspaceId: string; moduleId: string; instanceId: string | null; key: string | null }): void {
    const entry = this.library.workspaces[item.workspaceId];
    if (this.window.isDestroyed() || !entry || entry.trashedAt) return;
    const record = this.records(entry.id).find((one) => (item.instanceId ? one.instanceId === item.instanceId : one.moduleId === item.moduleId));
    const module = record && this.modules.get(record.moduleId);
    if (!record || !module) return;
    if (!this.panels.has(record.instanceId)) this.createView(record, { id: entry.id, displayName: entry.name, kind: entry.kind });
    const view = this.moduleView(record.instanceId);
    if (!view) return;
    this.panelDialogs.openSettings(record.instanceId, module, view, item.key);
  }

  // ── State ────────────────────────────────────────────────────────────

  private supportsWorkspace(module: InstalledModule, workspaceId: string): boolean {
    const { games } = module.manifest;
    const entry = this.library.workspaces[workspaceId];
    // A personal workspace belongs to no game: only modules for any game that did not opt out go there.
    if (entry?.kind === "personal") return allowsPersonalWorkspaces(module.manifest);
    if (!entry) return games.length === 0 || games.includes(workspaceId);
    return isForWorkspaceGame(games, entry);
  }

  private workspaceView(workspace: WorkspaceEntry): WorkspaceView {
    return {
      id: workspace.id,
      kind: workspace.kind,
      name: workspace.name,
      ...this.gameIcons.view(workspace),
      builtIn: workspace.catalogId !== null,
      steamAppId: workspace.steamAppId,
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
        panelStyle: library.panelStyle,
        tabOverflow: library.tabOverflow,
        toasts: library.toasts,
        steamProfile: library.steamProfile,
        askedModules: [...library.askedModules],
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
        ...(this.catalogModules.has(module.manifest.id) || (this.official.on && module.shippedVersion !== undefined) ? { updatable: true as const } : {}),
        support: module.manifest.support ?? null,
        publisher: publisherOf(module),
        publisherName: ((key) => (key ? this.publisherNames.name(key) : null))(publisherOf(module)),
        localDataWaiting: this.moduleLeftovers.localWaiting(module),
        icon: this.moduleInfo.get(module.manifest.id)?.icon ?? null,
        permissions: {
          asks: {
            network: [...module.manifest.permissions.network],
            connectors: [...(module.manifest.permissions.connectors ?? [])],
            folders: (module.manifest.permissions.folders ?? []).map(folderKey),
            ...(withGamePanelType(module.manifest) ? { withGame: true } : {}),
          },
          granted: this.grants.allowed(module),
          missing: this.grants.missing(module),
        },
        ...((name) => (name ? { gameName: name } : {}))(this.withGameName(module)),
        usedIn: this.workspacesUsing(module.manifest.id),
        notes: this.notesSeen.view(module),
        update: ((pending) =>
          pending
            ? { version: pending.version, asks: { network: [...pending.asks.network], connectors: [...pending.asks.connectors], folders: [...pending.asks.folders], ...(pending.asks.withGame ? { withGame: true } : {}) }, notes: pending.notes }
            : null)(
          this.lifecycle.updates.pending(module.manifest.id),
        ),
      })),
      moduleProblems: this.moduleProblems.filter((problem) => !problem.developmentFolder && !problem.official).map(({ folder, path: full, message, kind, values }) => ({ folder, path: full, message, ...(kind ? { kind } : {}), ...(values ? { values } : {}) })),
      devBuild: !app.isPackaged,
      officialPublish: this.officialPublishing.view(),
      developmentFolders: this.developmentFolders.view(),
      leftoverModuleData: this.moduleLeftovers.view(),
      panels: workspace.instances.map((record) => {
        const view = this.nativePanel(record.instanceId);
        const type = this.modulePanels.typeOf(record);
        const module = this.modules.get(record.moduleId);
        // A development module that cannot load right now is named from its manifest until it loads.
        const name = type?.name ?? (module ? this.shown(module.manifest).name : (waitingModules(this.moduleProblems).get(record.moduleId) ?? movedModule(record.moduleId)?.name ?? record.moduleId));
        const panelType = record.panelType ?? null;
        const openedFrom = this.panels.openedFrom(record.instanceId);
        const placement = this.panels.placement(record.instanceId);
        if (type === undefined) {
          // Discord voice is paused (shared/discord-voice.ts), installed or not: its panel says so and offers nothing.
          const paused = isVoicePaused(record.moduleId);
          // A module that left Tavora for the catalog and is not installed yet: its panel offers to install it.
          const moved = !paused && !module && movedModule(record.moduleId) !== undefined;
          return {
            instanceId: record.instanceId,
            moduleId: record.moduleId,
            panelType,
            name: moved || paused ? name : (record.panelType ?? name),
            status: "unavailable" as const,
            waiting: false,
            content: null,
            ...(moved ? { moved } : {}),
            ...(paused ? { paused } : {}),
          };
        }
        const content = record.content?.title ?? null;
        if (!(view instanceof BrowserPanel)) {
          const status = view?.status ?? "loading";
          // Hidden until its page has its data.
          const overGame = this.panels.isLent(record.instanceId);
          // A new page is also waiting until it has drawn once: its loader stays under the see-through view until then.
          const question = this.panelQuestions.of(record, workspace.instances);
          const phase = view?.phase ?? "loading";
          const waiting = !question && !overGame && (phase === "loading" || phase === "settling" || phase === "revealed");
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
            ...(placement ? { placement } : {}),
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
      runningWithGame: this.withGame.lines(),
      workspaceRunning: this.workspaceId !== null && this.running.includes(this.workspaceId),
      unlistedGame: this.unlistedRunning.length ? unlistedToOffer(this.unlistedRunning, liveWorkspaces(this.library), this.running, this.library.gameStart) : null,
      pendingGameSwitch: pending.pendingGameSwitch && isLive(this.library, pending.pendingGameSwitch) ? pending.pendingGameSwitch : null,
      streaming: this.streaming.view(),
      gameOverlays: this.gameOverlays.view(),
      hotkeyRequest: this.streaming.request(),
      moduleFiles: { folder: this.files.root(), custom: this.files.custom, available: this.files.available, moving: this.files.moving },
      snapshots: workspace.snapshots.map(({ id, name, savedAt }) => ({ id, name, savedAt })),
      notice: this.notice,
      keptAside: unreadableFilesKept(),
      profile: this.userProfile.view(),
      restartPending: library.grayscaleText !== this.options.grayscaleText,
      appearance: this.appearance.view(),
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

  private pushState(): void {
    clearImmediate(this.statePush);
    this.statePush = undefined;
    // Hotkeys follow the workspace shown now and its panels, which most changes that push the state can move.
    this.streaming?.sync();
    // So do the panels running with their game: one of that type added to (or closed in) its workspace takes over.
    this.syncWithGame();
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
    const monitor = this.modules.get(SYSTEM_MONITOR_ID);
    this.connection.setActive(process.platform === "win32" && present && monitor !== undefined && this.connectorsOf(monitor).has("system-info"));
  }

  /** Pushes the state once for a burst of changes, such as every panel of a workspace that just opened loading at once. */
  private pushStateSoon(): void {
    this.statePush ??= setImmediate(() => this.pushState());
  }

  private saveLibrary(): void {
    this.savedData.saveLibrary(this.library);
  }

  /** Also tells the caller whether the write landed. */
  private saveProfile(): Promise<void> {
    return this.savedData.saveProfile(this.profile);
  }

  /**
   * The host page sends what it has not saved yet (the dock waits a moment after each change before it saves the
   * layout), as the window closes or Tavora quits. Resolves once it has, or after PAGE_SAVE_CAP_MS when it doesn't
   * answer.
   */
  private pageSaved(): Promise<void> {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return Promise.resolve();
    const seq = ++this.pageSaveSeq;
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.pageSaves.delete(seq);
        resolve();
      };
      const timer = setTimeout(done, PAGE_SAVE_CAP_MS);
      this.pageSaves.set(seq, done);
      this.window.webContents.send("host:save-now", seq);
    });
  }

  /**
   * Every panel's page saves what it still has and closes, once, as the window closes or Tavora quits. Resolves when
   * they have, at most a moment after CLOSE_CAP_MS whatever a page does.
   */
  private closePanelPages(): Promise<void> {
    if (this.panelPages.step !== "running") return this.panelPages.done;
    const limit = new Promise<void>((resolve) => setTimeout(resolve, CLOSE_CAP_MS + 500).unref());
    const done: Promise<void> = Promise.race([Promise.resolve().then(() => this.panels.disposeAll()), limit])
      .catch((error: unknown) => console.error("[tavora] closing the panels failed", error))
      .then(() => void (this.panelPages = { step: "closed", done }));
    this.panelPages = { step: "closing", done };
    return done;
  }

  /** Resolves once pending writes are on disk, with everything still running (the cloud copy calls this before each sync). */
  async saveAll(): Promise<void> {
    this.workspaces.flush();
    await this.gameOverlays?.save();
    await this.streaming?.save();
    return this.savedData.flush();
  }

  /** Quitting: resolves once pending writes are on disk; keys go back to the system and the overlay server stops. */
  async flush(): Promise<void> {
    // What is waiting goes to disk at once (an update's installer doesn't wait long), and again once the pages have saved.
    this.workspaces.flush();
    await Promise.all([this.pageSaved(), this.closePanelPages(), this.savedData.flush()]);
    await this.gameOverlays?.shutdown();
    await this.streaming?.shutdown();
    return this.savedData.flush();
  }

  /** Looks at the running programs while "When a game starts", game overlays or a panel running with its game need it. */
  private syncGameWatcher(): void {
    if (this.library.gameStart !== "off" || this.gameOverlays?.needsWatcher() || this.withGameWanted()) this.gameWatcher.start();
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
        theme: () => this.appearance.host,
        changed: () => this.pushStateSoon(),
        overlaysChanged: () => {
          this.syncGameWatcher();
          this.pushStateSoon();
        },
        overGameChanged: (changed) => this.tellOverGameChanged(changed),
        fontCss: () => fontStylesheet(this.appearance.host.font),
        saveLibrary: () => this.saveLibrary(),
        workspaceId: () => this.workspaceId,
        askConnector: (moduleId, connector) => this.panelQuestions.askConnector(moduleId, connector),
        panelInfo: (instanceId, workspaceId) => this.panelInfo(instanceId, workspaceId),
        page: {
          sources: () => this.overlaySources(),
          keepRunning: (panels) => this.runForOverlayPage(panels),
          leave: () => this.leaveOverlayPage(),
          openSettings: (target) => this.openSettingsOverOverlayPage(target),
          choosePicture: () =>
            this.fileDialogs.pick(
              "layout-picture",
              {
                title: translate(this.language, "overlays.layout.chooseTitle"),
                properties: ["openFile"],
                filters: [{ name: translate(this.language, "dialog.images"), extensions: ["png", "jpg", "jpeg", "webp"] }],
              },
            ),
          rememberPicture: (file) => this.fileDialogs.remember("layout-picture", file),
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
    if (server.port) holdOwnPort(Number(server.port));
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

/** Clears what a browser session keeps: its storage and its cache. */
async function clearSession(ses: Electron.Session): Promise<void> {
  await ses.clearStorageData();
  await ses.clearCache();
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
