// Discord panel (docs/threat-model.md, D1 to D7). A pretend Discord app
// listens where the real one would, and a local server stands in for
// Discord's token address, so nothing here reaches Discord.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { fakeDiscord, type FakeDiscord } from "../../src/main/discord-fake.test-helper";
import { launch, openModule } from "./harness";

const DISCORD = "tavora.discord";
const SECRET = "test_Client-Secret_1234567890abc";

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
  fake.answers.set("AUTHENTICATE", () => ({ data: { user: { id: "1", username: "nik", global_name: "Nik" }, scopes: ["rpc", "rpc.voice.read", "identify"] } }));
  fake.answers.set("GET_SELECTED_VOICE_CHANNEL", () => ({
    data: {
      id: "10",
      guild_id: "20",
      name: "Factory Floor",
      voice_states: [person("1", "Nik"), person("2", "Jonas"), person("3", "Lena", { self_mute: true }), person("4", "Max", { self_mute: true, self_deaf: true }), person("5", "Sarah", { mute: true })],
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

test.afterAll(async () => {
  await fake.close();
  await new Promise((resolve) => tokens.close(resolve));
});

test("the Discord panel connects once approved and shows who is in the voice channel and who is talking", async () => {
  const { app, page, userData } = await launch(undefined, [], { env: { TAVORA_DISCORD_IPC: fake.path, TAVORA_DISCORD_TOKEN_URL: tokenUrl } });
  try {
    await openModule(page, DISCORD);
    const panel = page.getByTestId("discord-panel");
    await expect(panel).toContainText("Connect Discord");
    // Nothing is asked of Discord before the player connects.
    expect(fake.commands).toEqual([]);

    await panel.getByRole("button", { name: "Open Settings" }).click();
    await page.getByTestId("discord-secret").fill(SECRET);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("discord-secret-saved")).toBeVisible();
    // D3: kept encrypted, never in plain text on disk.
    expect(await readFile(path.join(userData, "discord.json"), "utf8")).not.toContain(SECRET);
    await page.keyboard.press("Escape");

    await panel.getByTestId("discord-connect").click();
    await expect(page.getByTestId("discord-server")).toHaveText("Wellbrained Crew");
    await expect(page.getByTestId("discord-current")).toContainText("Factory Floor");
    await expect(panel.locator("[data-testid^=discord-member-]")).toHaveCount(7);
    await expect(panel).toContainText("Lobby");
    // D2: only voice is read.
    expect(fake.commands.find((c) => c.cmd === "AUTHORIZE")?.args.scopes).toEqual(["rpc", "rpc.voice.read", "identify"]);
    // D1: the secret only goes to the token address.
    expect(tokenBodies.every((body) => body.includes(`client_secret=${SECRET}`))).toBe(true);

    fake.dispatch("SPEAKING_START", { user_id: "2", channel_id: "10" });
    await expect(page.getByTestId("discord-member-2")).toHaveAttribute("data-speaking", "true");
    fake.dispatch("SPEAKING_START", { user_id: "1", channel_id: "10" });
    await expect(page.getByTestId("discord-member-1")).toHaveAttribute("data-speaking", "true");
    if (process.env.TAVORA_DISCORD_SCREENSHOT) await page.screenshot({ path: process.env.TAVORA_DISCORD_SCREENSHOT });
    fake.dispatch("SPEAKING_STOP", { user_id: "2", channel_id: "10" });
    await expect(page.getByTestId("discord-member-2")).not.toHaveAttribute("data-speaking", "true");

    fake.dispatch("VOICE_STATE_DELETE", person("5", "Sarah"));
    await expect(page.getByTestId("discord-member-5")).toHaveCount(0);

    // Leaving voice in Discord.
    fake.answers.set("GET_SELECTED_VOICE_CHANNEL", () => ({ data: null }));
    fake.dispatch("VOICE_CHANNEL_SELECT", { channel_id: null });
    await expect(page.getByTestId("discord-no-call")).toBeVisible();
  } finally {
    await app.close();
  }
});
