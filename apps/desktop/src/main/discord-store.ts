import { isGameId } from "@tavora/module-schema";
import { isSnowflake } from "./discord-parse";
import { SealedFile } from "./sealed-file";

// The Discord sign-in (token), kept in discord.json in the user data folder and
// encrypted with the operating system's key store (Electron's safeStorage: DPAPI
// on Windows, the Keychain on macOS, the secret service on Linux). Where that is
// not available nothing is saved. Before 0.6.1 the file also held a Client
// Secret; it is dropped when the file is read and the file is written again.
// Before 0.16.11 it also held the voice channel last joined and the server each
// workspace remembers; Tavora moves those into the Discord module once (host.ts).

export interface Encryptor {
  /** Checks the system's key store (and caches the answer for `isAvailable`). Asked before anything is sealed or opened. */
  ready(): Promise<boolean>;
  /** The answer of the last `ready()`: false until it has run. For getters that can't wait. */
  isAvailable(): boolean;
  encrypt(text: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<string>;
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

/**
 * discord.json: Discord's sign-in, sealed (sealed-file.ts). One that couldn't be read at start reads as signed out, and
 * is never written over or removed: a save or sign-out moves it aside (kept) when it still can't be read.
 */
export class DiscordSecretsFile {
  private readonly sealed: SealedFile;

  constructor(
    file: string,
    private readonly encryptor: Encryptor,
  ) {
    // What it writes is the sign-in now, newer than one it couldn't read: that one moves aside instead of holding it up.
    this.sealed = new SealedFile(file, { moveHeldAside: true });
  }

  async load(): Promise<DiscordSecrets> {
    const encryptor = this.encryptor;
    if (!(await encryptor.ready())) return EMPTY;
    // Missing, newer, damaged, can't be read now, or encrypted by another user or PC: start without (the file is kept).
    const read = await this.sealed.open(async (data) => {
      const value: unknown = JSON.parse(await encryptor.decrypt(Buffer.from(data, "base64")));
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not Discord's secrets");
      return value as Record<string, unknown>;
    });
    if (read.status !== "opened") return EMPTY;
    const raw = read.value;
    try {
      const secrets = { token: token(raw.token), last: last(raw.last), games: games(raw.games) };
      // A file from before 0.6.1 holds a Client Secret: write it again without.
      if ("secret" in raw) await this.save(secrets).catch(() => undefined);
      return secrets;
    } catch {
      return EMPTY;
    }
  }

  async save(secrets: DiscordSecrets): Promise<void> {
    if (!secrets.token && !secrets.last && Object.keys(secrets.games ?? {}).length === 0) return this.sealed.forget();
    if (!(await this.encryptor.ready())) throw new Error("No secure storage on this PC.");
    await this.sealed.write({ data: (await this.encryptor.encrypt(JSON.stringify(secrets))).toString("base64") });
  }
}
