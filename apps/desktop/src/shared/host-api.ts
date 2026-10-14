// Contract between the trusted host UI (renderer) and the main process.
// Types only: imported by both sides, so it must not import Electron or Node.

/**
 * loading: the page is loading. ready: loaded and running. failed: the page
 * could not be loaded. unresponsive: the page stopped answering and may
 * recover. crashed: the renderer is gone until the panel is reloaded.
 */
export type InstanceStatus = "loading" | "ready" | "failed" | "unresponsive" | "crashed";

export type Screen = "welcome" | "game";
export type RootSort = "recent" | "manual";
export type Startup = "welcome" | "last-game";
export type RootItem = { kind: "game"; id: string } | { kind: "folder"; id: string };

export type IconView = { kind: "monogram"; text: string } | { kind: "image"; url: string };

export interface GameView {
  id: string;
  name: string;
  icon: IconView;
  /** Picked from the built-in list rather than added by name. */
  builtIn: boolean;
  addedAt: string;
  lastPlayedAt: string | null;
}

export interface FolderView {
  id: string;
  name: string;
  /** Up to three characters shown instead of the icon collage. */
  label: string | null;
  games: string[];
}

export interface PanelView {
  instanceId: string;
  moduleId: string;
  name: string;
  status: InstanceStatus;
  /** Position relative to the workspace area. */
  x: number;
  width: number;
}

/** What the host UI renders. Contains no module data. */
export interface HostViewState {
  screen: Screen;
  currentGameId: string | null;
  library: {
    /** Games not in Trash. */
    games: Record<string, GameView>;
    folders: Record<string, FolderView>;
    /** Top level of the rail in display order. */
    root: RootItem[];
    favorites: string[];
    /** Most recently played first, for the Welcome page. */
    recent: string[];
    trash: { game: GameView; trashedAt: string; purgeAt: string }[];
    sort: RootSort;
    startup: Startup;
    rail: { expanded: boolean; width: number };
  };
  modules: { id: string; name: string; description: string | null; available: boolean }[];
  panels: PanelView[];
  notice: string | null;
  panelHeaderHeight: number;
}

/** Everything the host UI can ask the main process to do. Parsed strictly in main. */
export type HostAction =
  | { type: "show-welcome" }
  | { type: "open-game"; gameId: string }
  | { type: "add-game"; catalogId: string }
  | { type: "add-game"; name: string }
  | { type: "rename-game"; gameId: string; name: string }
  | { type: "set-game-label"; gameId: string; label: string | null }
  | { type: "choose-game-image"; gameId: string }
  | { type: "trash-game"; gameId: string }
  | { type: "restore-game"; gameId: string }
  | { type: "delete-game"; gameId: string }
  | { type: "favorite"; gameId: string; index?: number }
  | { type: "unfavorite"; gameId: string }
  | { type: "move-game"; gameId: string; folderId: string | null; index?: number }
  | { type: "create-folder"; name: string; gameIds: string[] }
  | { type: "rename-folder"; folderId: string; name: string }
  | { type: "set-folder-label"; folderId: string; label: string | null }
  | { type: "delete-folder"; folderId: string }
  | { type: "move-folder"; folderId: string; index: number }
  | { type: "set-sort"; sort: RootSort }
  | { type: "set-startup"; startup: Startup }
  | { type: "set-rail"; expanded?: boolean; width?: number }
  | { type: "open-module"; moduleId: string }
  | { type: "close-panel"; instanceId: string }
  | { type: "reload-panel"; instanceId: string }
  | { type: "stop-panel"; instanceId: string };

/** `id` is set when the action created something (a game, a folder). */
export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export interface CatalogMatch {
  id: string;
  name: string;
}

export interface WorkspaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Exposed to the host UI as `window.tavoraHost` by the host preload. */
export interface TavoraHostApi {
  getState(): Promise<HostViewState | null>;
  act(action: HostAction): Promise<ActionResult>;
  searchCatalog(query: string): Promise<CatalogMatch[]>;
  /** Where module panels go, in window content coordinates. */
  setWorkspaceRect(rect: WorkspaceRect): void;
  /** Hides module panels while a menu or dialog would be drawn under them. */
  setOverlay(open: boolean): void;
  onState(listener: (state: HostViewState) => void): void;
}
