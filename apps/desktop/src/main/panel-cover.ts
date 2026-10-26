import { createHash } from "node:crypto";
import { session, WebContentsView, type View } from "electron";
import type { TavoraTheme } from "@tavora/sdk/protocol";
import { writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside } from "./json";

// While a game opens, its panels are shown under a cover: a tiny page of Tavora's own in the theme's background,
// over the whole workspace. Pages only draw while they are shown, and a heavy one takes a few hundred ms for its
// first frame; under the cover they all draw, and the cover goes once every one has, so they appear in one frame.
// The cover is plain. Tavora's fire (the Campfire loader) shows on it only when the game is expected to take long:
// from the start when it took long last time, else once it runs past FIRE_AFTER_MS. Once shown, the fire stays at
// least FIRE_MIN_MS, so it never flashes. The cover never stays longer than DRAW_CAP_MS after the panels were shown.

/** Opening a game that is expected to take longer than this shows the fire from the start; any other shows it this late. */
export const FIRE_AFTER_MS = 500;
/** How long the fire stays at least once it showed. */
export const FIRE_MIN_MS = 300;
/** How long the cover waits for the panels' first frames, at most. A broken module cannot hide the workspace. */
export const DRAW_CAP_MS = 3_000;
/** The cover's session: in memory only (no "persist:"), never shared with a module or the host UI. */
const COVER_PARTITION = "tavora-cover";
/** How long the fire takes to fade in, in the cover page. */
const FIRE_FADE_MS = 200;

/** When the fire shows, in ms after the cover appeared: at once when the game took long last time, else FIRE_AFTER_MS. */
export function fireDelay(estimateMs: number | undefined): number {
  return estimateMs !== undefined && estimateMs > FIRE_AFTER_MS ? 0 : FIRE_AFTER_MS;
}

/** How long to keep the cover once the panels have drawn, `elapsed` ms after it appeared: the fire's minimum, if it showed. */
export function holdFor(elapsed: number, fireAt: number): number {
  if (elapsed < fireAt) return 0;
  return Math.max(0, fireAt + FIRE_MIN_MS - elapsed);
}

/**
 * The cover's colour: the theme's background, a hair short of opaque. Chromium counts a page shown under an opaque
 * view as hidden, so it would not draw until the cover went; under this one it draws, and it looks the same.
 */
export function coverColor(background: string): string {
  // Electron reads eight digits as #aarrggbb.
  return /^#[0-9a-f]{6}$/i.test(background) ? `#fe${background.slice(1)}` : background;
}

/** The panels a game opens with, by module and type: its times are kept per game and per such layout. */
export function layoutKey(gameId: string, panels: readonly { moduleId: string; panelType?: string | null | undefined }[]): string {
  const types = panels.map((panel) => `${panel.moduleId}/${panel.panelType ?? ""}`).sort();
  return createHash("sha256").update(JSON.stringify([gameId, types])).digest("hex").slice(0, 24);
}

/** How many past openings an estimate is made from. */
const SAMPLES = 3;
/** Layouts kept in the file; the ones opened longest ago go first. */
const MAX_LAYOUTS = 200;
const KEY = /^[0-9a-f]{24}$/;

interface Times {
  ms: number[];
  at: number;
}

/**
 * How long each game (with its layout of panels) took to open the last few times, kept on this PC in
 * open-times.json. Not part of backups or the cloud copy: it says how fast this PC is.
 */
export class OpenTimes {
  private entries = new Map<string, Times>();
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    const raw = await readJsonOrSetAside<unknown>(this.file).catch(() => null);
    const record = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    this.entries.clear();
    for (const [key, value] of Object.entries(record)) {
      const entry = (typeof value === "object" && value !== null ? value : {}) as Partial<Times>;
      const ms = Array.isArray(entry.ms) ? entry.ms.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0).slice(-SAMPLES) : [];
      if (!KEY.test(key) || !ms.length || typeof entry.at !== "number" || !Number.isFinite(entry.at)) continue;
      this.entries.set(key, { ms, at: entry.at });
    }
  }

  /** How long the layout is expected to take, from its last openings; undefined when it never opened here. */
  estimate(key: string): number | undefined {
    const ms = this.entries.get(key)?.ms;
    if (!ms?.length) return undefined;
    return ms.reduce((sum, n) => sum + n, 0) / ms.length;
  }

  record(key: string, ms: number): Promise<void> {
    if (!KEY.test(key) || !Number.isFinite(ms) || ms < 0) return this.writing;
    const past = this.entries.get(key)?.ms ?? [];
    this.entries.delete(key);
    this.entries.set(key, { ms: [...past, Math.round(ms)].slice(-SAMPLES), at: this.now() });
    while (this.entries.size > MAX_LAYOUTS) {
      const oldest = [...this.entries].sort((a, b) => a[1].at - b[1].at)[0]![0];
      this.entries.delete(oldest);
    }
    const body = JSON.stringify(Object.fromEntries(this.entries));
    this.writing = this.writing.then(() => writeFileAtomic(this.file, body)).catch(() => undefined);
    return this.writing;
  }
}

export interface CoverPageOptions {
  theme: TavoraTheme;
  /** "Loading {game}…" under the fire. */
  label: string;
  /** Wall-clock time (Date.now) at which the fire fades in. */
  fireAtEpoch: number;
  /** Tavora's emblem as a data: URL, or null when it could not be read (the embers rise from nothing then). */
  emblem: string | null;
}

/** How far the panel's corner is rounded in the host UI (dock.css), as the loading card there. */
export const COVER_RADIUS = 10;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Only plain CSS colour values reach the page's style. */
const cssColor = (value: string, fallback: string) => (/^[#\w\s(),.%/-]+$/.test(value) ? value : fallback);

/**
 * The cover's page: the loading card of the host UI (its background and border) and the Campfire loader of
 * CampfireLoader.vue (emblem, rising embers, label), hidden until `fireAtEpoch`. With reduced motion it stays plain.
 */
export function coverPage({ theme, label, fireAtEpoch, emblem }: CoverPageOptions): string {
  const dark = theme.mode === "dark";
  const background = cssColor(theme.tokens.background, dark ? "#000" : "#fff");
  const border = cssColor(theme.tokens.border, "transparent");
  const muted = cssColor(theme.tokens["muted-foreground"], dark ? "#aaa" : "#555");
  const [ember, ember3, ember5] = dark ? ["#efb663", "#e88b48", "#ffe1a0"] : ["#a66a21", "#b95624", "#b98731"];
  // The same embers as CampfireLoader.vue, so the fire looks the same wherever it shows.
  const embers = Array.from({ length: 28 }, (_, i) => {
    const n = (i * 37 + 11) % 101;
    const side = i % 2 ? 1 : -1;
    const style = [
      `--x:${39 + ((i * 13) % 24)}%`,
      `--y:${46 + ((i * 7) % 16)}%`,
      `--spark-size:${1.3 + ((i * 11) % 23) / 10}px`,
      `--drift:${side * (15 + n * 0.7)}`,
      `--lift:${-100 - n * 0.95}`,
      `--speed:${0.75 + ((i * 17) % 50) / 100}`,
      `--delay:${-i * 0.391}s`,
    ].join(";");
    return `<i style="${style}"></i>`;
  }).join("");
  const logo = emblem ? `<img src="${escapeHtml(emblem)}" alt="" draggable="false">` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
html,body{margin:0;height:100%;overflow:hidden;background:${background};cursor:default;user-select:none}
body{box-sizing:border-box;border:1px solid ${border};border-radius:${COVER_RADIUS}px;font:13px system-ui,"Segoe UI",sans-serif;color:${muted}}
.campfire{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;opacity:0;transition:opacity ${FIRE_FADE_MS}ms ease-out}
body.fire .campfire{opacity:1}
.fire-box{position:relative;flex:none;width:var(--cf-size);height:var(--cf-size);isolation:isolate}
.fire-box img{display:block;width:100%;height:100%;object-fit:contain}
.embers{position:absolute;inset:0}
.embers i{position:absolute;left:var(--x);top:var(--y);width:var(--spark-size);height:calc(var(--spark-size)*1.5);border-radius:50%;background:${ember};opacity:0;animation:rise calc(3.6s*var(--speed)) linear infinite;animation-delay:var(--delay);filter:drop-shadow(0 0 2px color-mix(in srgb,${ember} 45%,transparent));--dx:calc(var(--drift)*var(--cf-scale)*1px);--dy:calc(var(--lift)*var(--cf-scale)*1px)}
.embers i:nth-child(3n){background:${ember3}}
.embers i:nth-child(5n){background:${ember5}}
@keyframes rise{0%{opacity:0;transform:translate(0,0) scale(.7) rotate(0)}10%{opacity:.9}35%{opacity:.8;transform:translate(calc(var(--dx)*-.15),calc(var(--dy)*.33)) scale(1) rotate(35deg)}65%{opacity:.55;transform:translate(calc(var(--dx)*.65),calc(var(--dy)*.65)) scale(.8) rotate(-20deg)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.2) rotate(65deg)}}
@media (prefers-reduced-motion:reduce){.campfire{display:none}}
</style></head><body><div class="campfire" role="status"><div class="fire-box" aria-hidden="true">${logo}<div class="embers">${embers}</div></div><span>${escapeHtml(label)}</span></div><script>
const SIZE=176,HEADROOM=95,GAP=26,LABEL=20,MARGIN=16,root=document.querySelector(".campfire"),box=document.querySelector(".fire-box");
function fit(){const s=Math.max(0,Math.min(1,(innerWidth-2*MARGIN)/SIZE,(innerHeight-2*MARGIN-GAP-LABEL)/(SIZE+HEADROOM)));root.style.setProperty("--cf-size",SIZE*s+"px");root.style.setProperty("--cf-scale",s);root.style.paddingTop=HEADROOM*s+"px";box.style.display=s>.2?"":"none"}
fit();addEventListener("resize",fit);
setTimeout(()=>document.body.classList.add("fire"),Math.max(0,${Math.round(fireAtEpoch)}-Date.now()));
</script></body></html>`;
}

/** A place on the window, in its content's coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelCoverOptions {
  /** The window's content view, which the cover is put on top of. */
  parent: View;
  emblem: () => string | null;
  now?: () => number;
}

/**
 * The cover itself: one view over the workspace, kept between games. start() shows it (over every panel, also ones
 * added since), finish() takes it away once the fire had its minimum, cancel() at once.
 */
export class PanelCover {
  private view: WebContentsView | null = null;
  private bounds: Rect | null = null;
  private shownAt = 0;
  private fireAt = 0;
  private active = false;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;

  constructor(private readonly options: PanelCoverOptions) {
    this.now = options.now ?? Date.now;
  }

  get covering(): boolean {
    return this.active;
  }

  /** Whether the fire has started to show on the cover now. */
  get fireShown(): boolean {
    return this.active && this.now() - this.shownAt >= this.fireAt;
  }

  /** Covers the workspace now. `estimateMs` is how long this game took to open last time (undefined when never). */
  start(theme: TavoraTheme, label: string, estimateMs: number | undefined): void {
    clearTimeout(this.holdTimer);
    const view = (this.view ??= this.createView());
    this.active = true;
    this.shownAt = this.now();
    this.fireAt = fireDelay(estimateMs);
    // The colour shows at once, before the page has loaded; the page only adds the fire and the card's border.
    view.setBackgroundColor(coverColor(theme.tokens.background));
    const page = coverPage({ theme, label, fireAtEpoch: this.shownAt + this.fireAt, emblem: this.options.emblem() });
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`).catch(() => undefined);
    this.place();
  }

  /** Where the workspace is (the host UI says so); null while it is not on screen. */
  setBounds(bounds: Rect | null): void {
    this.bounds = bounds;
    if (this.active) this.place();
  }

  /** The panels have drawn: the cover goes, after the fire's minimum if it showed. */
  finish(): void {
    if (!this.active) return;
    clearTimeout(this.holdTimer);
    const wait = holdFor(this.now() - this.shownAt, this.fireAt);
    if (wait > 0) this.holdTimer = setTimeout(() => this.cancel(), wait);
    else this.cancel();
  }

  /** Takes the cover away at once (a dialog opens over the workspace, the game is left). */
  cancel(): void {
    clearTimeout(this.holdTimer);
    this.active = false;
    this.view?.setVisible(false);
  }

  dispose(): void {
    this.cancel();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  private place(): void {
    const view = this.view;
    if (!view) return;
    if (!this.bounds || this.bounds.width < 1 || this.bounds.height < 1) return view.setVisible(false);
    view.setBounds(this.bounds);
    // Added again, it goes on top of every panel, also ones made after the last time.
    this.options.parent.addChildView(view);
    view.setVisible(true);
  }

  private createView(): WebContentsView {
    // A session of its own, kept in memory, that loads nothing but the cover's page (the host's own session lets only Tavora's pages in).
    const ses = session.fromPartition(COVER_PARTITION);
    ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith("data:") }));
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    const view = new WebContentsView({
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, spellcheck: false, navigateOnDragDrop: false, devTools: false },
    });
    view.setBorderRadius(COVER_RADIUS);
    view.setVisible(false);
    const contents = view.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    return view;
  }
}
