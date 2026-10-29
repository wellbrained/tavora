import type { WebContentsView } from "electron";
import type { BrowserPanel } from "./browser-view";
import type { InstanceStatus, ModuleView } from "./module-view";
import type { PanelRect, PanelViewAdapter } from "./panel-views";

/** A still image of a panel's page as a data: URL, or null when there is none. */
async function stillOf(view: WebContentsView): Promise<string | null> {
  const image = await view.webContents.capturePage().catch(() => null);
  return image && !image.isEmpty() ? `data:image/jpeg;base64,${image.toJPEG(85).toString("base64")}` : null;
}

/** A module's panel as Panel views sees it. */
export class ModulePanelView implements PanelViewAdapter {
  readonly kind = "module";
  readonly capturable = true;

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
  setMaximized(maximized: boolean): void {
    this.panel.setMaximized(maximized);
  }
  capture(): Promise<string | null> {
    return stillOf(this.panel.view);
  }
  dispose(): void {
    this.panel.dispose();
  }
}

/** A Browser panel as Panel views sees it: always revealed, never paused, no dialog and no maximized state of its own. */
export class BrowserPanelView implements PanelViewAdapter {
  readonly kind = "browser";
  readonly revealed = true;
  readonly firstDrawn = true;
  readonly drawn = Promise.resolve();

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
  setMaximized(): void {}
  capture(): Promise<string | null> {
    return stillOf(this.panel.view);
  }
  dispose(): void {
    this.panel.dispose();
  }
}
