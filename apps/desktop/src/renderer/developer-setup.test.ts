import { describe, expect, it } from "vitest";
import type { AccountView, DeveloperKeysView } from "../shared/host-api";
import { developerSetup } from "./developer-setup";

const KEY = { fingerprint: "ab:cd" };
const signedIn = (side: Partial<AccountView> = {}) =>
  ({
    account: { email: "me@example.com", discord: null, createdAt: "2026-10-01T00:00:00.000Z" },
    developer: { name: "Nik", nextChangeAt: "2026-11-01T00:00:00.000Z" },
    publisherKeys: [{ ...KEY, linkedAt: "2026-10-01T00:00:00.000Z" }],
    ...side,
  }) as AccountView;
const keys = (status: DeveloperKeysView["status"], kept = [KEY]) => ({ status, keys: kept }) as DeveloperKeysView;

describe("developerSetup", () => {
  it("is ready with a name and a kept key linked to the account", () => {
    expect(developerSetup(signedIn(), keys("ready"))).toBe("ready");
  });

  it("is unknown while the developer side isn't read yet, so the card doesn't flash after a start or stay up offline", () => {
    expect(developerSetup(signedIn({ developer: null, publisherKeys: null }), keys("ready"))).toBe("unknown");
  });

  it("is unknown while the kept keys are still loading or couldn't be read", () => {
    expect(developerSetup(signedIn(), null)).toBe("unknown");
    expect(developerSetup(signedIn(), keys("loading", []))).toBe("unknown");
    expect(developerSetup(signedIn(), keys("offline", []))).toBe("unknown");
  });

  it("is unknown before the account is read", () => {
    expect(developerSetup(null, null)).toBe("unknown");
  });

  it("is missing when signed out", () => {
    expect(developerSetup(signedIn({ account: null, developer: null, publisherKeys: null }), keys("signed-out", []))).toBe("missing");
  });

  it("is missing once read without a name, a key, or a linked key", () => {
    expect(developerSetup(signedIn({ developer: null }), keys("ready"))).toBe("missing");
    expect(developerSetup(signedIn(), keys("none", []))).toBe("missing");
    expect(developerSetup(signedIn({ publisherKeys: [] }), keys("ready"))).toBe("missing");
  });
});
