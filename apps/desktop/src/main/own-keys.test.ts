import { describe, expect, it } from "vitest";
import { ownKeys } from "./own-keys";

describe("ownKeys", () => {
  const key = (fingerprint: string) => ({ fingerprint, linkedAt: "2026-11-01T00:00:00.000Z" });

  it("counts paused keys with the linked ones, so their modules stay the account's and no new key is made", () => {
    expect(ownKeys({ publisherKeys: [key("a")], pausedKeys: [key("b")] })).toEqual(["a", "b"]);
    expect(ownKeys({ publisherKeys: [], pausedKeys: [key("b")] })).toEqual(["b"]);
  });

  it("reads a service from before paused keys, and an account not read yet", () => {
    expect(ownKeys({ publisherKeys: [key("a")] })).toEqual(["a"]);
    expect(ownKeys({ publisherKeys: null, pausedKeys: null })).toEqual([]);
  });
});
