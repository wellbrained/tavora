import { randomUUID } from "node:crypto";
import path from "node:path";
import { isGameId, isModuleId } from "@tavora/module-schema";
import { isWorkspaceId } from "./workspace-id";
import type { GameStart, RootItem, RootSort, Startup } from "../shared/host-api";
import { isSite } from "./browser-url";
import { isLanguageSetting, type LanguageSetting } from "../shared/i18n";
import { UserError } from "./messages";
import { CATALOG, catalogGame } from "./catalog";
import { DEFAULT_OVERLAY_PORT, MAX_OVERLAY_PORT, MIN_OVERLAY_PORT } from "./overlays";
import { iconFileAllowed, isSteamAppId, needsIcon } from "./steam-icons";
import { DEFAULT_THEME, isVariationId } from "./themes";

export type { RootItem, RootSort, Startup };

/**
 * The user's library: which workspaces exist, how the rail arranges them
 * and the few app preferences that go with it. Pure data and pure
 * operations; the host persists it and acts on what the operations return.
 */

export type WorkspaceIcon = { kind: "monogram"; text: string } | { kind: "image"; file: string };

/**
 * What a workspace in the library is: a game workspace, linked to a game, or a personal workspace that belongs to
 * no game (for modules such as Notes or Whiteboard). Both keep their own layout and module data under their id.
 */
export type WorkspaceKind = "game" | "personal";

export interface WorkspaceEntry {
  /** Stable id. Keys the workspace's panels and module data, so it never changes. A game workspace's id is its game's id. */
  id: string;
  /** A personal workspace has no built-in game, Steam id or icon of its own. */
  kind: WorkspaceKind;
  /** Set when the game was picked from the built-in list. */
  catalogId: string | null;
  /** Display name. Renaming never changes the id. */
  name: string;
  icon: WorkspaceIcon;
  /**
   * Whether the game shows its own icon (the one found on this PC or from Steam) while it has one. False means
   * the user chose their own letters. A picked image wins over both, so this only matters without one.
   */
  useOriginalIcon: boolean;
  /** The game's Steam application id, a hidden key used to find its icon; null when it has none. */
  steamAppId: number | null;
  /** The game's own icon in the user's data folder, kept unchanged (from the installed game or from Steam); null until found. */
  iconFile: string | null;
  /** When no icon was found for this game, so it is not looked up again for a while. */
  iconCheckedAt: string | null;
  /** When the user offered the game's icon to the Tavora service, so it is not offered again. */
  iconSharedAt: string | null;
  showNews: boolean;
  addedAt: string;
  lastOpenedAt: string | null;
  /** Set while the workspace is in Trash. */
  trashedAt: string | null;
}

export interface Folder {
  id: string;
  name: string;
  /** Up to three characters shown instead of the icon collage. */
  label: string | null;
  /** Workspace ids in manual order. */
  workspaces: string[];
}

export interface Library {
  version: 2;
  workspaces: Record<string, WorkspaceEntry>;
  folders: Record<string, Folder>;
  /** Top level of the rail in manual order. Every workspace not in Trash is here or in exactly one folder. */
  root: RootItem[];
  /** Shortcuts at the top of the rail, in manual order. The workspace keeps its own place too. */
  favorites: string[];
  sort: RootSort;
  rail: { expanded: boolean; width: number };
  startup: Startup;
  /** What happens when the game of a game workspace starts (main/game-watch.ts). */
  gameStart: GameStart;
  /** The personal workspace to go back to when the open workspace's game closes; null stays where it is. */
  gameEndWorkspaceId: string | null;
  /** Grayscale instead of ClearType text, for OLED screens. Read before the app is ready. */
  grayscaleText: boolean;
  /** Search may ask the Tavora service online. Off means the built-in games only. */
  onlineSearch: boolean;
  /** New versions of Tavora download by themselves. Off means the user starts the download. */
  autoUpdate: boolean;
  /** Updates of catalog modules that ask for nothing new install by themselves; off, they wait for the user. */
  autoUpdateModules: boolean;
  /** Game icons may be taken from Steam on this PC. Off means the generated badge. */
  steamIcons: boolean;
  /** The panel tabs show an icon before the module name. */
  moduleIcons: boolean;
  /** Stream overlays: Tavora serves module overlays to streaming software on this PC (overlays.ts). Off until the user turns it on. */
  streamOverlays: boolean;
  /** The port Stream overlays listen on, on 127.0.0.1. */
  overlayPort: number;
  /** Game overlays: module overlay pages shown over the user's game (game-overlays.ts). Off until the user turns it on. */
  gameOverlays: boolean;
  /** Game overlays stay where they are when the user switches to another window, as long as the game window is open. */
  overlaysStay: boolean;
  /** Where modules keep their pictures, when the user moved it from the default folder. */
  moduleFilesFolder: string | null;
  /** Module project folders a developer added in Settings > Modules; loaded straight from there (registry.ts). */
  developmentFolders: string[];
  /** Per system file dialog, the folder the user last picked from in it; the dialog opens there next time. */
  dialogFolders: Partial<Record<DialogPlace, string>>;
  /** Per `owner:module id`, the folder the user last saved a file to or opened one from for that module (files.saveJson, files.openJson). */
  moduleFolders: Record<string, string>;
  /** Per `owner:module id`, the module version whose patch notes the user has seen; newer notes are marked new. */
  moduleNotesSeen: Record<string, string>;
  /** The Steam profile link or id the user chose to remember for the Steam import, or null. Kept only on this PC. */
  steamProfile: string | null;
  /** Ids of games not in the library whose icon the user offered to the Tavora service (Steam import), so they are not offered again. */
  iconsOffered: string[];
  /** The language of Tavora's texts: one of them, or the system's. */
  language: LanguageSetting;
  /** The picked theme and variation. Kept even while that theme is not installed, which shows the default. */
  theme: { id: string; variation: string };
  /** Show the variation that matches the system's light or dark setting, and change with it. */
  followSystem: boolean;
  /** False until the first-run welcome was finished or skipped. */
  onboarded: boolean;
  /** Browser panel sites: signed in for all workspaces instead of per workspace, and ad blocking turned off. */
  browser: { sharedSites: string[]; adblockOff: string[] };
  lastWorkspaceId: string | null;
}

export const GAME_START_CHOICES: readonly GameStart[] = ["switch", "ask", "show", "off"];

export const RAIL = { compact: 72, minWidth: 180, maxWidth: 420, defaultWidth: 256 } as const;
export const TRASH_DAYS = 30;
export const MAX_NAME = 80;
export const MAX_LABEL = 3;

/** The system file dialogs that open where the user last picked from. */
export const DIALOG_PLACES = ["install-module", "development-folder", "workspace-image", "module-files", "cloud-copy", "save-picture", "module-zip", "publisher-key", "layout-picture"] as const;
export type DialogPlace = (typeof DIALOG_PLACES)[number];

/** Most development folders kept. */
export const MAX_DEVELOPMENT_FOLDERS = 20;
/** Modules whose seen patch notes are remembered; more than anyone installs. */
export const MAX_NOTES_SEEN = 1000;
/** Modules whose file folder is remembered; more than anyone installs. */
export const MAX_MODULE_FOLDERS = 1000;
/** Offered icons of games not in the library that are remembered; as many as a Steam import can list. */
export const MAX_ICONS_OFFERED = 5000;

/** Absolute paths only, each once (ignoring case on Windows), at most MAX_DEVELOPMENT_FOLDERS. */
export function cleanDevelopmentFolders(values: unknown[]): string[] {
  const seen = new Set<string>();
  const folders: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || value.length > 500 || !path.isAbsolute(value)) continue;
    const folder = path.resolve(value);
    const key = process.platform === "win32" ? folder.toLowerCase() : folder;
    if (seen.has(key)) continue;
    seen.add(key);
    folders.push(folder);
    if (folders.length === MAX_DEVELOPMENT_FOLDERS) break;
  }
  return folders;
}

/** A problem the user caused and should read, e.g. a duplicate game. */
export class LibraryError extends UserError {}

export function emptyLibrary(): Library {
  return {
    version: 2,
    workspaces: {},
    folders: {},
    root: [],
    favorites: [],
    sort: "recent",
    rail: { expanded: false, width: RAIL.defaultWidth },
    startup: "last-workspace",
    gameStart: "show",
    gameEndWorkspaceId: null,
    grayscaleText: false,
    onlineSearch: true,
    autoUpdate: true,
    autoUpdateModules: false,
    steamIcons: true,
    moduleIcons: true,
    streamOverlays: false,
    overlayPort: DEFAULT_OVERLAY_PORT,
    gameOverlays: false,
    overlaysStay: true,
    moduleFilesFolder: null,
    developmentFolders: [],
    dialogFolders: {},
    moduleFolders: {},
    moduleNotesSeen: {},
    steamProfile: null,
    iconsOffered: [],
    language: "system",
    theme: { ...DEFAULT_THEME },
    followSystem: true,
    onboarded: false,
    browser: { sharedSites: [], adblockOff: [] },
    lastWorkspaceId: null,
  };
}

// ── Reading ──────────────────────────────────────────────────────────────

export function liveWorkspaces(library: Library): WorkspaceEntry[] {
  return Object.values(library.workspaces).filter((workspace) => workspace.trashedAt === null);
}

export function trashedWorkspaces(library: Library): WorkspaceEntry[] {
  return Object.values(library.workspaces)
    .filter((workspace) => workspace.trashedAt !== null)
    .sort((a, b) => b.trashedAt!.localeCompare(a.trashedAt!));
}

export function isLive(library: Library, id: string): boolean {
  return library.workspaces[id]?.trashedAt === null;
}

/** When a trashed workspace is deleted for good. */
export function purgeDate(workspace: WorkspaceEntry): Date {
  return new Date(Date.parse(workspace.trashedAt!) + TRASH_DAYS * 24 * 60 * 60 * 1000);
}

function openedAt(workspace: WorkspaceEntry | undefined): string {
  return workspace?.lastOpenedAt ?? "";
}

/** When each workspace was last opened, kept at startup so the rail's order holds for the whole session. */
export function openedTimes(library: Library): Record<string, string> {
  return Object.fromEntries(Object.values(library.workspaces).map((workspace) => [workspace.id, openedAt(workspace)]));
}

/**
 * The rail's top level in display order. Folders sort by their most recently opened workspace.
 * `opened` is from openedTimes at startup, so opening a workspace never moves it mid-session.
 */
export function sortedRoot(library: Library, opened: Record<string, string> = openedTimes(library)): RootItem[] {
  if (library.sort === "manual") return [...library.root];
  const at = (id: string): string => opened[id] ?? "";
  const recency = (item: RootItem): string =>
    item.kind === "workspace" ? at(item.id) : library.folders[item.id]!.workspaces.map(at).sort().at(-1) ?? "";
  // Stable sort: equally recent items keep their manual order.
  return [...library.root].sort((a, b) => recency(b).localeCompare(recency(a)));
}

/** Most recently opened workspaces first, then the rest by when they were added. */
export function recentWorkspaces(library: Library, limit: number): WorkspaceEntry[] {
  return liveWorkspaces(library)
    .sort((a, b) => openedAt(b).localeCompare(openedAt(a)) || b.addedAt.localeCompare(a.addedAt))
    .slice(0, limit);
}

/** Built-in games matching a search, leaving out ones already in the library (Trash included). */
export function searchCatalog(library: Library, query: string, limit = 8) {
  const q = normalize(query);
  const available = CATALOG.filter((game) => !library.workspaces[game.id]);
  if (!q) return available.slice(0, limit);
  const score = (text: string) => {
    const t = normalize(text);
    return t.startsWith(q) ? 2 : t.includes(q) ? 1 : 0;
  };
  return available
    .map((game) => ({ game, score: Math.max(score(game.name), ...(game.aliases ?? []).map(score)) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.game.name.localeCompare(b.game.name))
    .slice(0, limit)
    .map((match) => match.game);
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// ── Workspaces ────────────────────────────────────────────────────────────────

/** Up to three letters or digits from the name's words, e.g. "Path of Exile 2" → "PE2". */
export function monogram(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  const significant = words.filter((word, index) => index === 0 || !/^(of|the|and|a|an|de|der|die|das)$/i.test(word));
  const letters = (significant.length > 1 ? significant.map((word) => [...word][0]) : [...(significant[0] ?? "?")])
    .slice(0, MAX_LABEL)
    .join("");
  return letters.toUpperCase() || "?";
}

function cleanName(name: unknown, kind: "name" | "folderName" = "name"): string {
  if (typeof name !== "string") throw new LibraryError(`error.${kind}.missing`);
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed) throw new LibraryError(`error.${kind}.empty`);
  if (trimmed.length > MAX_NAME) throw new LibraryError(`error.${kind}.long`, { max: MAX_NAME });
  return trimmed;
}

function cleanLabel(label: unknown): string {
  if (typeof label !== "string") throw new LibraryError("error.label.missing");
  const trimmed = label.trim();
  if (!trimmed || [...trimmed].length > MAX_LABEL) throw new LibraryError("error.label.length", { max: MAX_LABEL });
  return trimmed;
}

/** A path-safe id for a custom game or a personal workspace, never colliding with built-in ids. */
function customWorkspaceId(library: Library, name: string): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "workspace";
  const base = `local-${slug}`;
  let id = base;
  for (let n = 2; library.workspaces[id]; n++) id = `${base}-${n}`;
  return id;
}

export type NewWorkspace =
  | { catalogId: string }
  | { name: string; steamAppId?: number | null }
  | { online: { id: string; name: string; steamAppId?: number | null } }
  | { personal: string };

function checkNotInLibrary(library: Library, id: string): void {
  const existing = library.workspaces[id];
  if (existing) {
    throw new LibraryError(existing.trashedAt ? "error.game.inTrash" : "error.game.owned", { name: existing.name });
  }
}

/** Adds a workspace (empty) at the end of the rail. Returns its id. */
export function addWorkspace(library: Library, input: NewWorkspace, now: Date): string {
  let id: string;
  let name: string;
  let catalogId: string | null = null;
  let steamAppId: number | null = null;
  let kind: WorkspaceKind = "game";
  if ("personal" in input) {
    // A personal workspace is never linked to a built-in game, whatever its name.
    name = cleanName(input.personal);
    id = customWorkspaceId(library, name);
    kind = "personal";
  } else if ("catalogId" in input) {
    const known = catalogGame(input.catalogId);
    if (!known) throw new LibraryError("error.game.notBuiltIn");
    checkNotInLibrary(library, known.id);
    ({ id, name } = known);
    catalogId = known.id;
    steamAppId = known.steamAppId ?? null;
  } else if ("online" in input) {
    // The service issues canonical ids; a built-in game found online is still that built-in game.
    // `local-` ids belong to games the user added by name.
    const known = catalogGame(input.online.id);
    id = input.online.id;
    if (id.startsWith("local-")) throw new LibraryError("error.game.cantAdd");
    name = known ? known.name : cleanName(input.online.name);
    catalogId = known ? known.id : null;
    // The service's appid, or the built-in list's when the service has none for it.
    steamAppId = isSteamAppId(input.online.steamAppId) ? input.online.steamAppId : (known?.steamAppId ?? null);
    checkNotInLibrary(library, id);
  } else {
    name = cleanName(input.name);
    id = customWorkspaceId(library, name);
    // A Steam import knows the game's appid even when the service has no id for it.
    steamAppId = isSteamAppId(input.steamAppId) ? input.steamAppId : null;
  }
  if (!isWorkspaceId(id)) throw new LibraryError("error.workspace.badName");
  library.workspaces[id] = {
    id,
    kind,
    catalogId,
    name,
    icon: { kind: "monogram", text: monogram(name) },
    useOriginalIcon: kind === "game",
    steamAppId,
    iconFile: null,
    iconCheckedAt: null,
    iconSharedAt: null,
    showNews: kind === "game",
    addedAt: now.toISOString(),
    lastOpenedAt: null,
    trashedAt: null,
  };
  library.root.push({ kind: "workspace", id });
  return id;
}

/** Live game workspaces whose game has no icon yet and is due to be looked up. Personal workspaces have no icon to find. */
export function workspacesNeedingIcon(library: Library, now: Date): WorkspaceEntry[] {
  return liveWorkspaces(library).filter((workspace) => workspace.kind === "game" && needsIcon(workspace, now));
}

/** Records the outcome of looking for a game's icon: the saved file, or that none was found. */
export function recordIcon(library: Library, id: string, outcome: { file: string } | { none: Date }): void {
  const workspace = library.workspaces[id];
  if (!workspace) return;
  if ("file" in outcome) {
    if (!iconFileAllowed(workspace, outcome.file)) return;
    workspace.iconFile = outcome.file;
    workspace.iconCheckedAt = null;
  } else {
    workspace.iconFile = null;
    workspace.iconCheckedAt = outcome.none.toISOString();
  }
}

/** Notes that the user offered this game's icon to the Tavora service. */
export function markIconShared(library: Library, id: string, now: Date): void {
  const workspace = library.workspaces[id];
  if (workspace) workspace.iconSharedAt = now.toISOString();
}

/** Notes that the user offered the icon of a game that is not in the library, newest last. */
export function markIconOffered(library: Library, id: string): void {
  library.iconsOffered = [...library.iconsOffered.filter((other) => other !== id), id].slice(-MAX_ICONS_OFFERED);
}

/** True when another workspace in the library uses this icon file. */
export function iconFileShared(library: Library, file: string, exceptId: string): boolean {
  return Object.values(library.workspaces).some((workspace) => workspace.id !== exceptId && workspace.iconFile === file);
}

function liveWorkspace(library: Library, id: unknown): WorkspaceEntry {
  const workspace = typeof id === "string" ? library.workspaces[id] : undefined;
  if (!workspace || workspace.trashedAt !== null) throw new LibraryError("error.workspaceGone");
  return workspace;
}

export function renameWorkspace(library: Library, id: string, name: unknown): void {
  liveWorkspace(library, id).name = cleanName(name);
}

/**
 * Chooses letters for the icon (null: the ones derived from the name). A game workspace stops showing its game's icon,
 * which is what the user asked for by choosing letters. Returns the previous icon so a picked image's file can go.
 */
export function setWorkspaceLabel(library: Library, id: string, label: unknown): WorkspaceIcon | null {
  const workspace = liveWorkspace(library, id);
  const previous = workspace.icon;
  workspace.icon = { kind: "monogram", text: label === null ? monogram(workspace.name) : cleanLabel(label) };
  workspace.useOriginalIcon = false;
  return previous;
}

/** Goes back to the workspace's own icon (its game's, or the badge when none was found); a picked image or letters are dropped. */
export function useOriginalWorkspaceIcon(library: Library, id: string): WorkspaceIcon {
  const workspace = liveWorkspace(library, id);
  const previous = workspace.icon;
  workspace.icon = { kind: "monogram", text: monogram(workspace.name) };
  // A personal workspace has no icon of its own, so its letters are its original.
  workspace.useOriginalIcon = workspace.kind === "game";
  return previous;
}

/** Sets an uploaded image. Returns the previous icon so its file can be removed. */
export function setWorkspaceImage(library: Library, id: string, file: string): WorkspaceIcon {
  const workspace = liveWorkspace(library, id);
  const previous = workspace.icon;
  workspace.icon = { kind: "image", file };
  return previous;
}

export function setShowNews(library: Library, id: string, show: boolean): void {
  liveWorkspace(library, id).showNews = show;
}

export function markOpened(library: Library, id: string, now: Date): void {
  liveWorkspace(library, id).lastOpenedAt = now.toISOString();
  library.lastWorkspaceId = id;
}

/** Takes a workspace out of the top level or its folder. Favorites are separate shortcuts and stay. */
function unplace(library: Library, id: string): void {
  library.root = library.root.filter((item) => !(item.kind === "workspace" && item.id === id));
  for (const folder of Object.values(library.folders)) folder.workspaces = folder.workspaces.filter((workspace) => workspace !== id);
}

/** Moves a workspace and its data to Trash. Its data stays on disk until it is purged. */
export function trashWorkspace(library: Library, id: string, now: Date): void {
  const workspace = liveWorkspace(library, id);
  unplace(library, id);
  removeFavorite(library, id);
  workspace.trashedAt = now.toISOString();
  if (library.lastWorkspaceId === id) library.lastWorkspaceId = null;
}

export function restoreWorkspace(library: Library, id: string): void {
  const workspace = library.workspaces[id];
  if (!workspace || workspace.trashedAt === null) throw new LibraryError("error.workspace.notInTrash");
  workspace.trashedAt = null;
  library.root.push({ kind: "workspace", id });
}

/** Forgets a trashed workspace. The caller deletes its data. */
export function deleteTrashedWorkspace(library: Library, id: string): WorkspaceEntry {
  const workspace = library.workspaces[id];
  if (!workspace || workspace.trashedAt === null) throw new LibraryError("error.workspace.notInTrash");
  delete library.workspaces[id];
  return workspace;
}

/** Forgets every workspace that has been in Trash for 30 days. Returns them so their data can be deleted. */
export function purgeExpired(library: Library, now: Date): WorkspaceEntry[] {
  return trashedWorkspaces(library)
    .filter((workspace) => purgeDate(workspace) <= now)
    .map((workspace) => deleteTrashedWorkspace(library, workspace.id));
}

// ── Favorites ────────────────────────────────────────────────────────────

/** Adds or moves a favorite to a position (end when omitted). */
export function placeFavorite(library: Library, id: string, index?: number): void {
  liveWorkspace(library, id);
  const favorites = library.favorites.filter((workspace) => workspace !== id);
  favorites.splice(clampIndex(index, favorites.length), 0, id);
  library.favorites = favorites;
}

export function removeFavorite(library: Library, id: string): void {
  library.favorites = library.favorites.filter((workspace) => workspace !== id);
}

// ── Placement and folders ────────────────────────────────────────────────

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isInteger(index)) return length;
  return Math.max(0, Math.min(index, length));
}

function folder(library: Library, id: unknown): Folder {
  const found = typeof id === "string" ? library.folders[id] : undefined;
  if (!found) throw new LibraryError("error.folder.gone");
  return found;
}

/**
 * Places a workspace at the top level (folderId null) or in a folder, at an
 * index in that list's manual order. Moving within the same list counts
 * the index after the workspace was taken out.
 */
export function moveWorkspace(library: Library, id: string, target: { folderId: string | null; index?: number }): void {
  liveWorkspace(library, id);
  const destination = target.folderId === null ? null : folder(library, target.folderId);
  unplace(library, id);
  if (destination) {
    destination.workspaces.splice(clampIndex(target.index, destination.workspaces.length), 0, id);
  } else {
    library.root.splice(clampIndex(target.index, library.root.length), 0, { kind: "workspace", id });
  }
}

/** Moves a folder within the top level. */
export function moveFolder(library: Library, id: string, index: number): void {
  folder(library, id);
  const root = library.root.filter((item) => !(item.kind === "folder" && item.id === id));
  root.splice(clampIndex(index, root.length), 0, { kind: "folder", id });
  library.root = root;
}

/** Creates a folder where the first workspace was, holding the given workspaces. Returns its id. */
export function createFolder(library: Library, name: unknown, workspaceIds: string[] = []): string {
  const id = randomUUID();
  const cleaned = cleanName(name, "folderName");
  const firstIndex = workspaceIds.length
    ? library.root.findIndex((item) => item.kind === "workspace" && item.id === workspaceIds[0])
    : -1;
  library.folders[id] = { id, name: cleaned, label: null, workspaces: [] };
  library.root.splice(firstIndex >= 0 ? firstIndex : library.root.length, 0, { kind: "folder", id });
  for (const workspaceId of workspaceIds) moveWorkspace(library, workspaceId, { folderId: id });
  return id;
}

export function renameFolder(library: Library, id: string, name: unknown): void {
  folder(library, id).name = cleanName(name, "folderName");
}

export function setFolderLabel(library: Library, id: string, label: unknown): void {
  folder(library, id).label = label === null ? null : cleanLabel(label);
}

/** Deletes a folder. Its workspaces return to the top level where the folder was; no data is touched. */
export function deleteFolder(library: Library, id: string): void {
  const removed = folder(library, id);
  const index = library.root.findIndex((item) => item.kind === "folder" && item.id === id);
  library.root.splice(index, 1, ...removed.workspaces.map((workspace): RootItem => ({ kind: "workspace", id: workspace })));
  delete library.folders[id];
}

// ── Preferences ──────────────────────────────────────────────────────────

export function setRail(library: Library, rail: { expanded?: unknown; width?: unknown }): void {
  if (typeof rail.expanded === "boolean") library.rail.expanded = rail.expanded;
  if (typeof rail.width === "number" && Number.isFinite(rail.width)) {
    library.rail.width = Math.round(Math.max(RAIL.minWidth, Math.min(RAIL.maxWidth, rail.width)));
  }
}

// ── Loading ──────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** The Steam id the built-in list once had for Diablo IV (it is "D4: Dark Dreams Don't Die"). */
const WRONG_DIABLO_ID = 358090;

/**
 * Turns whatever was saved into a consistent library: unknown or broken
 * entries are dropped, and every live workspace ends up placed exactly once.
 */
export function sanitizeLibrary(raw: unknown): Library {
  const library = emptyLibrary();
  if (typeof raw !== "object" || raw === null) return library;
  const saved = raw as Partial<Record<keyof Library, unknown>>;

  for (const value of Object.values(asRecord(saved.workspaces))) {
    const workspace = value as Partial<WorkspaceEntry>;
    if (!isWorkspaceId(workspace.id) || library.workspaces[workspace.id]) continue;
    const name = typeof workspace.name === "string" && workspace.name.trim() ? workspace.name.trim().slice(0, MAX_NAME) : null;
    if (!name || typeof workspace.addedAt !== "string" || !ISO.test(workspace.addedAt)) continue;
    // A game saved before Steam icons existed gets its Steam id from the built-in list, if it is there.
    // Diablo IV was saved with the Steam id of another game; it gets the right one and its icon is looked for again.
    // Only an id made on this PC can be a personal workspace, so a built-in game is never turned into one.
    if (workspace.kind === "personal" && workspace.id.startsWith("local-")) {
      library.workspaces[workspace.id] = {
        id: workspace.id,
        kind: "personal",
        catalogId: null,
        name,
        icon: sanitizeIcon(workspace.icon, name),
        useOriginalIcon: false,
        steamAppId: null,
        iconFile: null,
        iconCheckedAt: null,
        iconSharedAt: null,
        showNews: false,
        addedAt: workspace.addedAt,
        lastOpenedAt: typeof workspace.lastOpenedAt === "string" && ISO.test(workspace.lastOpenedAt) ? workspace.lastOpenedAt : null,
        trashedAt: typeof workspace.trashedAt === "string" && ISO.test(workspace.trashedAt) ? workspace.trashedAt : null,
      };
      continue;
    }
    const wrongDiabloId = workspace.steamAppId === WRONG_DIABLO_ID && (workspace.id === "diablo-4" || workspace.catalogId === "diablo-4");
    const steamAppId = wrongDiabloId ? (catalogGame("diablo-4")?.steamAppId ?? null) : isSteamAppId(workspace.steamAppId) ? workspace.steamAppId : (catalogGame(workspace.id)?.steamAppId ?? null);
    library.workspaces[workspace.id] = {
      id: workspace.id,
      kind: "game",
      catalogId: typeof workspace.catalogId === "string" && catalogGame(workspace.catalogId) ? workspace.catalogId : null,
      name,
      icon: sanitizeIcon(workspace.icon, name),
      useOriginalIcon: workspace.useOriginalIcon !== false,
      steamAppId,
      // The icon file is named after the Steam id or the game id, so a changed or forged name is dropped.
      iconFile: iconFileAllowed({ id: workspace.id, steamAppId }, workspace.iconFile) ? workspace.iconFile : null,
      iconCheckedAt: !wrongDiabloId && typeof workspace.iconCheckedAt === "string" && ISO.test(workspace.iconCheckedAt) ? workspace.iconCheckedAt : null,
      iconSharedAt: typeof workspace.iconSharedAt === "string" && ISO.test(workspace.iconSharedAt) ? workspace.iconSharedAt : null,
      showNews: workspace.showNews !== false,
      addedAt: workspace.addedAt,
      lastOpenedAt: typeof workspace.lastOpenedAt === "string" && ISO.test(workspace.lastOpenedAt) ? workspace.lastOpenedAt : null,
      trashedAt: typeof workspace.trashedAt === "string" && ISO.test(workspace.trashedAt) ? workspace.trashedAt : null,
    };
  }

  const placed = new Set<string>();
  const take = (id: unknown): id is string => {
    if (typeof id !== "string" || !isLive(library, id) || placed.has(id)) return false;
    placed.add(id);
    return true;
  };

  const savedFolders = asRecord(saved.folders);
  for (const item of Array.isArray(saved.root) ? saved.root : []) {
    const entry = item as Partial<RootItem>;
    if (entry?.kind === "workspace" && take(entry.id)) {
      library.root.push({ kind: "workspace", id: entry.id });
    } else if (entry?.kind === "folder" && typeof entry.id === "string" && !library.folders[entry.id]) {
      const value = savedFolders[entry.id] as Partial<Folder> | undefined;
      if (!value || typeof value.name !== "string" || !value.name.trim()) continue;
      library.folders[entry.id] = {
        id: entry.id,
        name: value.name.trim().slice(0, MAX_NAME),
        label: typeof value.label === "string" && value.label.trim() ? [...value.label.trim()].slice(0, MAX_LABEL).join("") : null,
        workspaces: (Array.isArray(value.workspaces) ? value.workspaces : []).filter(take),
      };
      library.root.push({ kind: "folder", id: entry.id });
    }
  }
  // Live workspaces the saved arrangement lost go to the end, oldest first.
  for (const workspace of liveWorkspaces(library).sort((a, b) => a.addedAt.localeCompare(b.addedAt))) {
    if (!placed.has(workspace.id)) library.root.push({ kind: "workspace", id: workspace.id });
  }

  const favorites = new Set<string>();
  for (const id of Array.isArray(saved.favorites) ? saved.favorites : []) {
    if (typeof id === "string" && isLive(library, id) && !favorites.has(id)) favorites.add(id);
  }
  library.favorites = [...favorites];
  if (saved.sort === "manual" || saved.sort === "recent") library.sort = saved.sort;
  if (saved.startup === "welcome" || saved.startup === "last-workspace") library.startup = saved.startup;
  if (GAME_START_CHOICES.includes(saved.gameStart as GameStart)) library.gameStart = saved.gameStart as GameStart;
  if (typeof saved.gameEndWorkspaceId === "string" && isLive(library, saved.gameEndWorkspaceId) && library.workspaces[saved.gameEndWorkspaceId]!.kind === "personal") {
    library.gameEndWorkspaceId = saved.gameEndWorkspaceId;
  }
  if (typeof saved.grayscaleText === "boolean") library.grayscaleText = saved.grayscaleText;
  if (typeof saved.onlineSearch === "boolean") library.onlineSearch = saved.onlineSearch;
  if (typeof saved.autoUpdate === "boolean") library.autoUpdate = saved.autoUpdate;
  if (typeof saved.autoUpdateModules === "boolean") library.autoUpdateModules = saved.autoUpdateModules;
  if (typeof saved.steamIcons === "boolean") library.steamIcons = saved.steamIcons;
  if (typeof saved.moduleIcons === "boolean") library.moduleIcons = saved.moduleIcons;
  if (typeof saved.streamOverlays === "boolean") library.streamOverlays = saved.streamOverlays;
  if (typeof saved.gameOverlays === "boolean") library.gameOverlays = saved.gameOverlays;
  if (typeof saved.overlaysStay === "boolean") library.overlaysStay = saved.overlaysStay;
  if (Number.isInteger(saved.overlayPort) && (saved.overlayPort as number) >= MIN_OVERLAY_PORT && (saved.overlayPort as number) <= MAX_OVERLAY_PORT) library.overlayPort = saved.overlayPort as number;
  if (typeof saved.moduleFilesFolder === "string" && saved.moduleFilesFolder.length <= 500 && path.isAbsolute(saved.moduleFilesFolder)) library.moduleFilesFolder = saved.moduleFilesFolder;
  if (Array.isArray(saved.developmentFolders)) library.developmentFolders = cleanDevelopmentFolders(saved.developmentFolders);
  const dialogFolders = asRecord(saved.dialogFolders);
  for (const place of DIALOG_PLACES) {
    const folder = dialogFolders[place];
    if (typeof folder === "string" && folder.length <= 500 && path.isAbsolute(folder)) library.dialogFolders[place] = folder;
  }
  for (const [key, folder] of Object.entries(asRecord(saved.moduleFolders)).slice(0, MAX_MODULE_FOLDERS)) {
    if (key.length <= 200 && /^[^:]+:[^:]+$/.test(key) && typeof folder === "string" && folder.length <= 500 && path.isAbsolute(folder)) library.moduleFolders[key] = folder;
  }
  for (const [key, version] of Object.entries(asRecord(saved.moduleNotesSeen)).slice(0, MAX_NOTES_SEEN)) {
    if (key.length <= 200 && /^[^:]+:[^:]+$/.test(key) && typeof version === "string" && version.length <= 64) library.moduleNotesSeen[key] = version;
  }
  if (isLanguageSetting(saved.language)) library.language = saved.language;
  if (typeof saved.steamProfile === "string" && saved.steamProfile.trim() && saved.steamProfile.length <= 200) library.steamProfile = saved.steamProfile.trim();
  if (Array.isArray(saved.iconsOffered)) {
    library.iconsOffered = [...new Set(saved.iconsOffered.filter((id): id is string => isGameId(id) && !id.startsWith("local-")))].slice(-MAX_ICONS_OFFERED);
  }
  const theme = asRecord(saved.theme);
  if (isModuleId(theme.id) && isVariationId(theme.variation)) library.theme = { id: theme.id, variation: theme.variation };
  if (typeof saved.followSystem === "boolean") library.followSystem = saved.followSystem;
  // A library saved before the welcome existed belongs to someone who is past it.
  library.onboarded = typeof saved.onboarded === "boolean" ? saved.onboarded : true;
  setRail(library, asRecord(saved.rail));
  const browser = asRecord(saved.browser);
  library.browser = { sharedSites: siteList(browser.sharedSites), adblockOff: siteList(browser.adblockOff) };
  if (typeof saved.lastWorkspaceId === "string" && isLive(library, saved.lastWorkspaceId)) library.lastWorkspaceId = saved.lastWorkspaceId;
  return library;
}

/** Most sites a Browser list keeps. */
export const MAX_SITES = 500;

function siteList(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).filter(isSite))].slice(0, MAX_SITES);
}

/** Adds a site to a Browser list (signed in for all workspaces, or ad blocking off) or removes it. */
export function setSiteListed(library: Library, list: "sharedSites" | "adblockOff", site: string, listed: boolean): void {
  const sites = library.browser[list].filter((item) => item !== site);
  if (listed) {
    if (sites.length >= MAX_SITES) throw new LibraryError("error.browser.sitesLimit", { max: MAX_SITES });
    sites.push(site);
  }
  library.browser[list] = sites;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const ICON_FILE = /^[a-z0-9-]{1,80}\.(png|jpg|webp)$/;

function sanitizeIcon(icon: unknown, name: string): WorkspaceIcon {
  const value = icon as Partial<{ kind: string; text: unknown; file: unknown }> | undefined;
  if (value?.kind === "image" && typeof value.file === "string" && ICON_FILE.test(value.file)) {
    return { kind: "image", file: value.file };
  }
  if (value?.kind === "monogram" && typeof value.text === "string") {
    const text = [...value.text.trim()].slice(0, MAX_LABEL).join("");
    if (text) return { kind: "monogram", text };
  }
  return { kind: "monogram", text: monogram(name) };
}

export function isIconFile(file: string): boolean {
  return ICON_FILE.test(file);
}
