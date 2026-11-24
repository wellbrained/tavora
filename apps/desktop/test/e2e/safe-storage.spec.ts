// Saved sign-ins are sealed by the system through Electron's safeStorage. Tavora moved from the sync calls to the async
// ones; what an older Tavora sealed must open now, and what this one seals must open in the older one. Run against the
// real safeStorage in Electron's main process, so the run on Windows proves both ways (macOS and Linux are inferred).
import { expect, test } from "@playwright/test";
import { launch } from "./harness";

test("what the sync calls seal opens with the async ones, and the other way round", async () => {
  const { app } = await launch();
  try {
    const result = await app.evaluate(async ({ safeStorage }) => {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
      const text = JSON.stringify({ token: "abc", n: "ünï" });
      const sealedBefore = safeStorage.encryptString(text);
      const sealedNow = await safeStorage.encryptStringAsync(text);
      const openedNow = await safeStorage.decryptStringAsync(sealedBefore);
      return { openedNow, openedBefore: safeStorage.decryptString(sealedNow), text };
    });
    // A PC with no key store (a bare Linux runner) has nothing to prove.
    test.skip(result === null, "no system key store on this PC");
    expect(result!.openedNow.result).toBe(result!.text);
    expect(result!.openedBefore).toBe(result!.text);
  } finally {
    await app.close();
  }
});
