import { createHash } from "node:crypto";
import type { DiscordEvent, DiscordState } from "@tavora/sdk/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { DiscordConnector, SCOPES, type DiscordListener } from "./discord";
import { RpcClient } from "./discord-rpc";
import type { DiscordSecrets } from "./discord-store";
import { fakeDiscord, until, type FakeDiscord } from "./discord-fake.test-helper";

const HASH = "0123456789abcdef0123456789abcdef";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const SIGNED_IN: DiscordSecrets = { token: { accessToken: "good", refreshToken: "r", expiresAt: Date.now() + 1e9 } };

const person = (id: string, name: string) => ({
  nick: null,
  voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false },
  user: { id, username: name.toLowerCase(), global_name: name, avatar: null },
});

let fake: FakeDiscord | undefined;
let connector: DiscordConnector | undefined;
afterEach(async () => {
  connector?.dispose();
  await fake?.close();
  fake = connector = undefined;
});

interface Setup {
  secrets?: DiscordSecrets;
  running?: boolean;
  tokenStatus?: number;
}

/** A panel as the connector sees it: what it was told. */
function panel() {
  const states: DiscordState[] = [];
  const events: DiscordEvent[] = [];
  const listener: DiscordListener = { state: (state) => void states.push(state), event: (event) => void events.push(event) };
  return { states, events, listener };
}

async function setup({ secrets = { token: null }, running = true, tokenStatus = 200 }: Setup = {}) {
  connector?.dispose();
  await fake?.close();
  fake = await fakeDiscord();
  const discord = fake;
  discord.answers.set("AUTHORIZE", () => ({ data: { code: "code123" } }));
  discord.answers.set("AUTHENTICATE", (args) =>
    args.access_token === "good" || args.access_token === "fresh"
      ? { data: { user: { id: "1", username: "brain", global_name: "Brain" }, scopes: SCOPES } }
      : { error: { code: 4009, message: "Invalid token" } },
  );
  discord.answers.set("GET_SELECTED_VOICE_CHANNEL", () => ({ data: { id: "10", guild_id: "20", name: "Factory Floor", voice_states: [person("1", "Brain")] } }));
  const requests: { url: string; body: string }[] = [];
  const saved: DiscordSecrets[] = [];
  const timers: (() => void)[] = [];
  connector = new DiscordConnector({
    clientId: "99",
    connect: (events) => RpcClient.connect("99", events, running ? [discord.path] : ["/nonexistent/discord-ipc-0"]),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: String(init?.body ?? "") });
      if (url.startsWith("https://cdn.discordapp.com/")) return new Response(PNG, { status: 200 });
      const grant = new URLSearchParams(String(init?.body)).get("grant_type");
      if (tokenStatus !== 200) return Response.json({ error: "invalid_client" }, { status: tokenStatus });
      return Response.json({ access_token: grant === "refresh_token" ? "fresh" : "good", refresh_token: "r1", expires_in: 604800 });
    }) as typeof fetch,
    load: async () => secrets,
    save: async (next) => void saved.push(next),
    canSaveSignIn: true,
    onChange: () => undefined,
    setTimer: (fn) => {
      timers.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => undefined,
  });
  return { connector, fake: discord, requests, saved, timers };
}

describe("DiscordConnector", () => {
  it("does nothing until a panel uses it", async () => {
    const { connector, fake } = await setup({ secrets: SIGNED_IN });
    expect(connector.view().status).toBe("off");
    expect(fake.commands).toEqual([]);
  });

  it("waits for Connect before asking Discord for approval, then signs in with PKCE and no secret", async () => {
    const { connector, fake, requests, saved, timers } = await setup();
    const one = panel();
    await connector.use("p1", one.listener);
    expect(connector.state()).toMatchObject({ status: "signed-out", canSaveSignIn: true });
    expect(fake.commands).toEqual([]);

    await connector.connectNow();
    await until(() => connector.state().status === "connected");
    // PKCE: the challenge goes to the Discord app, the verifier only to Discord's token address, and no secret exists.
    const authorize = fake.commands.find((c) => c.cmd === "AUTHORIZE")?.args as Record<string, unknown>;
    expect(authorize).toEqual({ client_id: "99", scopes: ["rpc", "rpc.voice.read", "rpc.voice.write", "identify"], code_challenge: expect.any(String), code_challenge_method: "S256" });
    const tokenRequests = requests.filter((r) => r.body.includes("grant_type"));
    expect(tokenRequests.map((r) => r.url)).toEqual(["https://discord.com/api/oauth2/token"]);
    const body = new URLSearchParams(tokenRequests[0]!.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code123");
    expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(authorize.code_challenge);
    expect(body.get("code_verifier")!.length).toBeGreaterThanOrEqual(43);
    expect(requests.every((r) => !r.body.includes("client_secret"))).toBe(true);
    expect(saved.at(-1)?.token).toMatchObject({ accessToken: "good", refreshToken: "r1" });
    expect(connector.state()).toEqual({ status: "connected", error: null, user: { id: "1", name: "Brain" }, canControl: true, canSaveSignIn: true });
    // The panel hears it (changes are told after a short wait), and never the token.
    for (const fn of timers.splice(0)) fn();
    expect(one.states.at(-1)?.status).toBe("connected");
    expect(JSON.stringify(one.states)).not.toContain("good");
  });

  it("passes commands on and Discord's answer back as it came", async () => {
    const { connector, fake } = await setup({ secrets: SIGNED_IN });
    await connector.use("p1", panel().listener);
    await until(() => connector.state().status === "connected");
    expect(await connector.command("GET_SELECTED_VOICE_CHANNEL", {})).toEqual({ ok: true, data: { id: "10", guild_id: "20", name: "Factory Floor", voice_states: [person("1", "Brain")] } });

    // Joining takes the player out of another call, as Discord's own list does; leaving does not need to.
    await connector.command("SELECT_VOICE_CHANNEL", { channel_id: "11" });
    await connector.command("SELECT_VOICE_CHANNEL", { channel_id: null });
    expect(fake.commands.filter((c) => c.cmd === "SELECT_VOICE_CHANNEL").map((c) => c.args)).toEqual([{ channel_id: "11", force: true }, { channel_id: null }]);

    fake.answers.set("GET_CHANNEL", () => ({ error: { code: 4000, message: "No permission" } }));
    expect(await connector.command("GET_CHANNEL", { channel_id: "11" })).toEqual({ ok: false, reason: "refused", code: 4000, message: "No permission" });

    fake.answers.set("GET_GUILDS", () => ({ data: { guilds: [{ id: "1", name: "x".repeat(600 * 1024) }] } }));
    expect(await connector.command("GET_GUILDS", {})).toMatchObject({ ok: false, reason: "no-answer" });
  });

  it("answers not-connected while there is no connection", async () => {
    const { connector } = await setup();
    expect(await connector.command("GET_GUILDS", {})).toEqual({ ok: false, reason: "not-connected", code: null, message: null });
  });

  it("does not mute with a sign-in that lacks the permission, until the player allows it", async () => {
    const { connector, fake } = await setup({ secrets: SIGNED_IN });
    fake.answers.set("AUTHENTICATE", () => ({ data: { user: { id: "1", username: "brain", global_name: "Brain" }, scopes: ["rpc", "rpc.voice.read", "identify"] } }));
    await connector.use("p1", panel().listener);
    await until(() => connector.state().status === "connected");
    expect(connector.state().canControl).toBe(false);
    expect(await connector.command("SET_VOICE_SETTINGS", { mute: true })).toMatchObject({ ok: false, reason: "refused" });
    expect(fake.commands.some((c) => c.cmd === "SET_VOICE_SETTINGS")).toBe(false);

    fake.answers.set("AUTHENTICATE", () => ({ data: { user: { id: "1", username: "brain", global_name: "Brain" }, scopes: SCOPES } }));
    await connector.allowControl();
    await until(() => connector.state().canControl);
    expect(fake.commands.some((c) => c.cmd === "AUTHORIZE")).toBe(true);
    expect(await connector.command("SET_VOICE_SETTINGS", { mute: true })).toMatchObject({ ok: true });
  });

  it("asks Discord once per subscription for every panel, and sends each event only to the panels that want it", async () => {
    const { connector, fake } = await setup({ secrets: SIGNED_IN });
    const one = panel();
    const two = panel();
    await connector.use("p1", one.listener);
    await connector.use("p2", two.listener);
    await until(() => connector.state().status === "connected");
    await connector.subscribe("p1", "SPEAKING_START", "10");
    await connector.subscribe("p2", "SPEAKING_START", "10");
    await connector.subscribe("p2", "VOICE_CHANNEL_SELECT", null);
    expect(fake.commands.filter((c) => c.cmd === "SUBSCRIBE")).toEqual([
      { cmd: "SUBSCRIBE", args: { channel_id: "10" }, evt: "SPEAKING_START" },
      { cmd: "SUBSCRIBE", args: {}, evt: "VOICE_CHANNEL_SELECT" },
    ]);

    fake.dispatch("SPEAKING_START", { user_id: "2", channel_id: "10" });
    fake.dispatch("SPEAKING_START", { user_id: "2", channel_id: "99" });
    fake.dispatch("VOICE_CHANNEL_SELECT", { channel_id: null });
    fake.dispatch("MESSAGE_CREATE", { channel_id: "10", content: "secret" });
    await until(() => two.events.length === 2);
    expect(one.events).toEqual([{ event: "SPEAKING_START", data: { user_id: "2", channel_id: "10" } }]);
    expect(two.events).toEqual([
      { event: "SPEAKING_START", data: { user_id: "2", channel_id: "10" } },
      { event: "VOICE_CHANNEL_SELECT", data: { channel_id: null } },
    ]);

    // Discord is told to stop only when no panel wants it any more.
    await connector.unsubscribe("p1", "SPEAKING_START", "10");
    expect(fake.commands.some((c) => c.cmd === "UNSUBSCRIBE")).toBe(false);
    connector.release("p2");
    await until(() => fake.commands.some((c) => c.cmd === "UNSUBSCRIBE"));
    expect(fake.commands.filter((c) => c.cmd === "UNSUBSCRIBE")).toEqual(
      expect.arrayContaining([
        { cmd: "UNSUBSCRIBE", args: { channel_id: "10" }, evt: "SPEAKING_START" },
        { cmd: "UNSUBSCRIBE", args: {}, evt: "VOICE_CHANNEL_SELECT" },
      ]),
    );
    expect(connector.state().status).toBe("connected");
  });

  it("subscribes again after Discord restarts", async () => {
    const { connector, fake } = await setup({ secrets: SIGNED_IN });
    await connector.use("p1", panel().listener);
    await connector.subscribe("p1", "VOICE_STATE_UPDATE", "10");
    await until(() => connector.state().status === "connected");
    expect(fake.commands.filter((c) => c.cmd === "SUBSCRIBE")).toHaveLength(1);
    fake.drop();
    await until(() => connector.state().status === "not-running");
    expect(await connector.command("GET_GUILDS", {})).toMatchObject({ ok: false, reason: "not-connected" });
  });

  it("limits how many subscriptions one panel keeps", async () => {
    const { connector } = await setup({ secrets: SIGNED_IN });
    await connector.use("p1", panel().listener);
    for (let i = 0; i < 32; i++) await connector.subscribe("p1", "SPEAKING_START", String(100 + i));
    await expect(connector.subscribe("p1", "SPEAKING_START", "999")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("fetches only Discord's own pictures, once, as small PNGs", async () => {
    const { connector, requests } = await setup();
    const avatar = `https://cdn.discordapp.com/avatars/1/${HASH}.webp?size=1024`;
    expect(await connector.image(avatar)).toMatch(/^data:image\/png;base64,/);
    expect(await connector.image(avatar)).toMatch(/^data:image\/png;base64,/);
    expect(await connector.image("https://evil.example/avatars/1/x.png")).toBeNull();
    expect(await connector.image(`https://cdn.discordapp.com/attachments/1/2/${HASH}.png`)).toBeNull();
    expect(requests.map((r) => r.url)).toEqual([`https://cdn.discordapp.com/avatars/1/${HASH}.png?size=64`]);
  });

  it("refreshes an expired sign-in, and asks again when Discord refuses it", async () => {
    const expired = { token: { accessToken: "old", refreshToken: "r", expiresAt: 0 } };
    const first = await setup({ secrets: expired });
    await first.connector.use("p1", panel().listener);
    await until(() => first.connector.state().status === "connected");
    expect(first.requests.some((r) => r.body.includes("grant_type=refresh_token"))).toBe(true);
    // Refreshing needs no secret either.
    expect(first.requests.every((r) => !r.body.includes("client_secret"))).toBe(true);

    // The token is refused and refreshing fails too: Tavora is signed out and waits for Connect.
    const second = await setup({ secrets: { token: { accessToken: "old", refreshToken: "r", expiresAt: Date.now() + 1e9 } }, tokenStatus: 401 });
    await second.connector.use("p1", panel().listener);
    await until(() => second.connector.state().status === "signed-out");
    expect(second.saved.at(-1)?.token).toBeNull();
    expect(second.fake.commands.some((c) => c.cmd === "AUTHORIZE")).toBe(false);
  });

  it("says so when Discord does not sign Tavora in", async () => {
    const { connector } = await setup({ tokenStatus: 401 });
    await connector.use("p1", panel().listener);
    await connector.connectNow();
    await until(() => connector.state().status === "error");
    expect(connector.state().error).toBe("no-sign-in");
    expect(connector.view().error).toBe("discord.error.noSignIn");
  });

  it("uses a new verifier for each sign-in", async () => {
    const { connector, requests, fake } = await setup();
    await connector.use("p1", panel().listener);
    await connector.connectNow();
    await until(() => connector.state().status === "connected");
    await connector.signOut();
    await connector.connectNow();
    await until(() => connector.state().status === "connected");
    const verifiers = requests.filter((r) => r.body.includes("code_verifier")).map((r) => new URLSearchParams(r.body).get("code_verifier"));
    expect(verifiers).toHaveLength(2);
    expect(verifiers[0]).not.toBe(verifiers[1]);
    expect(fake.commands.filter((c) => c.cmd === "AUTHORIZE")).toHaveLength(2);
  });

  it("keeps looking while Discord isn't running, and notices when it quits", async () => {
    const { connector, timers } = await setup({ running: false, secrets: SIGNED_IN });
    await connector.use("p1", panel().listener);
    await until(() => connector.state().status === "not-running");
    expect(timers.length).toBeGreaterThan(0);

    const running = await setup({ secrets: SIGNED_IN });
    await running.connector.use("p1", panel().listener);
    await until(() => running.connector.state().status === "connected");
    running.fake.drop();
    await until(() => running.connector.state().status === "not-running");
  });

  it("disconnects when the last panel goes, and forgets the sign-in on Sign out", async () => {
    const { connector, saved } = await setup({ secrets: SIGNED_IN });
    await connector.use("p1", panel().listener);
    await connector.use("p2", panel().listener);
    await until(() => connector.state().status === "connected");
    connector.release("p1");
    expect(connector.view().status).toBe("connected");
    connector.release("p2");
    expect(connector.view().status).toBe("off");
    await connector.signOut();
    expect(saved.at(-1)).toEqual({ token: null });
  });

  it("hands over what the built-in panel kept, once, and keeps the sign-in", async () => {
    const last = { channelId: "10", guildId: "20", name: "Factory Floor", serverName: "Crew" };
    const games = { poe2: { guildId: "20", serverName: "Crew", channelId: "10", channelName: "Factory Floor" } };
    const { connector, saved } = await setup({ secrets: { ...SIGNED_IN, last, games } });
    expect(await connector.legacyPanelData()).toEqual({ last, games });
    await connector.forgetLegacyPanelData();
    expect(saved.at(-1)).toEqual({ token: SIGNED_IN.token });
    expect(await connector.legacyPanelData()).toBeNull();
  });
});
