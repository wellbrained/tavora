// The discord connector (the threat model, D1 to D9), used by a small probe module from test/connector-fixtures.
// The Discord module itself lives in the catalog now; what it shows is tested in its own repo.
// A pretend Discord app listens where the real one would, and a local server
// stands in for Discord's token address, so nothing here reaches Discord.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { fakeDiscord, type FakeDiscord } from "../../src/main/discord-fake.test-helper";
import { clickInModule, desktopDir, expectModuleText, inModule, launch } from "./harness";

const DISCORD = "local.test.discord-probe";
/** Not in test/fixtures, which every launch loads: a module asking for Discord would show its settings in every spec. */
const PROBES = path.join(desktopDir, "test/connector-fixtures");

let fake: FakeDiscord;
let tokens: Server;
let tokenUrl: string;
const tokenBodies: string[] = [];

test.beforeAll(async () => {
  fake = await fakeDiscord();
  fake.answers.set("AUTHORIZE", () => ({ data: { code: "code123" } }));
  fake.answers.set("AUTHENTICATE", () => ({ data: { user: { id: "1", username: "alex", global_name: "Alex" }, scopes: ["rpc", "rpc.voice.read", "rpc.voice.write", "identify"] } }));
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

/** A real key press in the module's page, so what follows counts as the user's own click (D8). */
async function gesture(app: ElectronApplication) {
  await app.evaluate(({ webContents }, moduleId) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
    if (!target) throw new Error("no panel");
    target.sendInputEvent({ type: "keyDown", keyCode: "Shift" });
    target.sendInputEvent({ type: "keyUp", keyCode: "Shift" });
  }, DISCORD);
}

/** What the host answered the probe for one of its buttons so far. */
const answers = (app: ElectronApplication, label: string) =>
  inModule<{ ok: boolean }[]>(app, DISCORD, `window.probe.results.filter((r) => r.label === ${JSON.stringify(label)}).map((r) => r.answer)`).catch(() => []);
const events = (app: ElectronApplication) => inModule<{ event: string }[]>(app, DISCORD, "window.probe.events").catch(() => []);

test.afterAll(async () => {
  await fake.close();
  await new Promise((resolve) => tokens.close(resolve));
});

test("a module with the discord connector asks first, connects once approved and acts only after the user's own click", async () => {
  const { app, page, userData } = await launch(undefined, [PROBES], { env: { TAVORA_DISCORD_IPC: fake.path, TAVORA_DISCORD_TOKEN_URL: tokenUrl } });
  try {
    // Adding it asks to let it use Discord with Tavora's sign-in (the module grants row of 2026-10-16).
    await page.getByTestId("add-module").click();
    await page.getByTestId(`open-${DISCORD}`).click();
    await expect(page.getByTestId("grant-dialog")).toBeVisible();
    await expect(page.getByTestId("grant-discord")).toContainText("Join or leave a voice channel when you click");
    await page.getByTestId("grant-allow").click();
    await expectModuleText(app, DISCORD, "probe-status", "ready");
    // Nothing is asked of Discord before the user connects.
    expect(fake.commands).toEqual([]);

    // Connecting needs the user's own click (D8).
    await clickInModule(app, DISCORD, "probe-connect");
    await expect.poll(async () => (await answers(app, "connect")).length).toBe(1);
    expect(fake.commands.some((c) => c.cmd === "AUTHORIZE")).toBe(false);
    expect((await answers(app, "connect"))[0]!.ok).toBe(false);
    await gesture(app);
    await clickInModule(app, DISCORD, "probe-connect");
    await expect.poll(async () => (await answers(app, "connect")).length).toBe(2);
    expect((await answers(app, "connect"))[1]!.ok).toBe(true);
    await expect.poll(() => inModule<string | undefined>(app, DISCORD, "window.probe.states.at(-1)?.status")).toBe("connected");
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

    // The module gets the events it subscribed to.
    fake.dispatch("VOICE_CHANNEL_SELECT", { channel_id: null });
    await expect.poll(async () => (await events(app)).some((e) => e.event === "VOICE_CHANNEL_SELECT")).toBe(true);

    // Muting needs the user's own click too (D8): unmuting would switch their microphone back on.
    await clickInModule(app, DISCORD, "probe-mute");
    await expect.poll(async () => (await answers(app, "mute")).length).toBe(1);
    expect(fake.commands.some((c) => c.cmd === "SET_VOICE_SETTINGS")).toBe(false);
    await gesture(app);
    await clickInModule(app, DISCORD, "probe-mute");
    await expect.poll(() => fake.commands.find((c) => c.cmd === "SET_VOICE_SETTINGS")?.args).toEqual({ mute: true });

    // Joining a channel needs the user's own click too (D8).
    await clickInModule(app, DISCORD, "probe-join-11");
    await expect.poll(async () => (await answers(app, "join")).length).toBe(1);
    expect(fake.commands.some((c) => c.cmd === "SELECT_VOICE_CHANNEL")).toBe(false);
    await gesture(app);
    await clickInModule(app, DISCORD, "probe-join-11");
    await expect.poll(() => fake.commands.find((c) => c.cmd === "SELECT_VOICE_CHANNEL")?.args).toEqual({ channel_id: "11", force: true });

    // Settings > Integrations > Discord lists the module (it asks for the connector).
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-integrations").click();
    await expect(page.getByTestId(`discord-user-${DISCORD}`)).toBeVisible();
  } finally {
    await app.close();
  }
});
