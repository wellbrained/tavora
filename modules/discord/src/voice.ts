// Turns what the Discord app sends (through Tavora's discord connector, as it
// came) into the plain values the panel shows. Everything from Discord is
// checked here: ids must be Discord ids, names are cut to a sensible length,
// and anything unexpected is dropped.

const SNOWFLAKE = /^\d{1,20}$/;
const AVATAR_HASH = /^(?:a_)?[0-9a-f]{32}$/;
export const MAX_NAME = 64;
/** Most people listed in one channel; Discord's own limit for a voice channel is 99. */
export const MAX_MEMBERS = 99;
/** Most voice channels listed for a server. */
export const MAX_CHANNELS = 50;
/** Most servers listed to choose from. */
export const MAX_SERVERS = 200;

export const isSnowflake = (value: unknown): value is string => typeof value === "string" && SNOWFLAKE.test(value);

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const flag = (value: unknown): boolean => value === true;

export function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  // No control or bidirectional override characters, so a name can't reorder the text around it.
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "").trim();
  return name ? [...name].slice(0, MAX_NAME).join("") : fallback;
}

/** A person in a voice channel, with their avatar hash for loading the picture. */
export interface VoicePerson {
  id: string;
  name: string;
  avatarHash: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Muted or deafened by a moderator. */
  serverMute: boolean;
  serverDeaf: boolean;
  /** The player's own volume for this person (0 to 200, 100 normally) and whether the player muted them for themselves. */
  volume: number;
  mutedForMe: boolean;
}

/** One entry of a channel's `voice_states`, or the data of a VOICE_STATE_* event. */
export function parseVoiceState(raw: unknown): VoicePerson | null {
  const entry = record(raw);
  const user = record(entry.user);
  const state = record(entry.voice_state);
  if (!isSnowflake(user.id)) return null;
  const username = cleanName(user.username, "Someone");
  return {
    id: user.id,
    name: cleanName(entry.nick, cleanName(user.global_name, username)),
    avatarHash: typeof user.avatar === "string" && AVATAR_HASH.test(user.avatar) ? user.avatar : null,
    selfMute: flag(state.self_mute),
    selfDeaf: flag(state.self_deaf),
    serverMute: flag(state.mute) || flag(state.suppress),
    serverDeaf: flag(state.deaf),
    // Discord's own per-person settings of the player: volume 0 to 200, and the player's local "mute for me".
    volume: typeof entry.volume === "number" && Number.isFinite(entry.volume) ? Math.min(200, Math.max(0, Math.round(entry.volume))) : 100,
    mutedForMe: flag(entry.mute),
  };
}

export interface VoiceChannel {
  id: string;
  name: string;
  guildId: string | null;
  position: number;
  people: VoicePerson[];
}

/** The answer to GET_SELECTED_VOICE_CHANNEL or GET_CHANNEL; null when there is no channel. */
export function parseChannel(raw: unknown): VoiceChannel | null {
  const channel = record(raw);
  if (!isSnowflake(channel.id)) return null;
  const states = Array.isArray(channel.voice_states) ? channel.voice_states : [];
  const people = new Map<string, VoicePerson>();
  for (const entry of states) {
    const person = parseVoiceState(entry);
    if (person && people.size < MAX_MEMBERS) people.set(person.id, person);
  }
  // A direct or group call has no server (and often no name).
  const guildId = isSnowflake(channel.guild_id) ? channel.guild_id : null;
  return {
    id: channel.id,
    name: cleanName(channel.name, guildId ? "Voice" : "Call"),
    guildId,
    position: typeof channel.position === "number" && Number.isFinite(channel.position) ? channel.position : 0,
    people: [...people.values()],
  };
}

/** Voice channels (type 2) and stage channels (type 13) of a server, from GET_CHANNELS. */
export function parseVoiceChannelIds(raw: unknown): string[] {
  const list = record(raw).channels;
  if (!Array.isArray(list)) return [];
  return list
    .map(record)
    .filter((channel) => (channel.type === 2 || channel.type === 13) && isSnowflake(channel.id))
    .map((channel) => channel.id as string)
    .slice(0, MAX_CHANNELS);
}

export interface Guild {
  id: string;
  name: string;
  /** Discord's icon address as it came; Tavora only fetches it when it is one of Discord's own. */
  iconUrl: string | null;
}

/** GET_GUILD. */
export function parseGuild(raw: unknown): Guild | null {
  const guild = record(raw);
  if (!isSnowflake(guild.id)) return null;
  const icon = guild.icon_url;
  return { id: guild.id, name: cleanName(guild.name, "Server"), iconUrl: typeof icon === "string" && icon.startsWith("https://cdn.discordapp.com/") && icon.length <= 300 ? icon : null };
}

/** The servers the player is on, from GET_GUILDS. */
export function parseGuilds(raw: unknown): { id: string; name: string }[] {
  const list = record(raw).guilds;
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, MAX_SERVERS)
    .map((item) => parseGuild(item))
    .filter((guild): guild is Guild => guild !== null)
    .map((guild) => ({ id: guild.id, name: guild.name }));
}

/** The `user_id` of a SPEAKING_START or SPEAKING_STOP event. */
export function speakingUser(raw: unknown): string | null {
  const id = record(raw).user_id;
  return isSnowflake(id) ? id : null;
}

/** The channel an event names, if it names one. */
export function eventChannel(raw: unknown): string | null {
  const id = record(raw).channel_id;
  return isSnowflake(id) ? id : null;
}

/** The address of someone's Discord picture; Tavora fetches it as a small PNG. */
export function avatarUrl(userId: string, hash: string): string | null {
  return isSnowflake(userId) && AVATAR_HASH.test(hash) ? `https://cdn.discordapp.com/avatars/${userId}/${hash}.png` : null;
}

/** The channel to join again from the panel, kept in the settings shared by every game. */
export interface LastChannel {
  channelId: string;
  guildId: string;
  name: string;
  serverName: string | null;
}

/** The server a game remembers (its settings in that game), and the channel the player was last in there. */
export interface GameServer {
  guildId: string | null;
  serverName: string | null;
  channelId: string | null;
  channelName: string | null;
}

const savedName = (value: unknown) => (typeof value === "string" ? cleanName(value, "") || null : null);

/** The channel to rejoin as saved; null when there is none or it is damaged. */
export function parseLast(raw: unknown): LastChannel | null {
  const value = record(raw);
  const name = savedName(value.name);
  if (!isSnowflake(value.channelId) || !isSnowflake(value.guildId) || !name) return null;
  return { channelId: value.channelId, guildId: value.guildId, name, serverName: savedName(value.serverName) };
}

/** A game's server as saved; null when the game remembers none ("Remember the server" is not ticked). */
export function parseGameServer(raw: unknown): GameServer | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = record(raw);
  return {
    guildId: isSnowflake(value.guildId) ? value.guildId : null,
    serverName: savedName(value.serverName),
    channelId: isSnowflake(value.channelId) ? value.channelId : null,
    channelName: savedName(value.channelName),
  };
}
