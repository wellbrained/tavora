import { readFile, rm } from "node:fs/promises";
import { isGameId } from "@tavora/module-schema";
import { isSnowflake } from "./discord-parse";
import { writeFileAtomic } from "./fsutil";

// The Discord sign-in (token), kept in discord.json in the user data folder and
// encrypted with the operating system's key store (Electron's safeStorage: DPAPI
// on Windows, the Keychain on macOS, the secret service on Linux). Where that is
// not available nothing is saved. Before 0.6.1 the file also held a Client
// Secret; it is dropped when the file is read and the file is written again.
// Before 0.16.11 it also held the voice channel last joined and the server each
// workspace remembers; Tavora moves those into the Discord module once (host.ts).

export interface Encryptor {
  isAvailable(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

export interface DiscordToken {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since 1970. */
  expiresAt: number;
}

/** Before 0.16.11: the voice channel the user was last in on a server, to rejoin from the panel. */
export interface DiscordLast {
  channelId: string;
  guildId: string;
  name: string;
  serverName: string | null;
}

/** Before 0.16.11: the server a workspace remembered, and the channel the user was last in there. */
export interface DiscordGame {
  guildId: string | null;
  serverName: string | null;
  channelId: string | null;
  channelName: string | null;
}

export interface DiscordSecrets {
  token: DiscordToken | null;
  /** Left by Discord panels before 0.16.11, until moved into the module. */
  last?: DiscordLast | null;
  /** Left by Discord panels before 0.16.11, by workspace id, until moved into the module. */
  games?: Record<string, DiscordGame>;
}

const EMPTY: DiscordSecrets = { token: null, last: null, games: {} };

function token(value: unknown): DiscordToken | null {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const ok = (text: unknown) => typeof text === "string" && text.length > 0 && text.length <= 500;
  return ok(raw.accessToken) && ok(raw.refreshToken) && typeof raw.expiresAt === "number" && Number.isFinite(raw.expiresAt)
    ? { accessToken: raw.accessToken as string, refreshToken: raw.refreshToken as string, expiresAt: raw.expiresAt }
    : null;
}

function last(value: unknown): DiscordLast | null {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const name = (text: unknown) => (typeof text === "string" && text.length > 0 && text.length <= 64 ? text : null);
  const channelName = name(raw.name);
  if (!isSnowflake(raw.channelId) || !isSnowflake(raw.guildId) || !channelName) return null;
  return { channelId: raw.channelId, guildId: raw.guildId, name: channelName, serverName: name(raw.serverName) };
}

const MAX_GAMES = 200;

function games(value: unknown): Record<string, DiscordGame> {
  const raw = (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const name = (text: unknown) => (typeof text === "string" && text.length > 0 && text.length <= 64 ? text : null);
  const result: Record<string, DiscordGame> = {};
  for (const [gameId, entry] of Object.entries(raw).slice(0, MAX_GAMES)) {
    const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    if (!isGameId(gameId)) continue;
    result[gameId] = {
      guildId: isSnowflake(item.guildId) ? item.guildId : null,
      serverName: name(item.serverName),
      channelId: isSnowflake(item.channelId) ? item.channelId : null,
      channelName: name(item.channelName),
    };
  }
  return result;
}

export async function loadDiscordSecrets(file: string, encryptor: Encryptor): Promise<DiscordSecrets> {
  if (!encryptor.isAvailable()) return EMPTY;
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as { v?: unknown; data?: unknown };
    if (saved.v !== 1 || typeof saved.data !== "string") return EMPTY;
    const raw = JSON.parse(encryptor.decrypt(Buffer.from(saved.data, "base64"))) as Record<string, unknown>;
    const secrets = { token: token(raw.token), last: last(raw.last), games: games(raw.games) };
    // A file from before 0.6.1 holds a Client Secret: write it again without.
    if ("secret" in raw) await saveDiscordSecrets(file, encryptor, secrets).catch(() => undefined);
    return secrets;
  } catch {
    // Missing, damaged, or encrypted by another user or PC: start without.
    return EMPTY;
  }
}

export async function saveDiscordSecrets(file: string, encryptor: Encryptor, secrets: DiscordSecrets): Promise<void> {
  if (!secrets.token && !secrets.last && Object.keys(secrets.games ?? {}).length === 0) {
    await rm(file, { force: true });
    return;
  }
  if (!encryptor.isAvailable()) throw new Error("No secure storage on this PC.");
  const data = encryptor.encrypt(JSON.stringify(secrets)).toString("base64");
  await writeFileAtomic(file, JSON.stringify({ v: 1, data }));
}
