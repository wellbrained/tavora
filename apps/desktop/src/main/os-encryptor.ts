import { safeStorage } from "electron";
import type { Encryptor } from "./discord-store";

/** How long the system's key store may take to answer before it counts as not available for that call. */
const ASK_LIMIT_MS = 10_000;

/**
 * The operating system's key store, for the sign-ins Tavora keeps (Discord, the Tavora account). Built once at start and
 * handed to everything that seals something. `test`: a test run, which accepts Linux's plain-text fallback.
 *
 * Uses safeStorage's async calls (the sync ones go in Electron 46). They read and write the same bytes as the sync ones.
 */
export function osEncryptor(test: boolean, limit = ASK_LIMIT_MS): Encryptor {
  // Test machines have no keyring; Linux's plain-text fallback stands in there (and only there).
  if (test && process.platform === "linux") safeStorage.setUsePlainTextEncryption(true);
  let available = false;
  let checking: Promise<boolean> | null = null;
  const check = async (): Promise<boolean> => {
    // Linux without a keyring falls back to a fixed key, which protects nothing; Tavora then saves no sign-in.
    available = (await safeStorage.isAsyncEncryptionAvailable()) && (process.platform !== "linux" || test || safeStorage.getSelectedStorageBackend() !== "basic_text");
    return available;
  };
  const ask = (): Promise<boolean> =>
    new Promise((resolve) => {
      // A key store that doesn't answer (a prompt nobody sees, a stuck service) counts as not available for now.
      const timer = setTimeout(() => resolve(false), limit);
      timer.unref();
      const done = (answer: boolean) => {
        clearTimeout(timer);
        resolve(answer);
      };
      check().then(done, () => done(false));
    });
  return {
    // Asked when something needs it, not at start. Once it said yes it stays yes; after a no (a keyring locked for now)
    // the next call asks again. One question at a time.
    ready: () => {
      if (available) return Promise.resolve(true);
      checking ??= ask().finally(() => {
        checking = null;
      });
      return checking;
    },
    isAvailable: () => available,
    encrypt: (text) => safeStorage.encryptStringAsync(text),
    decrypt: async (data, note) => {
      const read = await safeStorage.decryptStringAsync(data);
      if (!read.shouldReEncrypt) return read.result;
      // The system's key has moved on: the second read gives the text under the new key, and the caller is told to seal it again.
      if (note) note.stale = true;
      return (await safeStorage.decryptStringAsync(data)).result;
    },
  };
}
