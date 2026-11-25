import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { describe, expect, it } from "vitest";
import { patchStored } from "./patch-stored";

describe("patchStored", () => {
  for (const atomic of [true, false]) {
    it(`changes only the given fields of the newest copy (${atomic ? "compareAndSet" : "read, then write"})`, async () => {
      const { sdk } = createMemoryHost();
      await sdk.storage.app.set("settings", { mode: "basic", decimals: 2, newer: "kept" });
      expect(await patchStored(sdk.storage.app, "settings", { mode: "plus" }, { atomic })).toEqual({ mode: "plus", decimals: 2, newer: "kept" });
      expect(await sdk.storage.app.get("settings")).toEqual({ mode: "plus", decimals: 2, newer: "kept" });
    });
  }

  it("tries again on the newer copy when another panel saved first", async () => {
    const { sdk } = createMemoryHost();
    await sdk.storage.app.set("settings", { a: 1 });
    const store = sdk.storage.app;
    let raced = false;
    const racing: typeof store = {
      ...store,
      get: async <T = JsonValue>(key: string) => {
        const value = await store.get(key);
        if (!raced) {
          raced = true;
          await store.set(key, { a: 1, b: 2 });
        }
        return value as T | null;
      },
    };
    expect(await patchStored(racing, "settings", { c: 3 }, { atomic: true })).toEqual({ a: 1, b: 2, c: 3 });
  });
});
