import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  screen,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import type { TavoraGame } from "@tavora/sdk/protocol";
import type { ActionResult, GameView, HostAction, HostViewState, Screen } from "../shared/host-api";
import { parseAction } from "./actions";
import { contentTypeFor, HOST_CSP, HOST_SCHEME, resolveAsset } from "./assets";
import { deleteModuleData, orphanedPartitions } from "./gamedata";
import { THEME } from "./games";
import { IconError, importIcon, removeIcon } from "./icons";
import { readJsonOrSetAside } from "./json";
import {
  addGame,
  createFolder,
  deleteFolder,
  deleteTrashedGame,
  isLive,
  LibraryError,
  markPlayed,
  moveFolder,
  moveGame,
  placeFavorite,
  purgeDate,
  purgeExpired,
  recentGames,
  removeFavorite,
  renameFolder,
  renameGame,
  restoreGame,
  sanitizeLibrary,
  searchCatalog,
  setFolderLabel,
  setGameImage,
  setGameLabel,
  setRail,
  sortedRoot,
  trashedGames,
  trashGame,
  type GameEntry,
  type GameIcon,
  type Library,
} from "./library";
import { ModuleView } from "./module-view";
import { discoverModules, type InstalledModule } from "./registry";
import { DataRegistry } from "./storage";
import { writeFileAtomic } from "./fsutil";
import { fitsMinimums, layoutColumns, loadWorkspace, saveWorkspace, type InstanceRecord, type Rect, type WorkspaceState } from "./workspace";
import { initialBounds, MIN_SIZE, type WindowState } from "./window-state";

export const PANEL_HEADER_HEIGHT = 28;

export interface HostOptions {
  userData: string;
  moduleDirs: string[];
  /** Modules that ship with Tavora, shown as Official. */
  officialModuleDirs: string[];
  rendererDir: string;
  modulePreload: string;
  hostPreload: string;
  icon: string;
  devTools: boolean;
  /**
   * Development only: the Vite dev server that serves the host UI with hot
   * reload, instead of the built files in `rendererDir`.
   */
  devServer?: string | undefined;
}

const ICON_URL = `${HOST_SCHEME}://app/game-icons/`;

export class Host {
  private readonly data: DataRegistry;
  private readonly views = new Map<string, ModuleView>();
  private readonly viewsByContents = new Map<number, ModuleView>();
  private screen: Screen = "welcome";
  private notice: string | null = null;
  /** Where the host UI wants module panels, in window content coordinates. */
  private workspaceRect: Rect | null = null;
  /** True while the host UI shows a menu or dialog that module views would cover. */
  private overlay = false;
  private saving: Promise<void> = Promise.resolve();
  private windowSaveTimer: ReturnType<typeof setTimeout> | undefined;
  readonly window: BrowserWindow;

  private constructor(
    private readonly options: HostOptions,
    private readonly modules: Map<string, InstalledModule>,
    private readonly library: Library,
    private readonly workspace: WorkspaceState,
    windowState: WindowState,
  ) {
    this.data = new DataRegistry(options.userData);
    this.window = new BrowserWindow({
      ...windowState.bounds,
      minWidth: MIN_SIZE.width,
      minHeight: MIN_SIZE.height,
      title: "Tavora",
      icon: options.icon,
      backgroundColor: THEME.colors.background,
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
    if (windowState.maximized) this.window.maximize();
    this.window.once("ready-to-show", () => this.window.show());
  }

  static async create(options: HostOptions): Promise<Host> {
    const { userData } = options;
    const modules = await discoverModules({ official: options.officialModuleDirs, local: options.moduleDirs });
    const library = sanitizeLibrary(await readJsonOrSetAside(path.join(userData, "library.json")));
    const expired = purgeExpired(library, new Date());
    const workspace = await loadWorkspace(
      path.join(userData, "workspace.json"),
      Object.keys(library.games),
      (id) => modules.has(id),
    );
    const savedWindow = await readJsonOrSetAside<WindowState>(path.join(userData, "window.json"));
    const windowState = initialBounds(
      savedWindow,
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
    );
    await registerHostProtocol(options.rendererDir, path.join(userData, "game-icons"), options.devServer);

    // Dark only for now: native menus, dialogs and scrollbars match the UI.
    nativeTheme.themeSource = "dark";
    const host = new Host(options, modules, library, workspace, windowState);
    for (const game of expired) await host.deleteGameData(game);
    // Browser storage of games that are gone, removed before any session opens it.
    for (const dir of await orphanedPartitions(userData, new Set(Object.keys(library.games)))) {
      await rm(dir, { recursive: true, force: true });
    }
    const livePanels = new Set(Object.values(workspace.games).flatMap((game) => game.instances.map((i) => i.instanceId)));
    await host.data.panelState.prune(livePanels);
    if (expired.length) host.saveLibrary();

    host.screen = library.startup === "last-game" && library.lastGameId ? "game" : "welcome";
    host.registerIpc();
    host.registerWindowEvents();
    await host.window.loadURL(options.devServer ?? `${HOST_SCHEME}://app/index.html`);
    if (host.screen === "game") host.openCurrentGame();
    return host;
  }

  private get gameId(): string | null {
    return this.screen === "game" ? this.library.lastGameId : null;
  }

  private get game(): TavoraGame | null {
    const id = this.gameId;
    return id ? { id, displayName: this.library.games[id]!.name } : null;
  }

  private records(gameId: string): InstanceRecord[] {
    return (this.workspace.games[gameId] ??= { instances: [] }).instances;
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
    ipcMain.on("tavora:pong", (event: IpcMainEvent) => {
      if (event.senderFrame?.parent !== null) return;
      this.viewsByContents.get(event.sender.id)?.pong();
    });

    // Host UI side: only the host window's main frame may call these.
    const fromHost = (event: IpcMainInvokeEvent | IpcMainEvent) =>
      event.sender.id === this.window.webContents.id && event.senderFrame?.parent === null;

    ipcMain.handle("host:get-state", (event) => (fromHost(event) ? this.viewState() : null));
    ipcMain.handle("host:action", async (event, raw: unknown): Promise<ActionResult> => {
      if (!fromHost(event)) return { ok: false, error: "Not allowed." };
      const action = parseAction(raw);
      if (!action) return { ok: false, error: "Tavora did not understand that request." };
      try {
        const id = await this.perform(action);
        return id === undefined ? { ok: true } : { ok: true, id };
      } catch (error) {
        if (error instanceof LibraryError || error instanceof IconError) return { ok: false, error: error.message };
        console.error(`[tavora] ${action.type} failed`, error);
        return { ok: false, error: "Something went wrong. Please try again." };
      } finally {
        this.pushState();
      }
    });
    ipcMain.handle("host:search-catalog", (event, query: unknown) =>
      fromHost(event) && typeof query === "string" && query.length <= 100
        ? searchCatalog(this.library, query).map(({ id, name }) => ({ id, name }))
        : [],
    );
    ipcMain.on("host:workspace-rect", (event, rect: unknown) => {
      if (fromHost(event)) this.setWorkspaceRect(rect);
    });
    ipcMain.on("host:overlay", (event, open: unknown) => {
      if (!fromHost(event) || typeof open !== "boolean" || open === this.overlay) return;
      this.overlay = open;
      this.forEachView((view) => view.view.setVisible(!open));
    });
  }

  private registerWindowEvents(): void {
    this.window.on("resize", () => this.saveWindowSoon());
    this.window.on("move", () => this.saveWindowSoon());
    this.window.on("close", () => this.saveWindow());
    const suspend = () => this.forEachView((view) => view.suspend());
    const resume = () => this.forEachView((view) => view.resume());
    this.window.on("minimize", suspend);
    this.window.on("hide", suspend);
    this.window.on("restore", resume);
    this.window.on("show", resume);
    this.window.on("closed", () => {
      for (const view of this.views.values()) view.dispose();
      this.views.clear();
      this.viewsByContents.clear();
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────

  private async perform(action: HostAction): Promise<string | void> {
    const library = this.library;
    switch (action.type) {
      case "show-welcome":
        return this.showScreen("welcome");
      case "open-game":
        return this.openGame(action.gameId);
      case "add-game": {
        const id = addGame(library, action, new Date());
        this.workspace.games[id] = { instances: [] };
        this.saveLibrary();
        this.saveWorkspace();
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
      case "set-rail":
        setRail(library, action);
        break;
      case "open-module":
        return this.openModule(action.moduleId);
      case "close-panel":
        return this.closePanel(action.instanceId);
      case "reload-panel":
        return this.views.get(action.instanceId)?.reload();
      case "stop-panel":
        return this.views.get(action.instanceId)?.stop();
    }
    this.saveLibrary();
  }

  private showScreen(next: Screen): void {
    if (this.screen === next && next !== "game") return;
    this.notice = null;
    this.closeAllViews();
    this.screen = next;
  }

  private openGame(gameId: string): void {
    if (!isLive(this.library, gameId)) throw new LibraryError("That game no longer exists.");
    if (this.gameId === gameId) return;
    this.showScreen("game");
    markPlayed(this.library, gameId, new Date());
    this.saveLibrary();
    this.openCurrentGame();
  }

  private async chooseGameImage(gameId: string): Promise<void> {
    if (!isLive(this.library, gameId)) throw new LibraryError("That game no longer exists.");
    const picked = await dialog.showOpenDialog(this.window, {
      title: "Choose an icon",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    const source = picked.filePaths[0];
    if (picked.canceled || !source) return;
    const file = await importIcon(this.iconDir, gameId, source);
    const previous = setGameImage(this.library, gameId, file);
    await this.dropIconFile(previous);
  }

  private get iconDir(): string {
    return path.join(this.options.userData, "game-icons");
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
    await deleteModuleData(this.options.userData, game.id);
    await this.dropIconFile(game.icon);
    // Sessions may already be open in this run, so clear them; their
    // directories are removed at the next start.
    const keep = new Set(Object.keys(this.library.games));
    for (const dir of await orphanedPartitions(this.options.userData, keep)) {
      const ses = session.fromPartition(`persist:${decodeURIComponent(path.basename(dir))}`);
      await ses.clearStorageData();
      await ses.clearCache();
    }
  }

  private openModule(moduleId: string): void {
    const game = this.game;
    const module = this.modules.get(moduleId);
    if (!game || !module || !this.supportsGame(module, game.id)) return;
    const records = this.records(game.id);
    const minimums = [...records.map((record) => this.modules.get(record.moduleId)!), module].map(
      (installed) => installed.manifest.viewport,
    );
    if (!fitsMinimums(this.panelArea(), minimums)) {
      this.notice = `Not enough room for another ${module.manifest.name} panel. Close a panel or enlarge the window.`;
      return;
    }
    this.notice = null;
    const record = { instanceId: randomUUID(), moduleId };
    records.push(record);
    this.saveWorkspace();
    this.createView(record, game);
    this.layout();
  }

  private closePanel(instanceId: string): void {
    const game = this.game;
    if (!game) return;
    const records = this.records(game.id);
    const index = records.findIndex((record) => record.instanceId === instanceId);
    if (index < 0) return;
    this.notice = null;
    records.splice(index, 1);
    this.saveWorkspace();
    this.destroyView(instanceId);
    // Closing a panel ends its UI state; module settings and documents stay.
    void this.data.panelState.remove(instanceId).catch((error: unknown) => console.error("[tavora]", error));
    this.layout();
  }

  // ── Views ────────────────────────────────────────────────────────────

  private openCurrentGame(): void {
    const game = this.game;
    if (!game) return;
    for (const record of this.records(game.id)) this.createView(record, game);
    this.layout();
  }

  private createView(record: InstanceRecord, game: TavoraGame): void {
    const module = this.modules.get(record.moduleId)!;
    const view = new ModuleView({
      instanceId: record.instanceId,
      module,
      game,
      data: this.data.get(module.manifest.id, game.id),
      panelState: this.data.panelState,
      hostVersion: app.getVersion(),
      preload: this.options.modulePreload,
      devTools: this.options.devTools,
      getTheme: () => THEME,
      onStatus: () => this.pushState(),
    });
    const contentsId = view.webContentsId;
    this.views.set(record.instanceId, view);
    this.viewsByContents.set(contentsId, view);
    view.view.webContents.once("destroyed", () => this.viewsByContents.delete(contentsId));
    view.view.setVisible(!this.overlay && this.workspaceRect !== null);
    this.window.contentView.addChildView(view.view);
  }

  private destroyView(instanceId: string): void {
    const view = this.views.get(instanceId);
    if (!view) return;
    this.views.delete(instanceId);
    this.viewsByContents.delete(view.webContentsId);
    this.window.contentView.removeChildView(view.view);
    view.dispose();
  }

  private closeAllViews(): void {
    for (const instanceId of [...this.views.keys()]) this.destroyView(instanceId);
  }

  private forEachView(fn: (view: ModuleView) => void): void {
    for (const view of this.views.values()) fn(view);
  }

  private setWorkspaceRect(raw: unknown): void {
    const r = raw as Partial<Rect> | null;
    const numbers = r && [r.x, r.y, r.width, r.height].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
    if (!numbers) return;
    const { width, height } = this.window.getContentBounds();
    const x = Math.min(Math.round(r.x!), width);
    const y = Math.min(Math.round(r.y!), height);
    const rect = { x, y, width: Math.min(Math.round(r.width!), width - x), height: Math.min(Math.round(r.height!), height - y) };
    const first = this.workspaceRect === null;
    this.workspaceRect = rect;
    if (first) this.forEachView((view) => view.view.setVisible(!this.overlay));
    this.layout();
  }

  /** The area module content can use, below the panel headers. */
  private panelArea(): Rect {
    const rect = this.workspaceRect ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: rect.x,
      y: rect.y + PANEL_HEADER_HEIGHT,
      width: rect.width,
      height: Math.max(0, rect.height - PANEL_HEADER_HEIGHT),
    };
  }

  private layout(): void {
    const game = this.game;
    if (game) {
      const records = this.records(game.id);
      const columns = layoutColumns(records.length, this.panelArea());
      records.forEach((record, index) => this.views.get(record.instanceId)?.setBounds(columns[index]!));
    }
    this.pushState();
  }

  // ── State ────────────────────────────────────────────────────────────

  private supportsGame(module: InstalledModule, gameId: string): boolean {
    const { games } = module.manifest;
    const catalogId = this.library.games[gameId]?.catalogId;
    return games.length === 0 || games.includes(gameId) || (catalogId != null && games.includes(catalogId));
  }

  private gameView(game: GameEntry): GameView {
    return {
      id: game.id,
      name: game.name,
      icon: game.icon.kind === "image" ? { kind: "image", url: ICON_URL + game.icon.file } : game.icon,
      builtIn: game.catalogId !== null,
      addedAt: game.addedAt,
      lastPlayedAt: game.lastPlayedAt,
    };
  }

  private viewState(): HostViewState {
    const library = this.library;
    const game = this.game;
    const records = game ? this.records(game.id) : [];
    const area = this.panelArea();
    const columns = layoutColumns(records.length, { ...area, x: 0 });
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
        rail: { ...library.rail },
      },
      modules: [...this.modules.values()].map((module) => ({
        id: module.manifest.id,
        name: module.manifest.name,
        description: module.manifest.description ?? null,
        available: game !== null && this.supportsGame(module, game.id),
        provenance: module.provenance,
      })),
      panels: records.map((record, index) => ({
        instanceId: record.instanceId,
        moduleId: record.moduleId,
        name: this.modules.get(record.moduleId)!.manifest.name,
        status: this.views.get(record.instanceId)?.status ?? "loading",
        x: columns[index]!.x,
        width: columns[index]!.width,
      })),
      notice: this.notice,
      panelHeaderHeight: PANEL_HEADER_HEIGHT,
    };
  }

  private pushState(): void {
    if (!this.window.isDestroyed()) this.window.webContents.send("host:state", this.viewState());
  }

  private enqueue(write: () => Promise<void>, what: string): void {
    this.saving = this.saving.then(write).catch((error: unknown) => console.error(`[tavora] could not save ${what}`, error));
  }

  private saveLibrary(): void {
    const body = JSON.stringify(this.library, null, 2);
    this.enqueue(() => writeFileAtomic(path.join(this.options.userData, "library.json"), body), "library");
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
 * Serves the trusted host UI, plus game icons the player picked, and blocks
 * all network for the host renderer. With a dev server, the host UI comes
 * from there instead, and only that server is reachable.
 */
async function registerHostProtocol(rendererDir: string, iconDir: string, devServer?: string): Promise<void> {
  const root = devServer ? null : await realpath(rendererDir);
  await mkdir(iconDir, { recursive: true });
  const icons = await realpath(iconDir);
  const origin = `${HOST_SCHEME}://app`;
  protocol.handle(HOST_SCHEME, async (request) => {
    // URL.origin is "null" for custom schemes in Node, so compare the host.
    const url = new URL(request.url);
    let file: string | null = null;
    if (url.host === "app") {
      if (url.pathname.startsWith("/game-icons/")) file = await resolveAsset(icons, url.pathname.slice("/game-icons".length));
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
