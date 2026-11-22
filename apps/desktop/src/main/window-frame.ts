import type { BrowserWindow } from "electron";
import { veiled } from "./themes";
import type { WindowState } from "./window-state";

/** Leaves the workspace header's bottom border visible below the window controls. */
export const TITLE_BAR_HEIGHT = 47;
/** How dark the kit's dialog backdrop is (bg-black/80 in DialogOverlay). */
export const DIALOG_BACKDROP_OPACITY = 0.8;
/** How long the window's place waits after a move or resize before it is saved. */
export const WINDOW_SAVE_MS = 1000;

export interface WindowFrameOptions {
  /** Tavora's window; asked only once it is made. */
  window: () => Pick<BrowserWindow, "isDestroyed" | "setTitleBarOverlay" | "getNormalBounds" | "isMaximized">;
  /** The host theme's page and text colours now (appearance.ts). */
  colors: () => { background: string; text: string };
  /** Writes the window's place (saved-data.ts). */
  save: (state: WindowState) => void;
  /** How long a move or resize waits before it is saved; WINDOW_SAVE_MS by default. */
  saveMs?: number;
}

/**
 * Tavora's window frame: the window buttons in the theme's colours, on the colour the page reports behind them, dimmed
 * like the page while a dialog backdrop covers it, and the window's place and size, saved a moment after it moves and at
 * once when it closes.
 */
export class WindowFrame {
  /** True while a dialog backdrop dims the host page, so the window buttons are dimmed too. */
  private dimmed = false;
  /** The page colour behind the window buttons, as the page reports it (the workspace canvas is darker than the theme). */
  private buttonsBackground: string | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: WindowFrameOptions) {}

  /** The window buttons, in the theme's colours; under a dialog backdrop dimmed like the page around them. */
  titleBar(): { color: string; symbolColor: string; height: number } {
    const { background: themeBackground, text } = this.options.colors();
    const background = this.buttonsBackground ?? themeBackground;
    const veil = this.dimmed ? DIALOG_BACKDROP_OPACITY : 0;
    return { color: veiled(background, veil), symbolColor: veiled(text, veil), height: TITLE_BAR_HEIGHT };
  }

  /** The host page dims itself under a dialog backdrop, or stops. */
  dim(dimmed: boolean): void {
    if (dimmed === this.dimmed) return;
    this.dimmed = dimmed;
    this.recolour();
  }

  /** The page says what colour is behind the window buttons now; anything but a #rrggbb colour is ignored. */
  setButtonsBackground(color: unknown): void {
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color) || color === this.buttonsBackground) return;
    this.buttonsBackground = color;
    this.recolour();
  }

  /** Paints the window buttons again (a new theme, a dimmed page). */
  recolour(): void {
    const window = this.options.window();
    if (window.isDestroyed()) return;
    try {
      window.setTitleBarOverlay(this.titleBar());
    } catch {
      // Platforms without a window controls overlay have nothing to recolour.
    }
  }

  /** The window moved or was resized: its place is saved once it has been still a moment. */
  saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), this.options.saveMs ?? WINDOW_SAVE_MS);
  }

  /** Saves the window's place now (it is closing): its normal bounds, and whether it is maximized. */
  save(): void {
    clearTimeout(this.saveTimer);
    const window = this.options.window();
    if (window.isDestroyed()) return;
    this.options.save({ bounds: window.getNormalBounds(), maximized: window.isMaximized() });
  }
}
