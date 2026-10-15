import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isClientSecret, loadDiscordSecrets, saveDiscordSecrets, type Encryptor } from "./discord-store";

// Stands in for safeStorage: reversible, and never the plain text.
const encryptor = (available = true): Encryptor => ({
  isAvailable: () => available,
  encrypt: (text) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a)),
  decrypt: (data) => Buffer.from([...data].map((byte) => byte ^ 0x5a)).toString(),
});

const file = async () => path.join(await mkdtemp(path.join(os.tmpdir(), "tavora-discord-store-")), "discord.json");
const TOKEN = { accessToken: "a", refreshToken: "r", expiresAt: 123 };

describe("Discord secrets on disk", () => {
  it("keeps the secret and sign-in encrypted and reads them back", async () => {
    const where = await file();
    await saveDiscordSecrets(where, encryptor(), { secret: "s3cret_value", token: TOKEN });
    const text = await readFile(where, "utf8");
    expect(text).not.toContain("s3cret_value");
    expect(await loadDiscordSecrets(where, encryptor())).toEqual({ secret: "s3cret_value", token: TOKEN, last: null, games: {} });
  });

  it("deletes the file when nothing is left to keep", async () => {
    const where = await file();
    await saveDiscordSecrets(where, encryptor(), { secret: "s3cret_value", token: null });
    await saveDiscordSecrets(where, encryptor(), { secret: null, token: null });
    await expect(stat(where)).rejects.toThrow();
  });

  it("starts empty when the file is missing, damaged or can't be decrypted here", async () => {
    const where = await file();
    expect(await loadDiscordSecrets(where, encryptor())).toEqual({ secret: null, token: null, last: null, games: {} });
    await saveDiscordSecrets(where, encryptor(), { secret: "s3cret_value", token: TOKEN });
    expect(await loadDiscordSecrets(where, encryptor(false))).toEqual({ secret: null, token: null, last: null, games: {} });
    const broken: Encryptor = { ...encryptor(), decrypt: () => "not json" };
    expect(await loadDiscordSecrets(where, broken)).toEqual({ secret: null, token: null, last: null, games: {} });
  });

  it("keeps the channel to rejoin, and drops one that is damaged", async () => {
    const where = await file();
    const last = { channelId: "10", guildId: "20", name: "Factory Floor", serverName: "Wellbrained Crew" };
    await saveDiscordSecrets(where, encryptor(), { secret: "s3cret_value", token: null, last });
    expect((await loadDiscordSecrets(where, encryptor())).last).toEqual(last);
    await saveDiscordSecrets(where, encryptor(), { secret: "s3cret_value", token: null, last: { ...last, channelId: "not an id" } });
    expect((await loadDiscordSecrets(where, encryptor())).last).toBeNull();
  });

  it("keeps the server of each game, and drops entries that are damaged", async () => {
    const where = await file();
    const games = {
      poe2: { guildId: "20", serverName: "Wellbrained Crew", channelId: "10", channelName: "Factory Floor" },
      satisfactory: { guildId: null, serverName: null, channelId: null, channelName: null },
    };
    await saveDiscordSecrets(where, encryptor(), { secret: "s3cret_value", token: null, games });
    expect((await loadDiscordSecrets(where, encryptor())).games).toEqual(games);
    const damaged = { "Not A Game!": games.poe2, poe2: { ...games.poe2, guildId: "x", channelId: "y" } };
    await saveDiscordSecrets(where, encryptor(), { secret: "s3cret_value", token: null, games: damaged });
    expect((await loadDiscordSecrets(where, encryptor())).games).toEqual({ poe2: { guildId: null, serverName: "Wellbrained Crew", channelId: null, channelName: "Factory Floor" } });
  });

  it("refuses to save without secure storage", async () => {
    await expect(saveDiscordSecrets(await file(), encryptor(false), { secret: "s3cret_value", token: null })).rejects.toThrow();
  });

  it("knows what a Client Secret looks like", () => {
    expect(isClientSecret("AbC_dEf-123456789012345678901234")).toBe(true);
    expect(isClientSecret("short")).toBe(false);
    expect(isClientSecret("with space 12345")).toBe(false);
    expect(isClientSecret(null)).toBe(false);
  });
});
