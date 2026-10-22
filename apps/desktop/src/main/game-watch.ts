import path from "node:path";
import type { GameEntry } from "./library";
import { NOT_THE_GAME, normalizeName, type InstalledGame } from "./launcher-games";
import { windowsProgramProbe, type ProgramLook, type ProgramProbe } from "./program-list";

/**
 * Notices which games of the library are running, so Tavora can switch to one
 * when it starts (Settings > General, "When a game starts"). Two signs, both
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

/** Whether a library entry is this installed game: by Steam id when both have one, else by name. */
function isSameGame(entry: GameEntry, game: InstalledGame): boolean {
  if (entry.steamAppId !== null && game.steamAppId !== undefined) return entry.steamAppId === game.steamAppId;
  const name = normalizeName(entry.name);
  return name !== "" && name === normalizeName(game.name);
}

/** Of several entries for one game, the one opened most recently (then the one added last). */
function mostRecent(entries: readonly GameEntry[]): GameEntry | undefined {
  return [...entries].sort((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? "") || b.addedAt.localeCompare(a.addedAt))[0];
}

/**
 * The ids of the library games running now. `programs` are the paths of running programs, `steamAppId` the game
 * Steam runs (0 or null for none). A game in the library twice counts once, as the entry opened most recently;
 * a game installed twice (two launchers) counts when either copy runs.
 */
export function runningGames(entries: readonly GameEntry[], installed: readonly InstalledGame[], programs: Iterable<string>, steamAppId: number | null): Set<string> {
  const games = entries.filter((entry) => entry.kind === "game" && entry.trashedAt === null);
  const running = new Set<string>();
  const add = (matches: GameEntry[]) => {
    const pick = mostRecent(matches);
    if (pick) running.add(pick.id);
  };

  if (steamAppId) add(games.filter((entry) => entry.steamAppId === steamAppId));

  // A folder that two different games claim belongs to a launcher, not to a game.
  const claims = new Map<string, Set<string>>();
  for (const game of installed) {
    const key = gameFolderKey(folderOf(game));
    if (key) claims.set(key, (claims.get(key) ?? new Set()).add(normalizeName(game.name)));
  }
  const folders = new Map<string, GameEntry[]>();
  for (const game of installed) {
    const key = gameFolderKey(folderOf(game));
    if (!key || claims.get(key)!.size > 1) continue;
    const matches = games.filter((entry) => isSameGame(entry, game));
    if (matches.length) folders.set(key, [...(folders.get(key) ?? []), ...matches]);
  }
  if (!folders.size) return running;

  for (const program of programs) {
    if (NOT_THE_GAME.test(path.win32.basename(program))) continue;
    const lower = program.toLowerCase();
    for (const [key, matches] of folders) {
      if (lower.startsWith(key)) add(matches);
    }
  }
  return running;
}

/** Seconds between two looks at the running programs. */
export const POLL_SECONDS = 3;

export interface GameWatcherOptions {
  /** The library's entries now; read at every look, so renames and new games count straight away. */
  entries: () => readonly GameEntry[];
  /** The games launchers installed on this PC. */
  findInstalled: () => Promise<InstalledGame[]>;
  /**
   * Called with the running games whenever they change. The first call, once the installed games and the
   * programs are known, is `initial`: games already running then were not just started.
   */
  onChange: (running: ReadonlySet<string>, initial: boolean) => void;
  /** Looks at the running programs; a test stands in for Windows. */
  probe?: ProgramProbe;
  platform?: NodeJS.Platform;
  log?: (line: string) => void;
}

/** Looks for the installed games again this often, for games installed while Tavora runs. */
const INSTALLED_REFRESH_MS = 30 * 60 * 1000;

export class GameWatcher {
  private probe: ProgramProbe | null = null;
  private state: ProgramLook = { programs: new Map(), steamAppId: null };
  private installed: InstalledGame[] = [];
  private running = new Set<string>();
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
    if (!this.stopped || (this.options.platform ?? process.platform) !== "win32") return;
    this.stopped = false;
    this.installedKnown = false;
    this.looked = false;
    this.reported = false;
    void this.refreshInstalled();
    this.refreshTimer = setInterval(() => void this.refreshInstalled(), INSTALLED_REFRESH_MS);
    this.refreshTimer.unref?.();
    this.probe = this.options.probe ?? windowsProgramProbe();
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
  }

  /** Looks for the installed games again, e.g. after a game was added. */
  async refreshInstalled(): Promise<void> {
    try {
      this.installed = await this.options.findInstalled();
    } catch (error) {
      this.options.log?.(`finding installed games failed: ${String(error)}`);
    }
    this.installedKnown = true;
    this.update();
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

  private update(): void {
    if (this.stopped || !this.installedKnown || !this.looked) return;
    const running = runningGames(this.options.entries(), this.installed, this.state.programs.values(), this.state.steamAppId);
    const initial = !this.reported;
    if (!initial && running.size === this.running.size && [...running].every((id) => this.running.has(id))) return;
    this.reported = true;
    this.running = running;
    this.options.onChange(running, initial);
  }
}
