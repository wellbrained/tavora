import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Finds the games installed on this PC by looking at what the launchers leave
 * behind: Windows' list of installed programs (Battle.net, EA, Ubisoft and most
 * others write their games there), Epic's manifests and GOG's registry keys.
 * Only a name and the path of a program or icon file are kept, to read the
 * game's own icon from, and the install folder when the launcher names it.
 * Nothing is run, changed or sent anywhere.
 */

export type LauncherSource = "battlenet" | "epic" | "gog" | "steam" | "windows";

export interface InstalledGame {
  source: LauncherSource;
  name: string;
  /** The Steam application id, for a game Steam installed. */
  steamAppId?: number;
  /** An absolute path to a program (`.exe`) or icon (`.ico`) file. */
  file: string;
  /** Which icon of the file, as in the registry's `DisplayIcon` (`file,2`). */
  index: number;
  /** The game's install folder, when the launcher names it; game-watch.ts looks for running programs inside it. */
  folder?: string;
}

/** Earlier sources win when two launchers know the same game. Battle.net comes first. */
const ORDER: LauncherSource[] = ["battlenet", "epic", "gog", "steam", "windows"];

export interface ScanOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** The output of `reg query <key> /s`, or null when the key does not exist. */
  queryRegistry?: (key: string) => Promise<string | null>;
  /** The files of a folder that end with `.item`, as text; empty when there is no such folder. */
  readManifests?: (dir: string) => Promise<string[]>;
  /** The Steam client's folder, to find the games Steam installed; null or left out looks at none. */
  steamDir?: string | null;
  /** The games Steam installed in a Steam folder. */
  readSteamGames?: (steamDir: string) => Promise<InstalledGame[]>;
}

// ── Names ────────────────────────────────────────────────────────────────

const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

/** A name reduced to what two spellings of one game share: "Diablo® IV" and "Diablo 4" are the same. */
export function normalizeName(name: string): string {
  const tokens = name
    // Steam writes "Battlefield™ 6"; NFKD would turn the sign into the letters "tm".
    .replace(/[™℠®©]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return tokens.map((token, i) => (i > 0 ? (ROMAN[token] ?? token) : token)).join("");
}

/**
 * The installed game that goes with a library game, preferring the launchers in `ORDER`.
 * A Steam game is found by its Steam id first, since the id never differs in spelling.
 */
export function matchInstalled(name: string, installed: readonly InstalledGame[], steamAppId: number | null = null): InstalledGame | null {
  const wanted = normalizeName(name);
  const byId = steamAppId === null ? [] : installed.filter((game) => game.steamAppId === steamAppId);
  const matches = byId.length ? byId : wanted ? installed.filter((game) => normalizeName(game.name) === wanted) : [];
  matches.sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source));
  return matches[0] ?? null;
}

// ── The registry ─────────────────────────────────────────────────────────

/** The blocks of `reg query /s`: each key with its values by name. */
export function parseRegistry(output: string): Record<string, string>[] {
  const blocks: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("HKEY_")) {
      current = {};
      blocks.push(current);
      continue;
    }
    const value = /^ {4}(\S.*?) {4}REG_\w+(?: {4}(.*))?$/.exec(line);
    if (current && value) current[value[1]!.toLowerCase()] = (value[2] ?? "").trim();
  }
  return blocks;
}

/** An absolute Windows folder from the registry or a manifest, or undefined when it is not one. */
function installFolder(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const folder = value.trim().replace(/^"|"$/g, "");
  if (!/^[A-Za-z]:\\/.test(folder) || /(^|\\)\.\.(\\|$)/.test(folder)) return undefined;
  return path.win32.normalize(folder).replace(/\\+$/, "");
}

/** A `DisplayIcon` value such as `"C:\Games\a.exe",0` or `C:\Games\a.exe,-101`, or null when it is not an icon file path. */
export function parseDisplayIcon(value: string | undefined): { file: string; index: number } | null {
  if (!value) return null;
  const match = /^\s*"?(.+?)"?\s*(?:,\s*(-?\d{1,6}))?\s*$/.exec(value);
  const file = match?.[1]?.replace(/^"|"$/g, "");
  if (!file || !/^[A-Za-z]:\\/.test(file) || !/\.(exe|ico)$/i.test(file) || file.includes("..")) return null;
  return { file: path.win32.normalize(file), index: match?.[2] ? Number(match[2]) : 0 };
}

const UNINSTALL = "\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

export function gamesFromUninstall(output: string): InstalledGame[] {
  const games: InstalledGame[] = [];
  for (const block of parseRegistry(output)) {
    const name = block.displayname;
    const icon = parseDisplayIcon(block.displayicon);
    if (!name || !icon) continue;
    const source: LauncherSource = /blizzard|activision/i.test(block.publisher ?? "") ? "battlenet" : "windows";
    const folder = installFolder(block.installlocation);
    games.push({ source, name, ...icon, ...(folder ? { folder } : {}) });
  }
  return games;
}

export function gamesFromGog(output: string): InstalledGame[] {
  const games: InstalledGame[] = [];
  for (const block of parseRegistry(output)) {
    const icon = parseDisplayIcon(block.exe);
    const folder = installFolder(block.path);
    if (block.gamename && icon) games.push({ source: "gog", name: block.gamename, ...icon, ...(folder ? { folder } : {}) });
  }
  return games;
}

export function gamesFromEpic(manifests: readonly string[]): InstalledGame[] {
  const games: InstalledGame[] = [];
  for (const text of manifests) {
    try {
      const item = JSON.parse(text) as Record<string, unknown>;
      const { DisplayName: name, InstallLocation: dir, LaunchExecutable: exe } = item;
      if (typeof name !== "string" || typeof dir !== "string" || typeof exe !== "string") continue;
      // The launch program lives inside the install folder.
      if (/(^|[\\/])\.\.([\\/]|$)/.test(exe) || /^([A-Za-z]:|[\\/])/.test(exe)) continue;
      const icon = parseDisplayIcon(path.win32.join(dir, exe));
      const folder = installFolder(dir);
      if (icon) games.push({ source: "epic", name, ...icon, ...(folder ? { folder } : {}) });
    } catch {
      // A manifest this app cannot read is skipped.
    }
  }
  return games;
}

// ── Reading this PC ──────────────────────────────────────────────────────

function queryWindowsRegistry(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", key, "/s"],
      { timeout: 15_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

async function readEpicManifests(dir: string): Promise<string[]> {
  try {
    const files = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith(".item")).slice(0, 2000);
    const texts = await Promise.all(files.map((name) => readFile(path.join(dir, name), "utf8").catch(() => "")));
    return texts.filter(Boolean);
  } catch {
    return [];
  }
}

// ── Steam ────────────────────────────────────────────────────────────────

/** The library folders `libraryfolders.vdf` lists (where games are installed besides Steam's own folder). */
export function parseLibraryFolders(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((match) => match[1]!.replace(/\\\\/g, "\\")).filter((dir) => path.win32.isAbsolute(dir));
}

/** What an `appmanifest_<id>.acf` says about an installed game, or null when it is not usable. */
export function parseAppManifest(acf: string): { appid: number; name: string; installdir: string } | null {
  const value = (key: string) => new RegExp(`"${key}"\\s+"([^"]*)"`, "i").exec(acf)?.[1];
  const appid = Number(value("appid"));
  const name = value("name");
  const installdir = value("installdir");
  // The install folder is one name inside "common", never a path.
  if (!Number.isInteger(appid) || appid <= 0 || !name || !installdir || /[\\/]|^\.+$/.test(installdir)) return null;
  return { appid, name, installdir };
}

/** Programs of an install folder that are not the game itself. */
export const NOT_THE_GAME = /(unins|setup|redist|crash|report|helper|install|anticheat|battleye|bootstrap|updater|launcher|config|vcredist|ffmpeg|start_protected)/i;

/** The game's own program among the files of its install folder: the largest `.exe` that is not an installer, a helper or a launcher. */
export function pickProgram(files: readonly { name: string; size: number }[]): string | null {
  const candidates = files.filter((file) => /\.exe$/i.test(file.name) && !NOT_THE_GAME.test(file.name));
  candidates.sort((a, b) => b.size - a.size);
  return candidates[0]?.name ?? null;
}

const MAX_MANIFESTS = 2000;
const MAX_MANIFEST_BYTES = 64 * 1024;

/** The games Steam has installed, with the program to read each one's icon from. Only files are read. */
export async function findSteamGames(steamDir: string): Promise<InstalledGame[]> {
  const libraries = [steamDir];
  try {
    const vdf = await readFile(path.join(steamDir, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const dir of parseLibraryFolders(vdf)) if (!libraries.includes(dir)) libraries.push(dir);
  } catch {
    // Steam's own folder is still looked at.
  }
  const games: InstalledGame[] = [];
  for (const library of libraries) {
    const apps = path.join(library, "steamapps");
    let manifests: string[];
    try {
      manifests = (await readdir(apps)).filter((file) => /^appmanifest_\d+\.acf$/i.test(file)).slice(0, MAX_MANIFESTS);
    } catch {
      continue;
    }
    for (const manifest of manifests) {
      try {
        const text = await readFile(path.join(apps, manifest), "utf8");
        const app = text.length <= MAX_MANIFEST_BYTES ? parseAppManifest(text) : null;
        if (!app) continue;
        const folder = path.join(apps, "common", app.installdir);
        const entries = await readdir(folder, { withFileTypes: true });
        const exes = entries.filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name)).slice(0, 200);
        const sizes = await Promise.all(exes.map(async (entry) => ({ name: entry.name, size: (await stat(path.join(folder, entry.name))).size })));
        const program = pickProgram(sizes);
        if (program) games.push({ source: "steam", name: app.name, file: path.join(folder, program), index: 0, steamAppId: app.appid, folder });
      } catch {
        // A game whose folder is gone or unreadable is skipped.
      }
    }
  }
  return games;
}

/** The games installed on this PC that a launcher knows about. Windows only; anything else finds none. */
export async function findInstalledGames(options: ScanOptions = {}): Promise<InstalledGame[]> {
  if ((options.platform ?? process.platform) !== "win32") return [];
  const env = options.env ?? process.env;
  const query = options.queryRegistry ?? queryWindowsRegistry;
  const manifests = options.readManifests ?? readEpicManifests;
  const programData = env.ProgramData ?? "C:\\ProgramData";

  const steamDir = options.steamDir ?? null;
  const steam = steamDir ? (options.readSteamGames ?? findSteamGames)(steamDir).catch(() => []) : Promise.resolve([]);
  const [machine, machine32, user, gog, epic, steamGames] = await Promise.all([
    query(`HKLM${UNINSTALL}`),
    query(`HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall`),
    query(`HKCU${UNINSTALL}`),
    query("HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games"),
    manifests(path.win32.join(programData, "Epic", "EpicGamesLauncher", "Data", "Manifests")),
    steam,
  ]);
  return [
    ...[machine, machine32, user].flatMap((output) => (output ? gamesFromUninstall(output) : [])),
    ...(gog ? gamesFromGog(gog) : []),
    ...gamesFromEpic(epic),
    ...steamGames,
  ];
}
