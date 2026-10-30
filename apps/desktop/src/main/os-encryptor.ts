import { safeStorage } from "electron";
import type { Encryptor } from "./discord-store";

/**
 * The operating system's key store, for the sign-ins Tavora keeps (Discord, the Tavora account). Built once at start and
 * handed to everything that seals something. `test`: a test run, which accepts Linux's plain-text fallback.
 */
export function osEncryptor(test: boolean): Encryptor {
  // Test machines have no keyring; Linux's plain-text fallback stands in there (and only there).
  if (test && process.platform === "linux") safeStorage.setUsePlainTextEncryption(true);
  return {
    // Linux without a keyring falls back to a fixed key, which protects nothing; Tavora then saves no sign-in.
    isAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || test || safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (data) => safeStorage.decryptString(data),
  };
}
