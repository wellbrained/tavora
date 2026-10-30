import { describe, expect, it } from "vitest";
import type { SavedAccount } from "./account";
import { SignIn } from "./sign-in";

const SAVED: SavedAccount = { token: "t".repeat(40), email: "me@example.com", discord: null, createdAt: "2026-10-01T00:00:00Z" };

function signIn(enabled: boolean, stored: SavedAccount | null = SAVED) {
  const written: (SavedAccount | null)[] = [];
  let loads = 0;
  const store = new SignIn({
    enabled,
    load: async () => (loads++, stored),
    save: async (account) => void written.push(account),
  });
  return { store, written, loads: () => loads };
}

describe("SignIn", () => {
  it("has no token before it is read", () => {
    expect(signIn(true).store.token()).toBeNull();
  });

  it("gives the saved token once read, to everyone who holds it", async () => {
    const { store } = signIn(true);
    await store.load();
    const cloudCopy: { token(): string | null } = store;
    expect(cloudCopy.token()).toBe(SAVED.token);
    expect(store.current).toEqual(SAVED);
  });

  it("reads and gives nothing while accounts are off", async () => {
    const { store, loads } = signIn(false);
    await store.load();
    expect(loads()).toBe(0);
    expect(store.token()).toBeNull();
  });

  it("follows a sign-in and a sign-out, and writes them down only when asked", async () => {
    const { store, written } = signIn(true, null);
    await store.load();
    expect(store.token()).toBeNull();
    store.current = SAVED;
    expect(store.token()).toBe(SAVED.token);
    expect(written).toEqual([]);
    await store.persist(SAVED);
    store.current = null;
    await store.persist(null);
    expect(written).toEqual([SAVED, null]);
    expect(store.token()).toBeNull();
  });
});
