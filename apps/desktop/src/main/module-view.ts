import { readFile } from "node:fs/promises";
import { MessageChannelMain, session, WebContentsView, type Session } from "electron";
import type { Capability, TavoraGame, TavoraTheme, TavoraViewport } from "@tavora/sdk/protocol";
import { moduleThemeCss } from "./module-style";
import { contentTypeFor, MODULE_CSP, MODULE_SCHEME, resolveAsset } from "./assets";
import { BridgeSession } from "./bridge";
import { isWebUrl } from "./browser-url";
import { HostError } from "./errors";
import type { InstalledModule } from "./registry";
import type { InstanceStatus } from "../shared/host-api";
import type { ModuleData, PanelStateStore } from "./storage";
import { MODULE_STORAGE_LIMIT, overStorageLimit, STORAGE_CHECK_MS } from "./storage-guard";

export type { InstanceStatus } from "../shared/host-api";

export interface ModuleViewOptions {
  instanceId: string;
  module: InstalledModule;
  game: TavoraGame;
  data: ModuleData;
  panelState: PanelStateStore;
  hostVersion: string;
  preload: string;
  devTools: boolean;
  getTheme(): TavoraTheme;
  getLanguage(): string;
  /** Tavora's default look for the page, below the module's own styles (module-style.ts). Colours come from the theme stylesheet. */
  baseCss: string;
  onStatus(status: InstanceStatus): void;
  /** The module's own browser storage grew past the limit; the host clears it (see storage-guard.ts). */
  onStorageOver(): void;
  /** What a module may keep in its browser storage, in bytes. */
  storageLimit?: number;
  /** The page has its data and may be shown (see ModuleView.revealed). */
  onReveal?(): void;
  /** The player opened a web address from the module (links.open); it was checked to be one. */
  onOpenLink(url: string): void;
}

/** How often the host checks that a module's page still runs. */
export const HEARTBEAT_MS = 2_000;
/** How long a page may go without answering before it is reported as not responding. */
export const UNRESPONSIVE_MS = 10_000;

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

/**
 * A page is kept hidden until it has settled, so nobody watches it build itself. It has settled
 * when its requests have been answered and none has followed for SETTLE_MS; a page that never
 * connects is shown after NO_BRIDGE_MS, and no page is held back longer than REVEAL_CAP_MS.
 */
/** How long after a click or key press a link may be opened. */
export const GESTURE_MS = 2_000;
export const SETTLE_MS = 150;
export const NO_BRIDGE_MS = 400;
export const REVEAL_CAP_MS = 2_000;

/** Corner radius of a panel card in the host UI (dock.css), in px. */
const PANEL_RADIUS = 10;

/** One panel instance of a module, bound to one game. */
export class ModuleView {
  readonly view: WebContentsView;
  private bridge: BridgeSession | undefined;
  private viewport: TavoraViewport = { width: 0, height: 0 };
  private suspended = false;
  /** The inserted theme stylesheet of the current page, removed when the theme changes. */
  private themeCssKey: string | undefined;
  /** Theme stylesheets are swapped one at a time, so none is left behind. */
  private themeCssQueue: Promise<void> = Promise.resolve();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastPong = 0;
  private storageWatch: ReturnType<typeof setInterval> | undefined;
  private measuring = false;
  status: InstanceStatus = "loading";
  /** False while the page is still loading or filling itself with data; the host keeps the view hidden until then. */
  revealed = false;
  private revealTimers: ReturnType<typeof setTimeout>[] = [];
  private settleTimer: ReturnType<typeof setTimeout> | undefined;

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

    // No white flash before the page has painted.
    this.view.setBackgroundColor(options.getTheme().tokens.background);
    // Panels are rounded cards in the host UI; the view follows their corners.
    this.view.setBorderRadius(PANEL_RADIUS - 1);

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
      if (event.isMainFrame && !event.isSameDocument) {
        this.disconnect();
        this.setStatus("loading");
        this.hideUntilSettled();
      }
    });
    // The module's own files are served by the protocol handler, so an
    // error status means the entry page is missing or unreadable.
    contents.on("did-navigate", (_event, url, httpResponseCode) => {
      if (httpResponseCode < 400) return;
      console.warn(`[tavora] module ${module.manifest.id} failed to load ${url}: HTTP ${httpResponseCode}`);
      this.disconnect();
      this.setStatus("failed");
    });
    // A user stylesheet: every rule the module writes still wins over it.
    // The theme's colours go in a second one, replaced when the theme changes.
    contents.on("dom-ready", () => {
      this.themeCssQueue = this.themeCssQueue.then(() => void (this.themeCssKey = undefined));
      contents.insertCSS(options.baseCss, { cssOrigin: "user" }).catch(() => {
        // The page went away before the styles landed.
      });
      void this.insertThemeCss(options.getTheme());
    });
    contents.on("did-finish-load", () => {
      if (this.status !== "loading") return;
      this.setStatus("ready");
      this.startHeartbeat();
      this.startStorageWatch();
      this.later(NO_BRIDGE_MS, () => this.bridge === undefined && this.reveal());
    });
    contents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation replaced by another, not a failure.
      if (!isMainFrame || errorCode === -3) return;
      console.warn(`[tavora] module ${module.manifest.id} failed to load ${url}: ${description}`);
      this.disconnect();
      this.setStatus("failed");
    });
    contents.on("unresponsive", () => {
      if (this.status === "ready") this.setStatus("unresponsive");
    });
    contents.on("responsive", () => {
      if (this.status === "unresponsive") this.setStatus("ready");
    });
    contents.on("render-process-gone", (_event, details) => {
      console.warn(`[tavora] module ${module.manifest.id} renderer gone: ${details.reason}`);
      this.disconnect();
      this.setStatus("crashed");
    });

    this.hideUntilSettled();
    void contents.loadURL(`${origin}/${module.manifest.entry}`).catch(() => {
      // Load failures surface through did-fail-load / render-process-gone.
    });
  }

  /** When the player last clicked or pressed a key in the page (reported by the preload from real input only). */
  private gestureAt = 0;

  noteGesture(): void {
    this.gestureAt = Date.now();
  }

  /** links.open: only a web address, and only right after the player did something in the page. */
  private openLink(url: string): void {
    if (Date.now() - this.gestureAt > GESTURE_MS) {
      throw new HostError("PERMISSION_DENIED", "links.open must be called right after a click or key press");
    }
    if (!isWebUrl(url)) throw new HostError("INVALID_PARAMS", "params.url must be an http or https address");
    // One click opens one link, so a script cannot open a pile of them.
    this.gestureAt = 0;
    this.options.onOpenLink(url);
  }

  /** Starts counting for a new page: it is hidden until it settles or the cap runs out. */
  private hideUntilSettled(): void {
    this.revealed = false;
    this.clearRevealTimers();
    this.later(REVEAL_CAP_MS, () => this.reveal());
  }

  private later(ms: number, run: () => void): void {
    this.revealTimers.push(setTimeout(run, ms));
  }

  private clearRevealTimers(): void {
    for (const timer of this.revealTimers) clearTimeout(timer);
    this.revealTimers = [];
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
  }

  private onBridgeBusy(busy: boolean, served: number): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    if (!busy && served > 0 && !this.revealed) this.settleTimer = setTimeout(() => this.reveal(), SETTLE_MS);
  }

  private reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.clearRevealTimers();
    this.options.onReveal?.();
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
    const { module, game, instanceId, data, panelState, hostVersion } = this.options;
    const bridge: BridgeSession = new BridgeSession(
      port1,
      {
        hostVersion,
        moduleId: module.manifest.id,
        moduleVersion: module.manifest.version,
        instanceId,
        game,
        data,
        panelState,
        // No permission can be granted yet (see apps/docs/reference/protocol.md).
        capabilities: new Set<Capability>(),
        getViewport: () => ({ ...this.viewport }),
        isSuspended: () => this.suspended,
        getTheme: this.options.getTheme,
        getLanguage: this.options.getLanguage,
        onBusy: (busy, served) => this.onBridgeBusy(busy, served),
        openLink: (url) => this.openLink(url),
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

  setVisible(visible: boolean): void {
    this.view.setVisible(visible);
  }

  /** Recolours the page and tells the module, which may restyle itself through ui.onThemeChange. */
  applyTheme(theme: TavoraTheme): void {
    this.view.setBackgroundColor(theme.tokens.background);
    void this.insertThemeCss(theme);
    this.bridge?.emit("ui.theme", theme);
  }

  /** Tells the module the player changed the language, so it can word itself anew through ui.onLanguageChange. */
  applyLanguage(language: string): void {
    this.bridge?.emit("ui.language", language);
  }

  private insertThemeCss(theme: TavoraTheme): Promise<void> {
    const contents = this.view.webContents;
    this.themeCssQueue = this.themeCssQueue.then(async () => {
      const previous = this.themeCssKey;
      try {
        this.themeCssKey = await contents.insertCSS(moduleThemeCss(theme), { cssOrigin: "user" });
        if (previous) await contents.removeInsertedCSS(previous);
      } catch {
        // The page went away; the next one gets the theme on dom-ready.
      }
    });
    return this.themeCssQueue;
  }

  /** Tells the module it is hidden; it should pause timers and animations. */
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.bridge?.emit("lifecycle.suspend", null);
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.bridge?.emit("lifecycle.resume", null);
  }

  /** Called when the page's preload answers a heartbeat ping. */
  pong(): void {
    this.lastPong = Date.now();
    if (this.status === "unresponsive") this.setStatus("ready");
  }

  /**
   * Chromium only notices a hung page when input goes unanswered, which
   * misses a panel nobody is clicking. The preload shares the page's main
   * thread, so if it stops answering pings, so has the page.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPong = Date.now();
    this.heartbeat = setInterval(() => {
      const contents = this.view.webContents;
      if (contents.isDestroyed()) return this.stopHeartbeat();
      contents.send("tavora:ping");
      if (this.status === "ready" && Date.now() - this.lastPong > UNRESPONSIVE_MS) this.setStatus("unresponsive");
    }, HEARTBEAT_MS);
  }

  /** Measures the module's browser storage now and then; a module cannot be left to fill the player's disk. */
  private startStorageWatch(): void {
    this.stopStorageWatch();
    const limit = this.options.storageLimit ?? MODULE_STORAGE_LIMIT;
    this.storageWatch = setInterval(() => {
      const contents = this.view.webContents;
      if (contents.isDestroyed()) return this.stopStorageWatch();
      const folder = contents.session.storagePath;
      if (!folder || this.measuring) return;
      this.measuring = true;
      overStorageLimit(folder, limit)
        .then((over) => {
          if (over) this.options.onStorageOver();
        })
        .catch(() => undefined)
        .finally(() => (this.measuring = false));
    }, STORAGE_CHECK_MS);
  }

  private stopStorageWatch(): void {
    clearInterval(this.storageWatch);
    this.storageWatch = undefined;
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  reload(): void {
    this.setStatus("loading");
    this.view.webContents.reload();
  }

  /** Ends a hung or misbehaving module. Its data stays; Reload starts it again. */
  stop(): void {
    const contents = this.view.webContents;
    if (contents.isDestroyed()) return;
    const pid = contents.getOSProcessId();
    contents.forcefullyCrashRenderer();
    // Chromium has been seen to leave a busy renderer running; make sure.
    setTimeout(() => {
      if (this.status === "crashed" || contents.isDestroyed() || contents.getOSProcessId() !== pid) return;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, 2_000);
  }

  dispose(): void {
    this.stopHeartbeat();
    this.stopStorageWatch();
    this.clearRevealTimers();
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
    // Only a running page is watched; it is restarted when the page loads again.
    if (status !== "ready" && status !== "unresponsive") this.stopHeartbeat();
    this.status = status;
    // A page that failed has nothing to wait for; show whatever it is.
    if (status === "failed" || status === "crashed") this.reveal();
    this.options.onStatus(status);
  }
}
