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
}

/**
 * A docking layout: a tree of splits whose leaves are tab groups of panels.
 * Splits alternate direction level by level, starting with `direction` at
 * the root. Sizes are in pixels of the `width` by `height` area the layout
 * was saved at; restoring scales them to the area there is.
 */
export interface SavedLayout {
  width: number;
  height: number;
  /** "row" places the root's children side by side, "column" stacks them. */
  direction: "row" | "column";
  root: LayoutSplit;
}

export interface LayoutSplit {
  kind: "split";
  size: number;
  children: LayoutNode[];
}

export interface LayoutGroup {
  kind: "group";
  size: number;
  /** Panel instance ids, in tab order. */
  panels: string[];
  /** The panel whose tab is selected. */
  active: string;
}

export type LayoutNode = LayoutSplit | LayoutGroup;

/** A named layout the player saved for a game. */
export interface SnapshotView {
  id: string;
  name: string;
  savedAt: string;
}

/** Where a visible panel's content is, in window content coordinates. */
export interface PanelBounds {
  instanceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
    grayscaleText: boolean;
    rail: { expanded: boolean; width: number };
  };
  modules: {
    id: string;
    name: string;
    description: string | null;
    available: boolean;
    /** The smallest panel content area the module works in. */
    minWidth: number;
    minHeight: number;
    /** Official modules ship with Tavora; local ones were found on disk. */
    provenance: "official" | "local";
  }[];
  /** Panels of the current game, in the order they were opened. */
  panels: PanelView[];
  /** The current game's saved layout; panels missing from it are placed by the host UI. */
  layout: SavedLayout | null;
  /** Changes whenever `layout` was replaced by the main process, e.g. by applying a snapshot. */
  layoutEpoch: number;
  snapshots: SnapshotView[];
  notice: string | null;
  /** The player's local profile. */
  profile: { name: string; pictureUrl: string | null };
  /** A setting that only applies on start was changed since Tavora started. */
  restartPending: boolean;
}

/** Everything the host UI can ask the main process to do. Parsed strictly in main. */
export type HostAction =
  | { type: "show-welcome" }
  | { type: "restart" }
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
  | { type: "set-grayscale-text"; enabled: boolean }
  | { type: "set-profile-name"; name: string }
  /** A cropped 256 px PNG, base64-encoded. */
  | { type: "set-profile-picture"; png: string }
  | { type: "remove-profile-picture" }
  | { type: "set-rail"; expanded?: boolean; width?: number }
  | { type: "open-module"; moduleId: string }
  | { type: "close-panel"; instanceId: string }
  | { type: "reload-panel"; instanceId: string }
  | { type: "stop-panel"; instanceId: string }
  | { type: "save-layout"; layout: SavedLayout }
  | { type: "save-snapshot"; name: string }
  | { type: "update-snapshot"; snapshotId: string }
  | { type: "apply-snapshot"; snapshotId: string }
  | { type: "rename-snapshot"; snapshotId: string; name: string }
  | { type: "delete-snapshot"; snapshotId: string };

/** `id` is set when the action created something (a game, a folder). */
export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export interface CatalogMatch {
  id: string;
  name: string;
}

/** Exposed to the host UI as `window.tavoraHost` by the host preload. */
export interface TavoraHostApi {
  getState(): Promise<HostViewState | null>;
  act(action: HostAction): Promise<ActionResult>;
  searchCatalog(query: string): Promise<CatalogMatch[]>;
  /** Where the visible panels are. Panels not listed are hidden. */
  setPanelBounds(bounds: PanelBounds[]): void;
  /**
   * Hides module panels while a menu, dialog or drag would be drawn under
   * them. Before hiding, the host sends a still image of each visible panel
   * to `onFrozen`, so the workspace does not go blank.
   */
  setOverlay(open: boolean): void;
  onState(listener: (state: HostViewState) => void): void;
  onFrozen(listener: (images: Record<string, string>) => void): void;
  /** Tavora-wide keyboard shortcuts, also when a module panel has focus. */
  onShortcut(listener: (shortcut: HostShortcut) => void): void;
}

export type HostShortcut = "search";
