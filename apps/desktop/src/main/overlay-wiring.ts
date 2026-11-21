// Wires the services behind Stream overlays, game overlays, overlay previews and the Overlay page from the objects
// that own what they read (the library, the installed modules, the grants, Panel views, the game watcher) plus the few
// things only the host around them can do (OverlayHostPorts). None of them is handed the Host.
import { clipboard, desktopCapturer, globalShortcut, nativeImage, screen, BrowserWindow } from "electron";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isVoicePaused } from "../shared/discord-voice";
import { translate, type Language } from "../shared/i18n";
import { HOST_SCHEME } from "./assets";
import type { TavoraTheme } from "@tavora/sdk/protocol";
import { GameLayerCard } from "./game-layer-card";
import { GameOverlayWindow, type OverlayPanel } from "./game-overlay-window";
import { GameOverlays, type OverlayWindowRequest, type PanelInfo, type PanelLoan } from "./game-overlay-service";
import { GameVeilWindow } from "./game-veil-window";
import type { GameWatcher } from "./game-watch";
import type { GrantStore } from "./grants";
import type { Installed } from "./installed-modules";
import { clientArea, LayoutPictures, MAX_PICTURE_BYTES, MAX_PICTURE_WIDTH, PICTURES_FOLDER, picturePixels, sourceForHandle } from "./layout-pictures";
import type { Library } from "./library";
import { windowsForegroundProbe } from "./foreground";
import { OverlayCanvas } from "./overlay-canvas";
import { OverlayLayout, type SourcePanel } from "./overlay-layout";
import { OverlayPreviewWindow } from "./overlay-preview-window";
import { OverlayPreviews } from "./overlay-previews";
import type { PanelViews } from "./panel-views";
import type { Shell } from "./shell";
import { Streaming } from "./streaming";
import type { WorkspaceNames } from "./workspace-lookup";
import { stackAbove, windowsOrder } from "./window-order";

/** Stacking the overlays above the game failed (Windows' calls couldn't be loaded): said once only. */
let stackFailed = false;

/** What the overlay services ask of the host around them; the host answers (host.ts). */
export interface OverlayHostPorts {
  shell: Shell;
  language(): Language;
  /** The theme Tavora's own UI is drawn in now (the in-game layer's card). */
  theme(): TavoraTheme;
  /** The interface font's stylesheet for Tavora's own overlay chrome (module-fonts.ts). */
  fontCss?(): string;
  /** Something the Settings page depends on changed. */
  changed(): void;
  /** Something the Settings page or the game watcher depends on changed (a game overlay was added, removed or toggled). */
  overlaysChanged(): void;
  /** A module's game overlays in one workspace changed (the Overlay page added or removed one): its panels there hear it. */
  overGameChanged(module: { owner: string; moduleId: string; workspaceId: string }): void;
  saveLibrary(): void;
  /** The workspace shown now, or null. */
  workspaceId(): string | null;
  /** Asks the user in Tavora's consent dialog for a connector the module asks for on request. */
  askConnector(moduleId: string, connector: "stream-overlay"): Promise<boolean>;
  /** What the in-game layer knows of a panel, and lending its view to the layer. */
  panelsInGame: {
    info(instanceId: string, workspaceId?: string): PanelInfo | null;
    lend(instanceId: string, workspaceId: string, revoked: () => void): PanelLoan | null;
  };
  /** The Overlay page's side of the host: every panel, which ones run, leaving the page, and the system's picture dialog. */
  page: {
    sources(): SourcePanel[];
    keepRunning(panels: { workspaceId: string; moduleId: string; instanceId: string | null }[]): boolean[];
    leave(): void;
    openSettings(target: { workspaceId: string; moduleId: string; instanceId: string | null; key: string | null }): void;
    choosePicture(): Promise<string | undefined>;
    rememberPicture(file: string): void;
  };
}

export interface OverlayWiringOptions {
  userData: string;
  hidden: boolean;
  devServer?: string | undefined;
  devTools: boolean;
  hostPreload: string;
  modulePreload: string;
}

export interface OverlayServices {
  streaming: Streaming;
  gameOverlays: GameOverlays;
  previews: OverlayPreviews;
  layout: OverlayLayout<OverlayCanvas>;
}

export interface OverlayWiring {
  options: OverlayWiringOptions;
  /** The window the Overlay page's canvas is drawn in. */
  window: BrowserWindow;
  library: Library;
  workspaces: WorkspaceNames;
  installed: Installed;
  grants: GrantStore;
  panels: PanelViews;
  watcher: GameWatcher;
  ports: OverlayHostPorts;
}

/** The services, in the order they depend on each other: Streaming, then game overlays on its stores, then the Overlay page on those. */
export async function createOverlayServices(wiring: OverlayWiring): Promise<OverlayServices> {
  const { options, library, ports } = wiring;
  const installed = overlayModules(wiring.installed);
  const streaming = await Streaming.create({
    userData: options.userData,
    settings: () => library,
    saveSettings: (next) => {
      if (next.streamOverlays !== undefined) library.streamOverlays = next.streamOverlays;
      if (next.overlayPort !== undefined) library.overlayPort = next.overlayPort;
      ports.saveLibrary();
    },
    installed,
    grants: wiring.grants,
    askConnector: ports.askConnector,
    workspaceId: ports.workspaceId,
    workspaces: wiring.workspaces,
    panels: wiring.panels,
    shortcuts: globalShortcut,
    writeClipboard: (text) => clipboard.writeText(text),
    shell: ports.shell,
    language: ports.language,
    changed: ports.changed,
  });
  const gameOverlays = await GameOverlays.create({
    userData: options.userData,
    streaming,
    installed,
    workspaces: wiring.workspaces,
    settings: library,
    watcher: wiring.watcher,
    platform: {
      supported: process.platform === "win32",
      probe: () => windowsForegroundProbe(),
      // Windows reports pixels; windows are placed in DIPs.
      toDip: (rect) => screen.screenToDipRect(null, rect),
      screen: () => screen.getPrimaryDisplay().bounds,
      // Any of Tavora's windows with the keyboard; the service tells its own overlay windows apart.
      tavoraInFront: () => BrowserWindow.getFocusedWindow() !== null,
      openWindow: (request, panel) => overlayWindow(options, ports.fontCss, request, panel),
      openVeil: () => new GameVeilWindow({ hidden: options.hidden }),
      // Overlays that stay while the user is elsewhere sit right above the game's window, not above every window.
      stackAboveGame: (game, windows) => {
        if (process.platform !== "win32") return false;
        try {
          stackAbove(windowsOrder(), game, windows);
          return true;
        } catch (error) {
          // Said once: the service then keeps them above every window, as before, and tries again on each look.
          if (!stackFailed) console.warn("[tavora] cannot stack the overlays above the game", error);
          stackFailed = true;
          return false;
        }
      },
      gameOnTop: (game) => {
        if (process.platform !== "win32") return false;
        try {
          return windowsOrder().topmost(game);
        } catch {
          return false;
        }
      },
      // The card is a page of the host UI (layer-card.html), with a preload of its own.
      openCard: (request) =>
        new GameLayerCard({
          ...request,
          preload: path.join(path.dirname(options.hostPreload), "layer-card.cjs"),
          address: options.devServer ? new URL("layer-card.html", options.devServer).href : `${HOST_SCHEME}://app/layer-card.html`,
          hidden: options.hidden,
          devTools: options.devTools,
          theme: ports.theme,
          language: ports.language,
        }),
      shortcuts: globalShortcut,
    },
    panels: ports.panelsInGame,
    shell: ports.shell,
    language: ports.language,
    changed: ports.overlaysChanged,
    overGameChanged: ports.overGameChanged,
  });
  streaming.useOverlayKeys(gameOverlays);
  const previews = new OverlayPreviews({
    overlays: streaming.overlayStore,
    installed,
    openWindow: (request) =>
      new OverlayPreviewWindow(request, {
        hidden: options.hidden,
        labels: { dark: translate(ports.language(), "preview.dark"), light: translate(ports.language(), "preview.light"), checker: translate(ports.language(), "preview.checker") },
        ...(ports.fontCss ? { fontCss: ports.fontCss } : {}),
      }),
  });
  const layout = overlayLayout(wiring, gameOverlays);
  // The layer's frames open the Overlay page, and the page looks again when a game's window is seen: both need the page, which needs the layer.
  gameOverlays.useLayout(layout);
  return { streaming, gameOverlays, previews, layout };
}

/** The window for an overlay's page, or (with `panel`) for a panel over its game: the panel's own view goes into it, and no copy is made. */
function overlayWindow(options: OverlayWiringOptions, fontCss: (() => string) | undefined, request: OverlayWindowRequest, panel?: OverlayPanel): GameOverlayWindow {
  return new GameOverlayWindow({
    preload: path.join(path.dirname(options.modulePreload), "game-overlay.cjs"),
    hidden: options.hidden,
    id: request.id,
    source: { page: request.page, state: request.state, watch: request.watch },
    gameBounds: request.gameBounds,
    moved: request.moved,
    closeRequested: request.closeRequested,
    layoutRequested: request.layoutRequested,
    ended: request.ended,
    activated: request.activated,
    frameText: request.frameText,
    // The frame is Tavora's own chrome, in the font the user picked.
    ...(fontCss ? { fontCss } : {}),
    ...(panel ? { panel } : {}),
  });
}

/** The Overlay layout (overlay-layout.ts): the window where the user arranges the overlays and panels in game. */
function overlayLayout(wiring: OverlayWiring, gameOverlays: GameOverlays): OverlayLayout<OverlayCanvas> {
  const { options, library, ports } = wiring;
  const pictures = new LayoutPictures(path.join(options.userData, PICTURES_FOLDER));
  return new OverlayLayout<OverlayCanvas>({
    source: gameOverlays.layout,
    pictures,
    workspaces: wiring.workspaces,
    screen: () => screen.getPrimaryDisplay().workArea,
    // The monitors in their own pixels (DIPs times the scale), the main one first: only their shapes are used, for "Preview as".
    monitors: () => {
      const main = screen.getPrimaryDisplay().id;
      return screen
        .getAllDisplays()
        .sort((a, b) => Number(b.id === main) - Number(a.id === main))
        .map((display) => ({ id: display.id, width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) }));
    },
    settings: library,
    language: ports.language,
    sources: ports.page.sources,
    keepRunning: ports.page.keepRunning,
    leave: ports.page.leave,
    openSettings: ports.page.openSettings,
    openWindow: () => {
      const page = options.devServer ? new URL("layout.html", options.devServer) : new URL("layout.html", `${HOST_SCHEME}://app/`);
      return new OverlayCanvas({ window: wiring.window, preload: options.hostPreload, devTools: options.devTools, address: () => `${page.href.split("#")[0]}#layer` });
    },
    // Only on the user's click, only the game's own window, with the OS's window capture (as OBS's Window Capture does).
    capture: async (handle, size) => {
      if (options.hidden) return null;
      // The first look asks for no picture at all (a 0 x 0 thumbnail), only for the list: no such window open, nothing to take.
      const listed = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
      const wanted = sourceForHandle(listed, handle);
      if (!wanted) return null;
      // Electron can't capture one window alone: it takes a picture of every open window at this size and hands them all
      // over. Tavora keeps the game's by its id and lets the rest go at once, unread.
      // The size is in DIPs; the window's pixels are more on a scaled screen, and the game may not be on the main one.
      const gameWindow = gameOverlays.layout.gameWindow();
      const display = gameWindow ? screen.getDisplayMatching(gameWindow) : screen.getPrimaryDisplay();
      const thumbnailSize = picturePixels(size, display.scaleFactor);
      const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize, fetchWindowIcons: false });
      const found = sources.find((source) => source.id === wanted.id);
      if (!found || found.thumbnail.isEmpty()) return null;
      // Only the game itself: the window's title bar is cut off, so the picture has the canvas's shape (`size`).
      return found.thumbnail.crop(clientArea(found.thumbnail.getSize(), size)).toPNG();
    },
    choose: async () => {
      const file = await ports.page.choosePicture();
      if (!file) return "cancelled";
      try {
        if ((await stat(file)).size > MAX_PICTURE_BYTES) return "bad";
        let image = nativeImage.createFromBuffer(await readFile(file));
        if (image.isEmpty()) return "bad";
        if (image.getSize().width > MAX_PICTURE_WIDTH) image = image.resize({ width: MAX_PICTURE_WIDTH });
        ports.page.rememberPicture(file);
        return image.toPNG();
      } catch {
        return "bad";
      }
    },
  });
}

/**
 * The installed modules as the overlays see them. While Discord voice is paused (shared/discord-voice.ts) the Discord
 * module has no overlay page: its game and stream overlays aren't shown or served and none can be added, but they stay
 * saved (nothing is forgotten for a missing page, only for another publisher's module) and come back with it.
 */
export function overlayModules(installed: Installed): Pick<Installed, "shown" | "get"> {
  return {
    shown: (moduleId) => {
      const module = installed.shown(moduleId);
      if (!module || !isVoicePaused(moduleId)) return module;
      const { overlay: _paused, ...manifest } = module.manifest;
      return { ...module, manifest };
    },
    get: (moduleId) => installed.get(moduleId),
  };
}
