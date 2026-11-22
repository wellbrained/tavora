// The Browser panel's page (the Browser security notes). Unlike a module view
// it has no preload, no bridge and no IPC: the toolbar is drawn by the host
// UI, and the page is only ever told where to go by the main process.
import { session, WebContentsView, type Referrer, type Session, type WebContents } from "electron";
import type { PanelCorners } from "./panel-corners";
import type { BrowserError, BrowserState, InstanceStatus } from "../shared/host-api";
import { judgedTopUrl, judgeRequest, type AdBlocker } from "./browser-filter";
import { addressToUrl, displayHost, isPrivateUrl, isWebUrl, parseUrl, siteOfUrl } from "./browser-url";
import { shortcutIn } from "../shared/shortcuts";
import { BROWSER_MODULE_ID } from "./registry";
import { stillOf } from "./panel-still";
import { lockDevices } from "./devices";
import type { PanelViewAdapter } from "./panel-views";

/** Logins in a workspace's own session, or in the one shared by every workspace. */
export type BrowserKind = "workspace" | "shared";

/** The partition of a workspace's browser session; the shared one has no workspace. */
export function browserPartition(kind: BrowserKind, workspaceId: string): string {
  return kind === "shared" ? "persist:browser" : `persist:browser@${workspaceId}`;
}

/** How long after a click or key press a page may open a link in a new window, or take the panel to the other session. */
const GESTURE_MS = 1_000;

/**
 * How a main-frame navigation started: by the user (the address bar, a tab Tavora opened for a click, Open while the
 * panel asks), by the page, and then whether right after a click or key press in it, or by Tavora going again to an
 * address the page may have chosen itself (`restored`: the address the panel showed last time, Reload, Back, Forward,
 * Try again). `referrer` is what its first request sent.
 */
export type NavigationStart =
  | { by: "user"; referrer?: Referrer | undefined }
  | { by: "page"; gesture: boolean; referrer?: Referrer | undefined }
  | { by: "restored" };

/** Tavora reopens an address no click of the user's chose now: it is loaded, but its redirects to the other session ask. */
const RESTORED: NavigationStart = { by: "restored" };

/**
 * What happens to a navigation that has to move to the other session (a site signed in for all workspaces, or away from
 * one). Tavora can carry it there only by loading the address itself, and Chromium treats that like a typed address:
 * SameSite=Strict cookies go along and `Sec-Fetch-Site` says `none`. So that happens only when the user started the
 * navigation, or the page did right after a click or key press in it; it keeps the referrer the page would have sent.
 * Otherwise the panel asks: it shows where the page wants to go, and the user's press opens it there. So does a redirect
 * of an address Tavora reopened by itself (`restored`): the page may have put it there to be loaded later.
 */
export function crossSessionStep(start: NavigationStart): { action: "reissue"; referrer: Referrer | undefined } | { action: "ask" } {
  if (start.by === "restored" || (start.by === "page" && !start.gesture)) return { action: "ask" };
  return { action: "reissue", referrer: start.referrer };
}

/**
 * The referrer a page's own navigation sends, as far as Tavora can tell from outside the page: its origin only (the
 * default for a link to another site, which every session switch is), and nothing from a page that isn't on the web
 * or from https to http. The page's own referrer policy is not readable from here.
 */
export function pageReferrer(pageUrl: string | null): Referrer | undefined {
  const url = pageUrl && isWebUrl(pageUrl) ? parseUrl(pageUrl) : null;
  return url ? { url: `${url.origin}/`, policy: "strict-origin" } : undefined;
}

/** A site's home page: its origin and nothing a page could have chosen after it. */
function siteHome(url: string): string {
  const parsed = parseUrl(url);
  return parsed ? `${parsed.origin}/` : url;
}

/** Whether two addresses are the same once Chromium has written them its way (a slash after the host, lower-case names). */
function sameAddress(a: string, b: string): boolean {
  return a === b || (parseUrl(a)?.href ?? a) === (parseUrl(b)?.href ?? b);
}

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
 * and no Tavora protocol. Sessions are shared by the panels of one workspace (or
 * by all workspaces for the shared one), so hooks look the panel up by contents.
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
  // Every session gets this when it is made (index.ts); again here, so a Browser session never goes without it.
  lockDevices(ses);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
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
  /** The page's corner radius in px now (panel-corners.ts `page`); left out, Classic's. */
  cornerRadius?(): number;
  sessionFor(kind: BrowserKind): Session;
  /** Whether a page address belongs to a site the user signs in to for all workspaces. */
  isSharedSite(url: string): boolean;
  adblockOn(url: string): boolean;
  /** Puts a new view in the window in place of the old one (null when the panel opens). */
  swap(previous: WebContentsView | null, next: WebContentsView): void;
  /** Ctrl+L in the page: the toolbar's address bar takes the focus. */
  onFocusAddress(): void;
  /**
   * A new Browser tab beside this one: a link the user opened in a new tab (in the background when asked), with the
   * referrer the page gave it, or an empty one (Ctrl+T).
   */
  onOpenTab(url: string | null, background: boolean, referrer?: Referrer): void;
  /** Ctrl+W in the page closes this tab. */
  onCloseTab(): void;
  /** The page went somewhere new; the address is kept so the panel reopens there. */
  onAddress(url: string): void;
  onChange(): void;
}

/** How often redirects may move one navigation between the shared and the workspace session (Chromium allows 20 redirects in one). */
const MAX_REDIRECT_SWITCHES = 5;

/** The page's corner when the host gives none: Classic's (panel-corners.ts); the page sits below the toolbar. */
const PAGE_RADIUS = 9;

/** One Browser panel. Its page view is replaced when it moves between a workspace's and the shared session. */
export class BrowserPanel implements PanelViewAdapter {
  readonly moduleId = BROWSER_MODULE_ID;
  /** As Panel views sees it (panel-views.ts): always revealed, never paused, no dialog and no maximized state of its own. */
  readonly kind = "browser";
  readonly revealed = true;
  readonly firstDrawn = true;
  readonly drawn = Promise.resolve();
  readonly settled = Promise.resolve();
  view: WebContentsView;
  status: InstanceStatus = "ready";
  private sessionKind: BrowserKind = "workspace";
  private bounds: { x: number; y: number; width: number; height: number } | null = null;
  private visible = false;
  /** The page's address once it committed; requests of the page are judged against it, unless a public page is on its way (hopUrl). */
  private committedUrl: string | null = null;
  /**
   * Whether the user chose the page's very address (typed it, Open, a link they opened in a new tab): a site-list change
   * then loads it again in the other session. Otherwise the page or a redirect chose it, and only its site's home loads.
   */
  private committedChosen = false;
  /** Where the main frame is going (the current hop of a navigation) until it commits or stops. Redirects are judged from it, and the page's requests too while it is public. */
  private hopUrl: string | null = null;
  /** The address last asked for: shown until a page commits, and tried again by Reload when it failed. */
  private requestedUrl: string | null = null;
  private error: BrowserError | null = null;
  private blocked = 0;
  private fullscreen = false;
  private downloadsRefused = 0;
  private lastGesture = 0;
  /** The navigation Tavora itself just started in the page (load, Back, Forward, Reload), and how, until Chromium reports it. */
  private ownNavigation: { url: string; start: NavigationStart } | null = null;
  /** How the navigation under way started; its redirects follow the same rule (crossSessionStep). */
  private navigationStart: NavigationStart = { by: "user" };
  /** The address that navigation started at; a page it ends on elsewhere (a redirect) wasn't the start's choice. */
  private navigationUrl: string | null = null;
  /**
   * Redirects that moved the page to the other session since a page last committed or the user went somewhere: two sites
   * can't bounce it forever. Nothing counts while the panel asks, so the page can't turn the question into an error.
   */
  private redirectSwitches = 0;
  private changeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: BrowserPanelOptions) {
    this.view = this.createView();
  }

  /** Puts the page's view in the window; called once, after the host has registered the panel. */
  attach(): void {
    this.options.swap(null, this.view);
  }

  /** Whether nothing has been opened in this panel yet. */
  get blank(): boolean {
    return this.committedUrl === null && this.requestedUrl === null;
  }

  /**
   * Opens a link the user opened in a new tab, or had a module or Tavora open, as the user's own navigation, unless the
   * user already went somewhere.
   */
  restore(url: unknown, referrer?: Referrer): void {
    if (typeof url !== "string" || !isWebUrl(url) || !this.blank) return;
    this.open(url, this.kindFor(url), { by: "user", referrer });
  }

  /**
   * Opens the address the panel showed last time, unless the user already went somewhere. No click chose it now, and the
   * page may have put it there itself, so it is `restored`: it opens in the session its site belongs in, as it was
   * shown, but a redirect from it to the other session asks first (crossSessionStep).
   */
  reopen(url: unknown): void {
    if (typeof url !== "string" || !isWebUrl(url) || !this.blank) return;
    this.redirectSwitches = 0;
    this.open(url, this.kindFor(url), RESTORED);
  }

  get instanceId(): string {
    return this.options.instanceId;
  }

  get webContentsId(): number {
    return this.view.webContents.id;
  }

  /** The address requests of this panel's page are judged against. */
  get topUrl(): string | null {
    return judgedTopUrl(this.committedUrl, this.hopUrl);
  }

  private createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.options.sessionFor(this.sessionKind),
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
    view.setBorderRadius(this.options.cornerRadius?.() ?? PAGE_RADIUS);
    view.setVisible(false);
    this.watch(view.webContents);
    return view;
  }

  private watch(contents: WebContents): void {
    const current = () => this.view.webContents === contents;
    contents.setWebRTCIPHandlingPolicy("default_public_interface_only");
    contents.on("will-attach-webview", (event) => event.preventDefault());
    // A page may open a link in a "new window" only right after the user
    // clicked or typed; it then opens as a new Browser tab instead.
    contents.on("input-event", (_event, input) => {
      // Windows reports a key press as rawKeyDown.
      if (input.type === "mouseDown" || input.type === "rawKeyDown" || input.type === "keyDown" || input.type === "gestureTap") this.lastGesture = Date.now();
    });
    // A link the user opened in a new tab or window (target=_blank,
    // Ctrl+click, middle click) becomes a new Browser tab beside this one.
    // Without a click or key press just before, nothing opens, and one click
    // opens one tab, so a page cannot open a pile of them from a single click.
    contents.setWindowOpenHandler(({ url, disposition, referrer }) => {
      if (Date.now() - this.lastGesture < GESTURE_MS && this.mayFollow(url)) {
        this.lastGesture = 0;
        // The referrer as Chromium worked it out for the page; it applies the page's policy again when the tab loads.
        const sent = referrer.url && isWebUrl(referrer.url) && referrer.policy !== "no-referrer" ? referrer : undefined;
        setImmediate(() => current() && this.options.onOpenTab(url, disposition === "background-tab", sent));
      }
      return { action: "deny" };
    });
    // The page goes somewhere by itself (a link, a script, a form): it stays in this session, unless the address is a
    // site of the other one, see crossSessionStep.
    contents.on("will-navigate", (event) => {
      if (!this.mayFollow(event.url)) return event.preventDefault();
      const kind = this.kindFor(event.url);
      if (kind === this.sessionKind) return;
      event.preventDefault();
      if (!current()) return;
      this.crossSession(event.url, kind, { by: "page", gesture: this.pageGesture(event.url), referrer: pageReferrer(this.committedUrl) });
    });
    contents.on("will-frame-navigate", (event) => {
      if (event.isMainFrame) return;
      const url = parseUrl(event.url);
      if (!url || !["http:", "https:", "about:", "data:", "blob:"].includes(url.protocol)) event.preventDefault();
    });
    contents.on("did-start-navigation", (event) => {
      if (!current() || !event.isMainFrame) return;
      // Tavora's own navigation is the next one of the main frame Chromium reports (also one within the page, such as
      // Back to a pushState entry), started by no frame, to the address Tavora asked for. Anything else is the page's
      // (a link, a script, its history), and a click just before it is used up by it.
      const own = this.ownNavigation;
      this.ownNavigation = null;
      if (event.isSameDocument) return;
      this.hopUrl = event.url;
      this.navigationUrl = event.url;
      this.navigationStart =
        own && !event.initiator && sameAddress(own.url, event.url)
          ? own.start
          : { by: "page", gesture: this.takeGesture(), referrer: pageReferrer(this.committedUrl) };
      // Counted from here: the new page's first requests can be blocked before did-navigate arrives.
      this.blocked = 0;
    });
    contents.on("will-redirect", (event) => {
      if (!event.isMainFrame) return;
      const from = this.hopUrl ?? this.committedUrl ?? "";
      if (!isWebUrl(event.url) || (isPrivateUrl(event.url) && !isPrivateUrl(from))) return event.preventDefault();
      // A redirect to a site of the other session goes there as the navigation it belongs to would (will-navigate): only
      // shared sites sit in the shared session.
      const kind = this.kindFor(event.url);
      if (kind !== this.sessionKind) {
        event.preventDefault();
        // While the panel asks, the page behind it gets nowhere in the other session, and nothing it does there counts.
        if (!current() || this.asking) return;
        if (++this.redirectSwitches > MAX_REDIRECT_SWITCHES) return this.failed(event.url, { kind: "unknown", detail: "ERR_TOO_MANY_REDIRECTS" });
        this.crossSession(event.url, kind, this.navigationStart);
        return;
      }
      if (current()) this.hopUrl = event.url;
    });
    contents.on("did-navigate", (_event, url) => {
      if (!current()) return;
      this.redirectSwitches = 0;
      this.committedUrl = url;
      this.committedChosen = this.navigationStart.by === "user" && this.navigationUrl !== null && sameAddress(this.navigationUrl, url);
      this.hopUrl = null;
      // A page the page behind the question goes to in its own session doesn't end the question: Stay shows it.
      if (!this.asking) {
        this.error = null;
        this.requestedUrl = null;
      }
      this.applyVisibility();
      if (isWebUrl(url)) this.options.onAddress(url);
      this.changed();
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!current() || !isMainFrame) return;
      // The page put this address there itself (pushState, or its history).
      if (url !== this.committedUrl) this.committedChosen = false;
      this.committedUrl = url;
      if (isWebUrl(url)) this.options.onAddress(url);
      this.changed();
    });
    // A navigation that ends without a new page (stopped, refused, a download, a 204) reports no failure, but loading
    // stops: nothing is on its way any more.
    contents.on("did-stop-loading", () => {
      if (!current()) return;
      this.hopUrl = null;
      // Tavora's own load that never started (a page's beforeunload cancelled it) leaves no start behind for a later one.
      if (!contents.isLoading()) this.ownNavigation = null;
    });
    contents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
      if (!current() || !isMainFrame) return;
      // Only the navigation under way ends here: one that replaced it may have started already.
      if (url === this.hopUrl) this.hopUrl = null;
      // Tavora's own load failed before Chromium reported its start: its start is not one for a later navigation.
      if (this.ownNavigation && sameAddress(this.ownNavigation.url, url)) this.ownNavigation = null;
      // -3 is ERR_ABORTED: a navigation replaced by another, or one we refused. While the panel asks, a failure of the
      // page's other navigations doesn't replace the question with an error to try again.
      if (errorCode === -3 || this.asking) return;
      this.failed(url, loadError(errorCode, description));
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
    // Browser keys come before the page (the table: shared/shortcuts.ts). Esc always leaves fullscreen, whatever the
    // page does with the key.
    contents.on("before-input-event", (event, input) => {
      const shortcut = shortcutIn("browser", input, process.platform === "darwin");
      if (shortcut === "browser.leave-fullscreen" && this.fullscreen) this.exitFullscreen();
      else if (shortcut === "browser.address") this.options.onFocusAddress();
      else if (shortcut === "browser.new-tab") this.options.onOpenTab(null, false);
      else if (shortcut === "browser.close-tab") this.options.onCloseTab();
      else if (shortcut === "browser.back") this.back();
      else if (shortcut === "browser.forward") this.forward();
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

  /** The page could not be loaded: the panel shows why, with the address to try again. */
  private failed(url: string, error: BrowserError): void {
    this.requestedUrl = url;
    this.error = error;
    this.applyVisibility();
    this.changed();
  }

  private kindFor(url: string): BrowserKind {
    return this.options.isSharedSite(url) ? "shared" : "workspace";
  }

  /**
   * The click a page's own navigation to `url` came with. Electron reports the navigation (did-start-navigation, which
   * takes the click) before will-navigate asks about it, so a click already taken for this very navigation counts; it
   * is used up here. Otherwise the click is taken now.
   */
  private pageGesture(url: string): boolean {
    const start = this.navigationStart;
    if (start.by !== "page" || this.hopUrl !== url) return this.takeGesture();
    this.navigationStart = { ...start, gesture: false };
    return start.gesture;
  }

  /** Whether the user clicked or pressed a key in the page just now; a click is used up by what it lets the page do. */
  private takeGesture(): boolean {
    const gesture = Date.now() - this.lastGesture < GESTURE_MS;
    this.lastGesture = 0;
    return gesture;
  }

  /** A navigation that must move to the other session: carried there, or shown so the user can open it (crossSessionStep). */
  private crossSession(url: string, kind: BrowserKind, start: NavigationStart): void {
    const step = crossSessionStep(start);
    // Carried over, a page's navigation stays the page's: the address is its choice, and its click is used up by it.
    if (step.action === "reissue") return this.open(url, kind, start.by === "page" ? start : { by: "user", referrer: step.referrer });
    // One question at a time: what Open opens is the address the panel shows.
    if (this.asking) return;
    this.failed(url, { kind: "otherSession", detail: "" });
  }

  /** Whether the panel asks the user about a page's move to the other session (crossSessionStep). */
  get asking(): boolean {
    return this.error?.kind === "otherSession";
  }

  /** Open, while the panel asks: the address shown, in the session it belongs in, as the user's own navigation. */
  openAsked(): void {
    const url = this.requestedUrl;
    if (!this.asking || !url) return;
    this.redirectSwitches = 0;
    this.open(url, this.kindFor(url));
  }

  /**
   * Stay on this page, while the panel asks: the page shows again, where it was, or in the session its site belongs in
   * now, when a site list changed while the panel asked.
   */
  stay(): void {
    if (!this.asking) return;
    this.endAsking();
    this.siteSettingsChanged();
  }

  /** Ends the question without opening the address asked about. */
  private endAsking(): void {
    this.error = null;
    this.requestedUrl = null;
    this.applyVisibility();
    this.changed();
  }

  /** Whether the page may take the panel to an address: web only, and not from a public page to a local one. */
  private mayFollow(url: string): boolean {
    return isWebUrl(url) && !(isPrivateUrl(url) && !isPrivateUrl(this.committedUrl ?? ""));
  }

  /** Goes to what the user typed in the address bar. */
  navigate(address: string): void {
    this.redirectSwitches = 0;
    const url = addressToUrl(address);
    if (url) this.open(url, this.kindFor(url));
  }

  /** Loads an address, first moving to the other session's view when the site needs it; `start` says who chose it. */
  private open(url: string, kind: BrowserKind, start: NavigationStart = { by: "user" }): void {
    if (kind !== this.sessionKind) {
      const previous = this.view;
      this.sessionKind = kind;
      this.view = this.createView();
      this.committedUrl = null;
      this.fullscreen = false;
      this.options.swap(previous, this.view);
      if (this.bounds) this.view.setBounds(this.bounds);
      if (!previous.webContents.isDestroyed()) previous.webContents.close();
    }
    this.load(url, start);
  }

  private load(url: string, start: NavigationStart): void {
    const referrer = start.by === "restored" ? undefined : start.referrer;
    this.error = null;
    this.requestedUrl = url;
    this.setStatus("ready");
    this.ownNavigation = { url, start };
    void this.view.webContents.loadURL(url, referrer ? { httpReferrer: referrer } : undefined).catch(() => {
      // Failures surface through did-fail-load.
    });
    this.applyVisibility();
    this.changed();
  }

  /**
   * The user changed a Browser site list (here, in another panel or in Settings): the page shown moves to the session its
   * site belongs in now. The user chose the site, not the page's address: only an address they chose themselves loads
   * again there; otherwise the site's home opens, so no address a page picked is loaded like a typed one. While the
   * panel asks, the question stays, and Open decides in the session the site belongs in then.
   */
  siteSettingsChanged(): void {
    const url = this.asking ? null : (this.committedUrl ?? this.requestedUrl);
    const kind = url && isWebUrl(url) ? this.kindFor(url) : this.sessionKind;
    if (!url || kind === this.sessionKind) return this.changed();
    const chosen = url === this.committedUrl && this.committedChosen;
    this.redirectSwitches = 0;
    this.open(chosen ? url : siteHome(url), kind);
  }

  back(): void {
    this.goTo(-1);
  }

  forward(): void {
    this.goTo(1);
  }

  /** Back or Forward, pressed by the user, to an address the page may have chosen (`restored`). */
  private goTo(step: -1 | 1): void {
    const history = this.view.webContents.navigationHistory;
    if (!(step < 0 ? history.canGoBack() : history.canGoForward())) return;
    // Like Reload: from the page shown before the question, never the address it asks about.
    if (this.asking) this.endAsking();
    this.expectOwn(history.getEntryAtIndex(history.getActiveIndex() + step)?.url);
    if (step < 0) history.goBack();
    else history.goForward();
  }

  /**
   * Tavora is about to take the page again to `url`, an address of its history (Back, Forward, Reload) that the page may
   * have chosen itself, so it is `restored`. Chromium reports it as a navigation like any other.
   */
  private expectOwn(url: string | undefined): void {
    this.ownNavigation = url ? { url, start: RESTORED } : null;
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

  /** The address to hand to the system browser: the page's own, web only (never the one the panel asks about). */
  get externalUrl(): string | null {
    const url = this.asking ? this.committedUrl : (this.committedUrl ?? this.requestedUrl);
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
      // From the site list, not the session the page is in: while the panel asks they differ.
      shared: parsed ? this.options.isSharedSite(url) : this.sessionKind === "shared",
      adblock: parsed ? this.options.adblockOn(url) : true,
      blocked: this.blocked,
      error: this.status === "crashed" ? { kind: "crashed", detail: "" } : this.error,
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

  applyLanguage(_language?: unknown): void {}

  applyTheme(_theme?: unknown): void {
    this.view.setBackgroundColor(this.options.background());
  }

  /** Rounds the page to the panel cards' corners of the style now (panel-corners.ts). A new page view asks cornerRadius. */
  setCorners(corners: PanelCorners): void {
    this.view.setBorderRadius(corners.page);
  }

  /** A hidden page keeps running, like a background tab; Chromium throttles its timers. */
  suspend(): void {}

  resume(): void {}

  reload(): void {
    // Reload while the panel asks reloads the page shown before, never the address it asks about.
    if (this.asking) this.endAsking();
    if (this.status === "crashed" || this.error) {
      const url = this.requestedUrl ?? this.committedUrl;
      this.setStatus("ready");
      if (!url) return;
      // Try again: the address may be one the page went to by itself (it failed, or bounced between the sessions too
      // often), so it is `restored`. It loads again in this session; an address of the other session, or a redirect
      // there, asks first.
      this.redirectSwitches = 0;
      const kind = this.kindFor(url);
      if (kind === this.sessionKind) this.open(url, kind, RESTORED);
      else this.crossSession(url, kind, RESTORED);
      return;
    }
    this.expectOwn(this.view.webContents.getURL());
    this.view.webContents.reload();
  }

  /** Ends a hung page; Reload opens it again. */
  stop(): void {
    const contents = this.view.webContents;
    if (!contents.isDestroyed()) contents.forcefullyCrashRenderer();
  }

  setInDialog(): void {}
  focus(): void {}
  setMaximized(): void {}
  capture(): Promise<string | null> {
    return stillOf(this.view);
  }
  /** A Browser panel never goes over the game. */
  inGame(): null {
    return null;
  }

  dispose(): Promise<void> {
    clearTimeout(this.changeTimer);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    return Promise.resolve();
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

/** A short, plain reason a page did not load; the host UI words it. */
export function loadError(code: number, description: string): BrowserError {
  if (code <= -200 && code > -300) return { kind: "cert", detail: "" };
  if (code === -105 || code === -137) return { kind: "notFound", detail: "" };
  if (code === -106) return { kind: "offline", detail: "" };
  if (code === -102 || code === -118 || code === -7) return { kind: "noAnswer", detail: "" };
  if (code === -20 || code === -21 || code === -27) return { kind: "badAddress", detail: "" };
  return { kind: "unknown", detail: description || String(code) };
}
