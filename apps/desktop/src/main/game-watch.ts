import path from "node:path";
import type { GameStart, UnlistedGame } from "../shared/host-api";
import type { WorkspaceEntry } from "./library";
import { catalogIdFor, pickGames, type Signs } from "./installed-list";
import { isSameGame, normalizeName, type GameIdentity } from "../shared/same-game";
import { NOT_THE_GAME, type InstalledGame } from "./launcher-games";
import { windowsProgramProbe, type ProgramLook, type ProgramProbe } from "./program-list";
import { workspaceGameIds } from "./workspace-game";

/**
 * Notices which games of the library are running, so Tavora can switch to one
 * when it starts (Settings > General, "When a game starts"), and which games
 * not in the library are, so the rail can offer to add them. Two signs, both
 * read on this PC only and never sent anywhere:
 *  - Steam's own note of the game it runs (`RunningAppID` in the registry), matched by Steam id;
 *  - a running program inside the install folder of a game a launcher installed (launcher-games.ts).
 * Tavora looks at the running programs every few seconds (program-list.ts). Windows only.
 */

/** Folder names that hold many games or a launcher, never one game's own folder. */
const SHARED_FOLDER = /^(program files( \(x86\))?|programdata|windows|users|games|steamlibrary|steamapps|common|battle\.net|steam|epic games|gog galaxy|gog games|ubisoft|ubisoft game launcher|ea games|ea desktop|electronic arts|origin|origin games|riot games|riot client|xboxgames)$/i;

/** A folder with the trailing separator, lowercased, to compare program paths against; null when it is too broad to stand for one game. */
export function gameFolderKey(folder: string): string | null {
  const normalized = path.win32.normalize(folder).replace(/\\+$/, "");
  const parts = normalized.split("\\").filter(Boolean);
  // A drive root holds everything.
  if (parts.length < 2 || !/^[A-Za-z]:$/.test(parts[0]!)) return null;
  if (SHARED_FOLDER.test(parts[parts.length - 1]!)) return null;
  return `${normalized.toLowerCase()}\\`;
}

/** The folder a game was installed in: the one its launcher names, else the folder of its program. */
function folderOf(game: InstalledGame): string {
  return game.folder ?? path.win32.dirname(game.file);
}

/** A game by what names it: an installed game, or one running that is not in the library (which knows its built-in game). */
type GameRef = { name: string; steamAppId?: number | null; catalogId?: string | null };

/** Each game as `isSameGame` (shared/same-game.ts) knows it, worked out once per game. */
const identities = new WeakMap<GameRef, GameIdentity>();

/** A game by Tavora's rule: its built-in game is its Tavora id (a copy installed as "GTA V" is the built-in "Grand Theft Auto V"). */
function identityOfRef(game: GameRef): GameIdentity {
  let identity = identities.get(game);
  if (!identity) {
    const id = game.catalogId !== undefined ? game.catalogId : catalogIdFor(game.name, game.steamAppId ?? undefined);
    identity = { id, steamAppId: game.steamAppId ?? null, name: game.name };
    identities.set(game, identity);
  }
  return identity;
}

/**
 * Whether a library entry is this game, by the rule add-workspace, Add a game and the Steam import use (same Tavora id;
 * else, when both have one, the Steam id; else the name). An entry made from a built-in game is that game, whatever its id.
 */
function entryIsGame(entry: WorkspaceEntry, game: GameRef): boolean {
  const identity = identityOfRef(game);
  return isSameGame(entry, identity) || (identity.id !== null && workspaceGameIds(entry).includes(identity.id));
}

/** The live game entries of the library: a game in Trash is not in it. */
function liveGames(entries: readonly WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.filter((entry) => entry.kind === "game" && entry.trashedAt === null);
}

/** Whether the library (not its Trash) holds this game. */
function inLibrary(entries: readonly WorkspaceEntry[], game: GameRef): boolean {
  return liveGames(entries).some((entry) => entryIsGame(entry, game));
}

/** No activity: `runningNotInLibrary` only wants the Add a game list's picking, not its order. */
const NO_SIGNS: Signs = { steamPlayed: new Map(), seen: {} };

/** `oneGameFolders` of each list of installed games, worked out once per look for the installed games. */
const folderLists = new WeakMap<readonly InstalledGame[], Map<string, InstalledGame[]>>();

/** The install folders that stand for one game each, with the installed games in them. A folder two games claim belongs to a launcher. */
function oneGameFolders(installed: readonly InstalledGame[]): Map<string, InstalledGame[]> {
  const known = folderLists.get(installed);
  if (known) return known;
  const folders = new Map<string, InstalledGame[]>();
  for (const game of installed) {
    const key = gameFolderKey(folderOf(game));
    if (key) folders.set(key, [...(folders.get(key) ?? []), game]);
  }
  for (const [key, games] of folders) if (new Set(games.map((game) => normalizeName(game.name))).size > 1) folders.delete(key);
  folderLists.set(installed, folders);
  return folders;
}

/** The install folders (from `oneGameFolders`) that a running program is in; helpers and installers don't count. */
function* foldersRunning<T>(folders: ReadonlyMap<string, T>, programs: Iterable<string>): Generator<T> {
  for (const program of programs) {
    if (NOT_THE_GAME.test(path.win32.basename(program))) continue;
    const lower = program.toLowerCase();
    for (const [key, value] of folders) if (lower.startsWith(key)) yield value;
  }
}

/** Of several entries for one game, the one opened most recently (then the one added last). */
function mostRecent(entries: readonly WorkspaceEntry[]): WorkspaceEntry | undefined {
  return [...entries].sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "") || b.addedAt.localeCompare(a.addedAt))[0];
}

/**
 * The ids of the library games running now. `programs` are the paths of running programs, `steamAppId` the game
 * Steam runs (0 or null for none). A game in the library twice counts once, as the entry opened most recently;
 * a game installed twice (two launchers) counts when either copy runs.
 */
export function runningGames(entries: readonly WorkspaceEntry[], installed: readonly InstalledGame[], programs: Iterable<string>, steamAppId: number | null): Set<string> {
  const games = liveGames(entries);
  const running = new Set<string>();
  const add = (matches: WorkspaceEntry[]) => {
    const pick = mostRecent(matches);
    if (pick) running.add(pick.id);
  };

  if (steamAppId) add(games.filter((entry) => entry.steamAppId === steamAppId));

  const folders = new Map<string, WorkspaceEntry[]>();
  for (const [key, inFolder] of oneGameFolders(installed)) {
    const matches = games.filter((entry) => inFolder.some((game) => entryIsGame(entry, game)));
    if (matches.length) folders.set(key, matches);
  }
  for (const matches of foldersRunning(folders, programs)) add(matches);
  return running;
}

/** The installed games running now, library or not: Steam's running game, or a running program inside a game's own install folder. */
function installedRunning(installed: readonly InstalledGame[], programs: Iterable<string>, steamAppId: number | null): Set<InstalledGame> {
  const running = new Set<InstalledGame>();
  if (steamAppId) for (const game of installed) if (game.steamAppId === steamAppId) running.add(game);
  for (const games of foldersRunning(oneGameFolders(installed), programs)) for (const game of games) running.add(game);
  return running;
}

/** The keys (installed-list.ts) of the installed games running now, library or not. Used to remember when each game was last seen. */
export function runningInstalled(installed: readonly InstalledGame[], programs: Iterable<string>, steamAppId: number | null, keyOf: (game: InstalledGame) => string): Set<string> {
  return new Set([...installedRunning(installed, programs, steamAppId)].map(keyOf));
}

/**
 * The games running now that are not in the library (one in Trash counts as not). Only sure signs count: Steam's
 * running game, named by what Steam installed (an app Steam runs but did not install is left out), or a program in the
 * install folder of a game a launcher installed. Steam installs software too (Wallpaper Engine runs all day), so a Steam
 * app counts only when `steamGames` (Steam's own note of each app's kind) says it is a game. Windows' list of installed
 * programs holds every program (Edge, Git), so an entry from it counts only when it is one of the built-in games. Each
 * game once, as the Add a game list has it.
 */
export function runningNotInLibrary(
  entries: readonly WorkspaceEntry[],
  installed: readonly InstalledGame[],
  programs: Iterable<string>,
  steamAppId: number | null,
  steamGames: ReadonlySet<number>,
): UnlistedGame[] {
  const running = [...installedRunning(installed, programs, steamAppId)].filter((game) => game.steamAppId === undefined || steamGames.has(game.steamAppId));
  return pickGames(running, NO_SIGNS)
    .map(({ name, steamAppId, catalogId }) => ({ name, steamAppId, catalogId }))
    .filter((game) => !inLibrary(entries, game));
}

/**
 * The game not in the library that the rail offers to add (HostViewState.unlistedGame): the one started last, while no
 * game of the library runs (`running`, that one wins) and "When a game starts" is on (off means off). A game added or
 * restored since the last look is left out, so the offer goes as soon as it is in.
 */
export function unlistedToOffer(unlisted: readonly UnlistedGame[], entries: readonly WorkspaceEntry[], running: readonly string[], gameStart: GameStart): UnlistedGame | null {
  if (gameStart === "off" || running.some((id) => entries.some((entry) => entry.id === id))) return null;
  return unlisted.filter((game) => !inLibrary(entries, game)).at(-1) ?? null;
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Seconds between two looks at the running programs. */
export const POLL_SECONDS = 3;

export interface GameWatcherOptions {
  /** The library's entries now; read at every look, so renames and new games count straight away. */
  entries: () => readonly WorkspaceEntry[];
  /** The games launchers installed on this PC. */
  findInstalled: () => Promise<InstalledGame[]>;
  /**
   * Whether each of these Steam apps is a game rather than software, for the ones whose kind Steam notes. Asked only for
   * apps not known yet, when the installed games are looked for. Left out, or when it fails, a Steam app whose kind isn't
   * known doesn't count for `onUnlisted`.
   */
  steamKinds?: (appIds: ReadonlySet<number>) => Promise<ReadonlyMap<number, boolean>>;
  /**
   * Called with the running games whenever they change. The first call, once the installed games and the
   * programs are known, is `initial`: games already running then were not just started.
   */
  onChange: (running: ReadonlySet<string>, initial: boolean) => void;
  /**
   * Called with the running games that are not in the library whenever they change, the one started last at the end.
   * The first call comes with the first `onChange`.
   */
  onUnlisted?: (games: readonly UnlistedGame[]) => void;
  /** Called at every look with the installed games running now (keys from `keyOf`), to remember when each was last seen. */
  onSeen?: (keys: ReadonlySet<string>) => void;
  /** Names an installed game for `onSeen`. */
  keyOf?: (game: InstalledGame) => string;
  /** Looks at the running programs; a test stands in for Windows. */
  probe?: ProgramProbe;
  /**
   * Tests only: Steam runs this game, nothing else runs, on any platform. Asked when the watch starts. A packaged app
   * never sets it (index.ts).
   */
  testSteamAppId?: () => number | undefined;
  platform?: NodeJS.Platform;
  log?: (line: string) => void;
}

/** Looks for the installed games again this often, for games installed while Tavora runs. */
const INSTALLED_REFRESH_MS = 30 * 60 * 1000;

export class GameWatcher {
  private probe: ProgramProbe | null = null;
  private state: ProgramLook = { programs: new Map(), steamAppId: null };
  private installed: InstalledGame[] = [];
  /** Whether each Steam app is a game (`steamKinds`); an app's kind doesn't change, so it is asked once. */
  private readonly steamKinds = new Map<number, boolean>();
  /** The installed Steam apps that are games, for the same look as `installed`. */
  private steamGames: ReadonlySet<number> = new Set();
  private running = new Set<string>();
  /** The running games not in the library, the one started last at the end. */
  private unlisted: UnlistedGame[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private lookTimer: ReturnType<typeof setInterval> | undefined;
  private stopped = true;
  /** The installed games were looked for, and the programs were looked at once. */
  private installedKnown = false;
  private looked = false;
  private reported = false;

  constructor(private readonly options: GameWatcherOptions) {}

  get active(): boolean {
    return !this.stopped;
  }

  start(): void {
    const testApp = this.options.testSteamAppId?.();
    if (!this.stopped || (testApp === undefined && (this.options.platform ?? process.platform) !== "win32")) return;
    this.stopped = false;
    this.installedKnown = false;
    this.looked = false;
    this.reported = false;
    void this.refreshInstalled();
    this.refreshTimer = setInterval(() => void this.refreshInstalled(), INSTALLED_REFRESH_MS);
    this.refreshTimer.unref?.();
    this.probe = testApp !== undefined ? () => ({ programs: new Map(), steamAppId: testApp }) : (this.options.probe ?? windowsProgramProbe());
    this.lookTimer = setInterval(() => this.look(), POLL_SECONDS * 1000);
    this.lookTimer.unref?.();
    this.look();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.refreshTimer);
    clearInterval(this.lookTimer);
    this.probe = null;
    this.state = { programs: new Map(), steamAppId: null };
    if (this.running.size) {
      this.running = new Set();
      this.options.onChange(this.running, false);
    }
    if (this.unlisted.length) {
      this.unlisted = [];
      this.options.onUnlisted?.(this.unlisted);
    }
  }

  /** Looks for the installed games again, e.g. after a game was added (`added`, see `update`). */
  async refreshInstalled(added?: string): Promise<void> {
    try {
      const installed = await this.options.findInstalled();
      this.steamGames = await this.findSteamGames(installed);
      this.installed = installed;
    } catch (error) {
      this.options.log?.(`finding installed games failed: ${String(error)}`);
    }
    this.installedKnown = true;
    this.update(added);
  }

  private async findSteamGames(installed: readonly InstalledGame[]): Promise<ReadonlySet<number>> {
    const appIds = new Set(installed.flatMap((game) => game.steamAppId ?? []));
    const unknown = new Set([...appIds].filter((id) => !this.steamKinds.has(id)));
    if (unknown.size && this.options.steamKinds) {
      try {
        for (const [id, game] of await this.options.steamKinds(unknown)) this.steamKinds.set(id, game);
      } catch (error) {
        this.options.log?.(`reading which Steam apps are games failed: ${String(error)}`);
      }
    }
    return new Set([...appIds].filter((id) => this.steamKinds.get(id) === true));
  }

  /**
   * After this game was added: if it runs already, it counts as running straight away, not as just started (nothing
   * switches or asks for it); other games that started or closed meanwhile count as usual. Then looks for the installed
   * games again, since the game may have been installed since the last look.
   */
  libraryChanged(addedId: string): Promise<void> {
    this.update(addedId);
    return this.refreshInstalled(addedId);
  }

  /** The library games running as of the last look. */
  get runningNow(): ReadonlySet<string> {
    return this.running;
  }

  /** The library games a program belongs to, by the install folders the watcher knows (the program in front, for game overlays). */
  gamesOf(program: string): Set<string> {
    return this.installedKnown ? runningGames(this.options.entries(), this.installed, [program], null) : new Set();
  }

  private look(): void {
    if (this.stopped || !this.probe) return;
    try {
      this.state = this.probe();
    } catch (error) {
      // Windows' functions could not be loaded; looking again won't help.
      clearInterval(this.lookTimer);
      this.probe = null;
      this.options.log?.(`the game watcher stopped: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.looked = true;
    this.update();
  }

  /** `added`: a game just added, which counts as already running rather than just started. */
  private update(added?: string): void {
    if (this.stopped || !this.installedKnown || !this.looked) return;
    if (this.options.onSeen && this.options.keyOf) {
      const seen = runningInstalled(this.installed, this.state.programs.values(), this.state.steamAppId, this.options.keyOf);
      if (seen.size) this.options.onSeen(seen);
    }
    this.updateUnlisted();
    const running = runningGames(this.options.entries(), this.installed, this.state.programs.values(), this.state.steamAppId);
    if (this.reported && sameIds(running, this.running)) return;
    const first = !this.reported;
    this.reported = true;
    // The game just added and running already comes first, as running all along; then the rest start and close as usual.
    if (!first && added !== undefined && running.has(added) && !this.running.has(added)) {
      this.running = new Set([...this.running, added]);
      this.options.onChange(this.running, true);
      if (sameIds(running, this.running)) return;
    }
    this.running = running;
    this.options.onChange(running, first);
  }

  private updateUnlisted(): void {
    if (!this.options.onUnlisted) return;
    const now = runningNotInLibrary(this.options.entries(), this.installed, this.state.programs.values(), this.state.steamAppId, this.steamGames);
    const key = (game: UnlistedGame) => normalizeName(game.name);
    const keys = new Set(now.map(key));
    const kept = this.unlisted.filter((game) => keys.has(key(game)));
    const started = now.filter((game) => !kept.some((old) => key(old) === key(game)));
    if (this.reported && !started.length && kept.length === this.unlisted.length) return;
    this.unlisted = [...kept, ...started];
    this.options.onUnlisted(this.unlisted);
  }
}
