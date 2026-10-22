import { ReadOnlyFiles } from './read-only-files';
import { serveReadOnlyFile } from './read-only-files-http';
import { READ_ONLY_FILE_PATH } from '@tavora/sdk/protocol';
import { readFile } from "node:fs/promises";
import path from "node:path";
import { app, clipboard, ClipboardItem, MessageChannelMain, session, WebContentsView, type Session } from "electron";
import type { Capability, HotkeyBinding, HotkeySetResult, JsonValue, OverlayLinkResult, TavoraGame, TavoraTheme, TavoraViewport } from "@tavora/sdk/protocol";
import type { ResolvedPanelType } from "@tavora/module-schema";
import { modulePartition } from "./gamedata";
import { moduleThemeCss } from "./module-style";
import { contentTypeFor, moduleCsp, MODULE_SCHEME, resolveAsset } from "./assets";
import { BLOB_PATH, CLIPBOARD_PATH, PICTURES_PATH, JSON_EXPORT_PATH } from "@tavora/sdk/protocol";
import { BridgeSession, type BridgeContext } from "./bridge";
import { moduleReadPage } from "./page-import";
import type { CheckedMenu } from "./module-menu";
import type {TooltipRequest,TooltipAnchor} from "@tavora/sdk/protocol";
import type { PanelContent, PanelLaunch } from "./panel-content";
import { LIMITS, type PanelOpenResult } from "@tavora/sdk/protocol";
import type { DiscordConnector, DiscordListener } from "./discord";
import type { BlobStore } from "./blobs";
import { serveBlobs } from "./blob-http";
import { serveClipboard } from "./clipboard-http";
import { savePictureFile, servePictureSave } from "./picture-save-http";
import { saveJsonExport, serveJsonExport } from './json-export-http';
import { isWebUrl } from "./browser-url";
import { HostError } from "./errors";
import { moduleFetch, type TestHosts } from "./network";
import type { InstalledModule } from "./registry";
import type { InstanceStatus } from "../shared/host-api";
import type { ModuleData, ModuleStore, PanelStateStore } from "./storage";
import { MODULE_STORAGE_LIMIT, overStorageLimit, STORAGE_CHECK_MS } from "./storage-guard";

export type { InstanceStatus } from "../shared/host-api";

export interface ModuleViewOptions {
  instanceId: string;
  module: InstalledModule;
  /** The panel type this panel shows (its page comes from it), or null for a module without types. */
  panelType: ResolvedPanelType | null;
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
  /** Shows a module's menu in the host UI, over this panel (host.ts); resolves with the chosen id, or null. */
  showMenu(menu: CheckedMenu): Promise<string | null>;
  pickReadOnlyFile?(extensions:string[]):Promise<string|null>;
  tooltip?: {
    show(request:TooltipRequest):Promise<boolean>;
    move(anchor:TooltipAnchor):void;
    close(id?:string,hoverOnly?:boolean):void;
  };
  /** Why the panel's page is loading (panel.getLaunch); asked once for each page load. */
  launch(): PanelLaunch;
  /** What the panel shows now (panel.setContent), already checked. */
  setContent(content: PanelContent | null): void;
  /** panels.open from this panel, after its click was taken: the host picks or opens the destination. */
  openPanel(type: string, content: PanelContent | null): Promise<PanelOpenResult>;
  /** Hosts the player granted this module for network.fetch, as installed now; asked on every call and redirect. */
  networkHosts(): ReadonlySet<string>;
  /** Connectors the player granted this module, as installed now; asked on every call. */
  connectors(): ReadonlySet<string>;
  /** The module's settings shared by every game (storage.app). */
  appSettings: ModuleStore;
  /** The ai-usage connector, for a module granted it. */
  aiUsage: BridgeContext["aiUsage"];
  /** The discord connector, shared by every panel; this view uses it under its own instance id. */
  discord: Pick<DiscordConnector, "use" | "release" | "state" | "connectNow" | "allowControl" | "command" | "subscribe" | "unsubscribe" | "image">;
  /** Stream overlays of this module in this game, for a module granted the stream-overlay connector. */
  overlay: { publish(key: string, state: JsonValue): void; remove(key: string): void; copyLink(key: string): Promise<OverlayLinkResult>; resetLink(key: string): void };
  /** Hotkeys of this module in this game; `set` opens Tavora's hotkey dialog. */
  hotkeys: { list(): HotkeyBinding[]; set(action: string, target: string, label: string): Promise<HotkeySetResult>; remove(target: string, action: string | null): void };
  /** Test runs only: hosts mapped to a local server (network.ts). */
  testHosts?: TestHosts;
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
 * When the player last clicked or pressed a key in a page of this session (one module in one game). The clipboard
 * address is answered by the session, which cannot tell its panels apart, so this is kept per session; all of its
 * panels are the same module.
 */
const sessionGestures = new WeakMap<Session, { at: number }>();

function gestureOf(ses: Session): { at: number } {
  let gesture = sessionGestures.get(ses);
  if (!gesture) sessionGestures.set(ses, (gesture = { at: 0 }));
  return gesture;
}

async function writeClipboardPicture(png: Buffer): Promise<void> {
  await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
}

/** Where modules save pictures: a Tavora folder in the player's Pictures (tests point Pictures elsewhere, unpackaged only). */
function picturesFolder(): string {
  const pictures = !app.isPackaged && process.env.TAVORA_PICTURES_DIR ? path.resolve(process.env.TAVORA_PICTURES_DIR) : app.getPath("pictures");
  return path.join(pictures, "Tavora");
}

/**
 * Every module gets its own session per game: separate cookies, web storage,
 * cache and a separate renderer process from the host and other modules.
 */
function moduleSession(module: InstalledModule, game: TavoraGame, blobs: BlobStore): Session {
  const ses = session.fromPartition(modulePartition(module.owner, module.manifest.id, game.id));
  if (hardened.has(ses)) return ses;
  hardened.add(ses);

  const origin = moduleOrigin(module.manifest.id);
  // WebAssembly only for a module of Tavora's own that asked for it (the registry refuses the request from any other).
  const csp = moduleCsp(module.provenance === "official" && module.manifest.permissions.webAssembly === true);

  ses.protocol.handle(MODULE_SCHEME, async (request) => {
    // URL.origin is "null" for custom schemes in Node, so compare the host.
    const url = new URL(request.url);
    if (url.host !== module.manifest.id) return new Response("Not found", { status: 404 });
    if (url.pathname.startsWith(READ_ONLY_FILE_PATH)) return serveReadOnlyFile(request,url.pathname.slice(READ_ONLY_FILE_PATH.length),new ReadOnlyFiles(app.getPath('userData'),module.owner,module.manifest.id,game.id));
    if (url.pathname.startsWith(BLOB_PATH)) return serveBlobs(blobs, request, url);
    if (url.pathname === CLIPBOARD_PATH) {
      const gesture = gestureOf(ses);
      return serveClipboard(request, { allowed: () => Date.now() - gesture.at <= GESTURE_MS, consume: () => void (gesture.at = 0), write: writeClipboardPicture });
    }
    if (url.pathname === JSON_EXPORT_PATH) {
      const gesture = gestureOf(ses);
      const downloads = !app.isPackaged && process.env.TAVORA_EXPORTS_DIR ? path.resolve(process.env.TAVORA_EXPORTS_DIR) : path.join(app.getPath('downloads'), 'Tavora');
      return serveJsonExport(request, url, { allowed: () => Date.now() - gesture.at <= GESTURE_MS, consume: () => void (gesture.at = 0), save: (data, name) => saveJsonExport(downloads, data, name) });
    }
    if (url.pathname === PICTURES_PATH) {
      const gesture = gestureOf(ses);
      return servePictureSave(request, url, {
        allowed: () => Date.now() - gesture.at <= GESTURE_MS,
        consume: () => void (gesture.at = 0),
        save: (png, name) => savePictureFile(picturesFolder(), png, name),
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const file = await resolveAsset(module.root, url.pathname);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : await readFile(file), {
      headers: {
        "Content-Type": contentTypeFor(file),
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });

  // The page itself gets no network: every request that is not for the
  // module's own bundle is cancelled. Granted hosts are reached only through
  // network.fetch, which the main process makes (network.ts).
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
export const SETTLE_MS = 150;
export const NO_BRIDGE_MS = 400;
export const REVEAL_CAP_MS = 2_000;
/** How a panel answered panel.navigate. */
export type NavigateOutcome = "switched" | "failed" | "unhandled";

/** How long after a click or key press a link may be opened. */
export const GESTURE_MS = 2_000;
/**
 * How long a call that needs a click waits for it. The preload reports clicks on another channel than
 * the bridge, so the report can land just after the call the click made.
 */
const GESTURE_LATE_MS = 250;

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
  /** When the player last clicked or typed in this panel, or when it opened; panels.open switches the one used last. */
  usedAt = Date.now();
  private nextNavigation = 1;
  /** panel.navigate requests waiting for the page's answer. */
  private readonly navigations = new Map<number, (outcome: NavigateOutcome) => void>();

  constructor(private readonly options: ModuleViewOptions) {
    const { module, game } = options;
    this.view = new WebContentsView({
      webPreferences: {
        session: moduleSession(module, game, options.data.blobs),
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
    void contents.loadURL(`${origin}/${options.panelType?.entry ?? module.manifest.entry}`).catch(() => {
      // Load failures surface through did-fail-load / render-process-gone.
    });
  }

  /** When the player last clicked or pressed a key in the page (reported by the preload from real input only). */
  private gestureAt = 0;
  private pointer:{x:number;y:number;at:number}|null=null;
  notePointer(raw:unknown):void{
    if(raw===null){this.pointer=null;this.options.tooltip?.close(undefined,true);return;}
    if(!raw||typeof raw!=="object")return;
    const p=raw as {x:unknown;y:unknown};
    if(typeof p.x!=="number"||typeof p.y!=="number"||!Number.isFinite(p.x)||!Number.isFinite(p.y))return;
    this.pointer={x:p.x,y:p.y,at:Date.now()};
  }
  private tooltipAnchorAllowed(at:{x:number;y:number}):boolean{
    return at.x>=0&&at.y>=0&&at.x<=this.viewport.width&&at.y<=this.viewport.height&&!this.suspended;
  }
  private tooltipPointerMatches(at:{x:number;y:number}):boolean{
    const p=this.pointer;return !!p&&Date.now()-p.at<2000&&Math.abs(p.x-at.x)<40&&Math.abs(p.y-at.y)<40;
  }
  tooltipClosed(id:string):void{this.bridge?.emit("ui.tooltipClosed",{id});}

  /** Calls waiting for a click report that is still on its way (takeGestureSoon). */
  private readonly gestureWaiters = new Set<() => void>();

  noteGesture(): void {
    this.gestureAt = Date.now();
    this.usedAt = this.gestureAt;
    gestureOf(this.view.webContents.session).at = this.gestureAt;
    for (const wake of this.gestureWaiters) wake();
  }

  /**
   * Something only a click or key press in the page may do, once per click. Waits a moment first for a click
   * whose report has not arrived yet.
   */
  private async takeGesture(what: string): Promise<void> {
    if (Date.now() - this.gestureAt > GESTURE_MS) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.gestureWaiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, GESTURE_LATE_MS);
        this.gestureWaiters.add(done);
      });
    }
    if (Date.now() - this.gestureAt > GESTURE_MS) throw new HostError("PERMISSION_DENIED", `${what} must be called right after a click or key press`);
    this.gestureAt = 0;
  }

  /** links.open: only a web address, and only right after the player did something in the page. */
  private async openLink(url: string): Promise<void> {
    if (!isWebUrl(url)) throw new HostError("INVALID_PARAMS", "params.url must be an http or https address");
    // One click opens one link, so a script cannot open a pile of them.
    await this.takeGesture("links.open");
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
    const pageImports = new AbortController();
    const bridge: BridgeSession = new BridgeSession(
      port1,
      {
        hostVersion,
        moduleId: module.manifest.id,
        moduleVersion: module.manifest.version,
        instanceId,
        panelType: this.options.panelType?.id ?? null,
        launch: this.options.launch(),
        setContent: this.options.setContent,
        openPanel: async (type, content) => {
          // One click opens or switches one panel, so a page cannot keep panels coming on its own.
          await this.takeGesture("panels.open");
          return this.options.openPanel(type, content);
        },
        navigated: (requestId, handled, ok) => {
          if (this.bridge === bridge) this.navigated(requestId, handled, ok);
        },
        game,
        data,
        panelState,
        appSettings: this.options.appSettings,
        aiUsage: this.options.aiUsage,
        discord: this.discordFor(() => bridge),
        capabilities: () => this.capabilities(),
        readPage: (params) => moduleReadPage(params, {
          allowedHosts: this.options.networkHosts,
          userAgent: `Tavora/${hostVersion} (module ${module.manifest.id})`,
        }, module.manifest.id, pageImports.signal),
        fetch: (params) =>
          moduleFetch(params, {
            allowedHosts: this.options.networkHosts,
            userAgent: `Tavora/${hostVersion} (module ${module.manifest.id})`,
            ...(this.options.testHosts ? { testHosts: this.options.testHosts } : {}),
          }),
        getViewport: () => ({ ...this.viewport }),
        isSuspended: () => this.suspended,
        getTheme: this.options.getTheme,
        getLanguage: this.options.getLanguage,
        onBusy: (busy, served) => this.onBridgeBusy(busy, served),
        openLink: (url) => this.openLink(url),
        tooltip:{
          show:async request=>{
            if(!this.tooltipAnchorAllowed(request.at))return false;
            if(request.pinned)await this.takeGesture("ui.tooltip.show pinned");
            else {
              if(!this.tooltipPointerMatches(request.at))await new Promise(resolve=>setTimeout(resolve,40));
              if(!this.tooltipPointerMatches(request.at)&&Date.now()-this.gestureAt>2000)return false;
            }
            if(this.bridge!==bridge)return false;
            return this.options.tooltip?.show(request)??false;
          },
          move:anchor=>{if(this.tooltipAnchorAllowed(anchor.at)&&this.tooltipPointerMatches(anchor.at))this.options.tooltip?.move(anchor);},
          close:(id,hoverOnly)=>this.options.tooltip?.close(id,hoverOnly),
        },
        readOnlyFiles: {
          pick: async extensions => {
            await this.takeGesture('files.pickReadOnly');
            const selected = await this.options.pickReadOnlyFile?.(extensions);
            if (!selected || this.bridge !== bridge) return null;
            return new ReadOnlyFiles(app.getPath('userData'),module.owner,module.manifest.id,game.id).remember(selected,()=>this.bridge===bridge);
          },
          forget: id => new ReadOnlyFiles(app.getPath('userData'),module.owner,module.manifest.id,game.id).forget(id),
        },
        showMenu: async (menu) => {
          // One click opens one menu, so a page cannot keep menus coming on its own.
          await this.takeGesture("ui.showMenu");
          return this.options.showMenu(menu);
        },
        overlay: {
          publish: (key, state) => this.options.overlay.publish(key, state),
          remove: (key) => this.options.overlay.remove(key),
          copyLink: async (key) => {
            // One click copies one link, so a page cannot keep the clipboard to itself.
            await this.takeGesture("overlay.copyLink");
            return this.options.overlay.copyLink(key);
          },
          resetLink: (key) => this.options.overlay.resetLink(key),
        },
        hotkeys: {
          list: () => this.options.hotkeys.list(),
          set: async (action, target, label) => {
            if (!(module.manifest.actions ?? []).some((item) => item.id === action)) throw new HostError("INVALID_PARAMS", `this module has no action "${action}" in its manifest`);
            // Tavora's dialog takes the key; one click opens it once.
            await this.takeGesture("hotkeys.set");
            return this.options.hotkeys.set(action, target, label);
          },
          remove: (target, action) => this.options.hotkeys.remove(target, action),
        },
      },
      () => {
        pageImports.abort();
        if (this.bridge !== bridge) return;
        this.options.tooltip?.close();
        this.bridge = undefined;
        this.options.discord.release(this.options.instanceId);
      },
    );
    this.bridge = bridge;
    this.view.webContents.postMessage("tavora:port", null, [port2]);
  }

  /** What the player has granted now (grants.ts): `network` with any granted host, `aiUsage`, `discord` and `overlay` with their connectors. */
  private capabilities(): ReadonlySet<Capability> {
    const granted = new Set<Capability>();
    if (this.options.networkHosts().size > 0) granted.add("network");
    if (this.options.connectors().has("ai-usage")) granted.add("aiUsage");
    if (this.options.connectors().has("discord")) granted.add("discord");
    if (this.options.connectors().has("stream-overlay")) granted.add("overlay");
    return granted;
  }

  /**
   * The discord connector as this panel uses it. Any call but image() makes the panel a user, which
   * keeps the connection running until the page goes; what the connector tells reaches only the page
   * that asked, and only while the grant lasts. Signing in, joining or leaving a channel, and muting or
   * deafening the player need a click or key press in the page first, one per click.
   */
  private discordFor(bridge: () => BridgeSession): BridgeContext["discord"] {
    const connector = this.options.discord;
    const instanceId = this.options.instanceId;
    const listener: DiscordListener = {
      state: (state) => {
        if (this.bridge === bridge() && this.capabilities().has("discord")) bridge().emit("discord.state", state);
      },
      event: (event) => {
        if (this.bridge === bridge() && this.capabilities().has("discord")) bridge().emit("discord.event", event);
      },
    };
    const use = () => connector.use(instanceId, listener);
    return {
      state: async () => (await use(), connector.state()),
      connect: async () => {
        await this.takeGesture("discord.connect");
        await use();
        await connector.connectNow();
      },
      allowControl: async () => {
        await this.takeGesture("discord.allowControl");
        await use();
        await connector.allowControl();
      },
      command: async (command, args) => {
        // Joining or leaving, and muting or deafening the player (which can switch their microphone back on),
        // only follow a click or key press (D8). A person's volume streams while a slider is dragged, and only
        // changes what the player hears, so it needs none.
        if (command === "SELECT_VOICE_CHANNEL" || command === "SET_VOICE_SETTINGS") await this.takeGesture(command);
        await use();
        return connector.command(command, args);
      },
      subscribe: async (event, channelId) => {
        await use();
        await connector.subscribe(instanceId, event, channelId);
      },
      unsubscribe: (event, channelId) => connector.unsubscribe(instanceId, event, channelId),
      image: (url) => connector.image(url),
    };
  }

  /** The player pressed a hotkey set for this module in this game. */
  hotkeyPressed(binding: HotkeyBinding): void {
    this.bridge?.emit("hotkeys.pressed", { ...binding });
  }

  /** The player changed the AI accounts; a module granted the connector hears it. */
  notifyAiUsageAccounts(): void {
    if (this.capabilities().has("aiUsage")) this.bridge?.emit("aiUsage.accountsChanged", null);
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
    this.options.tooltip?.close();
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

  /**
   * Ends a hung or misbehaving module. Its data stays; Reload starts it again.
   * Resolves once the renderer is gone, so a reload after it is not undone by
   * the crash arriving late.
   */
  stop(): Promise<void> {
    const contents = this.view.webContents;
    if (contents.isDestroyed()) return Promise.resolve();
    const gone = new Promise<void>((resolve) => {
      contents.once("render-process-gone", () => resolve());
      contents.once("destroyed", () => resolve());
      setTimeout(resolve, 5_000);
    });
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
    return gone;
  }

  dispose(): void {
    this.stopHeartbeat();
    this.stopStorageWatch();
    this.clearRevealTimers();
    this.bridge?.emit("lifecycle.dispose", null);
    this.disconnect();
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }

  /**
   * Asks the page to switch to other content (panel.onNavigate). It saves first; `failed` when it could not or did
   * not answer within navigateTimeoutMs (it keeps what it showed), `unhandled` when the page takes no navigation.
   */
  navigate(content: PanelContent): Promise<NavigateOutcome> {
    const bridge = this.bridge;
    if (!bridge || !bridge.ready || this.status !== "ready") return Promise.resolve("failed");
    const requestId = this.nextNavigation++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish("failed"), LIMITS.navigateTimeoutMs);
      const finish = (outcome: NavigateOutcome) => {
        clearTimeout(timer);
        if (this.navigations.delete(requestId)) resolve(outcome);
      };
      this.navigations.set(requestId, finish);
      bridge.emit("panel.navigate", { requestId, content: { ...content } });
    });
  }

  private navigated(requestId: number, handled: boolean, ok: boolean): void {
    this.navigations.get(requestId)?.(!handled ? "unhandled" : ok ? "switched" : "failed");
  }

  private disconnect(): void {
    this.options.tooltip?.close();this.pointer=null;
    // A page that goes away answers nothing more.
    for (const finish of [...this.navigations.values()]) finish("failed");
    this.bridge?.close();
    this.bridge = undefined;
    this.options.discord.release(this.options.instanceId);
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
