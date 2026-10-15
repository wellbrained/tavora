import { afterEach, describe, expect, it } from "vitest";
import { DiscordConnection, DiscordError, SCOPES, type DiscordSecrets } from "./discord";
import { RpcClient } from "./discord-rpc";
import { fakeDiscord, until, type FakeDiscord } from "./discord-fake.test-helper";

const HASH = "0123456789abcdef0123456789abcdef";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

const person = (id: string, name: string, voice: Record<string, boolean> = {}) => ({
  nick: null,
  voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false, ...voice },
  user: { id, username: name.toLowerCase(), global_name: name, avatar: id === "1" ? HASH : null },
});

let fake: FakeDiscord | undefined;
let connection: DiscordConnection | undefined;
afterEach(async () => {
  connection?.dispose();
  await fake?.close();
  fake = connection = undefined;
});

interface Setup {
  secrets?: DiscordSecrets;
  running?: boolean;
  tokenStatus?: number;
}

async function setup({ secrets = { secret: "s3cret_value", token: null }, running = true, tokenStatus = 200 }: Setup = {}) {
  connection?.dispose();
  await fake?.close();
  fake = await fakeDiscord();
  const discord = fake;
  discord.answers.set("AUTHORIZE", () => ({ data: { code: "code123" } }));
  discord.answers.set("AUTHENTICATE", (args) =>
    args.access_token === "good" || args.access_token === "fresh"
      ? { data: { user: { id: "1", username: "brain", global_name: "Brain" }, scopes: SCOPES } }
      : { error: { code: 4009, message: "Invalid token" } },
  );
  discord.answers.set("GET_SELECTED_VOICE_CHANNEL", () => ({
    data: { id: "10", guild_id: "20", name: "Factory Floor", position: 1, voice_states: [person("1", "Brain"), person("2", "Lena", { self_mute: true })] },
  }));
  discord.answers.set("GET_GUILD", () => ({ data: { id: "20", name: "Wellbrained Crew", icon_url: `https://cdn.discordapp.com/icons/20/${HASH}.png` } }));
  discord.answers.set("GET_CHANNELS", () => ({ data: { channels: [{ id: "10", type: 2 }, { id: "11", type: 2 }, { id: "12", type: 0 }] } }));
  discord.answers.set("GET_CHANNEL", (args) => ({ data: { id: args.channel_id, guild_id: "20", name: "Lobby", position: 2, voice_states: [person("3", "Tobi")] } }));
  const requests: { url: string; body: string }[] = [];
  const saved: DiscordSecrets[] = [];
  const timers: (() => void)[] = [];
  const views: string[] = [];
  connection = new DiscordConnection({
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
    canSaveSecret: true,
    onChange: (view) => views.push(view.status),
    setTimer: (fn) => {
      timers.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => undefined,
  });
  return { connection, fake: discord, requests, saved, timers, views };
}

describe("DiscordConnection", () => {
  it("does nothing until a Discord panel is open", async () => {
    const { connection, fake } = await setup({ secrets: { secret: "s3cret_value", token: { accessToken: "good", refreshToken: "r", expiresAt: Date.now() + 1e9 } } });
    expect(connection.view().status).toBe("off");
    expect(fake.commands).toEqual([]);
  });

  it("asks for the Client Secret first", async () => {
    const { connection } = await setup({ secrets: { secret: null, token: null } });
    await connection.setWanted(true);
    expect(connection.view()).toMatchObject({ status: "no-secret", secretSaved: false });
    await expect(connection.connectNow()).rejects.toBeInstanceOf(DiscordError);
  });

  it("waits for Connect before asking Discord for approval, then shows the voice channel", async () => {
    const { connection, fake, requests, saved } = await setup();
    await connection.setWanted(true);
    expect(connection.view().status).toBe("signed-out");
    expect(fake.commands).toEqual([]);

    await connection.connectNow();
    await until(() => connection.view().status === "connected" && connection.view().others.length === 1);
    expect(fake.commands.find((c) => c.cmd === "AUTHORIZE")?.args).toEqual({ client_id: "99", scopes: ["rpc", "rpc.voice.read", "identify"] });
    // The secret goes to Discord's token address and nowhere else.
    const tokenRequests = requests.filter((r) => r.body.includes("s3cret_value"));
    expect(tokenRequests.map((r) => r.url)).toEqual(["https://discord.com/api/oauth2/token"]);
    expect(saved.at(-1)?.token).toMatchObject({ accessToken: "good", refreshToken: "r1" });

    const view = connection.view();
    expect(view.user).toEqual({ id: "1", name: "Brain" });
    expect(view.server).toMatchObject({ id: "20", name: "Wellbrained Crew" });
    expect(view.call?.name).toBe("Factory Floor");
    expect(view.call?.members.map((m) => [m.name, m.selfMute])).toEqual([
      ["Brain", false],
      ["Lena", true],
    ]);
    expect(view.others).toEqual([{ id: "11", name: "Lobby", members: [expect.objectContaining({ name: "Tobi" })] }]);
    for (const evt of ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"]) {
      expect(fake.commands).toContainEqual({ cmd: "SUBSCRIBE", args: { channel_id: "10" }, evt });
    }
    await until(() => connection.view().call!.members[0]!.avatar !== null && connection.view().server!.icon !== null);
  });

  it("follows talking, joining, leaving and muting", async () => {
    const { connection, fake } = await setup({ secrets: { secret: "s3cret_value", token: { accessToken: "good", refreshToken: "r", expiresAt: Date.now() + 1e9 } } });
    await connection.setWanted(true);
    await until(() => connection.view().status === "connected" && connection.view().call !== null);
    const members = () => connection.view().call!.members;

    fake.dispatch("SPEAKING_START", { user_id: "2", channel_id: "10" });
    await until(() => members().find((m) => m.id === "2")?.speaking === true);
    fake.dispatch("SPEAKING_STOP", { user_id: "2", channel_id: "10" });
    await until(() => members().find((m) => m.id === "2")?.speaking === false);

    fake.dispatch("VOICE_STATE_CREATE", person("4", "Max", { mute: true }));
    await until(() => members().length === 3);
    expect(members()[2]).toMatchObject({ name: "Max", serverMute: true });

    fake.dispatch("VOICE_STATE_UPDATE", person("2", "Lena", { self_mute: false, self_deaf: true }));
    await until(() => members().find((m) => m.id === "2")?.selfDeaf === true);

    fake.dispatch("VOICE_STATE_DELETE", person("4", "Max"));
    await until(() => members().length === 2);

    // Speaking in another channel is not shown here.
    fake.dispatch("SPEAKING_START", { user_id: "2", channel_id: "99" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(members().find((m) => m.id === "2")?.speaking).toBe(false);
  });

  it("switches channels and shows a direct call without a server", async () => {
    const { connection, fake } = await setup({ secrets: { secret: "s3cret_value", token: { accessToken: "good", refreshToken: "r", expiresAt: Date.now() + 1e9 } } });
    await connection.setWanted(true);
    await until(() => connection.view().call?.id === "10");
    fake.answers.set("GET_SELECTED_VOICE_CHANNEL", () => ({ data: { id: "30", name: null, voice_states: [person("1", "Brain"), person("5", "Kira")] } }));
    fake.dispatch("VOICE_CHANNEL_SELECT", { channel_id: "30" });
    await until(() => connection.view().call?.id === "30");
    expect(connection.view()).toMatchObject({ server: null, others: [], call: { name: "Call" } });
    expect(fake.commands).toContainEqual({ cmd: "UNSUBSCRIBE", args: { channel_id: "10" }, evt: "SPEAKING_START" });

    fake.answers.set("GET_SELECTED_VOICE_CHANNEL", () => ({ data: null }));
    fake.dispatch("VOICE_CHANNEL_SELECT", { channel_id: null });
    await until(() => connection.view().call === null);
    expect(connection.view().status).toBe("connected");
  });

  it("refreshes an expired sign-in, and asks again when Discord refuses it", async () => {
    const expired = { secret: "s3cret_value", token: { accessToken: "old", refreshToken: "r", expiresAt: 0 } };
    const first = await setup({ secrets: expired });
    await first.connection.setWanted(true);
    await until(() => first.connection.view().status === "connected");
    expect(first.requests.some((r) => r.body.includes("grant_type=refresh_token"))).toBe(true);

    // The token is refused and refreshing fails too: Tavora is signed out and waits for Connect.
    const second = await setup({ secrets: { secret: "s3cret_value", token: { accessToken: "old", refreshToken: "r", expiresAt: Date.now() + 1e9 } }, tokenStatus: 401 });
    await second.connection.setWanted(true);
    await until(() => second.connection.view().status === "signed-out");
    expect(second.saved.at(-1)?.token).toBeNull();
    expect(second.fake.commands.some((c) => c.cmd === "AUTHORIZE")).toBe(false);
  });

  it("says so when Discord does not accept the Client Secret", async () => {
    const { connection } = await setup({ tokenStatus: 401 });
    await connection.setWanted(true);
    await connection.connectNow();
    await until(() => connection.view().status === "error");
    expect(connection.view().error).toMatch(/Client Secret/);
  });

  it("keeps looking while Discord isn't running, and notices when it quits", async () => {
    const { connection, timers } = await setup({ running: false, secrets: { secret: "s3cret_value", token: { accessToken: "good", refreshToken: "r", expiresAt: Date.now() + 1e9 } } });
    await connection.setWanted(true);
    await until(() => connection.view().status === "not-running");
    expect(timers.length).toBeGreaterThan(0);

    const running = await setup({ secrets: { secret: "s3cret_value", token: { accessToken: "good", refreshToken: "r", expiresAt: Date.now() + 1e9 } } });
    await running.connection.setWanted(true);
    await until(() => running.connection.view().status === "connected");
    running.fake.drop();
    await until(() => running.connection.view().status === "not-running");
    expect(running.connection.view().call).toBeNull();
  });

  it("disconnects when the last panel closes, and forgets the sign-in on Sign out", async () => {
    const { connection, saved } = await setup({ secrets: { secret: "s3cret_value", token: { accessToken: "good", refreshToken: "r", expiresAt: Date.now() + 1e9 } } });
    await connection.setWanted(true);
    await until(() => connection.view().status === "connected");
    await connection.setWanted(false);
    expect(connection.view()).toMatchObject({ status: "off", call: null });
    await connection.signOut();
    expect(saved.at(-1)).toEqual({ secret: "s3cret_value", token: null });
    await connection.setSecret(null);
    expect(saved.at(-1)).toEqual({ secret: null, token: null });
  });
});
