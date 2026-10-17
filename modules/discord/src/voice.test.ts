import { describe, expect, it } from "vitest";
import { avatarUrl, cleanName, eventChannel, parseChannel, parseGameServer, parseGuild, parseGuilds, parseLast, parseVoiceChannelIds, parseVoiceState, speakingUser } from "./voice";

const state = (id: string, extra: Record<string, unknown> = {}) => ({
  nick: null,
  voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false, suppress: false },
  user: { id, username: `user${id}`, global_name: null, avatar: null },
  ...extra,
});

describe("Discord voice data", () => {
  it("reads a voice state, preferring the server nickname, then the display name", () => {
    expect(parseVoiceState(state("1"))?.name).toBe("user1");
    expect(parseVoiceState({ ...state("1"), user: { id: "1", username: "u", global_name: "Lena" } })?.name).toBe("Lena");
    expect(parseVoiceState({ ...state("1"), nick: "Lenchen", user: { id: "1", username: "u", global_name: "Lena" } })?.name).toBe("Lenchen");
  });

  it("tells self mute from a moderator's, and reads the player's own volume and mute for each person", () => {
    const person = parseVoiceState(state("2", { voice_state: { self_mute: true, self_deaf: true, mute: false, deaf: true } }))!;
    expect(person).toMatchObject({ selfMute: true, selfDeaf: true, serverMute: false, serverDeaf: true, volume: 100, mutedForMe: false });
    expect(parseVoiceState(state("2", { voice_state: { suppress: true } }))!.serverMute).toBe(true);
    expect(parseVoiceState({ ...state("2"), volume: 999, mute: true })).toMatchObject({ volume: 200, mutedForMe: true });
  });

  it("drops entries without a Discord id and keeps only real avatar hashes", () => {
    expect(parseVoiceState({ user: { id: "abc" } })).toBeNull();
    expect(parseVoiceState(null)).toBeNull();
    expect(parseVoiceState({ user: { id: "3", avatar: "../../etc" } })!.avatarHash).toBeNull();
    expect(parseVoiceState({ user: { id: "3", avatar: "a_0123456789abcdef0123456789abcdef" } })!.avatarHash).toBe("a_0123456789abcdef0123456789abcdef");
  });

  it("cleans names: no control or direction characters, at most 64 characters", () => {
    expect(cleanName("‮evil\u0007 ", "x")).toBe("evil");
    expect(cleanName("", "fallback")).toBe("fallback");
    expect(cleanName(42, "fallback")).toBe("fallback");
    expect([...cleanName("é".repeat(100), "x")]).toHaveLength(64);
  });

  it("reads a channel, without duplicates; a call without a server is still a channel", () => {
    const channel = parseChannel({ id: "10", guild_id: "20", name: "Factory Floor", position: 3, voice_states: [state("1"), state("1"), state("2")] })!;
    expect(channel).toMatchObject({ id: "10", guildId: "20", name: "Factory Floor", position: 3 });
    expect(channel.people.map((p) => p.id)).toEqual(["1", "2"]);
    expect(parseChannel({ id: "11", voice_states: [] })).toMatchObject({ guildId: null, name: "Call" });
    expect(parseChannel(null)).toBeNull();
  });

  it("lists only voice and stage channels of a server", () => {
    expect(parseVoiceChannelIds({ channels: [{ id: "1", type: 0 }, { id: "2", type: 2 }, { id: "3", type: 13 }, { id: "x", type: 2 }] })).toEqual(["2", "3"]);
    expect(parseVoiceChannelIds(undefined)).toEqual([]);
  });

  it("keeps a server icon only on Discord's image server, and builds avatar addresses from real hashes", () => {
    const hash = "0123456789abcdef0123456789abcdef";
    expect(parseGuild({ id: "20", name: "Crew", icon_url: "javascript:alert(1)" })).toEqual({ id: "20", name: "Crew", iconUrl: null });
    expect(parseGuild({ id: "20", name: "Crew", icon_url: `https://cdn.discordapp.com/icons/20/${hash}.png` })?.iconUrl).toBe(`https://cdn.discordapp.com/icons/20/${hash}.png`);
    expect(parseGuilds({ guilds: [{ id: "20", name: "Crew" }, { id: "nope" }] })).toEqual([{ id: "20", name: "Crew" }]);
    expect(avatarUrl("1", hash)).toBe(`https://cdn.discordapp.com/avatars/1/${hash}.png`);
    expect(avatarUrl("1", "nope")).toBeNull();
  });

  it("reads speaking events and the channel an event names", () => {
    expect(speakingUser({ user_id: "5", channel_id: "10" })).toBe("5");
    expect(speakingUser({ user_id: 5 })).toBeNull();
    expect(eventChannel({ channel_id: "10" })).toBe("10");
    expect(eventChannel({ channel_id: null })).toBeNull();
  });

  it("reads what the panel saved, dropping what is damaged", () => {
    const last = { channelId: "10", guildId: "20", name: "Factory Floor", serverName: "Crew" };
    expect(parseLast(last)).toEqual(last);
    expect(parseLast({ ...last, channelId: "x" })).toBeNull();
    expect(parseLast(null)).toBeNull();
    expect(parseGameServer({ guildId: "20", serverName: "Crew", channelId: "y", channelName: null })).toEqual({ guildId: "20", serverName: "Crew", channelId: null, channelName: null });
    // Remembered without a server yet is still remembered; nothing saved is not.
    expect(parseGameServer({})).toEqual({ guildId: null, serverName: null, channelId: null, channelName: null });
    expect(parseGameServer(null)).toBeNull();
  });
});
