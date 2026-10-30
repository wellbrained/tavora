// Wires the services behind Stream overlays, game overlays, overlay previews and the Overlay page from the objects
// that own what they read (the library, the installed modules, the grants, Panel views, the game watcher) plus the few
// things only the host around them can do (OverlayHostPorts). None of them is handed the Host.
import { clipboard, desktopCapturer, globalShortcut, nativeImage, screen, BrowserWindow } from "electron";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { translate, type Language } from "../shared/i18n";
import { HOST_SCHEME } from "./assets";
import { GameOverlayWindow, type OverlayPanel } from "./game-overlay-window";
import { GameOverlays, type OverlayWindowRequest, type PanelInfo, type PanelLoan } from "./game-overlay-service";
import { GameVeilWindow } from "./game-veil-window";
import type { GameWatcher } from "./game-watch";
import type { GrantStore } from "./grants";
import type { Installed } from "./installed-modules";
import { LayoutPictures, MAX_PICTURE_BYTES, MAX_PICTURE_WIDTH, PICTURES_FOLDER, sourceForHandle } from "./layout-pictures";
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

/** What the overlay services ask of the host around them; the host answers (host.ts). */
export interface OverlayHostPorts {
  shell: Shell;
  language(): Language;
  /** Something the Settings page depends on changed. */
  changed(): void;
  /** Something the Settings page or the game watcher depends on changed (a game overlay was added, removed or toggled). */
  overlaysChanged(): void;
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
  const streaming = await Streaming.create({
    userData: options.userData,
    settings: () => library,
    saveSettings: (next) => {
      if (next.streamOverlays !== undefined) library.streamOverlays = next.streamOverlays;
      if (next.overlayPort !== undefined) library.overlayPort = next.overlayPort;
      ports.saveLibrary();
    },
    installed: wiring.installed,
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
    installed: wiring.installed,
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
      openWindow: (request, panel) => overlayWindow(options, request, panel),
      openVeil: () => new GameVeilWindow({ hidden: options.hidden }),
      shortcuts: globalShortcut,
    },
    panels: ports.panelsInGame,
    shell: ports.shell,
    language: ports.language,
    changed: ports.overlaysChanged,
  });
  streaming.useOverlayKeys(gameOverlays);
  const previews = new OverlayPreviews({
    overlays: streaming.overlayStore,
    installed: wiring.installed,
    openWindow: (request) =>
      new OverlayPreviewWindow(request, {
        hidden: options.hidden,
        labels: { dark: translate(ports.language(), "preview.dark"), light: translate(ports.language(), "preview.light"), checker: translate(ports.language(), "preview.checker") },
      }),
  });
  const layout = overlayLayout(wiring, gameOverlays);
  // The layer's frames open the Overlay page, and the page looks again when a game's window is seen: both need the page, which needs the layer.
  gameOverlays.useLayout(layout);
  return { streaming, gameOverlays, previews, layout };
}

/** The window for an overlay's page, or (with `panel`) for a panel over its game: the panel's own view goes into it, and no copy is made. */
function overlayWindow(options: OverlayWiringOptions, request: OverlayWindowRequest, panel?: OverlayPanel): GameOverlayWindow {
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
    frameText: request.frameText,
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
    settings: library,
    language: ports.language,
    sources: ports.page.sources,
    keepRunning: ports.page.keepRunning,
    leave: ports.page.leave,
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
      // The size is in DIPs; the window's pixels are more on a scaled screen (never wider than a picture may be).
      const k = Math.max(1, Math.min(screen.getPrimaryDisplay().scaleFactor, MAX_PICTURE_WIDTH / Math.max(1, size.width)));
      const thumbnailSize = { width: Math.round(size.width * k), height: Math.round(size.height * k) };
      const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize, fetchWindowIcons: false });
      const found = sources.find((source) => source.id === wanted.id);
      return found && !found.thumbnail.isEmpty() ? found.thumbnail.toPNG() : null;
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
