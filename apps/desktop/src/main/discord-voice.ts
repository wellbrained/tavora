import type { DiscordMember } from "../shared/host-api";

// Turns what the Discord app sends into the plain values the Discord panel
// shows. Everything from Discord is checked here: ids must be Discord ids,
// names are cut to a sensible length, and anything unexpected is dropped.

const SNOWFLAKE = /^\d{1,20}$/;
const AVATAR_HASH = /^(?:a_)?[0-9a-f]{32}$/;
export const MAX_NAME = 64;
/** Most people listed in one channel; Discord's own limit for a voice channel is 99. */
export const MAX_MEMBERS = 99;
/** Most voice channels listed for a server. */
export const MAX_CHANNELS = 50;

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
export interface VoicePerson extends Omit<DiscordMember, "avatar" | "speaking"> {
  avatarHash: string | null;
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
  iconUrl: string | null;
}

/** GET_GUILD. The icon is only kept when it is one of Discord's own icon addresses. */
export function parseGuild(raw: unknown): Guild | null {
  const guild = record(raw);
  if (!isSnowflake(guild.id)) return null;
  return { id: guild.id, name: cleanName(guild.name, "Server"), iconUrl: imageUrl(guild.icon_url) };
}

/** The `user_id` of a SPEAKING_START or SPEAKING_STOP event. */
export function speakingUser(raw: unknown): string | null {
  const id = record(raw).user_id;
  return isSnowflake(id) ? id : null;
}

/** The signed-in user from AUTHENTICATE. */
export function parseUser(raw: unknown): { id: string; name: string } | null {
  const user = record(record(raw).user);
  return isSnowflake(user.id) ? { id: user.id, name: cleanName(user.global_name, cleanName(user.username, "You")) } : null;
}

const CDN = "https://cdn.discordapp.com/";

/** The address of someone's Discord picture, small. */
export function avatarUrl(userId: string, hash: string): string | null {
  return isSnowflake(userId) && AVATAR_HASH.test(hash) ? `${CDN}avatars/${userId}/${hash}.png?size=64` : null;
}

/**
 * A server icon address from Discord, if it is one: only Discord's image
 * server, only `icons/<id>/<hash>`, and always asked for as a small PNG.
 */
export function imageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin + "/" !== CDN) return null;
  const match = /^\/icons\/(\d{1,20})\/((?:a_)?[0-9a-f]{32})\.(?:png|webp|jpg|gif)$/.exec(url.pathname);
  return match ? `${CDN}icons/${match[1]}/${match[2]}.png?size=64` : null;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Largest picture Tavora keeps; a 64-pixel PNG is a few kilobytes. */
export const MAX_IMAGE = 256 * 1024;

/** A PNG from Discord as a data address, or null when it is not a small PNG. */
export function pngDataUrl(bytes: Buffer): string | null {
  if (bytes.length > MAX_IMAGE || bytes.length < PNG.length || !bytes.subarray(0, PNG.length).equals(PNG)) return null;
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
