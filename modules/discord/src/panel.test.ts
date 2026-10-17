import type { DiscordCommand, DiscordEvent, DiscordResult, DiscordState, JsonValue, TavoraSDK } from "@tavora/sdk";
import { TavoraError } from "@tavora/sdk";
import { describe, expect, it, vi } from "vitest";
import { createPanel, OTHERS_MS } from "./panel";

const HASH = "0123456789abcdef0123456789abcdef";
const CONNECTED: DiscordState = { status: "connected", error: null, user: { id: "1", name: "Brain" }, canControl: true, canSaveSignIn: true };

const person = (id: string, name: string, voice: Record<string, boolean> = {}, extra: Record<string, unknown> = {}) => ({
  nick: null,
  voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false, ...voice },
  user: { id, username: name.toLowerCase(), global_name: name, avatar: id === "1" ? HASH : null },
  ...extra,
});

type Answer = (args: Record<string, unknown>) => DiscordResult;
const ok = (data: unknown): DiscordResult => ({ ok: true, data: data as JsonValue });
const refused: DiscordResult = { ok: false, reason: "refused", code: 4000, message: "No" };

/** An SDK with only what the panel uses: the discord connector and settings, both kept here. */
function fakeSdk(state: DiscordState = CONNECTED) {
  const app = new Map<string, JsonValue>();
  const game = new Map<string, JsonValue>();
  const sent: { command: DiscordCommand; args: Record<string, unknown> }[] = [];
  const subscriptions = new Set<string>();
  const answers = new Map<DiscordCommand, Answer>([
    ["GET_SELECTED_VOICE_CHANNEL", () => ok({ id: "10", guild_id: "20", name: "Factory Floor", voice_states: [person("1", "Brain"), person("2", "Lena", { self_mute: true })] })],
    ["GET_GUILD", (args) => ok({ id: args.guild_id, name: args.guild_id === "21" ? "Other Crew" : "Wellbrained Crew", icon_url: `https://cdn.discordapp.com/icons/20/${HASH}.png` })],
    ["GET_GUILDS", () => ok({ guilds: [{ id: "20", name: "Wellbrained Crew" }, { id: "21", name: "Other Crew" }] })],
    ["GET_CHANNELS", () => ok({ channels: [{ id: "10", type: 2 }, { id: "11", type: 2 }, { id: "12", type: 0 }] })],
    ["GET_CHANNEL", (args) => ok({ id: args.channel_id, guild_id: "20", name: args.channel_id === "10" ? "Factory Floor" : "Lobby", position: args.channel_id === "10" ? 1 : 2, voice_states: args.channel_id === "11" ? [person("3", "Tobi")] : [] })],
  ]);
  let onState: (state: DiscordState) => void = () => {};
  let onEvent: (event: DiscordEvent) => void = () => {};
  const store = (map: Map<string, JsonValue>) => ({
    get: async (key: string) => (map.has(key) ? structuredClone(map.get(key)!) : null),
    set: async (key: string, value: JsonValue) => void map.set(key, structuredClone(value)),
    delete: async (key: string) => void map.delete(key),
    keys: async () => [...map.keys()],
  });
  const discord = {
    state: vi.fn(async () => state),
    onStateChange: (fn: typeof onState) => ((onState = fn), () => {}),
    onEvent: (fn: typeof onEvent) => ((onEvent = fn), () => {}),
    connect: vi.fn(async () => {}),
    allowControl: vi.fn(async () => {}),
    command: async (command: DiscordCommand, args: Record<string, unknown>) => {
      sent.push({ command, args });
      return answers.get(command)?.(args) ?? ok({});
    },
    subscribe: async (event: string, channelId?: string) => void subscriptions.add(channelId ? `${event}:${channelId}` : event),
    unsubscribe: async (event: string, channelId?: string) => void subscriptions.delete(channelId ? `${event}:${channelId}` : event),
    image: vi.fn(async (url: string) => `data:image/png;base64,${url.length}`),
  };
  const sdk = { storage: { ...store(game), app: store(app) }, connectors: { discord } } as unknown as TavoraSDK;
  return { sdk, app, game, sent, subscriptions, answers, discord, setState: (next: DiscordState) => onState(next), dispatch: (event: DiscordEvent["event"], data: unknown) => onEvent({ event, data: data as JsonValue }) };
}

/** Lets the panel's chain of awaits and its view update run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

async function started(fake = fakeSdk()) {
  const timers: (() => void)[] = [];
  const panel = createPanel(fake.sdk, { setTimer: (fn) => (timers.push(fn), 0 as unknown as ReturnType<typeof setTimeout>), clearTimer: () => undefined });
  await panel.start();
  await settle();
  return { ...fake, panel, timers, view: () => panel.view.value };
}

describe("Discord panel", () => {
  it("shows the voice channel, who is in it and the server's other voice channels", async () => {
    const { view, subscriptions, discord } = await started();
    expect(view()).toMatchObject({ server: { id: "20", name: "Wellbrained Crew" }, call: { id: "10", name: "Factory Floor" }, canControl: true, self: { mute: false, deaf: false }, userId: "1" });
    expect(view().call!.members.map((m) => [m.name, m.selfMute])).toEqual([["Brain", false], ["Lena", true]]);
    expect(view().channels.map((c) => [c.id, c.name])).toEqual([["10", "Factory Floor"], ["11", "Lobby"]]);
    expect(view().servers.map((s) => s.name)).toEqual(["Wellbrained Crew", "Other Crew"]);
    for (const event of ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"]) expect(subscriptions).toContain(`${event}:10`);
    expect(subscriptions).toContain("VOICE_CHANNEL_SELECT");
    // Pictures come through Tavora, as data addresses.
    expect(view().call!.members[0]!.avatar).toMatch(/^data:image\/png/);
    expect(view().server!.icon).toMatch(/^data:image\/png/);
    expect(discord.image).toHaveBeenCalledWith(`https://cdn.discordapp.com/avatars/1/${HASH}.png`);
  });

  it("follows talking, joining, leaving and muting", async () => {
    const { view, dispatch } = await started();
    const members = () => view().call!.members;
    dispatch("SPEAKING_START", { user_id: "2", channel_id: "10" });
    await settle();
    expect(members().find((m) => m.id === "2")?.speaking).toBe(true);
    dispatch("SPEAKING_STOP", { user_id: "2", channel_id: "10" });
    dispatch("VOICE_STATE_CREATE", person("4", "Max", { mute: true }));
    await settle();
    expect(members().find((m) => m.id === "2")?.speaking).toBe(false);
    expect(members()[2]).toMatchObject({ name: "Max", serverMute: true });
    dispatch("VOICE_STATE_UPDATE", person("1", "Brain", { self_mute: true }));
    await settle();
    expect(view().self).toEqual({ mute: true, deaf: false });
    dispatch("VOICE_STATE_DELETE", person("4", "Max"));
    // Speaking in another channel is not shown here.
    dispatch("SPEAKING_START", { user_id: "2", channel_id: "99" });
    await settle();
    expect(members()).toHaveLength(2);
    expect(members().find((m) => m.id === "2")?.speaking).toBe(false);
  });

  it("switches channels and shows a direct call without a server", async () => {
    const { view, answers, dispatch, subscriptions } = await started();
    answers.set("GET_SELECTED_VOICE_CHANNEL", () => ok({ id: "30", name: null, voice_states: [person("1", "Brain"), person("5", "Kira")] }));
    dispatch("VOICE_CHANNEL_SELECT", { channel_id: "30" });
    await settle();
    expect(view()).toMatchObject({ server: null, channels: [], call: { id: "30", name: "Call" } });
    expect(subscriptions).not.toContain("SPEAKING_START:10");
    expect(subscriptions).toContain("SPEAKING_START:30");
    answers.set("GET_SELECTED_VOICE_CHANNEL", () => ok(null));
    dispatch("VOICE_CHANNEL_SELECT", { channel_id: null });
    await settle();
    expect(view().call).toBeNull();
  });

  it("remembers the last server channel for every game, and joins it or another listed one when asked", async () => {
    const { view, app, answers, dispatch, sent, panel } = await started();
    expect(app.get("last")).toEqual({ channelId: "10", guildId: "20", name: "Factory Floor", serverName: "Wellbrained Crew" });
    answers.set("GET_SELECTED_VOICE_CHANNEL", () => ok(null));
    dispatch("VOICE_CHANNEL_SELECT", { channel_id: null });
    await settle();
    expect(view().last).toEqual({ channelId: "10", name: "Factory Floor", serverName: "Wellbrained Crew" });
    expect(sent.some((s) => s.command === "SELECT_VOICE_CHANNEL")).toBe(false);
    await panel.join("10");
    expect(sent.filter((s) => s.command === "SELECT_VOICE_CHANNEL").map((s) => s.args)).toEqual([{ channel_id: "10" }]);
    // A channel the panel never showed is not joined; Discord refusing is said plainly.
    await expect(panel.join("99")).rejects.toMatchObject({ key: "joinUnknown" });
    answers.set("SELECT_VOICE_CHANNEL", () => refused);
    await expect(panel.join("10")).rejects.toMatchObject({ key: "joinFailed" });
  });

  it("starts with what Tavora's built-in panel left", async () => {
    const fake = fakeSdk({ ...CONNECTED, status: "not-running" });
    fake.app.set("last", { channelId: "10", guildId: "20", name: "Factory Floor", serverName: "Crew" });
    fake.game.set("server", { guildId: "21", serverName: "Other Crew", channelId: "11", channelName: "Lobby" });
    const { view } = await started(fake);
    expect(view()).toMatchObject({ game: { remember: true, serverId: "21" }, last: { channelId: "11", name: "Lobby", serverName: "Other Crew" }, call: null, channels: [] });
  });

  it("remembers a server on this game, browses it without a call, and reads it every 5 minutes", async () => {
    const { view, game, answers, dispatch, panel, timers } = await started();
    expect(view().game).toEqual({ remember: false, serverId: null });
    await panel.rememberGame(true);
    expect(game.get("server")).toEqual({ guildId: "20", serverName: "Wellbrained Crew", channelId: "10", channelName: "Factory Floor" });

    answers.set("GET_SELECTED_VOICE_CHANNEL", () => ok(null));
    dispatch("VOICE_CHANNEL_SELECT", { channel_id: null });
    await settle();
    expect(view()).toMatchObject({ call: null, browseServer: { id: "20", name: "Wellbrained Crew" }, last: { channelId: "10" } });
    expect(view().channels).toHaveLength(2);

    await panel.setGameServer("21");
    await settle();
    expect(view()).toMatchObject({ browseServer: { id: "21", name: "Other Crew" }, game: { remember: true, serverId: "21" }, last: null });
    await expect(panel.setGameServer("99")).rejects.toMatchObject({ key: "serverUnknown" });

    // A call on another server does not replace the game's server.
    answers.set("GET_SELECTED_VOICE_CHANNEL", () => ok({ id: "10", guild_id: "20", name: "Factory Floor", voice_states: [person("1", "Brain")] }));
    dispatch("VOICE_CHANNEL_SELECT", { channel_id: "10" });
    await settle();
    expect(view()).toMatchObject({ server: { id: "20" }, browseServer: { id: "21" } });
    expect((game.get("server") as { guildId: string }).guildId).toBe("21");

    await panel.rememberGame(false);
    expect(game.has("server")).toBe(false);
    expect(OTHERS_MS).toBe(300_000);
    expect(timers.length).toBeGreaterThan(0);
  });

  it("leaves at once, mutes and deafens, and comes back when Discord refuses", async () => {
    const { view, sent, answers, panel } = await started();
    await panel.setVoice({ mute: true });
    await panel.setVoice({ deaf: false });
    expect(sent.filter((s) => s.command === "SET_VOICE_SETTINGS").map((s) => s.args)).toEqual([{ mute: true }, { deaf: false }]);
    answers.set("SET_VOICE_SETTINGS", () => refused);
    await expect(panel.setVoice({ mute: false })).rejects.toMatchObject({ key: "voiceFailed" });

    const leaving = panel.leave();
    await settle();
    expect(view().call).toBeNull();
    await leaving;
    expect(sent.find((s) => s.command === "SELECT_VOICE_CHANNEL")?.args).toEqual({ channel_id: null });

    const fresh = await started();
    fresh.answers.set("SELECT_VOICE_CHANNEL", () => refused);
    await expect(fresh.panel.leave()).rejects.toMatchObject({ key: "leaveFailed" });
    await settle();
    expect(fresh.view().call).not.toBeNull();
  });

  it("asks the player to allow muting first when the sign-in can't", async () => {
    const { panel, sent, discord } = await started(fakeSdk({ ...CONNECTED, canControl: false }));
    await expect(panel.setVoice({ mute: true })).rejects.toMatchObject({ key: "needsControl" });
    expect(sent.some((s) => s.command === "SET_VOICE_SETTINGS")).toBe(false);
    await panel.allowControl();
    expect(discord.allowControl).toHaveBeenCalled();
  });

  it("changes someone's volume and mute for the player only, and puts back what Discord says when it refuses", async () => {
    const fake = fakeSdk();
    fake.answers.set("GET_SELECTED_VOICE_CHANNEL", () => ok({ id: "10", guild_id: "20", name: "Factory Floor", voice_states: [person("1", "Brain"), person("2", "Lena", {}, { volume: 150, mute: true })] }));
    const { view, sent, answers, panel } = await started(fake);
    const lena = () => view().call!.members.find((m) => m.id === "2")!;
    expect([lena().volume, lena().mutedForMe]).toEqual([150, true]);
    await panel.setUserVoice("2", { volume: 80 });
    await settle();
    expect(lena().volume).toBe(80);
    expect(sent.filter((s) => s.command === "SET_USER_VOICE_SETTINGS").map((s) => s.args)).toEqual([{ user_id: "2", volume: 80 }]);
    await expect(panel.setUserVoice("1", { volume: 50 })).rejects.toMatchObject({ key: "personGone" });
    await expect(panel.setUserVoice("99", { mute: true })).rejects.toMatchObject({ key: "personGone" });
    answers.set("SET_USER_VOICE_SETTINGS", () => refused);
    await expect(panel.setUserVoice("2", { volume: 10 })).rejects.toMatchObject({ key: "voiceFailed" });
    await settle();
    expect(lena().volume).toBe(150);
  });

  it("clears the channel when the connection goes, and reads it again when it is back", async () => {
    const { view, setState, sent } = await started();
    setState({ ...CONNECTED, status: "not-running" });
    await settle();
    expect(view()).toMatchObject({ call: null, channels: [], servers: [] });
    expect(view().state?.status).toBe("not-running");
    const before = sent.length;
    setState(CONNECTED);
    await settle();
    expect(sent.length).toBeGreaterThan(before);
    expect(view().call?.id).toBe("10");
  });

  it("does nothing in Discord before the player connects", async () => {
    const { view, sent, panel, discord } = await started(fakeSdk({ status: "signed-out", error: null, user: null, canControl: false, canSaveSignIn: true }));
    expect(view().state?.status).toBe("signed-out");
    expect(sent).toEqual([]);
    await expect(panel.join("10")).rejects.toMatchObject({ key: "notConnected" });
    await panel.connect();
    expect(discord.connect).toHaveBeenCalled();
  });

  it("says when the player has not allowed it to use Discord", async () => {
    const fake = fakeSdk();
    fake.discord.state.mockRejectedValue(new TavoraError({ code: "PERMISSION_DENIED", message: "no", capability: "discord" }));
    const { view } = await started(fake);
    expect(view().denied).toBe(true);
  });
});
