import { ReadOnlyFiles } from './read-only-files';
import { serveReadOnlyFile } from './read-only-files-http';
import { FOLDER_READ_PATH, READ_ONLY_FILE_PATH } from '@tavora/sdk/protocol';
import { serveFolderFile, type FolderHost } from './folder-access';
import { readFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, clipboard, ClipboardItem, MessageChannelMain, session, shell, WebContentsView, type IpcMainEvent, type Session, type WebContents } from "electron";
import type { HotkeyBinding, JsonValue, TavoraTheme, TavoraViewport, TavoraWorkspace } from "@tavora/sdk/protocol";
import type { ResolvedPanelType } from "@tavora/module-schema";
import { modulePartition } from "./module-data";
import { gestureCounts, type OverGame } from "./game-overlays";
import { moduleThemeCss } from "./module-style";
import type { PanelCorners } from "./panel-corners";
import { InsertedCss } from "./inserted-css";
import { contentTypeFor, moduleCsp, MODULE_SCHEME, resolveAsset, withModulePolicy } from "./assets";
import { APP_BLOB_PATH, BLOB_PATH, CLIPBOARD_PATH, PICTURES_PATH, JSON_EXPORT_PATH, JSON_SAVE_PATH, JSON_OPEN_PATH, FILE_SAVE_PATH, FILE_OPEN_PATH } from "@tavora/sdk/protocol";
import { BridgeSession, newBridgeBudget, type PanelDialogSize } from "./bridge";
import type { CheckedMenu } from "./module-menu";
import type {TooltipRequest,TooltipAnchor,TooltipSkin} from "@tavora/sdk/protocol";
import { pointerOverAnchor } from "./tooltip-pointer";
import type { PanelContent, PanelLaunch } from "./panel-content";
import { LIMITS, type PanelOpenManyResult, type PanelOpenResult } from "@tavora/sdk/protocol";
import type { ModuleFileDialogs, PanelFileDialogs } from "./file-dialogs";
import { PanelSession, type PanelConnectors } from "./panel-session";
import type { BlobStore } from "./blobs";
import { serveBlobs } from "./blob-http";
import { takeUploadSlot, type UploadSlots } from "./upload-slots";
import { json, serveClipboard } from "./clipboard-http";
import { cleanPictureName, servePictureSave } from "./picture-save-http";
import { serveJsonOpen, serveJsonSave } from "./json-file-http";
import { serveFileOpen, serveFileSave } from "./table-file-http";
import { serveJsonExport } from './json-export-http';
import { DRAW_CAP_MS, ON_SCREEN_MS } from "./panel-cover";
import { stillOf } from "./panel-still";
import type { PanelViewAdapter } from "./panel-views";
import { recordCrash } from "./crash-log";
import { isPrivateUrl, isWebUrl } from "./browser-url";
import { HostError } from "./errors";
import { GESTURE_MS, unused, type PanelGate, type Press } from "./panel-gate";
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
  workspace: TavoraWorkspace;
  data: ModuleData;
  panelState: PanelStateStore;
  hostVersion: string;
  preload: string;
  devTools: boolean;
  getTheme(): TavoraTheme;
  /** The view's corner radius in px now (panel-corners.ts `module`); left out, Classic's. */
  cornerRadius?(): number;
  getLanguage(): string;
  /** Tavora's default look for the page, below the module's own styles (module-style.ts). Colours come from the theme stylesheet. */
  baseCss: string;
  /** The stylesheet with a theme's font: its files and --tavora-font-sans (module-fonts.ts). */
  fontCss(theme: TavoraTheme): string;
  onStatus(status: InstanceStatus): void;
  /** The module's own browser storage grew past the limit; the host clears it (see storage-guard.ts). */
  onStorageOver(): void;
  /** What a module may keep in its browser storage, in bytes. */
  storageLimit?: number;
  /** The page has its data and may be shown (see ModuleView.revealed). */
  onReveal?(): void;
  /** The page has drawn for the first time in its slot (see ModuleView.firstDrawn). */
  onDrawn?(): void;
  /** The panel's page took the keyboard focus (a click or Tab into it), so its dock group becomes the active one. */
  onFocus?(): void;
  /** The user opened a web address from the module (links.open); it was checked to be one. */
  onOpenLink(url: string): void;
  /** A call that needs Tavora's own window was refused because the panel is over the game; the host tells the user (once per press). */
  onNeedsTavora?(): void;
  /** Shows a module's menu in the host UI, over this panel (host.ts); resolves with the chosen id, or null. */
  showMenu(menu: CheckedMenu): Promise<string | null>;
  /**
   * Tavora's dialogs for this module, each opened only after its click was taken: pictures.save, files.saveJson /
   * openJson / save / open (the session's addresses), and linking files (files.pickReadOnly, through the gate).
   */
  files: PanelFileDialogs;
  /** Where a pick of files to link opens when there is no linked file to start next to: the workspace's game (save-dialog-folder.ts). */
  pickGame(): string;
  tooltip?: {
    show(request:TooltipRequest):Promise<boolean>;
    move(anchor:TooltipAnchor):void;
    /** `linger`: the module took it away (or the pointer left): it stays a moment in case the next card follows. */
    close(id?:string,hoverOnly?:boolean,linger?:boolean):void;
    defineSkin(name:string,skin:TooltipSkin):Promise<void>;
  };
  /** Why the panel's page is loading (panel.getLaunch); asked once for each page load. */
  launch(): PanelLaunch;
  /** Whether this panel, just added, may open its dialog once without a click (false when it came with another one from the same click). */
  mayWelcome?(): boolean;
  /** What the panel shows now (panel.setContent), already checked. */
  setContent(content: PanelContent | null): void;
  /** panels.open from this panel, after its click was taken: the host picks or opens the destination. */
  openPanel(type: string, content: PanelContent | null): Promise<PanelOpenResult>;
  /** panels.openMany from this panel, after its click was taken: the host opens them around this panel. */
  openPanels(types: string[]): Promise<Record<string, PanelOpenManyResult>>;
  /** panel.setMaximized from this panel (after its click was taken to maximize): asks the host UI to do it. */
  setMaximized(maximized: boolean): void;
  /**
   * panel.setDialog from this panel: shows it big in a dialog over the workspace, or back in its slot. Opening comes from
   * a click or key press (`byClick`), or from the Add click that carried over to a panel just added (not by a click).
   */
  setDialog(open: boolean, size: PanelDialogSize, how?: { byClick: boolean }): void;
  /** panel.setDialogTitle from this panel: the title in the frame of its open dialog, or null for the module's name. */
  setDialogTitle(title: string | null): void;
  /** panel.setLive from this panel (size already checked): what its live view over the game shows; null shows nothing. */
  setLive(state: JsonValue | null): void;
  /** The module's settings shared by every workspace (storage.app). */
  appSettings: ModuleStore;
  /** The module's files shared by every workspace (blobs.app). */
  appBlobs: BlobStore;
  /** The connectors of the module as this panel uses them; the panel's session gates them (panel-session.ts). */
  connectors: PanelConnectors;
  /**
   * The panel runs now only because its game runs, out of sight (with-game.ts): the hidden panel never placed in a
   * layout, or one of a workspace not shown. What needs the user there (a dialog, a menu, a picker, a link, another
   * panel, a key) is refused, without a word to the user.
   */
  runsOnlyWithGame?(): boolean;
}

/** How often the host checks that a module's page still runs. */
export const HEARTBEAT_MS = 2_000;
/** How long a page may go without answering before it is reported as not responding. */
export const UNRESPONSIVE_MS = 10_000;

export function moduleOrigin(moduleId: string): string {
  return `${MODULE_SCHEME}://${moduleId}`;
}

const hardened = new WeakSet<Session>();
/** The module each session serves its files from: updated when a panel reloads with a new copy. */
const serving = new WeakMap<Session, InstalledModule>();

/**
 * When the user last clicked or pressed a key in a page of this session (one module in one workspace). The clipboard
 * address is answered by the session, which cannot tell its panels apart, so this is kept per session; all of its
 * panels are the same module.
 */
const sessionGestures = new WeakMap<Session, SessionGesture>();

/** `overGame`: the latest press came from a panel over the game, whose calls that need Tavora's window are refused. */
interface SessionGesture {
  press: Press | null;
  overGame?: boolean;
  /** Tells the user once per press that the panel has to come back first. */
  refuse?: () => void;
}

/** Files a session's pages are writing now (blobs.put goes through the module's address, not the bridge). */
interface Uploads extends UploadSlots {
  running: number;
  /** Told whenever one starts or ends: a closing panel waits until none runs. */
  readonly changed: Set<() => void>;
}
const sessionUploads = new WeakMap<Session, Uploads>();

function uploadsOf(ses: Session): Uploads {
  let uploads = sessionUploads.get(ses);
  if (!uploads) sessionUploads.set(ses, (uploads = { running: 0, changed: new Set(), writing: 0, queued: [] }));
  return uploads;
}

/** Answers a request to the files address, counting one that writes for as long as it runs. */
async function countWrite(ses: Session, request: Request, serve: () => Promise<Response>): Promise<Response> {
  if (request.method === "GET" || request.method === "HEAD") return serve();
  const uploads = uploadsOf(ses);
  const tell = () => [...uploads.changed].forEach((changed) => changed());
  uploads.running++;
  tell();
  let free: (() => void) | null = null;
  try {
    const slot = takeUploadSlot(uploads);
    // BAD_REQUEST, as for too many calls: QUOTA_EXCEEDED would read as "the storage is full".
    if (!slot) return json(429, { error: { code: "BAD_REQUEST", message: "too many files are being stored at once; try again when one is done" } });
    free = await slot;
    return await serve();
  } finally {
    free?.();
    uploads.running--;
    tell();
  }
}

/**
 * The addresses a session answers that act on a press (the clipboard, the save and open dialogs). The press is the
 * session's, shared by every page of the module in that workspace, so they are refused for a page that runs only with
 * its game (outOfSight): it can't use a click made in a panel of the same module the user sees.
 */
const PRESS_PATHS: ReadonlySet<string> = new Set([CLIPBOARD_PATH, JSON_EXPORT_PATH, PICTURES_PATH, JSON_SAVE_PATH, JSON_OPEN_PATH, FILE_SAVE_PATH, FILE_OPEN_PATH]);

/** The module pages that are open, by their page's id: their session, and whether they run only with their game now. */
const outOfSight = new Map<number, { session: Session; now(): boolean }>();

/**
 * Whether a request to the session's own addresses is refused before it is answered (onBeforeRequest): one that acts on
 * a press, from a page running only with its game. A request no page can be named for (a worker of no page) is refused
 * while any page of the session runs that way.
 */
export function refusedOutOfSight(url: string, origin: string, webContentsId: number | undefined, ses: Session): boolean {
  if (!url.startsWith(`${origin}/`)) return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  if (!PRESS_PATHS.has(pathname)) return false;
  const page = webContentsId === undefined ? undefined : outOfSight.get(webContentsId);
  if (page) return page.now();
  return [...outOfSight.values()].some((other) => other.session === ses && other.now());
}

function gestureOf(ses: Session): SessionGesture {
  let gesture = sessionGestures.get(ses);
  if (!gesture) sessionGestures.set(ses, (gesture = { press: null }));
  return gesture;
}

/** The checks an address the session answers makes: an unused press, which the call then uses up. */
function pressCheck(gesture: SessionGesture, allowed: () => boolean = () => unused(gesture.press)) {
  return { allowed, consume: () => void (gesture.press && (gesture.press.used = true)) };
}

/** For the calls the session answers that open Tavora's dialogs: a press made over the game doesn't count. */
export function allowedHere(gesture: SessionGesture): () => boolean {
  return () => {
    if (!unused(gesture.press)) return false;
    if (!gesture.overGame) return true;
    gesture.refuse?.();
    return false;
  };
}

async function writeClipboardPicture(png: Buffer): Promise<void> {
  await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
}

/** Where the save dialog for pictures first opens: a Tavora folder in the user's Pictures (tests point Pictures elsewhere, unpackaged only). */
export function picturesFolder(): string {
  const pictures = !app.isPackaged && process.env.TAVORA_PICTURES_DIR ? path.resolve(process.env.TAVORA_PICTURES_DIR) : app.getPath("pictures");
  return path.join(pictures, "Tavora");
}

/** Where the save and open dialogs for a module's files first open: a Tavora folder in the user's Documents (tests point Documents elsewhere, unpackaged only). */
export function documentsFolder(): string {
  const documents = !app.isPackaged && process.env.TAVORA_DOCUMENTS_DIR ? path.resolve(process.env.TAVORA_DOCUMENTS_DIR) : app.getPath("documents");
  return path.join(documents, "Tavora");
}

/** Where files.exportJson saved before it asked: a Tavora folder in the user's Downloads, still one of Tavora's own folders (tests point it elsewhere, unpackaged only). */
export function exportsFolder(): string {
  return !app.isPackaged && process.env.TAVORA_EXPORTS_DIR ? path.resolve(process.env.TAVORA_EXPORTS_DIR) : path.join(app.getPath("downloads"), "Tavora");
}

/**
 * Every module gets its own session per workspace: separate cookies, web storage,
 * cache and a separate renderer process from the host and other modules.
 */
function moduleSession(module: InstalledModule, workspace: TavoraWorkspace, blobs: BlobStore, appBlobs: BlobStore, files: ModuleFileDialogs & { folders?: Pick<FolderHost, "read"> }): Session {
  const ses = session.fromPartition(modulePartition(module.owner, module.manifest.id, workspace.id));
  // The folder a session serves from follows the module as installed now: a built-in module's downloaded copy lives elsewhere than the shipped one.
  serving.set(ses, module);
  if (hardened.has(ses)) return ses;
  hardened.add(ses);

  const origin = moduleOrigin(module.manifest.id);

  // Every answer, errors and route answers too, carries a policy (withModulePolicy).
  ses.protocol.handle(MODULE_SCHEME, async (request) => withModulePolicy(await answerModule(request)));
  async function answerModule(request: Request): Promise<Response> {
    const module = serving.get(ses)!;
    // WebAssembly only for a module of Tavora's own that asked for it (the registry refuses the request from any other).
    const csp = moduleCsp(module.provenance === "official" && module.manifest.permissions.webAssembly === true);
    // URL.origin is "null" for custom schemes in Node, so compare the host.
    const url = new URL(request.url);
    if (url.host !== module.manifest.id) return new Response("Not found", { status: 404 });
    if (url.pathname.startsWith(READ_ONLY_FILE_PATH)) return serveReadOnlyFile(request,url.pathname.slice(READ_ONLY_FILE_PATH.length),new ReadOnlyFiles(app.getPath('userData'),module.owner,module.manifest.id,workspace.id));
    if (url.pathname === FOLDER_READ_PATH) return serveFolderFile(request, files.folders);
    if (url.pathname.startsWith(BLOB_PATH)) return countWrite(ses, request, () => serveBlobs(blobs, request, url));
    if (url.pathname.startsWith(APP_BLOB_PATH)) return countWrite(ses, request, () => serveBlobs(appBlobs, request, url, APP_BLOB_PATH));
    if (url.pathname === CLIPBOARD_PATH) return serveClipboard(request, { ...pressCheck(gestureOf(ses)), write: writeClipboardPicture });
    if (url.pathname === JSON_EXPORT_PATH) {
      // The older files.exportJson saves through the same dialog as files.saveJson (it used to write into Downloads unasked).
      const gesture = gestureOf(ses);
      return serveJsonExport(request, url, { ...pressCheck(gesture, allowedHere(gesture)), save: files.saveJson }, cleanPictureName);
    }
    if (url.pathname === PICTURES_PATH) {
      const gesture = gestureOf(ses);
      return servePictureSave(request, url, { ...pressCheck(gesture, allowedHere(gesture)), save: files.savePicture });
    }
    if (url.pathname === JSON_SAVE_PATH) {
      const gesture = gestureOf(ses);
      return serveJsonSave(request, url, { ...pressCheck(gesture, allowedHere(gesture)), save: files.saveJson }, cleanPictureName);
    }
    if (url.pathname === JSON_OPEN_PATH) {
      const gesture = gestureOf(ses);
      return serveJsonOpen(request, { ...pressCheck(gesture, allowedHere(gesture)), open: files.openJson });
    }
    if (url.pathname === FILE_SAVE_PATH) {
      const gesture = gestureOf(ses);
      return serveFileSave(request, url, { ...pressCheck(gesture, allowedHere(gesture)), save: files.saveFile }, cleanPictureName);
    }
    if (url.pathname === FILE_OPEN_PATH) {
      const gesture = gestureOf(ses);
      return serveFileOpen(request, url, { ...pressCheck(gesture, allowedHere(gesture)), open: files.openFile });
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
  }

  // The page itself gets no network: every request that is not for the
  // module's own bundle is cancelled. Granted hosts are reached only through
  // network.fetch, which the main process makes (network.ts).
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(`${origin}/`) || details.url.startsWith("devtools://");
    callback({ cancel: !allowed || refusedOutOfSight(details.url, origin, details.webContentsId, ses) });
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
/** The least time between two ports for one document: asking sooner waits, and asks made meanwhile get one port. */
export const CONNECT_GAP_MS = 250;
export const REVEAL_CAP_MS = 2_000;
/**
 * A closed panel's page may still be saving what was typed just before (lifecycle.dispose). It keeps its port, for saves
 * only, until it has answered a ping sent after the event and its calls have been quiet for CLOSE_QUIET_MS; never
 * longer than CLOSE_CAP_MS, so a hung page can't hold anything up.
 */
export const CLOSE_QUIET_MS = 150;
export const CLOSE_CAP_MS = 1_000;
/** Numbers the pings closing panels send, so only the answer to a panel's own ping counts. */
let closePings = 0;
/** Where a panel's page is, from its start to its first frame (`ModuleView.phase`), or what went wrong. */
export type PagePhase = Exclude<InstanceStatus, "ready"> | "settling" | "revealed" | "drawn";
/** How a panel answered panel.navigate. */
export type NavigateOutcome = "switched" | "failed" | "unhandled";

/** How long after a click or key press a gated call may be made (panel-gate.ts). */
export { GESTURE_MS };
/**
 * How long after its page starts a panel just added may open its dialog once without a click (the Add click carries
 * over, for a welcome on first add).
 */
export const ADD_DIALOG_MS = 10_000;

/** The corner of a module's view when the host gives none: Classic's (panel-corners.ts). */
const PANEL_VIEW_RADIUS = 9;

/** One panel instance of a module, bound to one workspace. */
export class ModuleView implements PanelViewAdapter {
  /** As Panel views sees it (panel-views.ts). */
  readonly kind = "module";
  readonly capturable = true;
  readonly view: WebContentsView;
  private bridge: BridgeSession | undefined;
  /**
   * What this panel's calls hold, across every port its pages asked for: a page that asks for a new port (or loads
   * again) starts with what its old ports still run, so asking again resets no limit.
   */
  private readonly bridgeBudget = newBridgeBudget();
  /** When this document last got a port (connect); 0 for a new document. */
  private lastConnect = 0;
  /** A port asked for too soon after the last one, given when the gap is over; never to another document. */
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private viewport: TavoraViewport = { width: 0, height: 0 };
  private suspended = false;
  /** Tavora's window is behind another program (the game), as the host last said. The panel is behind only while it is not over the game itself. */
  private windowBehind = false;
  private behind = false;
  /** The theme's colours in the current page, replaced when the theme changes. */
  private readonly themeCss = new InsertedCss(() => this.view.webContents);
  /** The font in the current page, replaced only when the user picks another (InsertedCss skips the same sheet). */
  private readonly fontCss = new InsertedCss(() => this.view.webContents);
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastPong = 0;
  private storageWatch: ReturnType<typeof setInterval> | undefined;
  private measuring = false;
  /** How the page is doing; changed only by `setStatus`, read as `status`. */
  private health: InstanceStatus = "loading";
  /**
   * Where the panel is in being closed (dispose): `open`; `saving`, its page out of sight with its port kept for saves
   * only (`settle` looks again whether it has gone quiet); `closed`, port and page gone. A page that finishes loading
   * after `open` starts no timers (they would outlive the view), and nothing it does reaches the host as this panel's.
   */
  private end: { step: "open" } | { step: "saving"; done: Promise<void>; settle: () => void; close: () => void } | { step: "closed"; done: Promise<void> } = { step: "open" };
  private get disposed(): boolean {
    return this.end.step !== "open";
  }

  /** The page, or undefined once it is gone: Electron drops a closed view's page, and a destroyed one throws on use. */
  private contents(): WebContents | undefined {
    const contents = this.view.webContents as WebContents | undefined;
    return contents && !contents.isDestroyed() ? contents : undefined;
  }
  /** False while the page is still loading or filling itself with data; the host keeps the view hidden until then. */
  revealed = false;
  private revealTimers: ReturnType<typeof setTimeout>[] = [];
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** When the user last clicked or typed in this panel, or when it opened; panels.open switches the one used last. */
  usedAt = Date.now();
  private nextNavigation = 1;
  /** panel.navigate requests waiting for the page's answer. */
  private readonly navigations = new Map<number, (outcome: NavigateOutcome) => void>();

  /** The connectors and pickers as this panel's pages reach them, and the watches they started (panel-session.ts). */
  private readonly session: PanelSession;
  /** What this panel's page may call now: the grant, the press, where the panel is, and its live page (the session's). */
  private readonly gate: PanelGate;

  constructor(private readonly options: ModuleViewOptions) {
    const { module, workspace } = options;
    this.session = new PanelSession({
      instanceId: options.instanceId,
      module: () => this.options.module,
      workspace,
      hostVersion: options.hostVersion,
      connectors: options.connectors,
      pickReadOnly: (request) => options.files.pickReadOnly(request),
      pickGame: () => options.pickGame(),
      readOnlyFiles: () => new ReadOnlyFiles(app.getPath("userData"), module.owner, module.manifest.id, workspace.id),
      showItemInFolder: (place) => shell.showItemInFolder(place),
      suspended: () => this.suspended,
      page: () => this.bridge,
      runsOnlyWithGame: () => options.runsOnlyWithGame?.() ?? false,
      overGame: () => this.overGame !== null,
      onNeedsTavora: () => options.onNeedsTavora?.(),
    });
    this.gate = this.session.gate;
    this.view = new WebContentsView({
      webPreferences: {
        session: moduleSession(module, workspace, options.data.blobs, options.appBlobs, {
          savePicture: (png, name) => options.files.savePicture(png, name),
          saveJson: (data, name) => options.files.saveJson(data, name),
          openJson: () => options.files.openJson(),
          saveFile: (data, name, kind) => options.files.saveFile(data, name, kind),
          openFile: (kinds) => options.files.openFile(kinds),
          ...(options.connectors.folders ? { folders: options.connectors.folders } : {}),
        }),
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
    // Panels are rounded cards in the host UI; the view follows their corners (panel-corners.ts).
    this.view.setBorderRadius(options.cornerRadius?.() ?? PANEL_VIEW_RADIUS);

    const contents = this.view.webContents;
    const origin = moduleOrigin(module.manifest.id);
    const sameModule = (url: string) => url.startsWith(`${origin}/`);
    // So the session can tell this page's requests from those of the module's other pages (refusedOutOfSight).
    const pageId = contents.id;
    outOfSight.set(pageId, { session: contents.session, now: () => this.options.runsOnlyWithGame?.() ?? false });
    contents.on("destroyed", () => outOfSight.delete(pageId));

    // The page is a native view, so a click in it never reaches the dock: the host makes its group active instead.
    contents.on("focus", () => !this.disposed && this.options.onFocus?.());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    // A blocked main-frame navigation starts no page: Electron asks these after did-start-navigation counted it.
    const block = (event: { preventDefault(): void }, mainFrame: boolean) => {
      event.preventDefault();
      if (!mainFrame || !this.pendingDocument) return;
      this.pendingDocument = false;
      this.documents--;
    };
    contents.on("will-navigate", (event) => {
      if (!sameModule(event.url)) block(event, true);
    });
    contents.on("will-frame-navigate", (event) => {
      if (!sameModule(event.url)) block(event, event.isMainFrame);
    });
    contents.on("will-redirect", (event) => {
      if (!sameModule(event.url)) block(event, event.isMainFrame);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());

    // A reload or in-module navigation starts a new document, which must
    // ask for a new port; the old one is closed so it cannot be reused.
    contents.on("did-start-navigation", (event) => {
      if (event.isMainFrame && !event.isSameDocument) {
        // A closed panel's page that goes elsewhere has nothing more to save here.
        if (this.disposed) return this.closeNow();
        this.documents++;
        this.pendingDocument = true;
        this.lastConnect = 0;
        this.disconnect();
        this.setStatus("loading");
        this.hideUntilSettled();
      }
    });
    // The module's own files are served by the protocol handler, so an
    // error status means the entry page is missing or unreadable.
    contents.on("did-navigate", (_event, url, httpResponseCode) => {
      // The page counted at its start is there now: nothing can take it back.
      this.pendingDocument = false;
      if (httpResponseCode < 400) return;
      if (this.disposed) return this.closeNow();
      console.warn(`[tavora] module ${module.manifest.id} failed to load ${url}: HTTP ${httpResponseCode}`);
      this.disconnect();
      this.setStatus("failed");
    });
    // A user stylesheet: every rule the module writes still wins over it.
    // The theme's colours go in a second one, replaced when the theme changes.
    contents.on("dom-ready", () => {
      if (this.disposed) return;
      // A new document starts without the style of Tavora's own that fades it over the game.
      this.gameCss = undefined;
      if (this.overGame) void this.applyGameOpacity();
      this.themeCss.forget();
      this.fontCss.forget();
      contents.insertCSS(options.baseCss, { cssOrigin: "user" }).catch(() => {
        // The page went away before the styles landed.
      });
      this.insertThemeCss(options.getTheme());
    });
    contents.on("did-finish-load", () => {
      if (this.disposed || this.health !== "loading") return;
      this.setStatus("ready");
      this.startHeartbeat();
      this.later(NO_BRIDGE_MS, () => this.bridge === undefined && this.reveal());
    });
    contents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation replaced by another, not a failure.
      if (!isMainFrame || errorCode === -3) return;
      if (this.disposed) return this.closeNow();
      console.warn(`[tavora] module ${module.manifest.id} failed to load ${url}: ${description}`);
      this.disconnect();
      this.setStatus("failed");
    });
    contents.on("unresponsive", () => {
      if (this.health === "ready") this.setStatus("unresponsive");
    });
    contents.on("responsive", () => {
      if (this.health === "unresponsive") this.setStatus("ready");
    });
    contents.on("render-process-gone", (_event, details) => {
      if (this.disposed) return this.closeNow();
      // Tavora's own stop (stop()) is no crash of the module's.
      if (!this.stoppedByTavora) recordCrash({ type: "module page", reason: details.reason, exitCode: details.exitCode, moduleId: module.manifest.id });
      this.disconnect();
      this.setStatus("crashed");
    });

    this.hideUntilSettled();
    // From the start, not from the first finished load: a page that keeps its load from finishing (or its worker) can
    // write to its storage all the same. It runs until the panel closes, across reloads and crashes.
    this.startStorageWatch();
    void contents.loadURL(`${origin}/${options.panelType?.entry ?? module.manifest.entry}`).catch(() => {
      // Load failures surface through did-fail-load / render-process-gone.
    });
  }

  private pointer:{x:number;y:number;at:number}|null=null;
  notePointer(raw:unknown):void{
    if(raw===null){this.pointer=null;this.options.tooltip?.close(undefined,true,true);return;}
    if(!raw||typeof raw!=="object")return;
    const p=raw as {x:unknown;y:unknown};
    if(typeof p.x!=="number"||typeof p.y!=="number"||!Number.isFinite(p.x)||!Number.isFinite(p.y))return;
    this.pointer={x:p.x,y:p.y,at:Date.now()};
  }
  private tooltipAnchorAllowed(at:{x:number;y:number}):boolean{
    return at.x>=0&&at.y>=0&&at.x<=this.viewport.width&&at.y<=this.viewport.height&&!this.suspended;
  }
  private tooltipPointerMatches(anchor:Pick<TooltipAnchor,"at"|"box">):boolean{
    return pointerOverAnchor(this.pointer,anchor);
  }
  tooltipClosed(id:string):void{this.bridge?.emit("ui.tooltipClosed",{id});}

  noteGesture(): void {
    // A closed panel's last click opens nothing more (see letGo).
    if (this.disposed) return;
    // Over the game the panel takes input only in Use (OverGame.takesInput); any report at another time is not the user's.
    if (!gestureCounts(this.overGame !== null, this.overGame?.takesInput ?? false)) return;
    const page = this.contents();
    const press = this.gate.notePress(page !== undefined);
    this.usedAt = press.at;
    if (!page) return;
    const shared = gestureOf(page.session);
    shared.press = press;
    shared.overGame = this.overGame !== null;
    shared.refuse = () => this.gate.tellNeedsTavora();
  }

  /** links.open: only a web address, and only right after the user did something in the page. */
  private async openLink(url: string): Promise<void> {
    if (!isWebUrl(url)) throw new HostError("INVALID_PARAMS", "params.url must be an http or https address");
    if (isPrivateUrl(url)) throw new HostError("PERMISSION_DENIED", "links.open opens only public addresses, not this PC or the local network");
    // One click opens one link, so a script cannot open a pile of them.
    await this.gate.enter("links.open");
    this.options.onOpenLink(url);
  }

  /** When this view's first page started loading: the pass of a panel just added counts from here. */
  private readonly firstPageAt = Date.now();
  /**
   * Main-frame pages this view has started (did-start-navigation, the first load too), less those blocked before they
   * came (will-navigate and the others, which Electron asks after did-start-navigation).
   */
  private documents = 0;
  /** The page counted last has not come yet (did-navigate), so a block can still take it back. */
  private pendingDocument = false;
  /** Until when this page may open its dialog once without a click (a panel just added), or null. */
  private addPass: { until: number } | null = null;

  /**
   * The page asked for its bridge: only a panel the user just added, in the workspace, gets the one dialog without a
   * click, and only its view's first page, within ADD_DIALOG_MS of that page starting. A page that holds back its
   * hello and loads again later gets none, nor does any later page.
   */
  private startPage(launch: PanelLaunch): void {
    const firstPage = this.documents <= 1;
    this.addPass = launch.reason === "add" && firstPage && !this.overGame && (this.options.mayWelcome?.() ?? true) ? { until: this.firstPageAt + ADD_DIALOG_MS } : null;
  }

  /** panel.setDialog: opening takes a click or key press, or the pass of a panel just added (used up either way). */
  private async requestDialog(open: boolean, size: PanelDialogSize): Promise<void> {
    if (!open) return this.options.setDialog(false, size);
    this.gate.check("panel.setDialog");
    const pass = this.addPass;
    this.addPass = null;
    if (pass && !this.gate.pressed && !this.overGame && Date.now() <= pass.until) return this.options.setDialog(true, size, { byClick: false });
    // Covering the app takes a click, as maximizing does. Over the game too: the host brings Tavora to the front for it.
    await this.gate.enter("panel.setDialog");
    this.options.setDialog(true, size, { byClick: true });
  }

  /** Starts counting for a new page: it is hidden until it settles or the cap runs out. */
  private hideUntilSettled(): void {
    if (this.disposed) return;
    this.revealed = false;
    this.firstDrawn = false;
    // Over the game nothing else shows the view again (the host leaves such a panel alone), so it hides and shows itself.
    if (this.overGame) this.view.setVisible(false);
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
    if (this.end.step === "saving") return this.end.settle();
    if (this.disposed) return;
    if (!busy && served > 0 && !this.revealed) this.settleTimer = setTimeout(() => this.reveal(), SETTLE_MS);
  }

  private reveal(): void {
    if (this.revealed || this.disposed) return;
    this.revealed = true;
    this.clearRevealTimers();
    if (this.overGame) this.view.setVisible(true);
    this.options.onReveal?.();
  }

  /** The name of the panel's type, or null for a module without types. */
  get typeName(): string | null {
    return this.options.panelType?.name ?? null;
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

  /** The owner the page runs as (its grants and data are this owner's); a copy of another owner never takes over the view (reload). */
  get owner(): string {
    return this.options.module.owner;
  }

  get workspaceId(): string {
    return this.options.workspace.id;
  }

  /**
   * Called when the module's main frame asks for a bridge port. A document gets at most one every CONNECT_GAP_MS: one
   * that asks sooner gets its port when the time is up, and asks made meanwhile share it, so asking in a loop can't keep
   * the main process busy. A new document asks at once.
   */
  connect(): void {
    const wait = this.lastConnect + CONNECT_GAP_MS - Date.now();
    if (wait > 0) {
      this.connectTimer ??= setTimeout(() => {
        this.connectTimer = undefined;
        this.connect();
      }, wait);
      return;
    }
    this.lastConnect = Date.now();
    this.disconnect();
    const launch = this.options.launch();
    this.startPage(launch);
    const { port1, port2 } = new MessageChannelMain();
    const { module, workspace, instanceId, data, panelState, hostVersion } = this.options;
    const pageImports = new AbortController();
    const bridge: BridgeSession = new BridgeSession(
      port1,
      {
        hostVersion,
        budget: this.bridgeBudget,
        moduleId: module.manifest.id,
        moduleVersion: module.manifest.version,
        instanceId,
        panelType: this.options.panelType?.id ?? null,
        launch,
        setContent: this.options.setContent,
        openPanel: async (type, content) => {
          // One click opens or switches one panel, so a page cannot keep panels coming on its own.
          await this.gate.enter("panels.open");
          return this.options.openPanel(type, content);
        },
        openPanels: async (types) => {
          // One press opens the whole call, but only the module's own types, each once, in this panel's area (the host checks).
          await this.gate.enter("panels.openMany");
          return this.options.openPanels(types);
        },
        navigated: (requestId, handled, ok) => {
          if (this.bridge === bridge) this.navigated(requestId, handled, ok);
        },
        isMaximized: () => this.maximized,
        isOverGame: () => this.overGame !== null,
        setMaximized: async (maximized) => {
          // Covering the other panels takes a click, so a page cannot take over the workspace on its own.
          if (maximized) {
            await this.gate.enter("panel.setMaximized");
          }
          this.options.setMaximized(maximized);
        },
        setDialog: (open, size) => this.requestDialog(open, size),
        setDialogTitle: (title) => this.options.setDialogTitle(title),
        setLive: (state) => this.options.setLive(state),
        workspace,
        data,
        // Its state is kept as the owner it runs as: another owner's copy of the module under its id never reads it.
        panelState: { get: (id) => panelState.get(id, module.owner), set: (id, value) => panelState.set(id, value, module.owner) },
        appSettings: this.options.appSettings,
        appBlobs: this.options.appBlobs,
        // The connectors and pickers: the session gates them and keeps what this page watches.
        ...this.session.connect(() => bridge, pageImports.signal),
        getViewport: () => ({ ...this.viewport }),
        isSuspended: () => this.suspended,
        isBehind: () => this.behind,
        getTheme: this.options.getTheme,
        getLanguage: this.options.getLanguage,
        // Only the page's current port says whether it is busy; an old port's calls ending say nothing about the new page.
        onBusy: (busy, served) => {
          if (this.bridge === bridge) this.onBridgeBusy(busy, served);
        },
        openLink: (url) => this.openLink(url),
        tooltip:{
          show:async request=>{
            this.gate.check("ui.tooltip.show");
            if(!this.tooltipAnchorAllowed(request.at))return false;
            if(request.pinned)await this.gate.enter("ui.tooltip.show", { detail: "a pinned ui.tooltip.show" });
            else {
              if(!this.tooltipPointerMatches(request))await new Promise(resolve=>setTimeout(resolve,40));
              if(!this.tooltipPointerMatches(request)&&!this.gate.pressed)return false;
            }
            if(!this.gate.live(bridge))return false;
            return this.options.tooltip?.show(request)??false;
          },
          move:anchor=>{if(this.tooltipAnchorAllowed(anchor.at)&&this.tooltipPointerMatches(anchor))this.options.tooltip?.move(anchor);},
          close:(id,hoverOnly)=>this.options.tooltip?.close(id,hoverOnly,true),
          defineSkin:async(name,skin)=>{await this.options.tooltip?.defineSkin(name,skin);},
        },
        showMenu: async (menu) => {
          // One click opens one menu, so a page cannot keep menus coming on its own.
          await this.gate.enter("ui.showMenu");
          return this.options.showMenu(menu);
        },
      },
      () => {
        pageImports.abort();
        if (this.bridge !== bridge) return;
        this.bridge = undefined;
        // A closed panel let go of all the rest when it was closed (a panel opened in its place may hold it now):
        // its port going only ends the wait for its saves.
        if (this.disposed) return this.closeNow();
        this.options.tooltip?.close();
        this.session.pageGone();
      },
    );
    this.bridge = bridge;
    this.view.webContents.postMessage("tavora:port", null, [port2]);
  }

  /** The Overlay page added or removed one of this module's game overlays in this workspace scope: `keys` is what overlay.overGame gives now. */
  overGameChanged(keys: string[]): void {
    this.bridge?.emit("overlay.overGameChanged", { keys: [...keys] });
  }

  /** The user pressed Settings on an overlay's frame on the Overlay page: the panel is in its dialog, and shows the settings of what `key` shows. False while the page has not connected yet. */
  openSettings(key: string): boolean {
    if (!this.bridge) return false;
    this.bridge.emit("panel.openSettings", { key });
    return true;
  }

  /** The user pressed a hotkey set for this module in this workspace. */
  hotkeyPressed(binding: HotkeyBinding): void {
    this.gate.noteHotkey(binding.action);
    this.bridge?.emit("hotkeys.pressed", { ...binding });
  }

  /** The user changed the AI accounts; a module granted the connector hears it. */
  notifyAiUsageAccounts(): void {
    if (this.gate.granted().has("aiUsage")) this.bridge?.emit("aiUsage.accountsChanged", null);
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.view.setBounds(bounds);
    if (bounds.width === this.viewport.width && bounds.height === this.viewport.height) return;
    this.viewport = { width: bounds.width, height: bounds.height };
    this.bridge?.emit("workspace.resize", { ...this.viewport });
  }

  /** Whether the panel is shown now (in its slot, or over the game). */
  private shown = false;
  private drawing: Promise<void> = Promise.resolve();
  private solid: Promise<void> = Promise.resolve();
  private frameRequests = 0;
  private readonly frameWaiters = new Map<number, () => void>();
  /** False from a new page's start until it has drawn once; the host UI keeps the panel's loader under it until then. */
  firstDrawn = false;

  /** How the page is doing: loading, ready, failed, unresponsive, crashed or unavailable. */
  get status(): InstanceStatus {
    return this.health;
  }

  /**
   * Where the page is, as one value (for the host UI and diagnostics): its trouble if it has one, else loading (the
   * document is not in yet), settling (in, hidden until its first data), revealed (shown, its first frame not drawn yet)
   * or drawn.
   */
  get phase(): PagePhase {
    if (this.health !== "loading" && this.health !== "ready") return this.health;
    if (!this.revealed) return this.health === "loading" ? "loading" : "settling";
    return this.firstDrawn ? "drawn" : "revealed";
  }

  setVisible(visible: boolean): void {
    this.view.setVisible(visible);
    if (visible === this.shown) return;
    this.shown = visible;
    if (visible) this.drawing = this.awaitFrame();
    else for (const done of [...this.frameWaiters.values()]) done();
  }

  /**
   * Asks the page for a frame now and resolves once it has drawn one (at most DRAW_CAP_MS later), or now while it is
   * hidden. Over the game, the window it was lent to stays see-through until then, so it never shows the panel's last
   * frame from its workspace: the page draws its look over the game only after it heard panel.overGame.
   */
  nextFrame(): Promise<void> {
    if (!this.shown) return Promise.resolve();
    this.drawing = this.awaitFrame();
    return this.drawing;
  }

  /** Resolves once the panel has drawn since it was last shown (at most DRAW_CAP_MS later), or now while it is hidden. */
  get drawn(): Promise<void> {
    return this.shown ? this.drawing : Promise.resolve();
  }

  /**
   * Resolves once the panel has drawn since it was last shown and its background is solid again (ON_SCREEN_MS after
   * the frame), or now while it is hidden. What the host UI shows under the view may go only then: before, the slot
   * shows through wherever the page draws nothing.
   */
  get settled(): Promise<void> {
    return this.shown ? this.solid : Promise.resolve();
  }

  /**
   * A page draws nothing while hidden, and a heavy one takes a few hundred ms for its first frame once shown. Until
   * that frame the view is see-through, so what the host UI shows in the slot stays: the panel's picture from while
   * a dialog was open, or its loader. The preload answers after the page's next frames (tavora:frame).
   */
  private awaitFrame(): Promise<void> {
    const contents = this.view.webContents;
    if (contents.isDestroyed()) return Promise.resolve();
    if (!this.overGame) this.view.setBackgroundColor("#00000000");
    const requestId = ++this.frameRequests;
    this.frameSeenAs = "not received";
    let solid = () => {};
    this.solid = new Promise((resolve) => (solid = resolve));
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.frameWaiters.delete(requestId);
        if (requestId === this.frameRequests && !contents.isDestroyed()) {
          contents.setBackgroundThrottling(true);
          // Opaque at once, the panel would show its plain colour until the frame is on screen.
          setTimeout(() => {
            if (requestId === this.frameRequests && !this.frameWaiters.size && !this.overGame && !contents.isDestroyed()) this.view.setBackgroundColor(this.options.getTheme().tokens.background);
            solid();
          }, ON_SCREEN_MS);
          if (this.shown && this.revealed && !this.firstDrawn) {
            this.firstDrawn = true;
            this.options.onDrawn?.();
          }
        } else solid();
        resolve();
      };
      // Shows up in Settings > Diagnostic info, so a panel that keeps a workspace's cover up that long can be found.
      const timer = setTimeout(() => {
        if (!contents.isDestroyed()) {
          const { width, height } = this.view.getBounds();
          console.warn(`[tavora] ${this.moduleId}${this.typeName ? ` (${this.typeName})` : ""} did not draw within ${DRAW_CAP_MS} ms of being shown: ${width}x${height}, ${this.phase}, loading ${contents.isLoading()}, suspended ${this.suspended}, revealed ${this.revealed}, page ${this.frameSeenAs}, window ${this.windowState()}`);
        }
        done();
      }, DRAW_CAP_MS);
      this.frameWaiters.set(requestId, done);
      // Chromium counts a page under another view (the workspace's loading cover) as hidden, and a hidden page does not
      // draw: until this frame, the page counts as shown wherever it lies.
      contents.setBackgroundThrottling(false);
      contents.send("tavora:frame", requestId);
    });
  }

  /** The window the panel is in: whether Windows shows it, so a panel that never draws can be told from a hidden window. */
  private windowState(): string {
    const window = BrowserWindow.getAllWindows().find((w) => w.contentView.children.includes(this.view));
    if (!window) return "none";
    return [window.isVisible() ? "visible" : "hidden", window.isMinimized() && "minimized", window.isFocused() ? "focused" : "unfocused"].filter(Boolean).join(" ");
  }

  /** What the page said when the last frame request reached it (document.visibilityState), or "not received". */
  private frameSeenAs = "not received";

  frameSeen(visibility: unknown): void {
    if (typeof visibility === "string") this.frameSeenAs = visibility.slice(0, 20);
  }

  /** The preload says the page has drawn since frame request `requestId`. */
  framed(requestId: unknown): void {
    if (typeof requestId === "number") this.frameWaiters.get(requestId)?.();
  }

  /**
   * The panel is over its game, in a window of Tavora's own (game-overlay-window.ts), which says how with `setOverGame`.
   * It is this same view and page, with the same bridge; only the look changes (see through and zoomed, as the window
   * says) and clicks and keys count as the user's only in Use (`OverGame.takesInput`).
   */
  private overGame: OverGame | null = null;
  /**
   * The style of Tavora's own on the page while over the game (opacity, zoom). Kept here, not with one stay over the game,
   * so it is always taken off again: a style left behind kept the panel zoomed in its workspace.
   */
  private gameCss: string | undefined;

  get isOverGame(): boolean {
    return this.overGame !== null;
  }

  /**
   * How the panel is over the game now, or null: back in its workspace slot. The window that holds the panel is the
   * only one that calls this: once when it takes the view, again whenever its mode, opacity or zoom changes, and null
   * when it lets the view go. The page hears `panel.overGame` only when it goes over the game or comes back.
   */
  setOverGame(next: OverGame | null): void {
    const was = this.overGame;
    if (!next) {
      if (!was) return;
      this.overGame = null;
      this.refreshBehind();
      this.bridge?.emit("panel.overGame", { over: false });
      this.view.setBackgroundColor(this.options.getTheme().tokens.background);
      // After any style being set or removed, so the style it inserts last isn't left behind.
      void this.applyGameOpacity();
      return;
    }
    this.overGame = { ...next };
    if (was) {
      // Faded or zoomed differently (or a new stay over the game, the panel lent again, with a style of its own).
      if (was.opacity !== next.opacity || was.zoom !== next.zoom) void this.applyGameOpacity();
      return;
    }
    // Without a colour of its own, so the opacity the user chose lets the game show through.
    this.view.setBackgroundColor("#00000000");
    this.refreshBehind();
    // The page may draw a lighter look of itself there (panel.isOverGame asks the same).
    this.bridge?.emit("panel.overGame", { over: true });
    if (next.opacity !== 100 || next.zoom !== 1) void this.applyGameOpacity();
  }

  private gameOpacityQueue: Promise<void> = Promise.resolve();

  private applyGameOpacity(): Promise<void> {
    this.gameOpacityQueue = this.gameOpacityQueue.then(async () => {
      const away = this.overGame;
      const contents = this.contents();
      if (!contents) return;
      try {
        const old = this.gameCss;
        this.gameCss = undefined;
        if (old) await contents.removeInsertedCSS(old);
        // Back in its workspace: no style of Tavora's own at all.
        if (!away) return;
        const rules = [away.opacity === 100 ? "" : `opacity:${away.opacity / 100} !important;`, away.zoom === 1 ? "" : `zoom:${away.zoom} !important;`].join("");
        if (rules) this.gameCss = await contents.insertCSS(`html{${rules}}`, { cssOrigin: "user" });
      } catch {
        // The page went away; the next load sets it again.
      }
    });
    return this.gameOpacityQueue;
  }

  /** Whether the panel's group fills the workspace, as the host UI last reported it. */
  private maximized = false;
  /** Whether the panel is shown big in a dialog over the workspace (panel.setDialog). */
  private inDialog = false;

  /** The host opened or closed the panel's dialog; the module hears a change. */
  setInDialog(open: boolean): void {
    if (open === this.inDialog) return;
    this.inDialog = open;
    this.bridge?.emit("panel.dialog", { open });
  }

  /** Gives the page the keyboard focus. */
  focus(): void {
    const contents = this.view.webContents;
    if (!contents.isDestroyed()) contents.focus();
  }

  /** The panel as a hotkey hears it. */
  get hotkeys(): ModuleView {
    return this;
  }

  /** Not while it runs only with its game, out of sight (a hotkey press goes to a panel in sight first). */
  inSight(): boolean {
    return !(this.options.runsOnlyWithGame?.() ?? false);
  }

  /** A still image of the page, to stand in for it while a menu is over it. */
  capture(): Promise<string | null> {
    return stillOf(this.view);
  }

  /** The page itself goes over the game (game-overlay-window.ts), unless it is gone. */
  inGame(): ModuleView | null {
    return this.view.webContents.isDestroyed() ? null : this;
  }

  /** The host UI reported whether the panel fills the workspace; the module hears a change. */
  setMaximized(maximized: boolean): void {
    if (maximized === this.maximized) return;
    this.maximized = maximized;
    this.bridge?.emit("panel.maximized", { maximized });
  }

  /** Recolours the page and tells the module, which may restyle itself through ui.onThemeChange. */
  applyTheme(theme: TavoraTheme): void {
    // A panel still waiting for its first frame stays see-through until then (awaitFrame).
    if (!this.overGame && !this.frameWaiters.size) this.view.setBackgroundColor(theme.tokens.background);
    this.insertThemeCss(theme);
    this.bridge?.emit("ui.theme", theme);
  }

  /** Rounds the view to the panel cards' corners of the style now (panel-corners.ts). */
  setCorners(corners: PanelCorners): void {
    this.view.setBorderRadius(corners.module);
  }

  /** Tells the module the user changed the language, so it can word itself anew through ui.onLanguageChange. */
  applyLanguage(language: string): void {
    this.bridge?.emit("ui.language", language);
  }

  /** The theme's colours, and its font when that changed. */
  private insertThemeCss(theme: TavoraTheme): void {
    void this.themeCss.replace(moduleThemeCss(theme));
    void this.fontCss.replace(this.options.fontCss(theme));
  }

  /** Tells the module it is hidden; it should pause timers and animations. */
  suspend(): void {
    this.options.tooltip?.close();
    if (this.suspended) return;
    this.suspended = true;
    this.session.setSuspended(true);
    this.bridge?.emit("lifecycle.suspend", null);
  }

  /**
   * Tavora's window went behind another program or came back in front. Tells the panel (lifecycle.behind) so what the user
   * must be there to see waits. A panel over the game is seen there, so it is never behind.
   */
  setWindowBehind(behind: boolean): void {
    this.windowBehind = behind;
    this.refreshBehind();
  }

  private refreshBehind(): void {
    const behind = this.windowBehind && this.overGame === null;
    if (behind === this.behind) return;
    this.behind = behind;
    this.bridge?.emit("lifecycle.behind", { behind });
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.session.setSuspended(false);
    this.bridge?.emit("lifecycle.resume", null);
  }

  /** Called when the page's preload answers a heartbeat ping. */
  pong(): void {
    this.lastPong = Date.now();
    if (this.health === "unresponsive") this.setStatus("ready");
  }

  /**
   * Chromium only notices a hung page when input goes unanswered, which
   * misses a panel nobody is clicking. The preload shares the page's main
   * thread, so if it stops answering pings, so has the page.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.disposed) return;
    this.lastPong = Date.now();
    this.heartbeat = setInterval(() => {
      // A closed view has no page any more (Electron drops it): stop, never touch it.
      const contents = this.contents();
      if (!contents) return this.stopHeartbeat();
      contents.send("tavora:ping");
      if (this.health === "ready" && Date.now() - this.lastPong > UNRESPONSIVE_MS) this.setStatus("unresponsive");
    }, HEARTBEAT_MS);
  }

  /** Measures the module's browser storage now and then; a module cannot be left to fill the user's disk. */
  private startStorageWatch(): void {
    this.stopStorageWatch();
    if (this.disposed) return;
    const limit = this.options.storageLimit ?? MODULE_STORAGE_LIMIT;
    this.storageWatch = setInterval(() => {
      const contents = this.contents();
      if (!contents) return this.stopStorageWatch();
      const folder = contents.session.storagePath;
      if (!folder || this.measuring) return;
      this.measuring = true;
      overStorageLimit(folder, limit)
        .then((over) => {
          // A measurement still running when the panel closes reports nothing: the panel is gone.
          if (over && !this.disposed) this.options.onStorageOver();
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

  /**
   * The page ended because Tavora stopped it (stop(): its storage was cleared, the user's Stop), not by crashing; true
   * until it loads again. Panels running with their game don't count that as a crash (host.ts).
   */
  get stoppedByTavora(): boolean {
    return this.stopping;
  }
  private stopping = false;

  /** Loads the page again; with `next`, from the module as installed now (an update may be in another folder). */
  reload(next?: InstalledModule): void {
    this.stopping = false;
    if (next && next.manifest.id === this.options.module.manifest.id && next.owner === this.options.module.owner) {
      this.options.module = next;
      const page = this.contents();
      if (page) serving.set(page.session, next);
    }
    const page = this.contents();
    // Without a page there is nothing to load, so the panel isn't left saying "loading".
    if (!page) return;
    this.setStatus("loading");
    page.reload();
  }

  /**
   * Ends a hung or misbehaving module. Its data stays; Reload starts it again.
   * Resolves once the renderer is gone, so a reload after it is not undone by
   * the crash arriving late.
   */
  stop(): Promise<void> {
    const contents = this.view.webContents;
    if (contents.isDestroyed()) return Promise.resolve();
    this.stopping = true;
    const gone = new Promise<void>((resolve) => {
      contents.once("render-process-gone", () => resolve());
      contents.once("destroyed", () => resolve());
      setTimeout(resolve, 5_000);
    });
    const pid = contents.getOSProcessId();
    contents.forcefullyCrashRenderer();
    // Chromium has been seen to leave a busy renderer running; make sure.
    setTimeout(() => {
      if (this.health === "crashed" || contents.isDestroyed() || contents.getOSProcessId() !== pid) return;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, 2_000);
    return gone;
  }

  /**
   * Closes the panel's page for good (the panel is closed, its workspace left, or the window goes). The page is hidden
   * at once and told (lifecycle.dispose); it keeps its port, for saves only, until it has answered a ping (the preload
   * answers once the page has had the event) and its calls and file writes have been quiet for CLOSE_QUIET_MS, or
   * CLOSE_CAP_MS is up. Then port and page close and the promise resolves.
   * `now` closes without waiting: for a panel whose data is being deleted.
   */
  dispose(now = false): Promise<void> {
    if (now && this.end.step === "saving") this.end.close();
    if (this.end.step !== "open") return this.end.done;
    this.stopHeartbeat();
    this.stopStorageWatch();
    this.clearRevealTimers();
    const bridge = this.bridge;
    // Electron drops a closed view's page, so it may be gone already.
    const contents = this.contents();
    let resolve!: () => void;
    const done = new Promise<void>((settled) => (resolve = settled));
    let answered = false;
    let listening = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let cap: ReturnType<typeof setTimeout> | undefined;
    const token = ++closePings;
    const uploads = contents && !contents.isDestroyed() ? uploadsOf(contents.session) : undefined;
    const onPong = (event: IpcMainEvent, answer: unknown) => {
      if (answer !== token || event.senderFrame?.parent !== null) return;
      answered = true;
      settle();
    };
    // Quiet: the page answered the ping sent after the event, and nothing it asked or writes since is still running.
    const settle = () => {
      clearTimeout(quiet);
      quiet = answered && !this.bridge?.busy && !uploads?.running ? setTimeout(close, CLOSE_QUIET_MS) : undefined;
    };
    const close = () => {
      if (this.end.step !== "saving" || this.end.done !== done) return;
      clearTimeout(quiet);
      clearTimeout(cap);
      this.end = { step: "closed", done };
      uploads?.changed.delete(settle);
      const alive = contents !== undefined && !contents.isDestroyed();
      if (alive && listening) contents.ipc.removeListener("tavora:pong", onPong);
      const port = this.bridge;
      this.bridge = undefined;
      port?.close();
      if (alive) contents.close();
      resolve();
    };
    this.end = { step: "saving", done, settle, close };
    // Everything but the port ends now, so nothing of this page reaches a panel opened in its place.
    this.letGo();
    bridge?.closing();
    bridge?.emit("lifecycle.dispose", null);
    if (now || !bridge?.ready || !contents || contents.isDestroyed()) {
      close();
      return done;
    }
    cap = setTimeout(close, CLOSE_CAP_MS);
    try {
      // Out of sight at once, and at full speed while it saves (a hidden page's timers are slowed down).
      this.setVisible(false);
      contents.setBackgroundThrottling(false);
      // The host finds pages by their panel, which is gone: this page's answer is heard here.
      contents.ipc.on("tavora:pong", onPong);
      listening = true;
      uploads?.changed.add(settle);
      contents.send("tavora:ping", token);
    } catch (error) {
      console.warn(`[tavora] module ${this.moduleId} could not wait for its page to save`, error);
      close();
    }
    return done;
  }

  /** A closing panel's page has nothing more to save: its port and page close now. */
  private closeNow(): void {
    if (this.end.step === "saving") this.end.close();
  }

  /**
   * Asks the page to switch to other content (panel.onNavigate). It saves first; `failed` when it could not or did
   * not answer within navigateTimeoutMs (it keeps what it showed), `unhandled` when the page takes no navigation.
   */
  navigate(content: PanelContent): Promise<NavigateOutcome> {
    const bridge = this.bridge;
    if (!bridge || !bridge.ready || this.health !== "ready") return Promise.resolve("failed");
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
    this.letGo();
    const bridge = this.bridge;
    this.bridge = undefined;
    bridge?.close();
  }

  /** What the page holds apart from its port: its watches, tooltip, Discord hold, waiting navigations and last press. */
  private letGo(): void {
    clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
    this.options.tooltip?.close();this.pointer=null;
    this.addPass = null;
    // A closed panel's last click opens nothing more, here or through its session (the session shares the press).
    if (this.disposed) this.gate.usePress();
    // A page that goes away answers nothing more.
    for (const finish of [...this.navigations.values()]) finish("failed");
    this.session.pageGone();
  }

  private setStatus(status: InstanceStatus): void {
    // A closed panel's page tells the host nothing more: a panel opened in its place may have the same id.
    if (this.disposed || this.health === status) return;
    // Only a running page is watched; it is restarted when the page loads again.
    if (status !== "ready" && status !== "unresponsive") this.stopHeartbeat();
    this.health = status;
    // A page that failed has nothing to wait for; show whatever it is.
    if (status === "failed" || status === "crashed") this.reveal();
    this.options.onStatus(status);
  }
}
