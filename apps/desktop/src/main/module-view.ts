import { readFile } from "node:fs/promises";
import { MessageChannelMain, session, WebContentsView, type Session } from "electron";
import type { TavoraGame, TavoraTheme, TavoraViewport } from "@tavora/sdk/protocol";
import { contentTypeFor, MODULE_CSP, MODULE_SCHEME, resolveAsset } from "./assets";
import { BridgeSession } from "./bridge";
import type { InstalledModule } from "./registry";
import type { ModuleStore } from "./storage";

export type InstanceStatus = "loading" | "ready" | "crashed";

export interface ModuleViewOptions {
  instanceId: string;
  module: InstalledModule;
  game: TavoraGame;
  store: ModuleStore;
  preload: string;
  devTools: boolean;
  getTheme(): TavoraTheme;
  onStatus(status: InstanceStatus): void;
}

export function moduleOrigin(moduleId: string): string {
  return `${MODULE_SCHEME}://${moduleId}`;
}

const hardened = new WeakSet<Session>();

/**
 * Every module gets its own session per game: separate cookies, web storage,
 * cache and a separate renderer process from the host and other modules.
 */
function moduleSession(module: InstalledModule, game: TavoraGame): Session {
  const ses = session.fromPartition(`persist:module:${module.manifest.id}@${game.id}`);
  if (hardened.has(ses)) return ses;
  hardened.add(ses);

  const origin = moduleOrigin(module.manifest.id);

  ses.protocol.handle(MODULE_SCHEME, async (request) => {
    // URL.origin is "null" for custom schemes in Node, so compare the host.
    const url = new URL(request.url);
    if (url.host !== module.manifest.id) return new Response("Not found", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const file = await resolveAsset(module.root, url.pathname);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : await readFile(file), {
      headers: {
        "Content-Type": contentTypeFor(file),
        "Content-Security-Policy": MODULE_CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });

  // Network mediation does not exist yet, so modules get none: every request
  // that is not for the module's own bundle is cancelled.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(`${origin}/`) || details.url.startsWith("devtools://");
    callback({ cancel: !allowed });
  });
  // Belt and braces: anything that bypasses webRequest still has to go
  // through a proxy that does not exist, loopback included.
  void ses.setProxy({ mode: "fixed_servers", proxyRules: "http://127.0.0.1:9", proxyBypassRules: "<-loopback>" });

  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.setSpellCheckerEnabled(false);
  ses.on("will-download", (event) => event.preventDefault());
  return ses;
}

/** One panel instance of a module, bound to one game. */
export class ModuleView {
  readonly view: WebContentsView;
  private bridge: BridgeSession | undefined;
  private viewport: TavoraViewport = { width: 0, height: 0 };
  status: InstanceStatus = "loading";

  constructor(private readonly options: ModuleViewOptions) {
    const { module, game } = options;
    this.view = new WebContentsView({
      webPreferences: {
        session: moduleSession(module, game),
        preload: options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        devTools: options.devTools,
      },
    });

    const contents = this.view.webContents;
    const origin = moduleOrigin(module.manifest.id);
    const sameModule = (url: string) => url.startsWith(`${origin}/`);

    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    contents.on("will-navigate", (event) => {
      if (!sameModule(event.url)) event.preventDefault();
    });
    contents.on("will-frame-navigate", (event) => {
      if (!sameModule(event.url)) event.preventDefault();
    });
    contents.on("will-redirect", (event) => {
      if (!sameModule(event.url)) event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());

    // A reload or in-module navigation starts a new document, which must
    // ask for a new port; the old one is closed so it cannot be reused.
    contents.on("did-start-navigation", (event) => {
      if (event.isMainFrame && !event.isSameDocument) this.disconnect();
    });
    contents.on("did-finish-load", () => this.setStatus("ready"));
    contents.on("render-process-gone", (_event, details) => {
      console.warn(`[tavora] module ${module.manifest.id} renderer gone: ${details.reason}`);
      this.disconnect();
      this.setStatus("crashed");
    });

    void contents.loadURL(`${origin}/${module.manifest.entry}`).catch(() => {
      // Load failures surface through did-fail-load / render-process-gone.
    });
  }

  get webContentsId(): number {
    return this.view.webContents.id;
  }

  get instanceId(): string {
    return this.options.instanceId;
  }

  get moduleId(): string {
    return this.options.module.manifest.id;
  }

  /** Called when the module's main frame asks for a bridge port. */
  connect(): void {
    this.disconnect();
    const { port1, port2 } = new MessageChannelMain();
    const bridge: BridgeSession = new BridgeSession(
      port1,
      {
        moduleId: this.moduleId,
        game: this.options.game,
        store: this.options.store,
        getViewport: () => ({ ...this.viewport }),
        getTheme: this.options.getTheme,
      },
      () => {
        if (this.bridge === bridge) this.bridge = undefined;
      },
    );
    this.bridge = bridge;
    this.view.webContents.postMessage("tavora:port", null, [port2]);
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.view.setBounds(bounds);
    if (bounds.width === this.viewport.width && bounds.height === this.viewport.height) return;
    this.viewport = { width: bounds.width, height: bounds.height };
    this.bridge?.emit("workspace.resize", { ...this.viewport });
  }

  emitTheme(theme: TavoraTheme): void {
    this.bridge?.emit("ui.theme", theme);
  }

  emitLifecycle(event: "lifecycle.suspend" | "lifecycle.resume"): void {
    this.bridge?.emit(event, null);
  }

  reload(): void {
    this.setStatus("loading");
    this.view.webContents.reload();
  }

  dispose(): void {
    this.bridge?.emit("lifecycle.dispose", null);
    this.disconnect();
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }

  private disconnect(): void {
    this.bridge?.close();
    this.bridge = undefined;
  }

  private setStatus(status: InstanceStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus(status);
  }
}
