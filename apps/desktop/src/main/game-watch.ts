import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { GameEntry } from "./library";
import { NOT_THE_GAME, normalizeName, type InstalledGame } from "./launcher-games";

/**
 * Notices which games of the library are running, so Tavora can switch to one
 * when it starts (Settings > General, "When a game starts"). Two signs, both
 * read on this PC only and never sent anywhere:
 *  - Steam's own note of the game it runs (`RunningAppID` in the registry), matched by Steam id;
 *  - a running program inside the install folder of a game a launcher installed (launcher-games.ts).
 * A small PowerShell helper lists the programs every few seconds. It asks Windows only for each
 * program's path (the same limited access Task Manager uses) and reads nothing else. Windows only.
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

/** Of several entries for one game, the one played most recently (then the one added last). */
function mostRecent(entries: readonly GameEntry[]): GameEntry | undefined {
  return [...entries].sort((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? "") || b.addedAt.localeCompare(a.addedAt))[0];
}

/**
 * The ids of the library games running now. `programs` are the paths of running programs, `steamAppId` the game
 * Steam runs (0 or null for none). A game in the library twice counts once, as the entry played most recently;
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

// ── The helper ───────────────────────────────────────────────────────────

/** Seconds between two looks at the running programs. */
export const POLL_SECONDS = 3;

/**
 * The PowerShell helper. It prints what changed since its last look: `+<pid>\t<path>` for a new
 * program, `-<pid>` for one that ended, `s<id>` for the game Steam runs (0 for none), and `.` after
 * each look. It ends by itself when Tavora (`parent`) is gone.
 */
export function probeScript(parent: number): string {
  return String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TavoraProgramPath {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static string Of(int pid) {
    IntPtr process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) return null;
    try {
      var name = new StringBuilder(1024);
      uint size = 1024;
      return QueryFullProcessImageName(process, 0, name, ref size) ? name.ToString() : null;
    } finally { CloseHandle(process); }
  }
}
'@
$known = @{}
$steam = -1
while ($true) {
  try { [void][System.Diagnostics.Process]::GetProcessById(${parent}) } catch { exit }
  $now = @{}
  foreach ($process in [System.Diagnostics.Process]::GetProcesses()) {
    $id = $process.Id
    $process.Dispose()
    if ($known.ContainsKey($id)) { $now[$id] = $known[$id]; continue }
    $file = [TavoraProgramPath]::Of($id)
    if ($file) { $now[$id] = $file; [Console]::Out.WriteLine("+$id" + [char]9 + $file) }
  }
  foreach ($id in $known.Keys) { if (-not $now.ContainsKey($id)) { [Console]::Out.WriteLine("-$id") } }
  $known = $now
  $running = [Microsoft.Win32.Registry]::GetValue('HKEY_CURRENT_USER\Software\Valve\Steam', 'RunningAppID', 0)
  if ($null -eq $running) { $running = 0 }
  if ($running -ne $steam) { $steam = $running; [Console]::Out.WriteLine("s$steam") }
  [Console]::Out.WriteLine('.')
  [Console]::Out.Flush()
  Start-Sleep -Seconds ${POLL_SECONDS}
}
`;
}

/** What the helper reported so far. */
export interface ProbeState {
  programs: Map<number, string>;
  steamAppId: number | null;
}

/** Applies one line of the helper. Returns true at the end of a look, when the state is whole. */
export function applyProbeLine(state: ProbeState, line: string): boolean {
  if (line === ".") return true;
  if (line.startsWith("+")) {
    const tab = line.indexOf("\t");
    const pid = Number(line.slice(1, tab));
    const file = line.slice(tab + 1);
    if (tab > 1 && Number.isInteger(pid) && path.win32.isAbsolute(file)) state.programs.set(pid, file);
  } else if (line.startsWith("-")) {
    state.programs.delete(Number(line.slice(1)));
  } else if (line.startsWith("s")) {
    const id = Number(line.slice(1));
    state.steamAppId = Number.isInteger(id) && id > 0 ? id : null;
  }
  return false;
}

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
  /** Starts the helper; a test stands in for PowerShell. */
  spawnProbe?: (script: string) => ChildProcess;
  platform?: NodeJS.Platform;
  log?: (line: string) => void;
}

/** Looks for the installed games again this often, for games installed while Tavora runs. */
const INSTALLED_REFRESH_MS = 30 * 60 * 1000;
/** A helper that ended by itself is started again at most this many times. */
const MAX_RESTARTS = 3;

function spawnPowerShell(script: string): ChildProcess {
  return spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
}

export class GameWatcher {
  private child: ChildProcess | null = null;
  private state: ProbeState = { programs: new Map(), steamAppId: null };
  private installed: InstalledGame[] = [];
  private running = new Set<string>();
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private restarts = 0;
  private stopped = true;
  /** The installed games were looked for, and the helper finished a first look. */
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
    this.restarts = 0;
    this.installedKnown = false;
    this.looked = false;
    this.reported = false;
    void this.refreshInstalled();
    this.refreshTimer = setInterval(() => void this.refreshInstalled(), INSTALLED_REFRESH_MS);
    this.refreshTimer.unref?.();
    this.startProbe();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.refreshTimer);
    const child = this.child;
    this.child = null;
    child?.kill();
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

  private startProbe(): void {
    const child = (this.options.spawnProbe ?? spawnPowerShell)(probeScript(process.pid));
    this.child = child;
    let rest = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) {
        if (!applyProbeLine(this.state, line)) continue;
        this.looked = true;
        this.update();
      }
    });
    child.on("error", (error) => this.options.log?.(`the game watcher could not start: ${error.message}`));
    child.on("exit", () => {
      if (this.child !== child || this.stopped) return;
      this.child = null;
      // The next helper's first look starts over, so nothing counts as started or closed in between.
      this.state = { programs: new Map(), steamAppId: null };
      this.looked = false;
      this.reported = false;
      if (this.restarts++ < MAX_RESTARTS) setTimeout(() => !this.stopped && !this.child && this.startProbe(), 5000).unref?.();
      else this.options.log?.("the game watcher stopped");
    });
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
