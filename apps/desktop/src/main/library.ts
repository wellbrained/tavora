import { randomUUID } from "node:crypto";
import { isGameId, isModuleId } from "@tavora/module-schema";
import type { RootItem, RootSort, Startup } from "../shared/host-api";
import { isSite } from "./browser-url";
import { isLanguageSetting, type LanguageSetting } from "../shared/i18n";
import { PlayerError } from "./messages";
import { CATALOG, catalogGame } from "./catalog";
import { iconFileAllowed, isSteamAppId, needsIcon } from "./steam-icons";
import { DEFAULT_THEME, isVariationId } from "./themes";

export type { RootItem, RootSort, Startup };

/**
 * The player's game library: which games exist, how the rail arranges them
 * and the few app preferences that go with it. Pure data and pure
 * operations; the host persists it and acts on what the operations return.
 */

export type GameIcon = { kind: "monogram"; text: string } | { kind: "image"; file: string };

export interface GameEntry {
  /** Stable id. Keys the game's workspace and module data, so it never changes. */
  id: string;
  /** Set when the game was picked from the built-in list. */
  catalogId: string | null;
  /** Display name. Renaming never changes the id. */
  name: string;
  icon: GameIcon;
  /**
   * Whether the game shows its own icon (the one found on this PC or from Steam) while it has one. False means
   * the player chose their own letters. A picked image wins over both, so this only matters without one.
   */
  useOriginalIcon: boolean;
  /** The game's Steam application id, a hidden key used to find its icon; null when it has none. */
  steamAppId: number | null;
  /** The game's own icon in the player's data folder, kept unchanged (from the installed game or from Steam); null until found. */
  iconFile: string | null;
  /** When no icon was found for this game, so it is not looked up again for a while. */
  iconCheckedAt: string | null;
  /** When the player offered the game's icon to the Tavora service, so it is not offered again. */
  iconSharedAt: string | null;
  showNews: boolean;
  addedAt: string;
  lastPlayedAt: string | null;
  /** Set while the game is in Trash. */
  trashedAt: string | null;
}

export interface Folder {
  id: string;
  name: string;
  /** Up to three characters shown instead of the icon collage. */
  label: string | null;
  /** Game ids in manual order. */
  games: string[];
}

export interface Library {
  version: 1;
  games: Record<string, GameEntry>;
  folders: Record<string, Folder>;
  /** Top level of the rail in manual order. Every game not in Trash is here or in exactly one folder. */
  root: RootItem[];
  /** Shortcuts at the top of the rail, in manual order. The game keeps its own place too. */
  favorites: string[];
  sort: RootSort;
  rail: { expanded: boolean; width: number };
  startup: Startup;
  /** Grayscale instead of ClearType text, for OLED screens. Read before the app is ready. */
  grayscaleText: boolean;
  /** Search may ask the Tavora service online. Off means the built-in games only. */
  onlineSearch: boolean;
  /** New versions of Tavora download by themselves. Off means the player starts the download. */
  autoUpdate: boolean;
  /** Game icons may be taken from Steam on this PC. Off means the generated badge. */
  steamIcons: boolean;
  /** The panel tabs show an icon before the module name. */
  moduleIcons: boolean;
  /** The Steam profile link or id the player chose to remember for the Steam import, or null. Kept only on this PC. */
  steamProfile: string | null;
  /** The language of Tavora's texts: one of them, or the system's. */
  language: LanguageSetting;
  /** The picked theme and variation. Kept even while that theme is not installed, which shows the default. */
  theme: { id: string; variation: string };
  /** Show the variation that matches the system's light or dark setting, and change with it. */
  followSystem: boolean;
  /** False until the first-run welcome was finished or skipped. */
  onboarded: boolean;
  /** Browser panel sites: signed in for all games instead of per game, and ad blocking turned off. */
  browser: { sharedSites: string[]; adblockOff: string[] };
  lastGameId: string | null;
}

export const RAIL = { compact: 72, minWidth: 180, maxWidth: 420, defaultWidth: 256 } as const;
export const TRASH_DAYS = 30;
export const MAX_NAME = 80;
export const MAX_LABEL = 3;

/** A problem the player caused and should read, e.g. a duplicate game. */
export class LibraryError extends PlayerError {}

export function emptyLibrary(): Library {
  return {
    version: 1,
    games: {},
    folders: {},
    root: [],
    favorites: [],
    sort: "recent",
    rail: { expanded: false, width: RAIL.defaultWidth },
    startup: "last-game",
    grayscaleText: false,
    onlineSearch: true,
    autoUpdate: true,
    steamIcons: true,
    moduleIcons: true,
    steamProfile: null,
    language: "system",
    theme: { ...DEFAULT_THEME },
    followSystem: true,
    onboarded: false,
    browser: { sharedSites: [], adblockOff: [] },
    lastGameId: null,
  };
}

// ── Reading ──────────────────────────────────────────────────────────────

export function liveGames(library: Library): GameEntry[] {
  return Object.values(library.games).filter((game) => game.trashedAt === null);
}

export function trashedGames(library: Library): GameEntry[] {
  return Object.values(library.games)
    .filter((game) => game.trashedAt !== null)
    .sort((a, b) => b.trashedAt!.localeCompare(a.trashedAt!));
}

export function isLive(library: Library, id: string): boolean {
  return library.games[id]?.trashedAt === null;
}

/** When a trashed game is deleted for good. */
export function purgeDate(game: GameEntry): Date {
  return new Date(Date.parse(game.trashedAt!) + TRASH_DAYS * 24 * 60 * 60 * 1000);
}

function playedAt(game: GameEntry | undefined): string {
  return game?.lastPlayedAt ?? "";
}

/** The rail's top level in display order. Folders sort by their most recently played game. */
export function sortedRoot(library: Library): RootItem[] {
  if (library.sort === "manual") return [...library.root];
  const recency = (item: RootItem): string =>
    item.kind === "game"
      ? playedAt(library.games[item.id])
      : library.folders[item.id]!.games.map((id) => playedAt(library.games[id])).sort().at(-1) ?? "";
  // Stable sort: equally recent items keep their manual order.
  return [...library.root].sort((a, b) => recency(b).localeCompare(recency(a)));
}

/** Most recently played games first, then the rest by when they were added. */
export function recentGames(library: Library, limit: number): GameEntry[] {
  return liveGames(library)
    .sort((a, b) => playedAt(b).localeCompare(playedAt(a)) || b.addedAt.localeCompare(a.addedAt))
    .slice(0, limit);
}

/** Built-in games matching a search, leaving out ones already in the library (Trash included). */
export function searchCatalog(library: Library, query: string, limit = 8) {
  const q = normalize(query);
  const available = CATALOG.filter((game) => !library.games[game.id]);
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

// ── Games ────────────────────────────────────────────────────────────────

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

/** A path-safe id for a custom game, never colliding with built-in ids. */
function customGameId(library: Library, name: string): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "game";
  const base = `local-${slug}`;
  let id = base;
  for (let n = 2; library.games[id]; n++) id = `${base}-${n}`;
  return id;
}

export type NewGame =
  | { catalogId: string }
  | { name: string; steamAppId?: number | null }
  | { online: { id: string; name: string; steamAppId?: number | null } };

function checkNotInLibrary(library: Library, id: string): void {
  const existing = library.games[id];
  if (existing) {
    throw new LibraryError(existing.trashedAt ? "error.game.inTrash" : "error.game.owned", { name: existing.name });
  }
}

/** Adds a game at the end of the rail with an empty workspace. Returns its id. */
export function addGame(library: Library, input: NewGame, now: Date): string {
  let id: string;
  let name: string;
  let catalogId: string | null = null;
  let steamAppId: number | null = null;
  if ("catalogId" in input) {
    const known = catalogGame(input.catalogId);
    if (!known) throw new LibraryError("error.game.notBuiltIn");
    checkNotInLibrary(library, known.id);
    ({ id, name } = known);
    catalogId = known.id;
    steamAppId = known.steamAppId ?? null;
  } else if ("online" in input) {
    // The service issues canonical ids; a built-in game found online is still that built-in game.
    // `local-` ids belong to games the player added by name.
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
    id = customGameId(library, name);
    // A Steam import knows the game's appid even when the service has no id for it.
    steamAppId = isSteamAppId(input.steamAppId) ? input.steamAppId : null;
  }
  if (!isGameId(id)) throw new LibraryError("error.game.badName");
  library.games[id] = {
    id,
    catalogId,
    name,
    icon: { kind: "monogram", text: monogram(name) },
    useOriginalIcon: true,
    steamAppId,
    iconFile: null,
    iconCheckedAt: null,
    iconSharedAt: null,
    showNews: true,
    addedAt: now.toISOString(),
    lastPlayedAt: null,
    trashedAt: null,
  };
  library.root.push({ kind: "game", id });
  return id;
}

/** Live games that have no icon yet and are due to be looked up. */
export function gamesNeedingIcon(library: Library, now: Date): GameEntry[] {
  return liveGames(library).filter((game) => needsIcon(game, now));
}

/** Records the outcome of looking for a game's icon: the saved file, or that none was found. */
export function recordIcon(library: Library, id: string, outcome: { file: string } | { none: Date }): void {
  const game = library.games[id];
  if (!game) return;
  if ("file" in outcome) {
    if (!iconFileAllowed(game, outcome.file)) return;
    game.iconFile = outcome.file;
    game.iconCheckedAt = null;
  } else {
    game.iconFile = null;
    game.iconCheckedAt = outcome.none.toISOString();
  }
}

/** Notes that the player offered this game's icon to the Tavora service. */
export function markIconShared(library: Library, id: string, now: Date): void {
  const game = library.games[id];
  if (game) game.iconSharedAt = now.toISOString();
}

/** True when another game in the library uses this icon file. */
export function iconFileShared(library: Library, file: string, exceptId: string): boolean {
  return Object.values(library.games).some((game) => game.id !== exceptId && game.iconFile === file);
}

function liveGame(library: Library, id: unknown): GameEntry {
  const game = typeof id === "string" ? library.games[id] : undefined;
  if (!game || game.trashedAt !== null) throw new LibraryError("error.gameGone");
  return game;
}

export function renameGame(library: Library, id: string, name: unknown): void {
  liveGame(library, id).name = cleanName(name);
}

/**
 * Chooses letters for the icon (null: the ones derived from the name). The game stops showing its own icon,
 * which is what the player asked for by choosing letters. Returns the previous icon so a picked image's file can go.
 */
export function setGameLabel(library: Library, id: string, label: unknown): GameIcon | null {
  const game = liveGame(library, id);
  const previous = game.icon;
  game.icon = { kind: "monogram", text: label === null ? monogram(game.name) : cleanLabel(label) };
  game.useOriginalIcon = false;
  return previous;
}

/** Goes back to the game's own icon (the badge when none was found); a picked image or letters are dropped. */
export function useOriginalGameIcon(library: Library, id: string): GameIcon {
  const game = liveGame(library, id);
  const previous = game.icon;
  game.icon = { kind: "monogram", text: monogram(game.name) };
  game.useOriginalIcon = true;
  return previous;
}

/** Sets an uploaded image. Returns the previous icon so its file can be removed. */
export function setGameImage(library: Library, id: string, file: string): GameIcon {
  const game = liveGame(library, id);
  const previous = game.icon;
  game.icon = { kind: "image", file };
  return previous;
}

export function setShowNews(library: Library, id: string, show: boolean): void {
  liveGame(library, id).showNews = show;
}

export function markPlayed(library: Library, id: string, now: Date): void {
  liveGame(library, id).lastPlayedAt = now.toISOString();
  library.lastGameId = id;
}

/** Takes a game out of the top level or its folder. Favorites are separate shortcuts and stay. */
function unplace(library: Library, id: string): void {
  library.root = library.root.filter((item) => !(item.kind === "game" && item.id === id));
  for (const folder of Object.values(library.folders)) folder.games = folder.games.filter((game) => game !== id);
}

/** Moves a game and its data to Trash. Its data stays on disk until it is purged. */
export function trashGame(library: Library, id: string, now: Date): void {
  const game = liveGame(library, id);
  unplace(library, id);
  removeFavorite(library, id);
  game.trashedAt = now.toISOString();
  if (library.lastGameId === id) library.lastGameId = null;
}

export function restoreGame(library: Library, id: string): void {
  const game = library.games[id];
  if (!game || game.trashedAt === null) throw new LibraryError("error.game.notInTrash");
  game.trashedAt = null;
  library.root.push({ kind: "game", id });
}

/** Forgets a trashed game. The caller deletes its data. */
export function deleteTrashedGame(library: Library, id: string): GameEntry {
  const game = library.games[id];
  if (!game || game.trashedAt === null) throw new LibraryError("error.game.notInTrash");
  delete library.games[id];
  return game;
}

/** Forgets every game that has been in Trash for 30 days. Returns them so their data can be deleted. */
export function purgeExpired(library: Library, now: Date): GameEntry[] {
  return trashedGames(library)
    .filter((game) => purgeDate(game) <= now)
    .map((game) => deleteTrashedGame(library, game.id));
}

// ── Favorites ────────────────────────────────────────────────────────────

/** Adds or moves a favorite to a position (end when omitted). */
export function placeFavorite(library: Library, id: string, index?: number): void {
  liveGame(library, id);
  const favorites = library.favorites.filter((game) => game !== id);
  favorites.splice(clampIndex(index, favorites.length), 0, id);
  library.favorites = favorites;
}

export function removeFavorite(library: Library, id: string): void {
  library.favorites = library.favorites.filter((game) => game !== id);
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
 * Places a game at the top level (folderId null) or in a folder, at an
 * index in that list's manual order. Moving within the same list counts
 * the index after the game was taken out.
 */
export function moveGame(library: Library, id: string, target: { folderId: string | null; index?: number }): void {
  liveGame(library, id);
  const destination = target.folderId === null ? null : folder(library, target.folderId);
  unplace(library, id);
  if (destination) {
    destination.games.splice(clampIndex(target.index, destination.games.length), 0, id);
  } else {
    library.root.splice(clampIndex(target.index, library.root.length), 0, { kind: "game", id });
  }
}

/** Moves a folder within the top level. */
export function moveFolder(library: Library, id: string, index: number): void {
  folder(library, id);
  const root = library.root.filter((item) => !(item.kind === "folder" && item.id === id));
  root.splice(clampIndex(index, root.length), 0, { kind: "folder", id });
  library.root = root;
}

/** Creates a folder where the first game was, holding the given games. Returns its id. */
export function createFolder(library: Library, name: unknown, gameIds: string[] = []): string {
  const id = randomUUID();
  const cleaned = cleanName(name, "folderName");
  const firstIndex = gameIds.length
    ? library.root.findIndex((item) => item.kind === "game" && item.id === gameIds[0])
    : -1;
  library.folders[id] = { id, name: cleaned, label: null, games: [] };
  library.root.splice(firstIndex >= 0 ? firstIndex : library.root.length, 0, { kind: "folder", id });
  for (const gameId of gameIds) moveGame(library, gameId, { folderId: id });
  return id;
}

export function renameFolder(library: Library, id: string, name: unknown): void {
  folder(library, id).name = cleanName(name, "folderName");
}

export function setFolderLabel(library: Library, id: string, label: unknown): void {
  folder(library, id).label = label === null ? null : cleanLabel(label);
}

/** Deletes a folder. Its games return to the top level where the folder was; no data is touched. */
export function deleteFolder(library: Library, id: string): void {
  const removed = folder(library, id);
  const index = library.root.findIndex((item) => item.kind === "folder" && item.id === id);
  library.root.splice(index, 1, ...removed.games.map((game): RootItem => ({ kind: "game", id: game })));
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
 * entries are dropped, and every live game ends up placed exactly once.
 */
export function sanitizeLibrary(raw: unknown): Library {
  const library = emptyLibrary();
  if (typeof raw !== "object" || raw === null) return library;
  const saved = raw as Partial<Record<keyof Library, unknown>>;

  for (const value of Object.values(asRecord(saved.games))) {
    const game = value as Partial<GameEntry>;
    if (!isGameId(game.id) || library.games[game.id]) continue;
    const name = typeof game.name === "string" && game.name.trim() ? game.name.trim().slice(0, MAX_NAME) : null;
    if (!name || typeof game.addedAt !== "string" || !ISO.test(game.addedAt)) continue;
    // A game saved before Steam icons existed gets its Steam id from the built-in list, if it is there.
    // Diablo IV was saved with the Steam id of another game; it gets the right one and its icon is looked for again.
    const wrongDiabloId = game.steamAppId === WRONG_DIABLO_ID && (game.id === "diablo-4" || game.catalogId === "diablo-4");
    const steamAppId = wrongDiabloId ? (catalogGame("diablo-4")?.steamAppId ?? null) : isSteamAppId(game.steamAppId) ? game.steamAppId : (catalogGame(game.id)?.steamAppId ?? null);
    library.games[game.id] = {
      id: game.id,
      catalogId: typeof game.catalogId === "string" && catalogGame(game.catalogId) ? game.catalogId : null,
      name,
      icon: sanitizeIcon(game.icon, name),
      useOriginalIcon: game.useOriginalIcon !== false,
      steamAppId,
      // The icon file is named after the Steam id or the game id, so a changed or forged name is dropped.
      iconFile: iconFileAllowed({ id: game.id, steamAppId }, game.iconFile) ? game.iconFile : null,
      iconCheckedAt: !wrongDiabloId && typeof game.iconCheckedAt === "string" && ISO.test(game.iconCheckedAt) ? game.iconCheckedAt : null,
      iconSharedAt: typeof game.iconSharedAt === "string" && ISO.test(game.iconSharedAt) ? game.iconSharedAt : null,
      showNews: game.showNews !== false,
      addedAt: game.addedAt,
      lastPlayedAt: typeof game.lastPlayedAt === "string" && ISO.test(game.lastPlayedAt) ? game.lastPlayedAt : null,
      trashedAt: typeof game.trashedAt === "string" && ISO.test(game.trashedAt) ? game.trashedAt : null,
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
    if (entry?.kind === "game" && take(entry.id)) {
      library.root.push({ kind: "game", id: entry.id });
    } else if (entry?.kind === "folder" && typeof entry.id === "string" && !library.folders[entry.id]) {
      const value = savedFolders[entry.id] as Partial<Folder> | undefined;
      if (!value || typeof value.name !== "string" || !value.name.trim()) continue;
      library.folders[entry.id] = {
        id: entry.id,
        name: value.name.trim().slice(0, MAX_NAME),
        label: typeof value.label === "string" && value.label.trim() ? [...value.label.trim()].slice(0, MAX_LABEL).join("") : null,
        games: (Array.isArray(value.games) ? value.games : []).filter(take),
      };
      library.root.push({ kind: "folder", id: entry.id });
    }
  }
  // Live games the saved arrangement lost go to the end, oldest first.
  for (const game of liveGames(library).sort((a, b) => a.addedAt.localeCompare(b.addedAt))) {
    if (!placed.has(game.id)) library.root.push({ kind: "game", id: game.id });
  }

  const favorites = new Set<string>();
  for (const id of Array.isArray(saved.favorites) ? saved.favorites : []) {
    if (typeof id === "string" && isLive(library, id) && !favorites.has(id)) favorites.add(id);
  }
  library.favorites = [...favorites];
  if (saved.sort === "manual" || saved.sort === "recent") library.sort = saved.sort;
  if (saved.startup === "welcome" || saved.startup === "last-game") library.startup = saved.startup;
  if (typeof saved.grayscaleText === "boolean") library.grayscaleText = saved.grayscaleText;
  if (typeof saved.onlineSearch === "boolean") library.onlineSearch = saved.onlineSearch;
  if (typeof saved.autoUpdate === "boolean") library.autoUpdate = saved.autoUpdate;
  if (typeof saved.steamIcons === "boolean") library.steamIcons = saved.steamIcons;
  if (typeof saved.moduleIcons === "boolean") library.moduleIcons = saved.moduleIcons;
  if (isLanguageSetting(saved.language)) library.language = saved.language;
  if (typeof saved.steamProfile === "string" && saved.steamProfile.trim() && saved.steamProfile.length <= 200) library.steamProfile = saved.steamProfile.trim();
  const theme = asRecord(saved.theme);
  if (isModuleId(theme.id) && isVariationId(theme.variation)) library.theme = { id: theme.id, variation: theme.variation };
  if (typeof saved.followSystem === "boolean") library.followSystem = saved.followSystem;
  // A library saved before the welcome existed belongs to someone who is past it.
  library.onboarded = typeof saved.onboarded === "boolean" ? saved.onboarded : true;
  setRail(library, asRecord(saved.rail));
  const browser = asRecord(saved.browser);
  library.browser = { sharedSites: siteList(browser.sharedSites), adblockOff: siteList(browser.adblockOff) };
  if (typeof saved.lastGameId === "string" && isLive(library, saved.lastGameId)) library.lastGameId = saved.lastGameId;
  return library;
}

/** Most sites a Browser list keeps. */
export const MAX_SITES = 500;

function siteList(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).filter(isSite))].slice(0, MAX_SITES);
}

/** Adds a site to a Browser list (signed in for all games, or ad blocking off) or removes it. */
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

function sanitizeIcon(icon: unknown, name: string): GameIcon {
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
