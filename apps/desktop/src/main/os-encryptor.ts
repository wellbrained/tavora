import { safeStorage } from "electron";
import type { Encryptor } from "./discord-store";

/** How long the system's key store may take to answer before it counts as not available for that call. */
const ASK_LIMIT_MS = 10_000;

/** A question the system never answered is asked again after this long (or when the user acts), instead of waiting for it for good. */
const ASK_AGAIN_MS = 60_000;

/**
 * The operating system's key store, for the sign-ins Tavora keeps (Discord, the Tavora account). Built once at start and
 * handed to everything that seals something. `test`: a test run, which accepts Linux's plain-text fallback.
 *
 * Uses safeStorage's async calls (the sync ones go in Electron 46). They read and write the same bytes as the sync ones.
 */
export function osEncryptor(test: boolean, limit = ASK_LIMIT_MS, answeredLate?: () => void, askAgainAfter = ASK_AGAIN_MS): Encryptor {
  // Test machines have no keyring; Linux's plain-text fallback stands in there (and only there).
  if (test && process.platform === "linux") safeStorage.setUsePlainTextEncryption(true);
  let available = false;
  // The question to the system is still open; `wait` is what callers share while it is, and `gaveUp` that its wait ran out.
  let open = false;
  let gaveUp = false;
  let startedAt = 0;
  /** Which question is the current one; an older one that answers late still updates `available`, nothing else. */
  let turn = 0;
  /** Questions to the system not answered yet; while two are, the user's acts ask no more (no stacked keyring prompts). */
  let unanswered = 0;
  let wait: Promise<boolean> | null = null;
  const check = async (): Promise<boolean> => {
    // Linux without a keyring falls back to a fixed key, which protects nothing; Tavora then saves no sign-in.
    const answer = (await safeStorage.isAsyncEncryptionAvailable()) && (process.platform !== "linux" || test || safeStorage.getSelectedStorageBackend() !== "basic_text");
    // Once yes, it stays yes: an older question that answers no after a newer one said yes changes nothing.
    available ||= answer;
    return answer;
  };
  const ask = (): Promise<boolean> => {
    open = true;
    gaveUp = false;
    startedAt = Date.now();
    const mine = ++turn;
    unanswered++;
    const asked: Promise<boolean> = new Promise((resolve) => {
      // A key store that doesn't answer (a prompt nobody sees, a stuck service) counts as not available for now.
      const timer = setTimeout(() => {
        gaveUp = true;
        resolve(false);
      }, limit);
      timer.unref();
      void check().catch(() => false).then((answer) => {
        clearTimeout(timer);
        unanswered--;
        const lateOne = answer && (mine !== turn || gaveUp);
        if (mine === turn) {
          open = false;
          if (wait === asked) wait = null;
          gaveUp = false;
        }
        resolve(answer);
        // The answer came after the wait ended: the views that showed "not available" are told.
        if (lateOne) answeredLate?.();
      });
    });
    return asked;
  };
  return {
    // Asked when something needs it, not at start. Once it said yes it stays yes; after a no (a keyring locked for now)
    // the next call asks again. One question at a time; while one that timed out is still open, later calls say no at
    // once instead of waiting for it again.
    // `again`: the user acted (Turn on, keep the sign-in), so a question that timed out is asked again now.
    ready: (again = false) => {
      if (available) return Promise.resolve(true);
      if (open && !(gaveUp && unanswered < 2 && (again || Date.now() - startedAt >= askAgainAfter))) return gaveUp ? Promise.resolve(false) : wait!;
      wait = ask();
      return wait;
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
