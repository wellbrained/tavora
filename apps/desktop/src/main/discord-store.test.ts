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
    expect(await loadDiscordSecrets(where, encryptor())).toEqual({ secret: "s3cret_value", token: TOKEN });
  });

  it("deletes the file when nothing is left to keep", async () => {
    const where = await file();
    await saveDiscordSecrets(where, encryptor(), { secret: "s3cret_value", token: null });
    await saveDiscordSecrets(where, encryptor(), { secret: null, token: null });
    await expect(stat(where)).rejects.toThrow();
  });

  it("starts empty when the file is missing, damaged or can't be decrypted here", async () => {
    const where = await file();
    expect(await loadDiscordSecrets(where, encryptor())).toEqual({ secret: null, token: null });
    await saveDiscordSecrets(where, encryptor(), { secret: "s3cret_value", token: TOKEN });
    expect(await loadDiscordSecrets(where, encryptor(false))).toEqual({ secret: null, token: null });
    const broken: Encryptor = { ...encryptor(), decrypt: () => "not json" };
    expect(await loadDiscordSecrets(where, broken)).toEqual({ secret: null, token: null });
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
