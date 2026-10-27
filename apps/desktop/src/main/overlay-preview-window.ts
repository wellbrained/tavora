// The preview window: a normal, small Tavora window that shows a module's overlay page at its real size, on a dark,
// light or checkered background, so the user can see what an overlay looks like without a game or OBS. It serves the
// page the way the game overlay window does (game-overlay-page.ts: the same address, the same live state, no bridge, a
// session that reaches nothing else). One window per overlay. It works whether or not Game overlays or Stream overlays
// are on, and is not part of the in-game layer: it is not on top, not click-through, and closes with Tavora.
import { BrowserWindow, WebContentsView } from "electron";
import { createHash } from "node:crypto";
import { GAME_OVERLAY_SCHEME } from "./assets";
import { GAME_OVERLAY_ORIGIN, serveGameOverlay } from "./game-overlay-page";
import type { PreviewRequest, PreviewWindow } from "./overlay-previews";
import { lockedSession } from "./game-overlay-window";

export const PREVIEW_BACKGROUNDS = ["dark", "light", "checker"] as const;
export type PreviewBackground = (typeof PREVIEW_BACKGROUNDS)[number];

/** The height of the footer with the background switch. */
export const PREVIEW_FOOTER = 40;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * The document behind and below the page: the chosen background, and the footer with the switch. Static markup made
 * from Tavora's own labels, with one inline script that only changes which background shows.
 */
export function previewChromeDocument(labels: Record<PreviewBackground, string>, initial: PreviewBackground = "dark"): string {
  const buttons = PREVIEW_BACKGROUNDS.map((id) => `<button type="button" data-bg="${id}" aria-pressed="${id === initial}">${escapeHtml(labels[id])}</button>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'">
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;font:12px 'Segoe UI',sans-serif;user-select:none}
body[data-bg=dark]{background:#1b1d22}
body[data-bg=light]{background:#f2f3f5}
body[data-bg=checker]{background-color:#cfd2d8;background-image:linear-gradient(45deg,#9da1a9 25%,transparent 25%,transparent 75%,#9da1a9 75%),linear-gradient(45deg,#9da1a9 25%,transparent 25%,transparent 75%,#9da1a9 75%);background-size:20px 20px;background-position:0 0,10px 10px}
footer{position:fixed;left:0;right:0;bottom:0;height:${PREVIEW_FOOTER}px;display:flex;align-items:center;justify-content:center;gap:6px;background:#23262d;border-top:1px solid #3a3e47}
button{font:inherit;color:#e8eaee;background:#2f333c;border:1px solid #444955;border-radius:6px;padding:4px 12px;cursor:pointer}
button[aria-pressed=true]{background:#4a6fa5;border-color:#7fb8ff}
</style><body data-bg="${initial}"><footer>${buttons}</footer>
<script>for(const b of document.querySelectorAll("button"))b.addEventListener("click",()=>{document.body.dataset.bg=b.dataset.bg;for(const o of document.querySelectorAll("button"))o.setAttribute("aria-pressed",String(o===b))})</script>`;
}

export class OverlayPreviewWindow implements PreviewWindow {
  private readonly window: BrowserWindow;
  private readonly chrome: WebContentsView;
  private readonly page: WebContentsView;
  private destroyed = false;

  constructor(
    request: PreviewRequest,
    options: { hidden: boolean; labels: Record<PreviewBackground, string> },
  ) {
    const name = createHash("sha256").update(request.id).digest("hex").slice(0, 32);
    const pageSession = lockedSession(`overlay-preview-${name}`, (url) => url.startsWith(`${GAME_OVERLAY_ORIGIN}/`));
    pageSession.protocol.handle(GAME_OVERLAY_SCHEME, (incoming) => serveGameOverlay(incoming, request.source));
    const chromeSession = lockedSession(`overlay-preview-chrome-${name}`, (url) => url.startsWith("data:"));
    const locked = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false };

    this.window = new BrowserWindow({
      show: false,
      width: 480,
      height: 320 + PREVIEW_FOOTER,
      minWidth: 200,
      minHeight: 120 + PREVIEW_FOOTER,
      title: request.title,
      autoHideMenuBar: true,
      backgroundColor: "#1b1d22",
      webPreferences: locked,
    });
    this.window.removeMenu();
    // The title stays the module's name, whatever the page calls itself.
    this.window.on("page-title-updated", (event) => event.preventDefault());

    this.chrome = new WebContentsView({ webPreferences: { ...locked, session: chromeSession } });
    this.page = new WebContentsView({ webPreferences: { ...locked, session: pageSession } });
    this.page.setBackgroundColor("#00000000");
    for (const view of [this.chrome, this.page]) {
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      view.webContents.on("will-navigate", (event) => event.preventDefault());
    }
    this.window.contentView.addChildView(this.chrome);
    this.window.contentView.addChildView(this.page);
    this.layout();
    this.window.on("resize", () => this.layout());
    void this.chrome.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(previewChromeDocument(options.labels))}`).catch(() => {});
    void this.page.webContents.loadURL(`${GAME_OVERLAY_ORIGIN}/`).catch(() => {});
    this.window.once("closed", () => {
      const wasDestroyed = this.destroyed;
      this.destroyed = true;
      if (!wasDestroyed) request.closed();
    });
    if (!options.hidden) this.window.show();
  }

  private layout(): void {
    if (this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    const above = Math.max(1, height - PREVIEW_FOOTER);
    this.chrome.setBounds({ x: 0, y: 0, width, height });
    this.page.setBounds({ x: 0, y: 0, width, height: above });
  }

  focus(): void {
    if (this.destroyed || this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const view of [this.chrome, this.page]) if (!view.webContents.isDestroyed()) view.webContents.close();
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}

