// The Browser panel's page (docs/browser-security.md). Unlike a module view
// it has no preload, no bridge and no IPC: the toolbar is drawn by the host
// UI, and the page is only ever told where to go by the main process.
import { session, WebContentsView, type Session, type WebContents } from "electron";
import type { BrowserState, InstanceStatus } from "../shared/host-api";
import { judgeRequest, type AdBlocker } from "./browser-filter";
import { addressToUrl, displayHost, isPrivateUrl, isWebUrl, parseUrl, siteOfUrl } from "./browser-url";
import { BROWSER_MODULE_ID } from "./registry";

/** Logins in a game's own session, or in the one shared by every game. */
export type BrowserKind = "game" | "shared";

/** The partition of a game's browser session; the shared one has no game. */
export function browserPartition(kind: BrowserKind, gameId: string): string {
  return kind === "shared" ? "persist:browser" : `persist:browser@${gameId}`;
}

/** How long after a click or key press a page may open a link in a new window. */
const GESTURE_MS = 1_000;

/** Permissions a page may have: copy buttons, and fullscreen that stays inside the panel. */
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"]);

/**
 * A plain Chrome user agent for the bundled Chromium, without "Electron",
 * "Tavora" or the app version, so sites work and Tavora is not fingerprinted.
 */
export function browserUserAgent(platform: NodeJS.Platform, chromeVersion: string): string {
  const os =
    platform === "win32" ? "Windows NT 10.0; Win64; x64" : platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "X11; Linux x86_64";
  const major = chromeVersion.split(".")[0] ?? "0";
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** What every browser session needs from the host. */
export interface BrowserSessionHooks {
  userAgent: string;
  ads: AdBlocker | null;
  /** The page address of a panel's contents, for requests made by that page; null when unknown. */
  topUrlOf(webContentsId: number | undefined): string | null;
  adblockOn(topUrl: string): boolean;
  onAdBlocked(webContentsId: number | undefined): void;
  onDownloadRefused(webContents: WebContents | null): void;
}

const hardened = new WeakSet<Session>();

/**
 * A browser session, made safe once: only web requests, nothing local from
 * a public page, ads blocked, every permission but two denied, no downloads,
 * and no Tavora protocol. Sessions are shared by the panels of one game (or
 * by all games for the shared one), so hooks look the panel up by contents.
 */
export function browserSession(partition: string, hooks: BrowserSessionHooks): Session {
  const ses = session.fromPartition(partition);
  if (hardened.has(ses)) return ses;
  hardened.add(ses);

  ses.setUserAgent(hooks.userAgent);
  ses.setSpellCheckerEnabled(false);
  ses.webRequest.onBeforeRequest((details, callback) => {
    const verdict = judgeRequest(
      { url: details.url, resourceType: details.resourceType, topUrl: hooks.topUrlOf(details.webContentsId) },
      hooks.ads,
      hooks.adblockOn,
    );
    if (verdict === "ad") hooks.onAdBlocked(details.webContentsId);
    callback({ cancel: verdict !== "allow" });
  });
  ses.setPermissionRequestHandler((_contents, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  ses.on("select-hid-device", (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.on("select-serial-port", (event, _ports, _contents, callback) => {
    event.preventDefault();
    callback("");
  });
  ses.on("select-usb-device", (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.on("will-download", (event, _item, contents) => {
    event.preventDefault();
    hooks.onDownloadRefused(contents ?? null);
  });
  return ses;
}

export interface BrowserPanelOptions {
  instanceId: string;
  devTools: boolean;
  background(): string;
  sessionFor(kind: BrowserKind): Session;
  /** Whether a page address belongs to a site the player signs in to for all games. */
  isSharedSite(url: string): boolean;
  adblockOn(url: string): boolean;
  /** Puts a new view in the window in place of the old one (null when the panel opens). */
  swap(previous: WebContentsView | null, next: WebContentsView): void;
  /** Ctrl+L in the page: the toolbar's address bar takes the focus. */
  onFocusAddress(): void;
  /** The page went somewhere new; the address is kept so the panel reopens there. */
  onAddress(url: string): void;
  onChange(): void;
}

/** Corner radius of a panel card in the host UI (dock.css), in px; the page sits below the toolbar. */
const PAGE_RADIUS = 9;

/** One Browser panel. Its page view is replaced when it moves between a game's and the shared session. */
export class BrowserPanel {
  readonly moduleId = BROWSER_MODULE_ID;
  view: WebContentsView;
  status: InstanceStatus = "ready";
  private kind: BrowserKind = "game";
  private bounds: { x: number; y: number; width: number; height: number } | null = null;
  private visible = false;
  /** The page's address once it committed; requests of the page are judged against it. */
  private committedUrl: string | null = null;
  /** The address of the current hop of a navigation, to judge where a redirect goes. */
  private hopUrl: string | null = null;
  /** The address last asked for: shown until a page commits, and tried again by Reload when it failed. */
  private requestedUrl: string | null = null;
  private error: string | null = null;
  private blocked = 0;
  private fullscreen = false;
  private downloadsRefused = 0;
  private lastGesture = 0;
  private changeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: BrowserPanelOptions) {
    this.view = this.createView();
  }

  /** Puts the page's view in the window; called once, after the host has registered the panel. */
  attach(): void {
    this.options.swap(null, this.view);
  }

  /** Opens the address the panel showed last time, unless the player already went somewhere. */
  restore(url: unknown): void {
    if (typeof url !== "string" || !isWebUrl(url) || this.committedUrl !== null || this.requestedUrl !== null) return;
    this.open(url, this.kindFor(url));
  }

  get instanceId(): string {
    return this.options.instanceId;
  }

  get webContentsId(): number {
    return this.view.webContents.id;
  }

  /** The address requests of this panel's page are judged against. */
  get topUrl(): string | null {
    return this.committedUrl;
  }

  private createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.options.sessionFor(this.kind),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        // HTML fullscreen fills the page view; the window stays as it is.
        disableHtmlFullscreenWindowResize: true,
        devTools: this.options.devTools,
      },
    });
    view.setBackgroundColor(this.options.background());
    view.setBorderRadius(PAGE_RADIUS);
    view.setVisible(false);
    this.watch(view.webContents);
    return view;
  }

  private watch(contents: WebContents): void {
    const current = () => this.view.webContents === contents;
    contents.setWebRTCIPHandlingPolicy("default_public_interface_only");
    contents.on("will-attach-webview", (event) => event.preventDefault());
    // A page may open a link in a "new window" only right after the player
    // clicked or typed; it then opens in this panel instead.
    contents.on("input-event", (_event, input) => {
      if (input.type === "mouseDown" || input.type === "keyDown" || input.type === "gestureTap") this.lastGesture = Date.now();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (Date.now() - this.lastGesture < GESTURE_MS) setImmediate(() => current() && this.follow(url));
      return { action: "deny" };
    });
    contents.on("will-navigate", (event) => {
      if (!this.mayFollow(event.url)) return event.preventDefault();
      const kind = this.kindFor(event.url);
      if (kind !== this.kind) {
        event.preventDefault();
        this.open(event.url, kind);
      }
    });
    contents.on("will-frame-navigate", (event) => {
      if (event.isMainFrame) return;
      const url = parseUrl(event.url);
      if (!url || !["http:", "https:", "about:", "data:", "blob:"].includes(url.protocol)) event.preventDefault();
    });
    contents.on("did-start-navigation", (event) => {
      if (event.isMainFrame && !event.isSameDocument) this.hopUrl = event.url;
    });
    contents.on("will-redirect", (event) => {
      if (!event.isMainFrame) return;
      const from = this.hopUrl ?? this.committedUrl ?? "";
      if (!isWebUrl(event.url) || (isPrivateUrl(event.url) && !isPrivateUrl(from))) return event.preventDefault();
      this.hopUrl = event.url;
    });
    contents.on("did-navigate", (_event, url) => {
      if (!current()) return;
      this.committedUrl = url;
      this.error = null;
      this.requestedUrl = null;
      this.blocked = 0;
      this.applyVisibility();
      if (isWebUrl(url)) this.options.onAddress(url);
      this.changed();
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!current() || !isMainFrame) return;
      this.committedUrl = url;
      if (isWebUrl(url)) this.options.onAddress(url);
      this.changed();
    });
    contents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation replaced by another, or one we refused.
      if (!current() || !isMainFrame || errorCode === -3) return;
      this.requestedUrl = url;
      this.error = loadError(errorCode, description);
      this.applyVisibility();
      this.changed();
    });
    for (const name of ["did-start-loading", "did-stop-loading", "page-title-updated", "audio-state-changed"] as const) {
      contents.on(name as "did-start-loading", () => current() && this.changed());
    }
    contents.on("enter-html-full-screen", () => {
      this.fullscreen = true;
      this.changed();
    });
    contents.on("leave-html-full-screen", () => {
      this.fullscreen = false;
      this.changed();
    });
    // Esc always leaves fullscreen, whatever the page does with the key.
    // Browser keys come before the page: Ctrl+L, Alt+Left and Alt+Right.
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const mod = process.platform === "darwin" ? input.meta : input.control;
      if (this.fullscreen && input.key === "Escape") this.exitFullscreen();
      else if (mod && !input.alt && !input.shift && input.key.toLowerCase() === "l") this.options.onFocusAddress();
      else if (input.alt && !mod && input.key === "ArrowLeft") this.back();
      else if (input.alt && !mod && input.key === "ArrowRight") this.forward();
      else return;
      event.preventDefault();
    });
    contents.on("unresponsive", () => {
      if (current() && this.status === "ready") this.setStatus("unresponsive");
    });
    contents.on("responsive", () => {
      if (current() && this.status === "unresponsive") this.setStatus("ready");
    });
    contents.on("render-process-gone", (_event, details) => {
      if (!current()) return;
      console.warn(`[tavora] browser page gone: ${details.reason}`);
      this.fullscreen = false;
      this.setStatus("crashed");
      this.applyVisibility();
    });
  }

  private kindFor(url: string): BrowserKind {
    return this.options.isSharedSite(url) ? "shared" : "game";
  }

  /** Whether the page may take the panel to an address: web only, and not from a public page to a local one. */
  private mayFollow(url: string): boolean {
    return isWebUrl(url) && !(isPrivateUrl(url) && !isPrivateUrl(this.committedUrl ?? ""));
  }

  /** A link the page opened in a new window. */
  private follow(url: string): void {
    if (this.mayFollow(url)) this.open(url, this.kindFor(url));
  }

  /** Goes to what the player typed in the address bar. */
  navigate(address: string): void {
    const url = addressToUrl(address);
    if (url) this.open(url, this.kindFor(url));
  }

  /** Loads an address, first moving to the other session's view when the site needs it. */
  private open(url: string, kind: BrowserKind): void {
    if (kind !== this.kind) {
      const previous = this.view;
      this.kind = kind;
      this.view = this.createView();
      this.committedUrl = null;
      this.fullscreen = false;
      this.options.swap(previous, this.view);
      if (this.bounds) this.view.setBounds(this.bounds);
      if (!previous.webContents.isDestroyed()) previous.webContents.close();
    }
    this.load(url);
  }

  private load(url: string): void {
    this.error = null;
    this.requestedUrl = url;
    this.setStatus("ready");
    void this.view.webContents.loadURL(url).catch(() => {
      // Failures surface through did-fail-load.
    });
    this.applyVisibility();
    this.changed();
  }

  /** The player changed whether this site signs in for all games: the page reloads in the right session. */
  siteSettingsChanged(): void {
    const url = this.committedUrl ?? this.requestedUrl;
    if (!url || !isWebUrl(url)) return this.changed();
    const kind = this.kindFor(url);
    if (kind !== this.kind) this.open(url, kind);
    else this.changed();
  }

  back(): void {
    const history = this.view.webContents.navigationHistory;
    if (history.canGoBack()) history.goBack();
  }

  forward(): void {
    const history = this.view.webContents.navigationHistory;
    if (history.canGoForward()) history.goForward();
  }

  /** Stops loading the page. */
  stopLoading(): void {
    this.view.webContents.stop();
  }

  setMuted(muted: boolean): void {
    this.view.webContents.setAudioMuted(muted);
    this.changed();
  }

  exitFullscreen(): void {
    if (!this.fullscreen) return;
    void this.view.webContents.executeJavaScript("document.exitFullscreen().catch(() => {})", true).catch(() => undefined);
  }

  /** The address to hand to the system browser: the page's own, web only. */
  get externalUrl(): string | null {
    const url = this.committedUrl ?? this.requestedUrl;
    return url && isWebUrl(url) ? url : null;
  }

  /** What the toolbar shows. */
  get state(): BrowserState {
    const contents = this.view.webContents;
    const destroyed = contents.isDestroyed();
    const url = (this.error ? this.requestedUrl : null) ?? this.committedUrl ?? this.requestedUrl ?? "";
    const parsed = isWebUrl(url) ? parseUrl(url) : null;
    const history = destroyed ? null : contents.navigationHistory;
    return {
      url,
      host: parsed ? displayHost(parsed.hostname) : "",
      title: this.error || destroyed ? "" : pageTitle(contents.getTitle(), url),
      secure: parsed?.protocol === "https:",
      loading: !destroyed && contents.isLoading(),
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
      site: siteOfUrl(url),
      shared: this.kind === "shared",
      adblock: parsed ? this.options.adblockOn(url) : true,
      blocked: this.blocked,
      error: this.status === "crashed" ? "This page crashed." : this.error,
      fullscreen: this.fullscreen,
      audible: !destroyed && contents.isCurrentlyAudible(),
      muted: !destroyed && contents.isAudioMuted(),
      downloadsRefused: this.downloadsRefused,
    };
  }

  adBlocked(): void {
    this.blocked++;
    this.changedSoon();
  }

  downloadRefused(): void {
    this.downloadsRefused++;
    this.changed();
  }

  /** Whether the page itself is on screen; otherwise the host UI shows the start page or the error. */
  private get showsPage(): boolean {
    return (this.committedUrl !== null || this.requestedUrl !== null) && this.error === null && this.status !== "crashed";
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = bounds;
    this.view.setBounds(bounds);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    this.view.setVisible(this.visible && this.showsPage);
  }

  /** Whether a still image of the page can stand in for it while a menu is open. */
  get capturable(): boolean {
    return this.showsPage;
  }

  applyTheme(_theme?: unknown): void {
    this.view.setBackgroundColor(this.options.background());
  }

  /** A hidden page keeps running, like a background tab; Chromium throttles its timers. */
  suspend(): void {}

  resume(): void {}

  reload(): void {
    if (this.status === "crashed" || this.error) {
      const url = this.requestedUrl ?? this.committedUrl;
      this.setStatus("ready");
      if (url) this.load(url);
      return;
    }
    this.view.webContents.reload();
  }

  /** Ends a hung page; Reload opens it again. */
  stop(): void {
    const contents = this.view.webContents;
    if (!contents.isDestroyed()) contents.forcefullyCrashRenderer();
  }

  dispose(): void {
    clearTimeout(this.changeTimer);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }

  private setStatus(status: InstanceStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.changed();
  }

  private changed(): void {
    clearTimeout(this.changeTimer);
    this.changeTimer = undefined;
    this.options.onChange();
  }

  /** Ad counts change in bursts; the toolbar is told a little later. */
  private changedSoon(): void {
    this.changeTimer ??= setTimeout(() => this.changed(), 250);
  }
}

/** The page's own title; Chromium falls back to the address, which is not one. */
function pageTitle(title: string, url: string): string {
  const bare = url.replace(/^https?:\/\//, "");
  return title === url || title === bare || url.startsWith(`${title}`) || bare.startsWith(title) ? "" : title;
}

/** A short, plain reason a page did not load. */
export function loadError(code: number, description: string): string {
  if (code <= -200 && code > -300) return "This site's security certificate isn't trusted, so Tavora won't open it.";
  if (code === -105 || code === -137) return "Tavora couldn't find this site. Check the address.";
  if (code === -106) return "You're offline.";
  if (code === -102 || code === -118 || code === -7) return "The site didn't answer.";
  if (code === -20 || code === -21 || code === -27) return "Tavora doesn't open this kind of address.";
  return `The page couldn't be opened (${description || code}).`;
}
