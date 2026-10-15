import { describe, expect, it } from "vitest";
import { avatarUrl, cleanName, imageUrl, parseChannel, parseGuild, parseUser, parseVoiceChannelIds, parseVoiceState, pngDataUrl, speakingUser } from "./discord-voice";

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

  it("tells self mute from a moderator's", () => {
    const person = parseVoiceState(state("2", { voice_state: { self_mute: true, self_deaf: true, mute: false, deaf: true } }))!;
    expect(person).toMatchObject({ selfMute: true, selfDeaf: true, serverMute: false, serverDeaf: true });
    expect(parseVoiceState(state("2", { voice_state: { suppress: true } }))!.serverMute).toBe(true);
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
    expect(
      parseVoiceChannelIds({
        channels: [
          { id: "1", type: 0 },
          { id: "2", type: 2 },
          { id: "3", type: 13 },
          { id: "x", type: 2 },
        ],
      }),
    ).toEqual(["2", "3"]);
    expect(parseVoiceChannelIds(undefined)).toEqual([]);
  });

  it("only accepts Discord's own icon addresses", () => {
    const hash = "0123456789abcdef0123456789abcdef";
    expect(imageUrl(`https://cdn.discordapp.com/icons/20/${hash}.webp?size=1024`)).toBe(`https://cdn.discordapp.com/icons/20/${hash}.png?size=64`);
    expect(imageUrl(`https://evil.example/icons/20/${hash}.png`)).toBeNull();
    expect(imageUrl(`https://cdn.discordapp.com.evil.example/icons/20/${hash}.png`)).toBeNull();
    expect(imageUrl(`http://cdn.discordapp.com/icons/20/${hash}.png`)).toBeNull();
    expect(imageUrl(`https://cdn.discordapp.com/attachments/1/2/x.png`)).toBeNull();
    expect(parseGuild({ id: "20", name: "Crew", icon_url: "javascript:alert(1)" })).toEqual({ id: "20", name: "Crew", iconUrl: null });
    expect(avatarUrl("1", hash)).toBe(`https://cdn.discordapp.com/avatars/1/${hash}.png?size=64`);
    expect(avatarUrl("1", "nope")).toBeNull();
  });

  it("keeps only small PNGs as pictures", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(10)]);
    expect(pngDataUrl(png)).toMatch(/^data:image\/png;base64,/);
    expect(pngDataUrl(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(pngDataUrl(Buffer.concat([png, Buffer.alloc(300 * 1024)]))).toBeNull();
  });

  it("reads speaking events and the signed-in user", () => {
    expect(speakingUser({ user_id: "5", channel_id: "10" })).toBe("5");
    expect(speakingUser({ user_id: 5 })).toBeNull();
    expect(parseUser({ user: { id: "7", username: "brain", global_name: "Brain" } })).toEqual({ id: "7", name: "Brain" });
    expect(parseUser({})).toBeNull();
  });
});
