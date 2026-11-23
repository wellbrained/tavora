// Stream overlays: pages a module ships for streaming software such as OBS (the manifest's `overlay`). The user
// adds an overlay's link as a Browser Source; Tavora serves the page and its files from this PC only, and passes on
// what the module published for it (overlay.publish) as server-sent events. Each link belongs to one key of one
// module in one workspace and carries a random token, which is the only thing that makes it reachable: the server
// listens on 127.0.0.1, refuses any other Host header (so a web page can't reach it through DNS rebinding), and serves
// a link only while its module is installed under the same owner with the `stream-overlay` connector granted.
//
// In OBS Tavora can't stop a page from navigating away (there is no will-navigate there), so the link leads to a frame
// page of Tavora's own (overlayFrame), and the module's page runs inside it: in a sandboxed iframe that may not
// navigate the top page, open windows or send forms, under a policy that lets the iframe show nothing but that page's
// own origin. The module's page gets an origin of its own per link, `<token>.localhost` (Chromium resolves any
// `*.localhost` name to this PC), so it is not the frame page's origin and can't reach into it to lift the sandbox.
// The link itself (on 127.0.0.1, where Tavoras before 0.24.105 served modules' pages) only redirects to the frame page,
// which has an origin of its own too, `f<token>.localhost`, that no page of a module ever ran on. The module's page is
// served as a document only with a key (FrameKeys) the frame page puts in the frame's address, and only that frame
// page's origin may frame it.
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { LIMITS, OVERLAY_COLOR_SCHEME_MESSAGE, OVERLAY_CSS_MESSAGE, OVERLAY_FONT_PATH, OVERLAY_STATE_PATH, type JsonValue } from "@tavora/sdk/protocol";
import { overlayFontCss, overlayMessage, watchOverlayFont } from "./overlay-font";
import { contentTypeFor, resolveAsset } from "./assets";
import { HostError } from "./errors";
import { isJsonValue } from "./json";
import { SAVED_FILES, SavedFile } from "./saved-file";
import { trackOwnServer } from "./own-ports";

export const OVERLAYS_FILE = "overlays.json";
/** Where Stream overlays listen unless the user picks another port. */
export const DEFAULT_OVERLAY_PORT = 47820;
export const MIN_OVERLAY_PORT = 1024;
export const MAX_OVERLAY_PORT = 65535;
/** Overlay pages one Tavora serves live data to at once; OBS keeps one per Browser Source. */
const MAX_STREAMS = 64;
/** How often a live overlay hears that Tavora is still there, and checks its link still may be served. */
const STREAM_PING_MS = 15_000;
/** How long saving waits for more changes, so a burst of counter clicks is written once. */
const SAVE_DELAY_MS = 250;

const TOKEN = /^[0-9a-f]{32}$/;

/** The query parameter that carries a frame page's key to the module's page (FrameKeys). */
export const FRAME_KEY_PARAM = "tavoraFrameKey";
/** How long after the frame page loaded its key lets the page load (again, when it reloads or moves within its frame). */
export const FRAME_KEY_MS = 30_000;
/** How often one key lets the page load within that time. */
export const FRAME_KEY_USES = 10;
/** Keys kept at once; the oldest goes first, so nothing can make the server keep more. */
const MAX_FRAME_KEYS = 256;

/** Who an overlay link belongs to, and the module's id for it. */
export interface OverlaySubject {
  owner: string;
  moduleId: string;
  workspaceId: string;
  key: string;
}

export interface OverlayLink extends OverlaySubject {
  token: string;
}

type OverlayFile = { version: number; links: (OverlayLink & { state?: JsonValue })[] };

const sameSubject = (a: OverlaySubject, b: OverlaySubject) => a.owner === b.owner && a.moduleId === b.moduleId && a.workspaceId === b.workspaceId && a.key === b.key;

function isSubjectField(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/** The overlay links and what each one shows, kept in overlays.json in the data folder. */
export class OverlayStore {
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly watchers = new Map<string, Set<(state: JsonValue | null | undefined) => void>>();

  private constructor(
    private readonly file: SavedFile,
    private readonly links: Map<string, OverlayLink>,
    private readonly states: Map<string, JsonValue>,
  ) {}

  static async load(userData: string): Promise<OverlayStore> {
    const file = new SavedFile(path.join(userData, OVERLAYS_FILE), SAVED_FILES[OVERLAYS_FILE]);
    const raw = (await file.read()) as Partial<OverlayFile> | null;
    const links = new Map<string, OverlayLink>();
    const states = new Map<string, JsonValue>();
    for (const entry of Array.isArray(raw?.links) ? raw.links : []) {
      if (typeof entry !== "object" || entry === null) continue;
      const { token, owner, moduleId, workspaceId, key, state } = entry as Partial<OverlayLink & { state: unknown }>;
      if (typeof token !== "string" || !TOKEN.test(token) || ![owner, moduleId, workspaceId, key].every(isSubjectField)) continue;
      links.set(token, { token, owner: owner!, moduleId: moduleId!, workspaceId: workspaceId!, key: key! });
      if (state !== undefined && isJsonValue(state)) states.set(token, state);
    }
    return new OverlayStore(file, links, states);
  }

  /** The link with this token, and what it shows now (null for nothing). */
  find(token: string): { link: OverlayLink; state: JsonValue | null } | null {
    const link = TOKEN.test(token) ? this.links.get(token) : undefined;
    return link ? { link, state: this.states.get(token) ?? null } : null;
  }

  /** The link a key has now, without making one. */
  peek(subject: OverlaySubject): { link: OverlayLink; state: JsonValue | null } | null {
    const link = this.linkOf(subject);
    return link ? { link, state: this.states.get(link.token) ?? null } : null;
  }

  private linkOf(subject: OverlaySubject): OverlayLink | undefined {
    for (const link of this.links.values()) if (sameSubject(link, subject)) return link;
    return undefined;
  }

  /** The link for a key, made the first time it is asked for. */
  link(subject: OverlaySubject): OverlayLink {
    const existing = this.linkOf(subject);
    if (existing) return existing;
    let count = 0;
    for (const link of this.links.values()) if (link.owner === subject.owner && link.moduleId === subject.moduleId && link.workspaceId === subject.workspaceId) count++;
    if (count >= LIMITS.maxOverlays) throw new HostError("QUOTA_EXCEEDED", `at most ${LIMITS.maxOverlays} overlays per module and workspace`);
    const link = { ...subject, token: randomBytes(16).toString("hex") };
    this.links.set(link.token, link);
    this.saveSoon();
    return link;
  }

  publish(subject: OverlaySubject, state: JsonValue): void {
    const link = this.link(subject);
    this.states.set(link.token, state);
    this.tell(link.token, state);
    this.saveSoon();
  }

  /** Shows nothing until published again; the link stays. */
  remove(subject: OverlaySubject): void {
    const link = this.linkOf(subject);
    if (!link || !this.states.delete(link.token)) return;
    this.tell(link.token, null);
    this.saveSoon();
  }

  /** A new token for the key's link; whatever used the old one stops getting anything. */
  reset(subject: OverlaySubject): void {
    const link = this.linkOf(subject);
    if (!link) return;
    this.replace(link);
    this.saveSoon();
  }

  /** New tokens for every link, so every link handed out so far stops working. */
  resetAll(): void {
    for (const link of [...this.links.values()]) this.replace(link);
    this.saveSoon();
  }

  /** Every link there is (for Settings; the tokens are not passed on). */
  all(): OverlayLink[] {
    return [...this.links.values()];
  }

  /** Forgets the links matching `test` (a deleted workspace, a module whose data was deleted). */
  forget(test: (link: OverlayLink) => boolean): void {
    let changed = false;
    for (const link of [...this.links.values()]) {
      if (!test(link)) continue;
      this.drop(link.token);
      changed = true;
    }
    if (changed) this.saveSoon();
  }

  private replace(link: OverlayLink): void {
    const state = this.states.get(link.token);
    this.drop(link.token);
    const next = { ...link, token: randomBytes(16).toString("hex") };
    this.links.set(next.token, next);
    if (state !== undefined) this.states.set(next.token, state);
  }

  private drop(token: string): void {
    this.links.delete(token);
    this.states.delete(token);
    // Closing tells each open stream to end; reconnecting with the old token finds nothing.
    for (const fn of this.watchers.get(token) ?? []) fn(undefined);
    this.watchers.delete(token);
  }

  /** Calls `fn` with each new state of a link, or with undefined when the link goes away. */
  watch(token: string, fn: (state: JsonValue | null | undefined) => void): () => void {
    let set = this.watchers.get(token);
    if (!set) this.watchers.set(token, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0 && this.watchers.get(token) === set) this.watchers.delete(token);
    };
  }

  private tell(token: string, state: JsonValue | null): void {
    for (const fn of this.watchers.get(token) ?? []) fn(state);
  }

  private saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY_MS);
  }

  /** Writes overlays.json now; also called on quit so the last change is not lost. */
  save(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const links: OverlayFile["links"] = [...this.links.values()].map((link) => (this.states.has(link.token) ? { ...link, state: this.states.get(link.token)! } : { ...link }));
    return this.file.write({ links }).catch((error: unknown) => console.error("[tavora] saving overlays failed", error));
  }
}

/** The page of a link's module, while it may be served: the module's real root and its manifest's `overlay`. */
export interface OverlayPage {
  root: string;
  entry: string;
}

/** The file of a request for `rest` ("/" for the page itself) under an overlay's address: the module's own files, next to the page. */
export function resolveOverlayFile(page: OverlayPage, rest: string): Promise<string | null> {
  const dir = path.posix.dirname(page.entry);
  return resolveAsset(page.root, rest === "/" ? `/${page.entry}` : `${dir === "." ? "" : `/${dir}`}${rest}`);
}

export interface OverlayServerOptions {
  store: OverlayStore;
  /** The page for a link, or null when its module is gone, is another owner's now, or lost the connector. */
  page(link: OverlayLink): OverlayPage | null;
  /** The clock frame page keys are timed by (tests). */
  now?: () => number;
}

/**
 * Strict: the page loads only its own files and talks only to the server it came from. No workers: a service worker
 * could answer the page's own address later with a document of its own.
 */
const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];

/** The policy of an overlay page in Tavora's own windows (game-overlay-page.ts), which nothing may frame. */
export const OVERLAY_CSP = [...PAGE_POLICY, "frame-ancestors 'none'"].join("; ");

/**
 * The policy the frame page requires of every document in its frame (the iframe's `csp`, CSP Embedded Enforcement):
 * Chromium shows a document there only if its own policy is at least this strict, so nothing the page could get
 * served another way (a cached or synthesized response) runs without it.
 */
export const OVERLAY_REQUIRED_CSP = PAGE_POLICY.join("; ");

/** The policy of a module's overlay page in OBS: the same, shown only inside the link's frame page. */
export function streamOverlayCsp(port: number, token: string): string {
  return [...PAGE_POLICY, `frame-ancestors ${overlayFrameOrigin(port, token)}`].join("; ");
}

const COMMON_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export type OverlayServerStatus = "off" | "running" | "in-use" | "failed";

/** The address OBS is given for a link: the frame page around the module's page. */
export function overlayUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/overlay/${token}/`;
}

/** Where the module's own page of a link is served: an origin of its own, which only that link's frame page shows. */
export function overlayPageOrigin(port: number, token: string): string {
  return `http://${token}.localhost:${port}`;
}

/** Where a link's frame page is served (the link redirects there): an origin no page of a module ever ran on. */
export function overlayFrameOrigin(port: number, token: string): string {
  return `http://f${token}.localhost:${port}`;
}

const FRAME_STYLE = "html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}iframe{display:block;width:100%;height:100%;border:0}";
/**
 * The frame page's one script. It gives the frame its address, with the link's `#…` (which never reaches the
 * server). It takes on the colour scheme the page reports (OVERLAY_COLOR_SCHEME_MESSAGE, sent by watchOverlay):
 * Chromium paints an opaque backdrop behind a frame whose scheme differs from its page's, and an overlay must stay
 * see-through. And it passes on the Custom CSS OBS puts into the frame page (a `<style>` OBS adds once the page has
 * loaded) to the page, only to the page's origin (OVERLAY_CSS_MESSAGE), as OBS used to give it to the page itself.
 * It reads nothing else from the page and gives it nothing else.
 */
const FRAME_SCRIPT =
  `(function(){var f=document.getElementById("page"),src=f.getAttribute("data-src"),origin=new URL(src).origin,sent=null;` +
  `function css(){var t=[];document.querySelectorAll("style:not(#frame)").forEach(function(s){t.push(s.textContent||"")});return t.join("\\n")}` +
  `function send(){var c=css();if(c===sent||!f.contentWindow)return;sent=c;f.contentWindow.postMessage({type:${JSON.stringify(OVERLAY_CSS_MESSAGE)},css:c},origin)}` +
  `addEventListener("message",function(e){var d=e.data;if(e.source!==f.contentWindow||!d||d.type!==${JSON.stringify(OVERLAY_COLOR_SCHEME_MESSAGE)})return;` +
  `if(typeof d.colorScheme==="string"&&/^[a-z ]{1,32}$/.test(d.colorScheme))f.style.colorScheme=d.colorScheme;sent=null;send()});` +
  `new MutationObserver(send).observe(document.documentElement,{childList:true,subtree:true,characterData:true});` +
  `f.src=src+location.hash})();`;
const hashOf = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
/**
 * What the iframe allows the page: its scripts, and its own origin, so its files, `_state` and `_font.css` load as they
 * always did (an opaque origin would make each of them a cross-origin request and take its storage away). That origin
 * is not the frame page's, so it can't reach into it. Nothing else: no navigating the top page, no new windows, no
 * forms, no dialogs, no downloads.
 */
export const OVERLAY_SANDBOX = "allow-scripts allow-same-origin";

const escapeAttribute = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The frame page OBS loads for a link: no content of its own, only the module's page, filling it. `search` (the link's
 * query, usually none) goes on to the page. Its policy lets it run its one script and show only the page's origin,
 * so the page can't take the frame to any other address either. Inline styles are allowed only so OBS's Custom CSS
 * gets in (and on to the page); the frame page has nothing a style could reveal.
 */
export function overlayFrame(port: number, token: string, search = "", key?: string): { html: string; csp: string } {
  const query = key === undefined ? search : `${search ? `${search}&` : "?"}${FRAME_KEY_PARAM}=${key}`;
  const src = `${overlayPageOrigin(port, token)}/${query}`;
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>Tavora overlay</title><style id="frame">${FRAME_STYLE}</style></head>` +
    `<body><iframe id="page" data-src="${escapeAttribute(src)}" sandbox="${OVERLAY_SANDBOX}" csp="${escapeAttribute(OVERLAY_REQUIRED_CSP)}" allow="autoplay" scrolling="no"></iframe>` +
    `<script>${FRAME_SCRIPT}</script></body></html>`;
  const csp = [
    "default-src 'none'",
    `script-src ${hashOf(FRAME_SCRIPT)}`,
    "style-src 'unsafe-inline'",
    `frame-src ${overlayPageOrigin(port, token)}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return { html, csp };
}

/** The Host of a module's page, `<token>.localhost:<port>`. */
const PAGE_HOST = /^([0-9a-f]{32})\.localhost:(\d+)$/;
/** The Host of a link's frame page, `f<token>.localhost:<port>`. */
const FRAME_HOST = /^f([0-9a-f]{32})\.localhost:(\d+)$/;

/** Where a request puts what it loads into a frame or window of its own: a document. */
const DOCUMENT_DESTS = new Set(["document", "iframe", "frame", "embed", "object", "fencedframe"]);
/** Files a browser shows as a document of their own, which could run the module's scripts outside the frame page's sandbox. */
const DOCUMENT_TYPE = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)\b/;

/**
 * The keys of the frame pages Tavora served: each lets the page of its link be loaded as a document, for FRAME_KEY_MS
 * after its frame page loaded and at most FRAME_KEY_USES times, so the page can reload or move within its frame. Only the
 * frame page (on its own origin, which nothing but Tavora ever served) and the page in it see a key: a service worker an
 * older Tavora's page left on the link's address only sees the link's redirect, not where it leads.
 */
export class FrameKeys {
  private readonly keys = new Map<string, { token: string; until: number; uses: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A new key for one load of the page of the link with `token`. */
  mint(token: string): string {
    const now = this.now();
    for (const [key, entry] of this.keys) if (entry.until <= now) this.keys.delete(key);
    while (this.keys.size >= MAX_FRAME_KEYS) this.keys.delete(this.keys.keys().next().value!);
    const key = randomBytes(16).toString("hex");
    this.keys.set(key, { token, until: now + FRAME_KEY_MS, uses: 0 });
    return key;
  }

  /** Whether `key` was made for this link and still lets the page load; each load counts. */
  spend(token: string, key: string | null): boolean {
    const entry = key ? this.keys.get(key) : undefined;
    if (!key || !entry || entry.token !== token) return false;
    if (entry.until <= this.now() || ++entry.uses > FRAME_KEY_USES) {
      this.keys.delete(key);
      return false;
    }
    return true;
  }
}

/** The HTTP server behind Stream overlays; runs only while the user has them on. */
export class OverlayServer {
  private server: Server | null = null;
  private listening: number | null = null;
  /** Each open live stream and the link it is for. */
  private readonly streams = new Map<ServerResponse, OverlayLink>();
  status: OverlayServerStatus = "off";
  private readonly frameKeys: FrameKeys;

  constructor(private readonly options: OverlayServerOptions) {
    this.frameKeys = new FrameKeys(options.now);
  }

  /** The port it listens on, or null while it does not. */
  get port(): number | null {
    return this.listening;
  }

  /**
   * Starts and stops run one after the other, in the order asked: a stop while it starts ends that start, and two quick
   * port changes leave one server, the newest, that `stop` can end.
   */
  private queue: Promise<unknown> = Promise.resolve();

  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Listens on 127.0.0.1:port (stopping first if it ran on another one). */
  start(port: number): Promise<OverlayServerStatus> {
    return this.inTurn(() => this.startNow(port));
  }

  stop(): Promise<void> {
    return this.inTurn(() => this.stopNow());
  }

  private async startNow(port: number): Promise<OverlayServerStatus> {
    if (this.server && this.listening === port) return this.status;
    await this.stopNow();
    const server = createServer((request, response) => void this.handle(request, response, port));
    trackOwnServer(server);
    server.keepAliveTimeout = 5_000;
    this.status = await new Promise<OverlayServerStatus>((resolve) => {
      server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRINUSE" || error.code === "EACCES" ? "in-use" : "failed"));
      server.listen(port, "127.0.0.1", () => resolve("running"));
    });
    if (this.status === "running") {
      this.server = server;
      this.listening = port;
      server.on("error", (error) => console.error("[tavora] overlay server error", error));
    } else {
      server.close();
    }
    return this.status;
  }

  private async stopNow(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.listening = null;
    this.status = "off";
    for (const stream of this.streams.keys()) stream.end();
    this.streams.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /**
   * Ends at once every open stream whose link may no longer be served (its module lost the connector, was removed or
   * now comes from another publisher). The host calls it whenever grants or installed modules change; the ping below
   * only catches what slipped past.
   */
  recheck(): void {
    for (const [stream, link] of this.streams) if (!this.options.page(link)) stream.end();
  }

  private async handle(request: IncomingMessage, response: ServerResponse, port: number): Promise<void> {
    try {
      // Only addresses of this PC as typed into OBS, or a link's own page; a page on the web that resolves its own name to
      // 127.0.0.1 sends its own.
      const host = request.headers.host?.toLowerCase();
      const pageHost = host ? PAGE_HOST.exec(host) : null;
      const frameHost = host ? FRAME_HOST.exec(host) : null;
      const linkHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
      // Nothing of a module runs on the link's origin any more. A service worker a page registered there under an older
      // Tavora could still answer the link itself; every answer from there clears it, when it reaches the browser.
      if (linkHost) response.setHeader("Clear-Site-Data", '"storage"');
      if (!linkHost && pageHost?.[2] !== String(port) && frameHost?.[2] !== String(port)) return this.plain(response, 421, "Misdirected request");
      if (request.method !== "GET" && request.method !== "HEAD") return this.plain(response, 405, "Method not allowed");
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      if (pageHost) return await this.page(request, response, port, pageHost[1]!, url);
      if (frameHost) return this.frame(request, response, port, frameHost[1]!, url);
      const match = /^\/overlay\/([0-9a-f]{32})(\/.*)?$/.exec(url.pathname);
      const found = match ? this.options.store.find(match[1]!) : null;
      if (!match || !found || !this.options.page(found.link)) return this.plain(response, 404, "Not found");
      const rest = match[2];
      // The link leads to its frame page, on an origin no service worker of an older Tavora's page can be on: such a
      // worker that answers the link sees only this redirect (opaque to it), never the frame page's key.
      if (rest === undefined || rest === "/") {
        response.writeHead(302, { ...COMMON_HEADERS, Location: `${overlayFrameOrigin(port, found.link.token)}/${url.search}` });
        return void response.end();
      }
      // A page an older Tavora served here ran outside any sandbox: it gets nothing more (its state, its font) and shows
      // again, framed, once OBS reloads the source.
      return this.plain(response, 404, "Not found");
    } catch (error) {
      console.error("[tavora] overlay request failed", error);
      if (!response.headersSent) this.plain(response, 500, "Something went wrong");
      else response.end();
    }
  }

  /** A request on a link's frame page origin: the frame page, with a key of its own for each load (OBS's Refresh too). */
  private frame(request: IncomingMessage, response: ServerResponse, port: number, token: string, url: URL): void {
    const found = this.options.store.find(token);
    if (!found || !this.options.page(found.link) || url.pathname !== "/") return this.plain(response, 404, "Not found");
    const key = request.method === "HEAD" ? undefined : this.frameKeys.mint(token);
    const frame = overlayFrame(port, token, url.search, key);
    this.send(request, response, "text/html; charset=utf-8", Buffer.from(frame.html), frame.csp);
  }

  /** A request on a link's own origin: the module's page and its files, its state and Tavora's font. */
  private async page(request: IncomingMessage, response: ServerResponse, port: number, token: string, url: URL): Promise<void> {
    const { pathname } = url;
    const found = this.options.store.find(token);
    const page = found ? this.options.page(found.link) : null;
    // Never as a page of its own, only inside the link's frame page (the sandbox there is what keeps it in), and never as
    // a worker's script: a service worker could answer the page's address with a document of its own later.
    const header = request.headers["sec-fetch-dest"];
    const dest = typeof header === "string" ? header : undefined;
    const refused = dest === "document" || dest === "serviceworker" || dest === "sharedworker" || dest === "worker" || request.headers["service-worker"] !== undefined;
    if (!found || !page || refused) return this.plain(response, 404, "Not found");
    if (pathname === `/${OVERLAY_STATE_PATH}`) return this.stream(request, response, found.link, found.state);
    if (pathname === `/${OVERLAY_FONT_PATH}`) return this.send(request, response, "text/css; charset=utf-8", Buffer.from(overlayFontCss()));
    const file = await resolveOverlayFile(page, pathname);
    if (!file) return this.plain(response, 404, "Not found");
    const type = contentTypeFor(file);
    // A document (the frame's page, or anything a browser without Sec-Fetch-Dest could show as one) only for the key of a
    // frame page Tavora served. The page's scripts, styles, pictures, state and font need none.
    const asDocument = request.method !== "HEAD" && (dest === undefined ? DOCUMENT_TYPE.test(type) : DOCUMENT_DESTS.has(dest));
    if (asDocument && !this.frameKeys.spend(token, url.searchParams.get(FRAME_KEY_PARAM))) return this.plain(response, 404, "Not found");
    this.send(request, response, type, await readFile(file), streamOverlayCsp(port, token));
  }

  private send(request: IncomingMessage, response: ServerResponse, type: string, body: Buffer, csp?: string): void {
    response.writeHead(200, { ...COMMON_HEADERS, "Content-Type": type, ...(csp ? { "Content-Security-Policy": csp } : {}), "Content-Length": body.byteLength });
    response.end(request.method === "HEAD" ? undefined : body);
  }

  private plain(response: ServerResponse, status: number, text: string): void {
    response.writeHead(status, { ...COMMON_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    response.end(text);
  }

  private stream(request: IncomingMessage, response: ServerResponse, link: OverlayLink, state: JsonValue | null): void {
    if (this.streams.size >= MAX_STREAMS) return this.plain(response, 503, "Too many overlays");
    response.writeHead(200, { ...COMMON_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
    if (request.method === "HEAD") return void response.end();
    this.streams.set(response, link);
    let current = state;
    const send = (value: JsonValue | null) => {
      current = value;
      // Ended (the link went, the grant went, Tavora stops) but not closed yet: a write now would throw.
      if (!response.writableEnded && !response.destroyed) response.write(overlayMessage(value));
    };
    response.write("retry: 2000\n\n");
    send(state);
    const stopState = this.options.store.watch(link.token, (next) => {
      if (next === undefined) response.end();
      else send(next);
    });
    const stopFont = watchOverlayFont(() => send(current));
    const stop = () => {
      stopState();
      stopFont();
    };
    // The module may lose its grant or go away while OBS keeps the page open.
    const ping = setInterval(() => {
      if (!this.options.page(link)) response.end();
      else response.write(": ping\n\n");
    }, STREAM_PING_MS);
    response.on("close", () => {
      clearInterval(ping);
      stop();
      this.streams.delete(response);
    });
  }
}
