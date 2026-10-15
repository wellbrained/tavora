import { readFile, rm } from "node:fs/promises";
import type { DiscordSecrets, DiscordToken } from "./discord";
import { writeFileAtomic } from "./fsutil";

// The Discord Client Secret and sign-in, kept in discord.json in the user
// data folder and encrypted with the operating system's key store (Electron's
// safeStorage: DPAPI on Windows, the Keychain on macOS, the secret service on
// Linux). Where that is not available nothing is saved.

export interface Encryptor {
  isAvailable(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

const EMPTY: DiscordSecrets = { secret: null, token: null };
const MAX_SECRET = 200;

export const isClientSecret = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(value);

function token(value: unknown): DiscordToken | null {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const ok = (text: unknown) => typeof text === "string" && text.length > 0 && text.length <= 500;
  return ok(raw.accessToken) && ok(raw.refreshToken) && typeof raw.expiresAt === "number" && Number.isFinite(raw.expiresAt)
    ? { accessToken: raw.accessToken as string, refreshToken: raw.refreshToken as string, expiresAt: raw.expiresAt }
    : null;
}

export async function loadDiscordSecrets(file: string, encryptor: Encryptor): Promise<DiscordSecrets> {
  if (!encryptor.isAvailable()) return EMPTY;
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as { v?: unknown; data?: unknown };
    if (saved.v !== 1 || typeof saved.data !== "string") return EMPTY;
    const raw = JSON.parse(encryptor.decrypt(Buffer.from(saved.data, "base64"))) as Record<string, unknown>;
    const secret = isClientSecret(raw.secret) && raw.secret.length <= MAX_SECRET ? raw.secret : null;
    return { secret, token: secret ? token(raw.token) : null };
  } catch {
    // Missing, damaged, or encrypted by another user or PC: start without.
    return EMPTY;
  }
}

export async function saveDiscordSecrets(file: string, encryptor: Encryptor, secrets: DiscordSecrets): Promise<void> {
  if (!secrets.secret && !secrets.token) {
    await rm(file, { force: true });
    return;
  }
  if (!encryptor.isAvailable()) throw new Error("No secure storage on this PC.");
  const data = encryptor.encrypt(JSON.stringify(secrets)).toString("base64");
  await writeFileAtomic(file, JSON.stringify({ v: 1, data }));
}
