import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, ipcMain, nativeTheme, protocol, session, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { isGameId, isModuleId } from "@tavora/module-schema";
import type { TavoraGame, TavoraTheme } from "@tavora/sdk/protocol";
import { contentTypeFor, HOST_CSP, HOST_SCHEME, resolveAsset } from "./assets";
import { GAMES, THEMES } from "./games";
import { ModuleView, type InstanceStatus } from "./module-view";
import { discoverModules, type InstalledModule } from "./registry";
import { DataRegistry } from "./storage";
import {
  fitsMinimums,
  layoutColumns,
  loadWorkspace,
  saveWorkspace,
  type InstanceRecord,
  type Rect,
  type WorkspaceState,
} from "./workspace";

export const TOOLBAR_HEIGHT = 48;
export const PANEL_HEADER_HEIGHT = 28;

export interface HostOptions {
  userData: string;
  moduleDirs: string[];
  rendererDir: string;
  modulePreload: string;
  hostPreload: string;
  devTools: boolean;
}

/** What the host UI renders. Contains no module data. */
export interface HostViewState {
  games: TavoraGame[];
  currentGameId: string;
  modules: { id: string; name: string; available: boolean }[];
  panels: { instanceId: string; moduleId: string; name: string; status: InstanceStatus; x: number; width: number }[];
  notice: string | null;
  toolbarHeight: number;
  panelHeaderHeight: number;
}

export class Host {
  private readonly data: DataRegistry;
  private readonly views = new Map<string, ModuleView>();
  private readonly viewsByContents = new Map<number, ModuleView>();
  private notice: string | null = null;
  private saving: Promise<void> = Promise.resolve();
  readonly window: BrowserWindow;

  private constructor(
    private readonly options: HostOptions,
    private readonly modules: Map<string, InstalledModule>,
    private readonly workspace: WorkspaceState,
  ) {
    this.data = new DataRegistry(options.userData);
    this.window = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 640,
      minHeight: 480,
      title: "Tavora",
      backgroundColor: THEMES.dark.colors.background,
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
  }

  static async create(options: HostOptions): Promise<Host> {
    const modules = await discoverModules(options.moduleDirs);
    const workspace = await loadWorkspace(
      path.join(options.userData, "workspace.json"),
      GAMES.map((game) => game.id),
      (id) => modules.has(id),
    );
    await registerHostProtocol(options.rendererDir);

    const host = new Host(options, modules, workspace);
    const livePanels = new Set(Object.values(workspace.games).flatMap((game) => game.instances.map((i) => i.instanceId)));
    await host.data.panelState.prune(livePanels);
    host.registerIpc();
    host.registerWindowEvents();
    await host.window.loadURL(`${HOST_SCHEME}://app/index.html`);
    host.openCurrentGame();
    return host;
  }

  private get game(): TavoraGame {
    return GAMES.find((game) => game.id === this.workspace.currentGameId) ?? GAMES[0]!;
  }

  private get records(): InstanceRecord[] {
    return this.workspace.games[this.game.id]!.instances;
  }

  private theme(): TavoraTheme {
    return nativeTheme.shouldUseDarkColors ? THEMES.dark : THEMES.light;
  }

  // ── IPC ──────────────────────────────────────────────────────────────

  private registerIpc(): void {
    // Module side: the only message a module renderer can send. Identity is
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
    const fromHost = (event: IpcMainInvokeEvent) =>
      event.sender.id === this.window.webContents.id && event.senderFrame?.parent === null;

    ipcMain.handle("host:get-state", (event) => (fromHost(event) ? this.viewState() : null));
    ipcMain.handle("host:select-game", (event, gameId: unknown) => {
      if (fromHost(event) && isGameId(gameId)) this.selectGame(gameId);
    });
    ipcMain.handle("host:open-module", (event, moduleId: unknown) => {
      if (fromHost(event) && isModuleId(moduleId)) this.openModule(moduleId);
    });
    ipcMain.handle("host:close-panel", (event, instanceId: unknown) => {
      if (fromHost(event) && typeof instanceId === "string") this.closePanel(instanceId);
    });
    ipcMain.handle("host:reload-panel", (event, instanceId: unknown) => {
      if (fromHost(event) && typeof instanceId === "string") this.views.get(instanceId)?.reload();
    });
    ipcMain.handle("host:stop-panel", (event, instanceId: unknown) => {
      if (fromHost(event) && typeof instanceId === "string") this.views.get(instanceId)?.stop();
    });
  }

  private registerWindowEvents(): void {
    this.window.on("resize", () => this.layout());
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
    nativeTheme.on("updated", () => {
      const theme = this.theme();
      this.forEachView((view) => view.emitTheme(theme));
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────

  private selectGame(gameId: string): void {
    if (gameId === this.game.id || !GAMES.some((game) => game.id === gameId)) return;
    this.notice = null;
    this.closeAllViews();
    this.workspace.currentGameId = gameId;
    this.save();
    this.openCurrentGame();
  }

  private openModule(moduleId: string): void {
    const module = this.modules.get(moduleId);
    if (!module || !this.supportsGame(module)) return;
    const minimums = [...this.records.map((record) => this.modules.get(record.moduleId)!), module].map(
      (installed) => installed.manifest.viewport,
    );
    if (!fitsMinimums(this.panelArea(), minimums)) {
      this.notice = `Not enough room for another ${module.manifest.name} panel. Close a panel or enlarge the window.`;
      this.pushState();
      return;
    }
    this.notice = null;
    const record = { instanceId: randomUUID(), moduleId };
    this.records.push(record);
    this.save();
    this.createView(record);
    this.layout();
  }

  private closePanel(instanceId: string): void {
    const index = this.records.findIndex((record) => record.instanceId === instanceId);
    if (index < 0) return;
    this.notice = null;
    this.records.splice(index, 1);
    this.save();
    this.destroyView(instanceId);
    // Closing a panel ends its UI state; module settings and documents stay.
    void this.data.panelState.remove(instanceId).catch((error: unknown) => console.error("[tavora]", error));
    this.layout();
  }

  // ── Views ────────────────────────────────────────────────────────────

  private openCurrentGame(): void {
    for (const record of this.records) this.createView(record);
    this.layout();
  }

  private createView(record: InstanceRecord): void {
    const module = this.modules.get(record.moduleId)!;
    const view = new ModuleView({
      instanceId: record.instanceId,
      module,
      game: this.game,
      data: this.data.get(module.manifest.id, this.game.id),
      panelState: this.data.panelState,
      hostVersion: app.getVersion(),
      preload: this.options.modulePreload,
      devTools: this.options.devTools,
      getTheme: () => this.theme(),
      onStatus: () => this.pushState(),
    });
    const contentsId = view.webContentsId;
    this.views.set(record.instanceId, view);
    this.viewsByContents.set(contentsId, view);
    view.view.webContents.once("destroyed", () => this.viewsByContents.delete(contentsId));
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

  private panelArea(): Rect {
    const { width, height } = this.window.getContentBounds();
    const top = TOOLBAR_HEIGHT + PANEL_HEADER_HEIGHT;
    return { x: 0, y: top, width, height: Math.max(0, height - top) };
  }

  private layout(): void {
    const columns = layoutColumns(this.records.length, this.panelArea());
    this.records.forEach((record, index) => this.views.get(record.instanceId)?.setBounds(columns[index]!));
    this.pushState();
  }

  // ── State ────────────────────────────────────────────────────────────

  private supportsGame(module: InstalledModule): boolean {
    return module.manifest.games.length === 0 || module.manifest.games.includes(this.game.id);
  }

  private viewState(): HostViewState {
    const columns = layoutColumns(this.records.length, this.panelArea());
    return {
      games: [...GAMES],
      currentGameId: this.game.id,
      modules: [...this.modules.values()].map((module) => ({
        id: module.manifest.id,
        name: module.manifest.name,
        available: this.supportsGame(module),
      })),
      panels: this.records.map((record, index) => ({
        instanceId: record.instanceId,
        moduleId: record.moduleId,
        name: this.modules.get(record.moduleId)!.manifest.name,
        status: this.views.get(record.instanceId)?.status ?? "loading",
        x: columns[index]!.x,
        width: columns[index]!.width,
      })),
      notice: this.notice,
      toolbarHeight: TOOLBAR_HEIGHT,
      panelHeaderHeight: PANEL_HEADER_HEIGHT,
    };
  }

  private pushState(): void {
    if (!this.window.isDestroyed()) this.window.webContents.send("host:state", this.viewState());
  }

  private save(): void {
    const snapshot = structuredClone(this.workspace);
    const file = path.join(this.options.userData, "workspace.json");
    this.saving = this.saving
      .then(() => saveWorkspace(file, snapshot))
      .catch((error: unknown) => console.error("[tavora] could not save workspace", error));
  }

  /** Resolves once pending workspace writes are on disk. */
  flush(): Promise<void> {
    return this.saving;
  }
}

/** Serves the trusted host UI and blocks all network for the host renderer. */
async function registerHostProtocol(rendererDir: string): Promise<void> {
  const root = await realpath(rendererDir);
  const origin = `${HOST_SCHEME}://app`;
  protocol.handle(HOST_SCHEME, async (request) => {
    // URL.origin is "null" for custom schemes in Node, so compare the host.
    const url = new URL(request.url);
    const file = url.host === "app" ? await resolveAsset(root, url.pathname) : null;
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(await readFile(file), {
      headers: {
        "Content-Type": contentTypeFor(file),
        "Content-Security-Policy": HOST_CSP,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(details.url.startsWith(`${origin}/`) || details.url.startsWith("devtools://")) });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
