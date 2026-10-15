import { execFile } from "node:child_process";
import { access, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "./fsutil";

/**
 * A game's own Steam icon, the `.ico` file Steam itself uses for the game's
 * shortcuts. It comes from the Steam client on this PC when it has the file,
 * and otherwise from Steam's public icon address, which serves the very same
 * file. Tavora's service is never involved and Tavora never ships these: only
 * the player's own copy exists, kept unchanged in the player's data folder.
 */

export const STEAM_ICON_BASE = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

export const MAX_STEAM_ICON_BYTES = 1024 * 1024;
export const ICON_TIMEOUT_MS = 10_000;
/** A game Steam has no icon for is asked about again after this long. */
export const ICON_RETRY_DAYS = 7;

const HASH = /^[0-9a-f]{40}$/;

export function isSteamAppId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}

export function isIconHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

export function steamIconUrl(appid: number, hash: string, base: string = STEAM_ICON_BASE): string {
  return `${base.replace(/\/+$/, "")}/${appid}/${hash}.ico`;
}

/** The file name for a game's icon: only digits, so it can never point elsewhere. */
export function iconFileName(appid: number): string {
  return `${appid}.ico`;
}

export function isIconFileName(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,10}\.ico$/.test(value);
}

/** Recognises an ICO file by its header and its frame table, whatever it is called. */
export function isIco(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_STEAM_ICON_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) return false;
  const count = view.getUint16(4, true);
  if (count < 1 || count > 64 || 6 + count * 16 > bytes.byteLength) return false;
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const size = view.getUint32(entry + 8, true);
    const offset = view.getUint32(entry + 12, true);
    if (size === 0 || offset < 6 + count * 16 || offset + size > bytes.byteLength) return false;
  }
  return true;
}

// ── Finding Steam on this PC ─────────────────────────────────────────────

export interface SteamDirOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Whether a file exists. */
  exists?: (file: string) => Promise<boolean>;
  /** Steam's folder as the Windows registry has it, or null. */
  registry?: () => Promise<string | null>;
}

function windowsRegistryPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
      { timeout: 3000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(null);
        resolve(/SteamPath\s+REG_SZ\s+(.+?)\s*$/m.exec(stdout)?.[1] ?? null);
      },
    );
  });
}

/** The folder of the Steam client on this PC, or null when there is none. */
export async function findSteamDir(options: SteamDirOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const exists =
    options.exists ??
    (async (file: string) => {
      try {
        await access(file);
        return true;
      } catch {
        return false;
      }
    });

  const candidates: string[] = [];
  if (platform === "win32") {
    const fromRegistry = await (options.registry ?? windowsRegistryPath)();
    if (fromRegistry) candidates.push(fromRegistry);
    for (const base of [env["ProgramFiles(x86)"], env.ProgramFiles, "C:\\Program Files (x86)"]) {
      if (base) candidates.push(path.join(base, "Steam"));
    }
  } else if (platform === "linux") {
    candidates.push(
      path.join(home, ".steam", "steam"),
      path.join(home, ".local", "share", "Steam"),
      path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
    );
  } else if (platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "Steam"));
  }
  for (const candidate of candidates) {
    const dir = path.normalize(candidate);
    if (await exists(path.join(dir, "appcache", "appinfo.vdf"))) return dir;
  }
  return null;
}

const MAX_APPINFO_BYTES = 256 * 1024 * 1024;

/** Steam's cache of what it knows about apps, or null when it cannot be read. */
export async function loadAppInfo(steamDir: string): Promise<Uint8Array | null> {
  try {
    const file = path.join(steamDir, "appcache", "appinfo.vdf");
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_APPINFO_BYTES) return null;
    return new Uint8Array(await readFile(file));
  } catch {
    return null;
  }
}

// ── Saving one icon ──────────────────────────────────────────────────────

export type IconResult = { status: "saved"; file: string } | { status: "none" } | { status: "failed" };

export interface SaveIconOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/**
 * Saves a game's icon unchanged into `iconDir`. The icon file Steam keeps on
 * this PC is used when it is there; otherwise the same file is asked from
 * Steam's public icon address. `none` means there is no usable icon (ask again
 * much later); `failed` means the network or Steam did not answer (soon).
 */
export async function saveSteamIcon(
  iconDir: string,
  steamDir: string,
  appid: number,
  hash: string,
  options: SaveIconOptions = {},
): Promise<IconResult> {
  if (!isSteamAppId(appid) || !isIconHash(hash)) return { status: "none" };
  const file = iconFileName(appid);

  try {
    const local = path.join(steamDir, "steam", "games", `${hash}.ico`);
    const info = await stat(local);
    if (info.isFile() && info.size <= MAX_STEAM_ICON_BYTES) {
      const bytes = new Uint8Array(await readFile(local));
      if (isIco(bytes)) {
        await writeFileAtomic(path.join(iconDir, file), bytes);
        return { status: "saved", file };
      }
    }
  } catch {
    // Steam does not have this file on disk (yet): the public address has it.
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(steamIconUrl(appid, hash, options.baseUrl), {
      // No cookies, no referrer, nothing that says who is asking.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 403) return { status: "none" };
    if (!response.ok) return { status: "failed" };
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_STEAM_ICON_BYTES) return { status: "none" };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!isIco(bytes)) return { status: "none" };
    await writeFileAtomic(path.join(iconDir, file), bytes);
    return { status: "saved", file };
  } catch {
    return { status: "failed" };
  }
}

export async function removeSteamIcon(iconDir: string, file: string): Promise<void> {
  if (!isIconFileName(file)) return;
  await rm(path.join(iconDir, file), { force: true });
}

/** True when a game with a Steam id should be asked for its icon now. */
export function needsIcon(
  game: { steamAppId: number | null; iconFile: string | null; iconCheckedAt: string | null },
  now: Date,
): boolean {
  if (game.steamAppId === null || game.iconFile !== null) return false;
  if (game.iconCheckedAt === null) return true;
  const checked = Date.parse(game.iconCheckedAt);
  return !Number.isFinite(checked) || now.getTime() - checked > ICON_RETRY_DAYS * 24 * 60 * 60 * 1000;
}
