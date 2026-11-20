// Stream overlays: pages a module ships for streaming software such as OBS (the manifest's `overlay`). The user
// adds an overlay's link as a Browser Source; Tavora serves the page and its files from this PC only, and passes on
// what the module published for it (overlay.publish) as server-sent events. Each link belongs to one key of one
// module in one workspace and carries a random token, which is the only thing that makes it reachable: the server
// listens on 127.0.0.1, refuses any other Host header (so a web page can't reach it through DNS rebinding), and serves
// a link only while its module is installed under the same owner with the `stream-overlay` connector granted.
//
// In OBS Tavora can't stop a page from navigating away (there is no will-navigate there), so the link serves a frame
// page of Tavora's own (overlayFrame), and the module's page runs inside it: in a sandboxed iframe that may not
// navigate the top page, open windows or send forms, under a policy that lets the iframe show nothing but that page's
// own origin. The module's page gets an origin of its own per link, `<token>.localhost` (Chromium resolves any
// `*.localhost` name to this PC), so it is not the frame page's origin and can't reach into it to lift the sandbox.
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { LIMITS, OVERLAY_COLOR_SCHEME_MESSAGE, OVERLAY_FONT_PATH, OVERLAY_STATE_PATH, type JsonValue } from "@tavora/sdk/protocol";
import { overlayFontCss, overlayMessage, watchOverlayFont } from "./overlay-font";
import { contentTypeFor, resolveAsset } from "./assets";
import { HostError } from "./errors";
import { SerialQueue, writeFileAtomic } from "./fsutil";
import { isJsonValue, readSavedFile } from "./json";
import { SUPPORTED_VERSIONS } from "./saved-versions";
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

const VERSION = SUPPORTED_VERSIONS[OVERLAYS_FILE];

type OverlayFile = { version: typeof VERSION; links: (OverlayLink & { state?: JsonValue })[] };

const sameSubject = (a: OverlaySubject, b: OverlaySubject) => a.owner === b.owner && a.moduleId === b.moduleId && a.workspaceId === b.workspaceId && a.key === b.key;

function isSubjectField(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/** The overlay links and what each one shows, kept in overlays.json in the data folder. */
export class OverlayStore {
  private readonly queue = new SerialQueue();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly watchers = new Map<string, Set<(state: JsonValue | null | undefined) => void>>();

  private constructor(
    private readonly file: string,
    private readonly links: Map<string, OverlayLink>,
    private readonly states: Map<string, JsonValue>,
  ) {}

  static async load(userData: string): Promise<OverlayStore> {
    const file = path.join(userData, OVERLAYS_FILE);
    const raw = (await readSavedFile(file, { version: VERSION })) as Partial<OverlayFile> | null;
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
    const body: OverlayFile = {
      version: VERSION,
      links: [...this.links.values()].map((link) => (this.states.has(link.token) ? { ...link, state: this.states.get(link.token)! } : { ...link })),
    };
    const text = `${JSON.stringify(body, null, 2)}\n`;
    return this.queue.run(() => writeFileAtomic(this.file, text)).catch((error: unknown) => console.error("[tavora] saving overlays failed", error));
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
}

/** Strict: the page loads only its own files and talks only to the server it came from. */
const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
];

/** The policy of an overlay page in Tavora's own windows (game-overlay-page.ts), which nothing may frame. */
export const OVERLAY_CSP = [...PAGE_POLICY, "frame-ancestors 'none'"].join("; ");

/** The policy of a module's overlay page in OBS: the same, shown only inside the link's frame page. */
export function streamOverlayCsp(port: number): string {
  return [...PAGE_POLICY, `frame-ancestors http://127.0.0.1:${port} http://localhost:${port}`].join("; ");
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

const FRAME_STYLE = "html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}iframe{display:block;width:100%;height:100%;border:0}";
/**
 * The frame takes the colour scheme the page reports (OVERLAY_COLOR_SCHEME_MESSAGE, sent by watchOverlay): Chromium
 * paints an opaque backdrop behind a frame whose scheme differs from its page's, and an overlay must stay see-through.
 * It reads nothing else from the page and gives it nothing.
 */
const FRAME_SCRIPT = `addEventListener("message",function(e){var f=document.getElementById("page"),d=e.data;if(f&&e.source===f.contentWindow&&d&&d.type===${JSON.stringify(OVERLAY_COLOR_SCHEME_MESSAGE)}&&typeof d.colorScheme==="string"&&/^[a-z ]{1,32}$/.test(d.colorScheme))f.style.colorScheme=d.colorScheme});`;
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
 * so the page can't take the frame to any other address either.
 */
export function overlayFrame(port: number, token: string, search = ""): { html: string; csp: string } {
  const src = `${overlayPageOrigin(port, token)}/${search}`;
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>Tavora overlay</title><style>${FRAME_STYLE}</style><script>${FRAME_SCRIPT}</script></head>` +
    `<body><iframe id="page" src="${escapeAttribute(src)}" sandbox="${OVERLAY_SANDBOX}" allow="autoplay" scrolling="no"></iframe></body></html>`;
  const csp = [
    "default-src 'none'",
    `script-src ${hashOf(FRAME_SCRIPT)}`,
    `style-src ${hashOf(FRAME_STYLE)}`,
    `frame-src ${overlayPageOrigin(port, token)}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return { html, csp };
}

/** The Host of a module's page, `<token>.localhost:<port>`. */
const PAGE_HOST = /^([0-9a-f]{32})\.localhost:(\d+)$/;

/** The HTTP server behind Stream overlays; runs only while the user has them on. */
export class OverlayServer {
  private server: Server | null = null;
  private listening: number | null = null;
  /** Each open live stream and the link it is for. */
  private readonly streams = new Map<ServerResponse, OverlayLink>();
  status: OverlayServerStatus = "off";

  constructor(private readonly options: OverlayServerOptions) {}

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
      const frameHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
      if (!frameHost && pageHost?.[2] !== String(port)) return this.plain(response, 421, "Misdirected request");
      if (request.method !== "GET" && request.method !== "HEAD") return this.plain(response, 405, "Method not allowed");
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      if (pageHost) return await this.page(request, response, port, pageHost[1]!, url.pathname);
      const match = /^\/overlay\/([0-9a-f]{32})(\/.*)?$/.exec(url.pathname);
      const found = match ? this.options.store.find(match[1]!) : null;
      if (!match || !found || !this.options.page(found.link)) return this.plain(response, 404, "Not found");
      const rest = match[2];
      if (rest === undefined) {
        response.writeHead(308, { ...COMMON_HEADERS, Location: `/overlay/${match[1]}/` });
        return void response.end();
      }
      if (rest === "/") {
        const frame = overlayFrame(port, found.link.token, url.search);
        return this.send(request, response, "text/html; charset=utf-8", Buffer.from(frame.html), frame.csp);
      }
      // A page an older Tavora served here, still open in OBS until it reloads, keeps getting its state and font.
      if (rest === `/${OVERLAY_STATE_PATH}`) return this.stream(request, response, found.link, found.state);
      if (rest === `/${OVERLAY_FONT_PATH}`) return this.send(request, response, "text/css; charset=utf-8", Buffer.from(overlayFontCss()));
      return this.plain(response, 404, "Not found");
    } catch (error) {
      console.error("[tavora] overlay request failed", error);
      if (!response.headersSent) this.plain(response, 500, "Something went wrong");
      else response.end();
    }
  }

  /** A request on a link's own origin: the module's page and its files, its state and Tavora's font. */
  private async page(request: IncomingMessage, response: ServerResponse, port: number, token: string, pathname: string): Promise<void> {
    const found = this.options.store.find(token);
    const page = found ? this.options.page(found.link) : null;
    // Never as a page of its own, only inside the link's frame page: the sandbox there is what keeps it in.
    if (!found || !page || request.headers["sec-fetch-dest"] === "document") return this.plain(response, 404, "Not found");
    if (pathname === `/${OVERLAY_STATE_PATH}`) return this.stream(request, response, found.link, found.state);
    if (pathname === `/${OVERLAY_FONT_PATH}`) return this.send(request, response, "text/css; charset=utf-8", Buffer.from(overlayFontCss()));
    const file = await resolveOverlayFile(page, pathname);
    if (!file) return this.plain(response, 404, "Not found");
    this.send(request, response, contentTypeFor(file), await readFile(file), streamOverlayCsp(port));
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
