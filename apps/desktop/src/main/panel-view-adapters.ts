import type { WebContentsView } from "electron";
import type { BrowserPanel } from "./browser-view";
import type { OverlayPanel } from "./game-overlay-window";
import type { InstanceStatus, ModuleView } from "./module-view";
import type { PanelRect, PanelViewAdapter } from "./panel-views";
import { encodePng } from "./png-encode";

/** A still image of a panel's page as a lossless data: URL (it stands in for the page, so it must look the same), or null when there is none. */
async function stillOf(view: WebContentsView): Promise<string | null> {
  const image = await view.webContents.capturePage().catch(() => null);
  if (!image || image.isEmpty()) return null;
  // The capture's only bitmap is its 1x one, in device pixels: the host UI shows it at that size over the pixel ratio.
  const { width, height } = image.getSize();
  const png = await encodePng(image.toBitmap(), width, height).catch(() => null);
  return png ? `data:image/png;base64,${png.toString("base64")}` : null;
}

/** A module's panel as Panel views sees it. */
export class ModulePanelView implements PanelViewAdapter {
  readonly kind = "module";
  readonly capturable = true;

  get hotkeys(): ModuleView {
    return this.panel;
  }

  constructor(readonly panel: ModuleView) {}

  get view(): WebContentsView {
    return this.panel.view;
  }
  get webContentsId(): number {
    return this.panel.webContentsId;
  }
  get status(): InstanceStatus {
    return this.panel.status;
  }
  get revealed(): boolean {
    return this.panel.revealed;
  }
  get firstDrawn(): boolean {
    return this.panel.firstDrawn;
  }
  get drawn(): Promise<void> {
    return this.panel.drawn;
  }
  get settled(): Promise<void> {
    return this.panel.settled;
  }
  setBounds(rect: PanelRect): void {
    this.panel.setBounds(rect);
  }
  setVisible(visible: boolean): void {
    this.panel.setVisible(visible);
  }
  suspend(): void {
    this.panel.suspend();
  }
  resume(): void {
    this.panel.resume();
  }
  setInDialog(open: boolean): void {
    this.panel.setInDialog(open);
  }
  focus(): void {
    this.panel.focus();
  }
  setMaximized(maximized: boolean): void {
    this.panel.setMaximized(maximized);
  }
  capture(): Promise<string | null> {
    return stillOf(this.panel.view);
  }
  /** The module's page itself goes over the game, unless it is gone. */
  inGame(): OverlayPanel | null {
    return this.panel.view.webContents.isDestroyed() ? null : this.panel;
  }
  dispose(now?: boolean): Promise<void> {
    return this.panel.dispose(now);
  }
}

/** A Browser panel as Panel views sees it: always revealed, never paused, no dialog and no maximized state of its own. */
export class BrowserPanelView implements PanelViewAdapter {
  readonly kind = "browser";
  readonly revealed = true;
  readonly firstDrawn = true;
  readonly drawn = Promise.resolve();
  readonly settled = Promise.resolve();

  constructor(readonly panel: BrowserPanel) {}

  /** Replaced when the page's session changes, so always read from the panel. */
  get view(): WebContentsView {
    return this.panel.view;
  }
  get webContentsId(): number {
    return this.panel.webContentsId;
  }
  get status(): InstanceStatus {
    return this.panel.status;
  }
  get capturable(): boolean {
    return this.panel.capturable;
  }
  setBounds(rect: PanelRect): void {
    this.panel.setBounds(rect);
  }
  setVisible(visible: boolean): void {
    this.panel.setVisible(visible);
  }
  suspend(): void {
    this.panel.suspend();
  }
  resume(): void {
    this.panel.resume();
  }
  setInDialog(): void {}
  focus(): void {}
  setMaximized(): void {}
  capture(): Promise<string | null> {
    return stillOf(this.panel.view);
  }
  /** A Browser panel never goes over the game. */
  inGame(): null {
    return null;
  }
  dispose(): Promise<void> {
    this.panel.dispose();
    return Promise.resolve();
  }
}
