import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Finds the games installed on this PC by looking at what the launchers leave
 * behind: Windows' list of installed programs (Battle.net, EA, Ubisoft and most
 * others write their games there), Epic's manifests and GOG's registry keys.
 * Only a name and the path of a program or icon file are kept, to read the
 * game's own icon from. Nothing is run, changed or sent anywhere.
 */

export type LauncherSource = "battlenet" | "epic" | "gog" | "windows";

export interface InstalledGame {
  source: LauncherSource;
  name: string;
  /** An absolute path to a program (`.exe`) or icon (`.ico`) file. */
  file: string;
  /** Which icon of the file, as in the registry's `DisplayIcon` (`file,2`). */
  index: number;
}

/** Earlier sources win when two launchers know the same game. Battle.net comes first. */
const ORDER: LauncherSource[] = ["battlenet", "epic", "gog", "windows"];

export interface ScanOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** The output of `reg query <key> /s`, or null when the key does not exist. */
  queryRegistry?: (key: string) => Promise<string | null>;
  /** The files of a folder that end with `.item`, as text; empty when there is no such folder. */
  readManifests?: (dir: string) => Promise<string[]>;
}

// ── Names ────────────────────────────────────────────────────────────────

const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

/** A name reduced to what two spellings of one game share: "Diablo® IV" and "Diablo 4" are the same. */
export function normalizeName(name: string): string {
  const tokens = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return tokens.map((token, i) => (i > 0 ? (ROMAN[token] ?? token) : token)).join("");
}

/** The installed game that goes with a library game's name, preferring the launchers in `ORDER`. */
export function matchInstalled(name: string, installed: readonly InstalledGame[]): InstalledGame | null {
  const wanted = normalizeName(name);
  if (!wanted) return null;
  const matches = installed.filter((game) => normalizeName(game.name) === wanted);
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
    games.push({ source, name, ...icon });
  }
  return games;
}

export function gamesFromGog(output: string): InstalledGame[] {
  const games: InstalledGame[] = [];
  for (const block of parseRegistry(output)) {
    const icon = parseDisplayIcon(block.exe);
    if (block.gamename && icon) games.push({ source: "gog", name: block.gamename, ...icon });
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
      if (icon) games.push({ source: "epic", name, ...icon });
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

/** The games installed on this PC that a launcher knows about. Windows only; anything else finds none. */
export async function findInstalledGames(options: ScanOptions = {}): Promise<InstalledGame[]> {
  if ((options.platform ?? process.platform) !== "win32") return [];
  const env = options.env ?? process.env;
  const query = options.queryRegistry ?? queryWindowsRegistry;
  const manifests = options.readManifests ?? readEpicManifests;
  const programData = env.ProgramData ?? "C:\\ProgramData";

  const [machine, machine32, user, gog, epic] = await Promise.all([
    query(`HKLM${UNINSTALL}`),
    query(`HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall`),
    query(`HKCU${UNINSTALL}`),
    query("HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games"),
    manifests(path.win32.join(programData, "Epic", "EpicGamesLauncher", "Data", "Manifests")),
  ]);
  return [
    ...[machine, machine32, user].flatMap((output) => (output ? gamesFromUninstall(output) : [])),
    ...(gog ? gamesFromGog(gog) : []),
    ...gamesFromEpic(epic),
  ];
}
