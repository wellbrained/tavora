import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadTrustedSavedKey } from "./official-saved-key";

const key: KeyObject = generateKeyPairSync("ed25519").privateKey;

function store(saved: KeyObject | null) {
  const calls: string[] = [];
  return { calls, store: { load: async () => saved, forget: async () => void calls.push("forget") } };
}

describe("loadTrustedSavedKey", () => {
  it("returns a saved key that is still trusted and keeps it", async () => {
    const { store: s, calls } = store(key);
    expect(await loadTrustedSavedKey(s, () => true, () => calls.push("pushed"))).toBe(key);
    expect(calls).toEqual([]);
  });

  it("forgets a saved key that is no longer pinned or is revoked", async () => {
    const { store: s, calls } = store(key);
    expect(await loadTrustedSavedKey(s, () => false, () => calls.push("pushed"))).toBeNull();
    expect(calls).toEqual(["forget", "pushed"]);
  });

  it("has nothing to forget when no key is saved", async () => {
    const { store: s, calls } = store(null);
    expect(await loadTrustedSavedKey(s, () => false, () => calls.push("pushed"))).toBeNull();
    expect(calls).toEqual([]);
  });
});
