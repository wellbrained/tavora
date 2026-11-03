// Tavora's own toasts: a small see-through page of Tavora's, added to the window above every panel (panels are native views,
// drawn above the host page, so a toast drawn by the host page would hide behind them wherever the user put it).
//   - The host page keeps the list of toasts and what Undo does. It sends the words here (host:toasts) and hears back which
//     button was pressed (host:toast-event).
//   - The toast page (toasts.html) shows them with the kit's Toaster, the same as in a panel, and keeps their time. It is
//     only as big as the toasts' box (toast-layout.ts), so a press anywhere else reaches the panels around it.
//   - It has a preload of its own with five calls (preload/toasts.ts); it cannot reach the host's actions, a module or a
//     network, and it is served by Tavora's own address like the host page.
import { ipcMain, WebContentsView, type BrowserWindow, type IpcMainEvent } from "electron";
import type { TavoraTheme } from "@tavora/sdk/protocol";
import { cleanExtent, cleanToasts, hostToastDuration, isToastPosition, toastRoom, type HostToast, type ToastsEvent, type ToastsPageState } from "../shared/host-toasts";
import { keepOnTop, ToastLayout } from "./toast-layout";

/** How long the page has to say it is ready before it counts as failed. */
const READY_AFTER_MS = 10_000;

export interface ToastViewOptions {
  window: BrowserWindow;
  /** The toast page's preload (preload/toasts.cjs). */
  preload: string;
  /** The address of toasts.html. */
  address: string;
  devTools: boolean;
  theme(): TavoraTheme;
  language(): string;
  /** A press on a toast, to hand to the host page. */
  event(event: ToastsEvent): void;
  /** The page is down for good: the host page shows the toasts itself (true), or the page is back (false). */
  fallback(on: boolean): void;
  /** How long the page has to say it is ready (tests). */
  readyAfterMs?: number;
}

export class ToastView {
  private readonly view: WebContentsView;
  private readonly layout: ToastLayout;
  private readonly top: { raise(): void; stop(): void };
  private items: HostToast[] = [];
  private ready = false;
  private hidden = false;
  private behind = false;
  private disposed = false;
  private attempt = 0;
  private failedAttempt = 0;
  private retried = false;
  private broken = false;
  private fallback = false;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  /** The toasts' own clocks while the page is down. */
  private readonly expiry = new Map<number, { revision: number; left: number; since: number | null; timer: ReturnType<typeof setTimeout> | undefined; fired: boolean }>();
  private readonly listeners: [string, (event: IpcMainEvent, ...args: unknown[]) => void][] = [];
  private readonly onResize = () => {
    this.layout.windowResized();
    this.send();
  };

  constructor(private readonly options: ToastViewOptions) {
    const { window } = options;
    this.view = new WebContentsView({
      webPreferences: { preload: options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, devTools: options.devTools },
    });
    this.view.setBackgroundColor("#00000000");
    this.view.setVisible(false);
    const contents = this.view.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    // A page that does not load, never says it is ready or is gone is a failure (see fail()): it is logged, the toasts keep
    // their time without the page, and the page loads again once; after that the host page shows them itself.
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      // -3 is a load that was replaced by another one, not a failure.
      if (isMainFrame && code !== -3) this.fail(`did not load (${description || code})`);
    });
    contents.on("did-finish-load", () => {
      // Loaded but not ready (the page may have said so already, before the load event): only that is worth a countdown.
      if (this.disposed || this.ready || this.failedAttempt === this.attempt) return;
      this.clearReadyTimer();
      this.readyTimer = setTimeout(() => this.fail("sent no ready signal"), this.options.readyAfterMs ?? READY_AFTER_MS);
    });
    contents.on("render-process-gone", (_event, details) => {
      this.ready = false;
      if (this.disposed || details.reason === "clean-exit" || contents.isDestroyed()) return;
      this.fail(`crashed (${details.reason})`);
    });
    window.contentView.addChildView(this.view);
    this.top = keepOnTop(window.contentView, this.view);
    this.layout = new ToastLayout(
      { setBounds: (place) => this.view.setBounds(place), setVisible: (visible) => this.view.setVisible(visible), raise: () => this.top.raise() },
      { area: () => window.getContentBounds() },
    );
    window.on("resize", this.onResize);
    this.layout.setPosition(this.state().position);

    this.listen("toasts:ready", (event) => {
      if (!this.fromPage(event)) return;
      this.ready = true;
      this.retried = false;
      // A new attempt for whatever happens next: a crash after a late recovery must count, not be taken for the failure
      // already seen in this attempt (and a late answer of the old load is stale).
      this.attempt++;
      this.clearReadyTimer();
      if (this.broken) {
        console.error("[tavora] the toast page is back; toasts show above the panels again");
        this.broken = false;
        this.useFallback(false);
        this.place();
      }
      this.updateExpiry();
      this.send();
    });
    this.listen("toasts:extent", (event, raw) => {
      const extent = this.fromPage(event) && cleanExtent(raw);
      if (extent) this.layout.setExtent(extent);
    });
    this.listen("toasts:action", (event, id) => this.press(event, "action", id));
    this.listen("toasts:dismiss", (event, id) => this.press(event, "dismiss", id));
    // A press leaves the keys with the toast page; they go back to the page the user was typing in.
    this.listen("toasts:release", (event) => {
      if (this.fromPage(event)) this.giveKeysBack();
    });
    this.load();
  }

  private load(): void {
    const contents = this.view.webContents;
    const attempt = ++this.attempt;
    this.clearReadyTimer();
    // The failure is also told by did-fail-load; fail() counts each attempt once. A slow load is not a failure: the countdown
    // for the ready signal starts when the page has loaded (did-finish-load).
    void contents.loadURL(this.options.address).catch((error: unknown) => {
      if (attempt === this.attempt) this.fail("did not load", error);
    });
  }

  /**
   * The toast page failed: it did not load, never got ready or crashed. Says so in the log, then the first time loads it once
   * more; the second time the host page shows the toasts itself. Until one of them works, expiry runs here.
   */
  private fail(reason: string, error?: unknown): void {
    if (this.disposed || this.failedAttempt === this.attempt) return;
    this.failedAttempt = this.attempt;
    this.ready = false;
    this.clearReadyTimer();
    console.error(`[tavora] the toast page ${reason}`, ...(error === undefined ? [] : [error]));
    this.broken = true;
    this.place();
    this.updateExpiry();
    if (this.view.webContents.isDestroyed()) return;
    if (!this.retried) {
      this.retried = true;
      console.error("[tavora] loading the toast page once more");
      this.load();
    } else {
      console.error("[tavora] the toast page is still down; toasts show in the main window instead");
      this.useFallback(true);
    }
  }

  private useFallback(on: boolean): void {
    if (this.fallback === on) return;
    this.fallback = on;
    this.options.fallback(on);
    this.updateExpiry();
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== undefined) clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
  }

  /** The toast page is in the window only while it works and there are toasts; a broken one is never in the way of a press. */
  private place(): void {
    this.layout.setCount(this.broken ? 0 : this.items.length);
  }

  /**
   * While the toast page is down (and the host page has not taken over) the toasts run out of time here: each one that has a
   * duration is dismissed through the host page, so an Undo nobody pressed ends as it always does. Hidden or behind the game
   * they wait, as on the page.
   */
  private updateExpiry(): void {
    const running = this.broken && !this.fallback && !this.disposed;
    const live = new Map(this.items.map((item) => [item.id, item]));
    for (const [id, entry] of this.expiry) {
      if (running && live.get(id)?.revision === entry.revision) continue;
      clearTimeout(entry.timer);
      this.expiry.delete(id);
    }
    if (!running) return;
    const paused = this.hidden || this.behind;
    for (const item of this.items) {
      const duration = hostToastDuration(item);
      if (!Number.isFinite(duration)) continue;
      let entry = this.expiry.get(item.id);
      if (!entry) {
        entry = { revision: item.revision, left: duration, since: null, timer: undefined, fired: false };
        this.expiry.set(item.id, entry);
      }
      if (entry.fired) continue;
      if (paused && entry.since !== null) {
        clearTimeout(entry.timer);
        entry.left = Math.max(0, entry.left - (Date.now() - entry.since));
        entry.since = null;
      } else if (!paused && entry.since === null) {
        entry.since = Date.now();
        const own = entry;
        entry.timer = setTimeout(() => {
          // The entry stays (fired) until the host page's list no longer has the toast, so it is dismissed once, never twice.
          own.fired = true;
          this.options.event({ type: "dismiss", id: item.id });
        }, entry.left);
      }
    }
  }

  /** The view's page, to tell it apart from the others (tests; the main process never mixes it up with a panel). */
  get webContentsId(): number {
    return this.view.webContents.id;
  }

  /** The host page's list of toasts. */
  sync(raw: unknown): void {
    if (this.disposed) return;
    this.items = cleanToasts(raw);
    this.place();
    this.updateExpiry();
    this.send();
  }

  /** The theme, the language or the position changed. */
  refresh(): void {
    this.layout.setPosition(this.state().position);
    this.send();
  }

  /** Tavora is hidden or shown: hidden, no toast runs out of time. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.updateExpiry();
    this.send();
  }

  /** Tavora's window went behind another program (the game) or came back: behind, no toast runs out of time either. */
  setBehind(behind: boolean): void {
    if (behind === this.behind) return;
    this.behind = behind;
    this.updateExpiry();
    this.send();
  }

  /** Above everything else in the window. */
  raise(): void {
    if (!this.disposed) this.top.raise();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearReadyTimer();
    for (const entry of this.expiry.values()) clearTimeout(entry.timer);
    this.expiry.clear();
    this.layout.dispose();
    this.top.stop();
    for (const [channel, listener] of this.listeners) ipcMain.removeListener(channel, listener as never);
    const { window } = this.options;
    if (!window.isDestroyed()) {
      window.removeListener("resize", this.onResize);
      window.contentView.removeChildView(this.view);
    }
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }

  private state(): ToastsPageState {
    const theme = this.options.theme();
    const { width } = this.options.window.getContentBounds();
    return {
      items: this.items,
      position: isToastPosition(theme.toasts) ? theme.toasts : "bottom-center",
      mode: theme.mode,
      colors: theme.tokens,
      radius: theme.radius,
      language: this.options.language(),
      room: toastRoom(width),
      paused: this.hidden || this.behind,
    };
  }

  private send(): void {
    if (!this.ready || this.disposed || this.view.webContents.isDestroyed()) return;
    this.view.webContents.send("toasts:state", this.state());
  }

  private press(event: IpcMainEvent, type: ToastsEvent["type"], id: unknown): void {
    if (!this.fromPage(event) || typeof id !== "number" || !Number.isSafeInteger(id)) return;
    this.options.event({ type, id });
    // A press on a button gave the toast page the keys; a toast that left by itself did not take them from anyone.
    if (this.view.webContents.isFocused()) this.giveKeysBack();
  }

  private giveKeysBack(): void {
    const { window } = this.options;
    if (this.view.webContents.isFocused() && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.focus();
  }

  /** Only the toast page's own top frame may speak for it. */
  private fromPage(event: IpcMainEvent): boolean {
    return !this.disposed && event.sender.id === this.view.webContents.id && event.senderFrame?.parent === null;
  }

  private listen(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void {
    ipcMain.on(channel, listener as never);
    this.listeners.push([channel, listener]);
  }
}
