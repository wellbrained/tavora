import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDiscordSecrets, saveDiscordSecrets, type Encryptor } from "./discord-store";

// Stands in for safeStorage: reversible, and never the plain text.
const encryptor = (available = true): Encryptor => ({
  isAvailable: () => available,
  encrypt: (text) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a)),
  decrypt: (data) => Buffer.from([...data].map((byte) => byte ^ 0x5a)).toString(),
});

const file = async () => path.join(await mkdtemp(path.join(os.tmpdir(), "tavora-discord-store-")), "discord.json");
const TOKEN = { accessToken: "a", refreshToken: "r", expiresAt: 123 };

describe("Discord secrets on disk", () => {
  it("keeps the sign-in encrypted and reads it back", async () => {
    const where = await file();
    await saveDiscordSecrets(where, encryptor(), { token: TOKEN });
    const text = await readFile(where, "utf8");
    expect(text).not.toContain(TOKEN.accessToken + TOKEN.refreshToken);
    expect(await loadDiscordSecrets(where, encryptor())).toEqual({ token: TOKEN, last: null, games: {} });
  });

  it("deletes the file when nothing is left to keep", async () => {
    const where = await file();
    await saveDiscordSecrets(where, encryptor(), { token: null });
    await saveDiscordSecrets(where, encryptor(), { token: null });
    await expect(stat(where)).rejects.toThrow();
  });

  it("starts empty when the file is missing, damaged or can't be decrypted here", async () => {
    const where = await file();
    expect(await loadDiscordSecrets(where, encryptor())).toEqual({ token: null, last: null, games: {} });
    await saveDiscordSecrets(where, encryptor(), { token: TOKEN });
    expect(await loadDiscordSecrets(where, encryptor(false))).toEqual({ token: null, last: null, games: {} });
    const broken: Encryptor = { ...encryptor(), decrypt: () => "not json" };
    expect(await loadDiscordSecrets(where, broken)).toEqual({ token: null, last: null, games: {} });
  });

  it("keeps the channel to rejoin, and drops one that is damaged", async () => {
    const where = await file();
    const last = { channelId: "10", guildId: "20", name: "Factory Floor", serverName: "Wellbrained Crew" };
    await saveDiscordSecrets(where, encryptor(), { token: null, last });
    expect((await loadDiscordSecrets(where, encryptor())).last).toEqual(last);
    await saveDiscordSecrets(where, encryptor(), { token: null, last: { ...last, channelId: "not an id" } });
    expect((await loadDiscordSecrets(where, encryptor())).last).toBeNull();
  });

  it("keeps the server of each game, and drops entries that are damaged", async () => {
    const where = await file();
    const games = {
      poe2: { guildId: "20", serverName: "Wellbrained Crew", channelId: "10", channelName: "Factory Floor" },
      satisfactory: { guildId: null, serverName: null, channelId: null, channelName: null },
    };
    await saveDiscordSecrets(where, encryptor(), { token: null, games });
    expect((await loadDiscordSecrets(where, encryptor())).games).toEqual(games);
    const damaged = { "Not A Game!": games.poe2, poe2: { ...games.poe2, guildId: "x", channelId: "y" } };
    await saveDiscordSecrets(where, encryptor(), { token: null, games: damaged });
    expect((await loadDiscordSecrets(where, encryptor())).games).toEqual({ poe2: { guildId: null, serverName: "Wellbrained Crew", channelId: null, channelName: "Factory Floor" } });
  });

  it("refuses to save without secure storage", async () => {
    await expect(saveDiscordSecrets(await file(), encryptor(false), { token: TOKEN })).rejects.toThrow();
  });

  it("drops the Client Secret an older version kept, and writes the file again without it", async () => {
    const where = await file();
    const old = { secret: "s3cret_value", token: TOKEN, last: null, games: {} };
    await writeFile(where, JSON.stringify({ v: 1, data: encryptor().encrypt(JSON.stringify(old)).toString("base64") }));
    expect(await loadDiscordSecrets(where, encryptor())).toEqual({ token: TOKEN, last: null, games: {} });
    const again = JSON.parse(encryptor().decrypt(Buffer.from(JSON.parse(await readFile(where, "utf8")).data, "base64")));
    expect(again).toEqual({ token: TOKEN, last: null, games: {} });
    expect(again).not.toHaveProperty("secret");
  });

  it("keeps a sign-in that has no secret behind it", async () => {
    const where = await file();
    await saveDiscordSecrets(where, encryptor(), { token: TOKEN });
    expect((await loadDiscordSecrets(where, encryptor())).token).toEqual(TOKEN);
  });
});
