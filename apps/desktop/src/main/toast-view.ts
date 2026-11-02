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
import { cleanExtent, cleanToasts, isToastPosition, toastRoom, type HostToast, type ToastsEvent, type ToastsPageState } from "../shared/host-toasts";
import { keepOnTop, ToastLayout } from "./toast-layout";

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
}

export class ToastView {
  private readonly view: WebContentsView;
  private readonly layout: ToastLayout;
  private readonly top: { raise(): void; stop(): void };
  private items: HostToast[] = [];
  private ready = false;
  private paused = false;
  private disposed = false;
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
    // A page that is gone loads again; the host page's list is sent to it once it says it is ready.
    contents.on("render-process-gone", (_event, details) => {
      this.ready = false;
      if (this.disposed || details.reason === "clean-exit" || contents.isDestroyed()) return;
      void contents.loadURL(options.address).catch(() => undefined);
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
    void contents.loadURL(options.address).catch(() => undefined);
  }

  /** The view's page, to tell it apart from the others (tests; the main process never mixes it up with a panel). */
  get webContentsId(): number {
    return this.view.webContents.id;
  }

  /** The host page's list of toasts. */
  sync(raw: unknown): void {
    if (this.disposed) return;
    this.items = cleanToasts(raw);
    this.layout.setCount(this.items.length);
    this.send();
  }

  /** The theme, the language or the position changed. */
  refresh(): void {
    this.layout.setPosition(this.state().position);
    this.send();
  }

  /** Tavora is hidden or shown: hidden, no toast runs out of time. */
  setHidden(hidden: boolean): void {
    if (hidden === this.paused) return;
    this.paused = hidden;
    this.send();
  }

  /** Above everything else in the window. */
  raise(): void {
    if (!this.disposed) this.top.raise();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
      paused: this.paused,
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
