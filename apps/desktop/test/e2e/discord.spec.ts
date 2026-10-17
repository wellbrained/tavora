// The Discord module and the discord connector (docs/threat-model.md, D1 to D9).
// A pretend Discord app listens where the real one would, and a local server
// stands in for Discord's token address, so nothing here reaches Discord.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { fakeDiscord, type FakeDiscord } from "../../src/main/discord-fake.test-helper";
import { clickInModule, expectModuleText, inModule, launch } from "./harness";

const DISCORD = "tavora.discord";

let fake: FakeDiscord;
let tokens: Server;
let tokenUrl: string;
const tokenBodies: string[] = [];

const person = (id: string, name: string, voice: Record<string, boolean> = {}) => ({
  nick: null,
  voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false, ...voice },
  user: { id, username: name.toLowerCase(), global_name: name, avatar: null },
});

test.beforeAll(async () => {
  fake = await fakeDiscord();
  fake.answers.set("AUTHORIZE", () => ({ data: { code: "code123" } }));
  fake.answers.set("AUTHENTICATE", () => ({ data: { user: { id: "1", username: "nik", global_name: "wellbrained" }, scopes: ["rpc", "rpc.voice.read", "rpc.voice.write", "identify"] } }));
  fake.answers.set("GET_SELECTED_VOICE_CHANNEL", () => ({
    data: {
      id: "10",
      guild_id: "20",
      name: "Factory Floor",
      voice_states: [person("1", "wellbrained"), person("2", "Jonas"), person("3", "Lena", { self_mute: true }), person("4", "Max", { self_mute: true, self_deaf: true }), person("5", "Sarah", { mute: true })],
    },
  }));
  fake.answers.set("GET_GUILD", () => ({ data: { id: "20", name: "Wellbrained Crew", icon_url: null } }));
  fake.answers.set("GET_CHANNELS", () => ({ data: { channels: [{ id: "10", type: 2 }, { id: "11", type: 2 }, { id: "12", type: 2 }] } }));
  fake.answers.set("GET_CHANNEL", (args) =>
    args.channel_id === "11"
      ? { data: { id: "11", guild_id: "20", name: "Lobby", position: 1, voice_states: [person("6", "Tobi"), person("7", "Kira", { self_mute: true })] } }
      : { data: { id: "12", guild_id: "20", name: "AFK", position: 2, voice_states: [] } },
  );
  tokens = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      tokenBodies.push(body);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 604800 }));
    });
  });
  await new Promise<void>((resolve) => tokens.listen(0, "127.0.0.1", resolve));
  tokenUrl = `http://127.0.0.1:${(tokens.address() as AddressInfo).port}/api/oauth2/token`;
});

/** A real key press in the module's page, so what follows counts as the player's own click (D8). */
async function gesture(app: ElectronApplication) {
  await app.evaluate(({ webContents }, moduleId) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
    if (!target) throw new Error("no panel");
    target.sendInputEvent({ type: "keyDown", keyCode: "Shift" });
    target.sendInputEvent({ type: "keyUp", keyCode: "Shift" });
  }, DISCORD);
}

const count = (app: ElectronApplication, selector: string) => inModule<number>(app, DISCORD, `document.querySelectorAll('${selector}').length`).catch(() => -1);
const attribute = (app: ElectronApplication, testId: string, name: string) =>
  inModule<string | null>(app, DISCORD, `document.querySelector('[data-testid="${testId}"]')?.getAttribute("${name}") ?? null`).catch(() => null);

test.afterAll(async () => {
  await fake.close();
  await new Promise((resolve) => tokens.close(resolve));
});

test("the Discord module asks first, connects once approved and shows who is in the voice channel and who is talking", async () => {
  const { app, page, userData } = await launch(undefined, [], { env: { TAVORA_DISCORD_IPC: fake.path, TAVORA_DISCORD_TOKEN_URL: tokenUrl } });
  try {
    // Adding it asks to let it use Discord with Tavora's sign-in (the module grants row of 2026-10-16).
    await page.getByTestId("add-module").click();
    await page.getByTestId(`open-${DISCORD}`).click();
    await expect(page.getByTestId("grant-dialog")).toBeVisible();
    await expect(page.getByTestId("grant-discord")).toContainText("Join or leave a voice channel when you click");
    await page.getByTestId("grant-allow").click();
    await expectModuleText(app, DISCORD, "discord-connect", "Connect");
    // Nothing is asked of Discord before the player connects.
    expect(fake.commands).toEqual([]);

    // Connecting needs the player's own click (D8).
    await clickInModule(app, DISCORD, "discord-connect");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fake.commands.some((c) => c.cmd === "AUTHORIZE")).toBe(false);
    await gesture(app);
    await clickInModule(app, DISCORD, "discord-connect");
    await expectModuleText(app, DISCORD, "discord-server", "Wellbrained Crew");
    await expect.poll(() => count(app, '[data-testid="discord-current"]')).toBe(1);
    await expect.poll(() => count(app, "[data-testid^=discord-member-]")).toBe(7);
    // D2: only voice is read.
    expect(fake.commands.find((c) => c.cmd === "AUTHORIZE")?.args.scopes).toEqual(["rpc", "rpc.voice.read", "rpc.voice.write", "identify"]);
    // D1: no secret exists; the one-time verifier only goes to the token address, and it matches the challenge the Discord app got.
    const authorize = fake.commands.find((c) => c.cmd === "AUTHORIZE")?.args as { code_challenge: string; code_challenge_method: string };
    expect(authorize.code_challenge_method).toBe("S256");
    expect(tokenBodies).toHaveLength(1);
    const body = new URLSearchParams(tokenBodies[0]);
    expect(body.has("client_secret")).toBe(false);
    expect(createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url")).toBe(authorize.code_challenge);
    // D3: the sign-in is kept encrypted, never in plain text on disk.
    await expect.poll(async () => readFile(path.join(userData, "discord.json"), "utf8").catch(() => "")).not.toBe("");
    const onDisk = await readFile(path.join(userData, "discord.json"), "utf8");
    expect(onDisk).not.toContain("access");
    expect(onDisk).not.toContain("refresh");

    fake.dispatch("SPEAKING_START", { user_id: "2", channel_id: "10" });
    await expect.poll(() => attribute(app, "discord-member-2", "data-speaking")).toBe("true");
    fake.dispatch("SPEAKING_START", { user_id: "1", channel_id: "10" });
    await expect.poll(() => attribute(app, "discord-member-1", "data-speaking")).toBe("true");
    if (process.env.TAVORA_DISCORD_SCREENSHOT) await page.screenshot({ path: process.env.TAVORA_DISCORD_SCREENSHOT });
    fake.dispatch("SPEAKING_STOP", { user_id: "2", channel_id: "10" });
    await expect.poll(() => attribute(app, "discord-member-2", "data-speaking")).toBeNull();

    fake.dispatch("VOICE_STATE_DELETE", person("5", "Sarah"));
    await expect.poll(() => count(app, '[data-testid="discord-member-5"]')).toBe(0);

    // Joining a channel needs the player's own click too (D8).
    await clickInModule(app, DISCORD, "discord-join-11");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fake.commands.some((c) => c.cmd === "SELECT_VOICE_CHANNEL")).toBe(false);
    await gesture(app);
    await clickInModule(app, DISCORD, "discord-join-11");
    await expect.poll(() => fake.commands.find((c) => c.cmd === "SELECT_VOICE_CHANNEL")?.args).toEqual({ channel_id: "11", force: true });

    // Leaving voice in Discord.
    fake.answers.set("GET_SELECTED_VOICE_CHANNEL", () => ({ data: null }));
    fake.dispatch("VOICE_CHANNEL_SELECT", { channel_id: null });
    await expect.poll(() => count(app, '[data-testid="discord-no-call"]')).toBe(1);

    // Settings > Integrations > Discord lists the module, which can be taken back.
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-integrations").click();
    await expect(page.getByTestId(`discord-user-${DISCORD}`)).toBeVisible();
  } finally {
    await app.close();
  }
});
