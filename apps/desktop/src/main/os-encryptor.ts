import { safeStorage } from "electron";
import type { Encryptor } from "./discord-store";

/**
 * The operating system's key store, for the sign-ins Tavora keeps (Discord, the Tavora account). Built once at start and
 * handed to everything that seals something. `test`: a test run, which accepts Linux's plain-text fallback.
 *
 * Uses safeStorage's async calls (the sync ones go in Electron 46). They read and write the same bytes as the sync ones.
 */
export function osEncryptor(test: boolean): Encryptor {
  // Test machines have no keyring; Linux's plain-text fallback stands in there (and only there).
  if (test && process.platform === "linux") safeStorage.setUsePlainTextEncryption(true);
  let available = false;
  let checking: Promise<boolean> | null = null;
  const check = async (): Promise<boolean> => {
    // Linux without a keyring falls back to a fixed key, which protects nothing; Tavora then saves no sign-in.
    available = (await safeStorage.isAsyncEncryptionAvailable()) && (process.platform !== "linux" || test || safeStorage.getSelectedStorageBackend() !== "basic_text");
    return available;
  };
  return {
    // One check at a time; each caller gets a fresh answer (a locked keyring can open later).
    ready: () => {
      checking ??= check().finally(() => {
        checking = null;
      });
      return checking;
    },
    isAvailable: () => available,
    encrypt: (text) => safeStorage.encryptStringAsync(text),
    decrypt: async (data) => {
      const read = await safeStorage.decryptStringAsync(data);
      // The key was rotated: the second read gives the text the new key would give.
      return read.shouldReEncrypt ? (await safeStorage.decryptStringAsync(data)).result : read.result;
    },
  };
}
